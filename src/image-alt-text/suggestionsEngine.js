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
import { getPrompt } from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { sleep } from '../support/utils.js';

const PROMPT_FILE = 'image-alt-text';
const BATCH_SIZE = 10;
const BATCH_DELAY = 5000;
const MODEL = 'gpt-4o';
// https://platform.openai.com/docs/guides/vision
const SUPPORTED_FORMATS = /\.(webp|png|gif|jpeg|jpg)(?=\?|$)/i;

const filterImages = (imageUrls, auditUrl) => {
  const imagesFromHost = [];
  const otherImages = [];
  const unsupportedFormatImages = [];

  imageUrls.forEach((imageUrl) => {
    if (!SUPPORTED_FORMATS.test(imageUrl)) {
      unsupportedFormatImages.push(imageUrl);
    } else if (imageUrl.includes(auditUrl)) {
      imagesFromHost.push(imageUrl);
    } else {
      otherImages.push(imageUrl);
    }
  });

  return { imagesFromHost, otherImages, unsupportedFormatImages };
};

const chunkArray = (array, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

const generateBatchPromises = (
  imageBatches,
  firefallClient,
  log,
) => imageBatches.map(async (batch, index) => {
  await sleep(index * BATCH_DELAY);

  const firefallOptions = {
    imageUrls: batch,
    model: MODEL,
    additionalHeaders: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  };
  const prompt = await getPrompt({ images: batch }, PROMPT_FILE, log);
  try {
    const response = await firefallClient.fetchChatCompletion(prompt, firefallOptions);
    if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
      log.error('[alt-text]: No final suggestions found for batch');
    }

    const answer = JSON.parse(response.choices[0].message.content);
    log.info(`[alt-text]: Loaded ${answer.length} alt-text suggestions for batch`);
    return answer;
  } catch (err) {
    log.error('[alt-text]: Error calling Firefall for alt-text suggestion generation for batch', err);
    return [];
  }
});

const getImageSuggestions = async (imageUrls, auditUrl, context) => {
  const { log } = context;
  const firefallClient = FirefallClient.createFrom(context);

  const filteredImages = filterImages(imageUrls, auditUrl);

  log.info('[alt-text]: Total images from host:', filteredImages.imagesFromHost.length);
  log.info('[alt-text]: Other images:', filteredImages.otherImages);
  log.info('[alt-text]: Unsupported format images:', filteredImages.unsupportedFormatImages);

  const supportedImageBatches = chunkArray(filteredImages.imagesFromHost, BATCH_SIZE);

  const batchPromises = generateBatchPromises(supportedImageBatches, firefallClient, log);

  const batchedResults = await Promise.all(batchPromises);

  const suggestionsByImageUrl = batchedResults.reduce((acc, result) => {
    result.forEach((item) => {
      acc[item.image_url] = item;
    });
    return acc;
  }, {});

  log.info(`[alt-text]: Final Merged Suggestions: ${Object.keys(suggestionsByImageUrl).length}`);

  return suggestionsByImageUrl;
};

export default {
  getImageSuggestions,
};
