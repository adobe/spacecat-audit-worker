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
import { getPrompt, isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { sleep } from '../support/utils.js';

const PROMPT_FILE = 'image-alt-text';
const BATCH_SIZE = 3;
const BATCH_DELAY = 5000;
const MODEL = 'gpt-4o';
// https://platform.openai.com/docs/guides/vision
const FF_SUPPORTED_FORMATS = /\.(webp|png|gif|jpeg|jpg)(?=\?|$)/i;
const FF_UNSUPPORTED_FORMATS = /\.(svg|bmp|tiff|ico)(?=\?|$)/i;
const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

const mimeTypesForBase64 = {
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
};

const filterImages = (imageUrls) => {
  const supportedImages = [];
  const unsupportedFormatImages = [];

  imageUrls.forEach((imageUrl) => {
    if (!FF_SUPPORTED_FORMATS.test(imageUrl)) {
      unsupportedFormatImages.push(imageUrl);
    } else {
      supportedImages.push(imageUrl);
    }
  });

  return { supportedImages, unsupportedFormatImages };
};

const chunkArray = (array, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

const getFirefallResponse = async (prompt, firefallClient, firefallOptions, log) => {
  try {
    log.info(`[${AUDIT_TYPE}]: Batch prompt:`, prompt);
    const response = await firefallClient.fetchChatCompletion(prompt, firefallOptions);
    if (isNonEmptyArray(response.choices) && response.choices[0].finish_reason !== 'stop') {
      log.error(`[${AUDIT_TYPE}]: No final suggestions found for batch`);
    }

    const answer = JSON.parse(response.choices[0].message.content);
    log.info(`[${AUDIT_TYPE}]: Loaded ${answer.length} alt-text suggestions for batch`);
    return answer;
  } catch (err) {
    log.error(`[${AUDIT_TYPE}]: Error calling Firefall for alt-text suggestion generation for batch`, err);
    return [];
  }
};

const promptOnlyBatchPromises = (
  imageBatches,
  firefallClient,
  log,
) => imageBatches.map(async (batch, index) => {
  await sleep(index * BATCH_DELAY);

  const firefallOptions = {
    model: MODEL,
  };
  const prompt = await getPrompt({ images: batch }, PROMPT_FILE, log);
  return getFirefallResponse(prompt, firefallClient, firefallOptions, log);
});

const convertImagesToBase64 = async (imageUrls, log) => {
  const base64Blobs = [];

  const fetchPromises = imageUrls.map(async (url) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image from ${url}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const match = url.match(FF_UNSUPPORTED_FORMATS);
      const extension = match ? match[1].toLowerCase() : '';
      const mimeType = mimeTypesForBase64[extension] || 'application/octet-stream'; // Default to a generic binary type
      const base64String = Buffer.from(arrayBuffer).toString('base64');
      base64Blobs.push({ url, blob: `data:${mimeType};base64,${base64String}` });
    } catch (error) {
      log.error(`[${AUDIT_TYPE}]: Error downloading blob for ${url}:`, error);
    }
  });

  await Promise.all(fetchPromises);

  return base64Blobs;
};

const getImageSuggestions = async (imageUrls, auditUrl, context) => {
  const { log } = context;
  const firefallClient = FirefallClient.createFrom(context);

  const filteredImages = filterImages(imageUrls, auditUrl);

  log.info(`[${AUDIT_TYPE}]: Supported FF images:`, filteredImages.supportedImages);
  log.info(`[${AUDIT_TYPE}]: Unsupported FF images:`, filteredImages.unsupportedFormatImages);

  const base64Images = await convertImagesToBase64(filteredImages.unsupportedFormatImages, log);

  const supportedImageBatches = chunkArray(filteredImages.supportedImages, BATCH_SIZE);
  const batchPromises = promptOnlyBatchPromises(supportedImageBatches, firefallClient, log);

  const base64ImageBatches = chunkArray(Object.values(base64Images), BATCH_SIZE);
  const base64BatchPromises = promptOnlyBatchPromises(base64ImageBatches, firefallClient, log);

  const batchedSupportedResults = await Promise.all(batchPromises);
  const batchedBase64Results = await Promise.all(base64BatchPromises);

  const suggestionsByImageUrl = [...batchedSupportedResults, ...batchedBase64Results]
    .reduce((acc, result) => {
      result.forEach((item) => {
        acc[item.image_url] = item;
      });
      return acc;
    }, {});

  log.info(`[${AUDIT_TYPE}]: Final Merged Suggestions: ${Object.keys(suggestionsByImageUrl).length}`);

  return suggestionsByImageUrl;
};

export default {
  getImageSuggestions,
};
