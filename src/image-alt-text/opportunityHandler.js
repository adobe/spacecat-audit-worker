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

import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { Audit } from '@adobe/spacecat-shared-data-access';

/**
 * Synchronizes existing suggestions with new data
 * by removing existing suggestions and adding new ones.
 *
 * @param {Object} params - The parameters for the sync operation.
 * @param {Object} params.opportunity - The opportunity object to synchronize suggestions for.
 * @param {Array} params.newSuggestions - Array of new data objects to sync.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export async function syncAltTextSuggestions({ opportunity, newSuggestions, log }) {
  const existingSuggestions = await opportunity.getSuggestions();

  // Remove existing suggestions
  await Promise.all(existingSuggestions.map((suggestion) => suggestion.remove()));

  // Add new suggestions to oppty
  if (isNonEmptyArray(newSuggestions)) {
    const updateResult = await opportunity.addSuggestions(newSuggestions);

    if (isNonEmptyArray(updateResult.errorItems)) {
      log.error(`Suggestions for siteId ${opportunity.getSiteId()} contains ${updateResult.errorItems.length} items with errors`);
      updateResult.errorItems.forEach((errorItem) => {
        log.error(`Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
      });

      if (!isNonEmptyArray(updateResult.createdItems)) {
        throw new Error(`Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
      }
    }
  }
}
// TO-DO: Implement in https://jira.corp.adobe.com/browse/ASSETS-47371
const getProjectedMetrics = () => ({
  projectedTrafficLost: 3871,
  projectedTrafficValue: 7355,
});

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export default async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  const { detectedTags } = auditData.auditResult;

  log.info(`Syncing opportunity and suggestions for ${auditData.siteId}`);
  let altTextOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === Audit.AUDIT_TYPES.ALT_TEXT,
    );
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  try {
    if (!altTextOppty) {
      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: 'https://adobe.sharepoint.com/:w:/s/aemsites-engineering/EeEUbjd8QcFOqCiwY0w9JL8BLMnpWypZ2iIYLd0lDGtMUw?e=XSmEjh',
        type: Audit.AUDIT_TYPES.ALT_TEXT,
        origin: 'AUTOMATION',
        title: 'Missing alt text for images decreases accessibility and discoverability of content',
        description: 'Missing alt text on images leads to poor seo scores, low accessibility scores and search engine failing to surface such images with keyword search',
        guidance: {
          recommendations: [
            {
              insight: 'Alt text for images decreases accessibility and limits discoverability',
              recommendation: 'Add meaningful alt text on images that clearly articulate the subject matter of the image',
              type: null,
              rationale: 'Alt text for images is vital to ensure your content is discoverable and usable for many people as possible',
            },
          ],
        },
        data: getProjectedMetrics(),
        tags: ['seo', 'accessibility'],
      };
      altTextOppty = await Opportunity.create(opportunityData);
      log.debug('Alt-text Opportunity created');
    } else {
      altTextOppty.setAuditId(auditData.id);
      await altTextOppty.save();
    }
  } catch (e) {
    log.error(`Creating alt-text opportunity for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
    throw new Error(`Failed to create alt-text opportunity for siteId ${auditData.siteId}: ${e.message}`);
  }

  const suggestions = detectedTags.imagesWithoutAltText.map((image) => ({
    pageUrl: new URL(image.pageUrl, auditUrl).toString(),
    imageUrl: new URL(image.src, auditUrl).toString(),
  }));

  const firefallClient = FirefallClient.createFrom(context);
  // const prompt = await getPrompt({}, 'image-alt-text', log);
  const prompt = 'You re tasked with identifying suitable text for the alt attribute of images. You are an expert SEO consultant, and your goal is to suggest a description for each image that is helpful for the user.### Rules:1. Follow the industry guidelines for accessibility, https://www.w3.org/WAI/tutorials/images/2. Alt-text should reflect how the image relates to the content. Avoid irrelevant descriptions.3. Use natural language, ensuring you\'re not "stuffing" SEO keys.4. If an image is purely decorative and adds no functional or informational value, use an empty string as the alt text.5. For infographics, describe the key data points and trends.6. Ideal description length is 50-60 characters.7. Dont duplicate text thats adjacent in the document or website.8. End the alt text sentence with a period.9. The alt text should be helpful for the user, not the search engine.10. Consider key elements of why you chose this image, instead of describing every little detail. No need to say image of or picture of. But, do say if its a logo, illustration, painting, or cartoon.11. If you can recognize a person in the image, use their name when known.### Response Format:Your response must be a valid JSON object with the following json structure:{image_url: string of the url you used to check the image,suggestion: string of the suggestion you found,ai_rationale: string,confidence_score: number}**IMPORTANT:**- Provide only the JSON object. Do not include any additional text, explanation, or formatting.### Task:Given this list list of images, suggest a description for the alt attribute of each image that is helpful for the user.';
  const recommendableSuggestions = suggestions.filter((s) => {
    const { imageUrl } = s;
    const regex = /\.(webp|png|gif|jpeg)(?=\?|$)/i;
    return imageUrl.contains('bamboo') && regex.test(imageUrl);
  });
  const imageList = recommendableSuggestions.map((suggestion) => suggestion.imageUrl);
  log.info('About to call Firefall with images', imageList);
  log.info('and prompt', prompt);

  function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  const batchSize = 10;
  const imageBatches = chunkArray(imageList, batchSize);

  const batchPromises = imageBatches.map(async (batch) => {
    const firefallOptions = {
      imageUrls: batch,
      model: 'gpt-4-vision',
    };

    try {
      const response = await firefallClient.fetchChatCompletion(prompt, firefallOptions);
      log.info('Firefall response for alt-text suggestions', JSON.stringify(response));
      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error('No final suggestions found for batch');
      }

      const answer = JSON.parse(response.choices[0].message.content);
      log.info(`Final suggestion for batch, ${JSON.stringify(answer)}`, answer);
    } catch (err) {
      log.error('Error calling Firefall for alt-text suggestion generation for batch', err);
    }
  });

  await Promise.all(batchPromises);

  log.debug(`Suggestions: ${JSON.stringify(suggestions)}`);

  await syncAltTextSuggestions({
    opportunity: altTextOppty,
    newSuggestions: suggestions.map((suggestion) => ({
      opportunityId: altTextOppty.getId(),
      type: 'CONTENT_UPDATE',
      data: { recommendations: [suggestion] },
      rank: 1,
    })),
    log,
  });

  log.info(`Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and alt-text audit type.`);
}
