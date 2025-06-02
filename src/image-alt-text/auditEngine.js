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

  const fetchPromises = imageUrls.map(async (url) => {
    try {
      const response = await fetch(new URL(url, auditUrl).toString());
      if (!response.ok) {
        throw new Error(`Failed to fetch image from ${url}`);
      }

      const contentLength = response.headers.get('Content-Length');
      if (contentLength && parseInt(contentLength, 10) > MAX_SIZE_BYTES) {
        log.info(`[${AUDIT_TYPE}]: Skipping image ${url} as it exceeds ${MAX_SIZE_KB}KB`);
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64String = Buffer.from(arrayBuffer).toString('base64');
      const mimeType = await getMimeType(url);
      const base64Blob = `data:${mimeType};base64,${base64String}`;

      if (Buffer.byteLength(base64Blob, 'utf8') > MAX_SIZE_BYTES) {
        log.info(`[${AUDIT_TYPE}]: Skipping base64 image ${url} as it exceeds ${MAX_SIZE_KB}KB`);
        return;
      }

      base64Blobs.push({ url, blob: base64Blob });
    } catch (error) {
      log.error(`[${AUDIT_TYPE}]: Error downloading blob for ${url}:`, error);
    }
  });

  await Promise.all(fetchPromises);

  return base64Blobs;
};

function detectLanguageFromText(text) {
  const langCode = franc(text);
  return langCode !== 'und' ? langCode : UNKNOWN_LANGUAGE;
}

function detectLanguageFromDom({ document }) {
  const htmlTag = document.querySelector('html');
  if (htmlTag && htmlTag.hasAttribute('lang')) {
    return htmlTag.getAttribute('lang');
  }

  const metaTags = document.querySelectorAll('meta[http-equiv="Content-Language"], meta[name="language"]');
  for (const meta of metaTags) {
    if (meta.hasAttribute('content')) {
      return meta.getAttribute('content');
    }
  }

  return UNKNOWN_LANGUAGE;
}

function detectLanguageFromUrl(pageUrl) {
  const url = new URL(pageUrl);
  const pathSegments = url.pathname.split('/');
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

  return null;
}

const getPageLanguage = ({ document, pageUrl }) => {
  let lang = UNKNOWN_LANGUAGE;
  if (!document) {
    return lang;
  }

  if (pageUrl) {
    const urlLanguage = detectLanguageFromUrl(pageUrl);
    if (urlLanguage) {
      return urlLanguage;
    }
  }
  lang = detectLanguageFromDom({ document });
  if (lang === UNKNOWN_LANGUAGE) {
    // Check the page URL for the language
    // if (pageUrl) {
    //   const urlLanguage = detectLanguageFromUrl(pageUrl);
    //   if (urlLanguage) {
    //     return urlLanguage;
    //   }
    // }

    const bodyText = document.querySelector('body').textContent;
    const cleanedText = bodyText.replace(/[\n\t]/g, '').replace(/ {2,}/g, ' ');
    lang = detectLanguageFromText(cleanedText);
  }
  return lang;
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

    pageImages.images.forEach((image) => {
      if (!hasText(image.alt?.trim())) {
        if (image.isDecorative) {
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
      }
    });
  }

  async filterImages(baseURL, fetch) {
    try {
      const imageUrls = Array.from(this.auditedImages.imagesWithoutAltText.keys());
      const supportedBlobUrls = imageUrls.filter((url) => SUPPORTED_BLOB_FORMATS.test(url));
      const supportedImageUrls = imageUrls.filter((url) => SUPPORTED_FORMATS.test(url));
      const base64Blobs = await convertImagesToBase64(
        supportedBlobUrls,
        baseURL,
        this.log,
        fetch,
      );
      const filteredImages = new Map();

      // Add supported images directly to the map
      supportedImageUrls.forEach((url) => {
        const originalData = this.auditedImages.imagesWithoutAltText.get(url);
        filteredImages.set(url, originalData);
      });
      this.log.info(`[${AUDIT_TYPE}]: Supported images:`, Array.from(filteredImages.values()));

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
