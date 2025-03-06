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
import { convertImagesToBase64 } from './auditEngine.js';

const PROMPT_FILE = 'image-alt-text';
const BATCH_SIZE = 3;
const BATCH_DELAY = 5000;
const MODEL = 'gpt-4o';
// https://platform.openai.com/docs/guides/vision
const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

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

const getImageSuggestions = async (images, context) => {
  const { log } = context;
  const firefallClient = FirefallClient.createFrom(context);

  const processedImages = images.map((image) => {
    if (image.blob) {
      return {
        ...image,
        blob: convertImagesToBase64(image),
      };
    }
    return image;
  });

  const imageBatches = chunkArray(processedImages, BATCH_SIZE);
  const batchPromises = promptOnlyBatchPromises(imageBatches, firefallClient, log);

  const batchedResults = await Promise.all(batchPromises);

  const suggestionsByImageUrl = [...batchedResults]
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
