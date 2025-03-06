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

const getMimeType = async (url) => {
  const match = url.match(SUPPORTED_BLOB_FORMATS);
  const extension = match[1].toLowerCase();
  return mimeTypesForBase64[extension];
};

export const convertImagesToBase64 = async (imageUrls, auditUrl, log, fetch) => {
  const base64Blobs = [];

  const fetchPromises = imageUrls.map(async (url) => {
    try {
      const response = await fetch(new URL(url, auditUrl).toString());
      if (!response.ok) {
        throw new Error(`Failed to fetch image from ${url}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64String = Buffer.from(arrayBuffer).toString('base64');
      const mimeType = await getMimeType(url);
      base64Blobs.push({ url, blob: `data:${mimeType};base64,${base64String}` });
    } catch (error) {
      log.error(`[${AUDIT_TYPE}]: Error downloading blob for ${url}:`, error);
    }
  });

  await Promise.all(fetchPromises);

  return base64Blobs;
};

export default class AuditEngine {
  constructor(log) {
    this.log = log;
    this.auditedTags = {
      imagesWithoutAltText: new Map(),
    };
  }

  performPageAudit(pageUrl, pageTags) {
    if (!isNonEmptyArray(pageTags?.images)) {
      this.log.debug(`[${AUDIT_TYPE}]: No images found for page ${pageUrl}`);
      return;
    }

    pageTags.images.forEach((image) => {
      if (!hasText(image.alt?.trim())) {
        this.auditedTags.imagesWithoutAltText.set(image.src, {
          pageUrl,
          src: image.src,
        });
      }
    });
  }

  async filterImages(baseURL, fetch) {
    try {
      const imageUrls = Array.from(this.auditedTags.imagesWithoutAltText.keys());
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
        const originalData = this.auditedTags.imagesWithoutAltText.get(url);
        filteredImages.set(url, originalData);
      });
      this.log.info(`[${AUDIT_TYPE}]: Supported images:`, Array.from(filteredImages.values()));

      // Add unique blobs to the map
      const uniqueBlobsMap = new Map();
      base64Blobs.forEach(({ url, blob }) => {
        if (!uniqueBlobsMap.has(blob)) {
          const originalData = this.auditedTags.imagesWithoutAltText.get(url);
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

      // Add unique blobs to the filtered map
      uniqueBlobsMap.forEach((originalData) => {
        filteredImages.set(originalData.src, { ...originalData, blob: !!originalData.blob });
      });

      this.auditedTags.imagesWithoutAltText = filteredImages;
    } catch (error) {
      this.log.error(`[${AUDIT_TYPE}]: Error processing images for base64 conversion:`, error);
    }
  }

  finalizeAudit() {
    // Log summary
    this.log.info(
      `[${AUDIT_TYPE}]: Found ${Array.from(this.auditedTags.imagesWithoutAltText.values()).length} images without alt text`,
    );
  }

  getAuditedTags() {
    return { imagesWithoutAltText: Array.from(this.auditedTags.imagesWithoutAltText.values()) };
  }
}
