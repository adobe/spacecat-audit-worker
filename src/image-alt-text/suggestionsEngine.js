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

export const getImageSuggestions = async (imageUrls, auditUrl, context) => {
  const { log } = context;
  const firefallClient = FirefallClient.createFrom(context);

  const imagesFromHost = [];
  const otherImages = [];
  const unsupportedFormatImages = [];

  imageUrls.forEach((imageUrl) => {
    const regex = /\.(webp|png|gif|jpeg)(?=\?|$)/i;

    if (!regex.test(imageUrl)) {
      unsupportedFormatImages.push(imageUrl);
    } else if (imageUrl.includes(auditUrl)) {
      imagesFromHost.push(imageUrl);
    } else {
      otherImages.push(imageUrl);
    }
  });

  log.info('Images from host:', imagesFromHost);
  log.info('Other images:', otherImages);
  log.info('Unsupported format images:', unsupportedFormatImages);

  const imageList = imagesFromHost;
  log.info('About to call Firefall with images', imageList);

  function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  const BATCH_SIZE = 10;
  const BATCH_DELAY = 5000;
  const imageBatches = chunkArray(imageList, BATCH_SIZE);

  const batchPromises = imageBatches.map(async (batch, index) => {
    await sleep(index * BATCH_DELAY);

    const firefallOptions = {
      imageUrls: batch,
      model: 'gpt-4-vision',
    };
    const prompt = await getPrompt({ images: batch }, 'image-alt-text', log);
    log.info('and prompt', prompt);
    try {
      const response = await firefallClient.fetchChatCompletion(prompt, firefallOptions);
      log.info('Firefall response for alt-text suggestions', JSON.stringify(response));
      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error('No final suggestions found for batch');
      }

      const answer = JSON.parse(response.choices[0].message.content);
      log.info(`Final suggestion for batch, ${JSON.stringify(answer)}`);
      return answer;
    } catch (err) {
      log.error('Error calling Firefall for alt-text suggestion generation for batch', err);
      return [];
    }
  });

  const results = await Promise.all(batchPromises);

  const finalResults = results.reduce((acc, result) => {
    result.forEach((item) => {
      acc[item.image_url] = item;
    });
    return acc;
  }, {});

  log.info(`Final Merged Suggestions: ${JSON.stringify(finalResults)}`);

  return finalResults;
};
