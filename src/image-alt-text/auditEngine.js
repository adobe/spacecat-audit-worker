/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { isNonEmptyArray, hasText } from '@adobe/spacecat-shared-utils';
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { franc } from 'franc-min';
import { validCountryCodes } from './country-code.js';

// GPT support: https://platform.openai.com/docs/guides/vision
const SUPPORTED_FORMATS = /\.(webp|png|gif|jpeg|jpg)(?=\?|$)/i;
const SUPPORTED_BLOB_FORMATS = /\.(svg|bmp|tiff|ico)(?=\?|$)/i;
const mimeTypesForBase64 = {
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
};
const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;
const UNKNOWN_LANGUAGE = 'unknown';

const getMimeType = async (url) => {
  const match = url.match(SUPPORTED_BLOB_FORMATS);
  const extension = match[1].toLowerCase();
  return mimeTypesForBase64[extension];
};

export const convertImagesToBase64 = async (imageUrls, auditUrl, log, fetch) => {
  const base64Blobs = [];
  // ~120KB is the max size for a blob that GPT will digest
  const MAX_SIZE_KB = 120;
  const MAX_SIZE_BYTES = MAX_SIZE_KB * 1024;

  log.info(`[${AUDIT_TYPE}]: Starting base64 conversion for ${imageUrls.length} images`);
  log.info(`[${AUDIT_TYPE}]: Max size limit: ${MAX_SIZE_KB}KB (${MAX_SIZE_BYTES} bytes)`);

  const fetchPromises = imageUrls.map(async (url) => {
    try {
      log.debug(`[${AUDIT_TYPE}]: Fetching image: ${url}`);
      const response = await fetch(new URL(url, auditUrl).toString());
      if (!response.ok) {
        log.warn(`[${AUDIT_TYPE}]: Failed to fetch image from ${url} - Status: ${response.status}`);
        return;
      }

      const contentLength = response.headers.get('Content-Length');
      if (contentLength && parseInt(contentLength, 10) > MAX_SIZE_BYTES) {
        log.info(`[${AUDIT_TYPE}]: Skipping image ${url} as it exceeds ${MAX_SIZE_KB}KB (Content-Length: ${contentLength})`);
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64String = Buffer.from(arrayBuffer).toString('base64');
      const mimeType = await getMimeType(url);
      const base64Blob = `data:${mimeType};base64,${base64String}`;

      if (Buffer.byteLength(base64Blob, 'utf8') > MAX_SIZE_BYTES) {
        log.info(`[${AUDIT_TYPE}]: Skipping base64 image ${url} as it exceeds ${MAX_SIZE_KB}KB (Base64 size: ${Buffer.byteLength(base64Blob, 'utf8')} bytes)`);
        return;
      }

      log.debug(`[${AUDIT_TYPE}]: Successfully converted ${url} to base64 (size: ${Buffer.byteLength(base64Blob, 'utf8')} bytes)`);
      base64Blobs.push({ url, blob: base64Blob });
    } catch (error) {
      log.error(`[${AUDIT_TYPE}]: Error downloading blob for ${url}:`, error);
    }
  });

  await Promise.all(fetchPromises);

  log.info(`[${AUDIT_TYPE}]: Base64 conversion completed. Successfully converted ${base64Blobs.length} out of ${imageUrls.length} images`);
  return base64Blobs;
};

function detectLanguageFromText(text) {
  const langCode = franc(text);
  return langCode !== 'und' ? langCode : UNKNOWN_LANGUAGE;
}

function detectLanguageFromDom({ document }) {
  const metaTags = document.querySelectorAll('meta[http-equiv="Content-Language"], meta[name="language"]');
  for (const meta of metaTags) {
    if (meta.hasAttribute('content')) {
      return meta.getAttribute('content');
    }
  }

  return UNKNOWN_LANGUAGE;
}

function detectLanguageFromUrl(pageUrl) {
  const pathSegments = pageUrl.split('/');
  const segmentsToCheck = pathSegments.slice(0, -1);

  // Check each path segment for country codes
  for (const segment of segmentsToCheck) {
    if (segment.length > 0) {
      const lowerSegment = segment.toLowerCase();
      if (validCountryCodes.has(lowerSegment)) {
        return lowerSegment;
      }
    }
  }

  return UNKNOWN_LANGUAGE;
}

const getPageLanguage = ({ document, pageUrl }) => {
  if (!document) {
    return UNKNOWN_LANGUAGE;
  }

  // Try DOM-based detection first
  const domLanguage = detectLanguageFromDom({ document });
  if (domLanguage !== UNKNOWN_LANGUAGE) {
    return domLanguage;
  }

  // Try URL-based detection if pageUrl is available
  if (pageUrl) {
    const urlLanguage = detectLanguageFromUrl(pageUrl);
    if (urlLanguage !== UNKNOWN_LANGUAGE) {
      return urlLanguage;
    }
  }

  // Fall back to text-based detection
  const bodyText = document.querySelector('body')?.textContent;
  if (bodyText) {
    const cleanedText = bodyText.replace(/[\n\t]/g, '').replace(/ {2,}/g, ' ');
    return detectLanguageFromText(cleanedText);
  }

  return UNKNOWN_LANGUAGE;
};

export default class AuditEngine {
  constructor(log) {
    this.log = log;
    this.auditedImages = {
      imagesWithoutAltText: new Map(),
      decorativeImagesWithoutAltText: new Map(),
    };
  }

  performPageAudit(pageUrl, pageImages) {
    if (!isNonEmptyArray(pageImages?.images)) {
      this.log.debug(`[${AUDIT_TYPE}]: No images found for page ${pageUrl}`);
      return;
    }

    const pageLanguage = getPageLanguage({ document: pageImages.dom?.window?.document, pageUrl });

    this.log.debug(`[${AUDIT_TYPE}]: Language: ${pageLanguage}, Page: ${pageUrl}`);
    this.log.info(`[${AUDIT_TYPE}]: Processing ${pageImages.images.length} images for page ${pageUrl}`);

    let imagesWithoutAltText = 0;
    let decorativeImages = 0;
    let imagesWithAltText = 0;

    pageImages.images.forEach((image) => {
      if (!hasText(image.alt?.trim())) {
        imagesWithoutAltText += 1;
        if (image.isDecorative) {
          decorativeImages += 1;
          this.auditedImages.decorativeImagesWithoutAltText.set(image.src, {
            pageUrl,
            src: image.src,
            xpath: image.xpath,
          });
        }

        if (image.shouldShowAsSuggestion) {
          this.auditedImages.imagesWithoutAltText.set(image.src, {
            pageUrl,
            src: image.src,
            xpath: image.xpath,
            language: pageLanguage,
          });
        }
      } else {
        imagesWithAltText += 1;
      }
    });

    this.log.info(`[${AUDIT_TYPE}]: Page ${pageUrl} summary - Total: ${pageImages.images.length}, Without alt: ${imagesWithoutAltText}, With alt: ${imagesWithAltText}, Decorative: ${decorativeImages}, Should suggest: ${this.auditedImages.imagesWithoutAltText.size - this.auditedImages.decorativeImagesWithoutAltText.size}`);
  }

  async filterImages(baseURL, fetch) {
    try {
      const imageUrls = Array.from(this.auditedImages.imagesWithoutAltText.keys());

      // Log initial state
      this.log.info(`[${AUDIT_TYPE}]: Starting filterImages - Total images without alt text: ${imageUrls.length}`);
      this.log.info(`[${AUDIT_TYPE}]: Image URLs:`, imageUrls);

      const supportedBlobUrls = imageUrls.filter((url) => SUPPORTED_BLOB_FORMATS.test(url));
      const supportedImageUrls = imageUrls.filter((url) => SUPPORTED_FORMATS.test(url));

      // Log filtering results
      this.log.info(`[${AUDIT_TYPE}]: Supported blob formats (svg|bmp|tiff|ico): ${supportedBlobUrls.length}`);
      this.log.info(`[${AUDIT_TYPE}]: Supported image formats (webp|png|gif|jpeg|jpg): ${supportedImageUrls.length}`);
      this.log.info(`[${AUDIT_TYPE}]: Supported blob URLs:`, supportedBlobUrls);
      this.log.info(`[${AUDIT_TYPE}]: Supported image URLs:`, supportedImageUrls);

      // Log URLs that don't match any format
      const unsupportedUrls = imageUrls.filter(
        (url) => !SUPPORTED_BLOB_FORMATS.test(url) && !SUPPORTED_FORMATS.test(url),
      );
      this.log.info(`[${AUDIT_TYPE}]: Unsupported URLs (no format match): ${unsupportedUrls.length}`);
      this.log.info(`[${AUDIT_TYPE}]: Unsupported URLs:`, unsupportedUrls);

      const base64Blobs = await convertImagesToBase64(
        supportedBlobUrls,
        baseURL,
        this.log,
        fetch,
      );

      // Log base64 conversion results
      this.log.info(`[${AUDIT_TYPE}]: Base64 conversion successful for ${base64Blobs.length} blobs`);

      const filteredImages = new Map();

      // Add supported images directly to the map
      supportedImageUrls.forEach((url) => {
        const originalData = this.auditedImages.imagesWithoutAltText.get(url);
        filteredImages.set(url, originalData);
      });
      this.log.info(`[${AUDIT_TYPE}]: Supported images added to filtered map: ${filteredImages.size}`);

      // Add unique blobs to the map
      const uniqueBlobsMap = new Map();
      base64Blobs.forEach(({ url, blob }) => {
        if (!uniqueBlobsMap.has(blob)) {
          const originalData = this.auditedImages.imagesWithoutAltText.get(url);
          uniqueBlobsMap.set(blob, { ...originalData, blob });
        }
      });

      // Log unique blobs with blob existence as true/false
      this.log.info(
        `[${AUDIT_TYPE}]: Unique blobs:`,
        Array.from(uniqueBlobsMap.values()).map((data) => ({
          ...data,
          blob: !!data.blob,
        })),
      );
      // Log total blobs
      this.log.info(`[${AUDIT_TYPE}]: Total blobs:`, base64Blobs.length);

      // Add unique blobs to the filtered map
      uniqueBlobsMap.forEach((originalData) => {
        filteredImages.set(originalData.src, { ...originalData, blob: !!originalData.blob });
      });

      // Log final results
      this.log.info(`[${AUDIT_TYPE}]: Final filtered images count: ${filteredImages.size}`);
      this.log.info(`[${AUDIT_TYPE}]: Images filtered out: ${imageUrls.length - filteredImages.size}`);

      this.auditedImages.imagesWithoutAltText = filteredImages;
    } catch (error) {
      this.log.error(`[${AUDIT_TYPE}]: Error processing images for base64 conversion:`, error);
    }
  }

  finalizeAudit() {
    // Log summary
    this.log.info(
      `[${AUDIT_TYPE}]: Found ${Array.from(this.auditedImages.imagesWithoutAltText.values()).length} images without alt text`,
    );
    this.log.info(
      `[${AUDIT_TYPE}]: Found ${Array.from(this.auditedImages.decorativeImagesWithoutAltText.values()).length} decorative images`,
    );
  }

  getAuditedTags() {
    return {
      imagesWithoutAltText: Array.from(this.auditedImages.imagesWithoutAltText.values()),
      decorativeImagesCount: Array.from(
        this.auditedImages.decorativeImagesWithoutAltText.values(),
      ).length,
    };
  }
}

export { getPageLanguage, detectLanguageFromText };
