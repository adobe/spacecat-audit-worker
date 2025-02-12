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

import { OPPORTUNITY_TYPES } from './constants.js';

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
  if (newSuggestions.length > 0) {
    const updateResult = await opportunity.addSuggestions(newSuggestions);

    if (updateResult.errorItems?.length > 0) {
      log.error(`Suggestions for siteId ${opportunity.getSiteId()} contains ${updateResult.errorItems.length} items with errors`);
      updateResult.errorItems.forEach((errorItem) => {
        log.error(`Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
      });

      if (updateResult.createdItems?.length <= 0) {
        throw new Error(`Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
      }
    }
  }
}

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export default async function convertToOpportunity(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  const { detectedTags } = auditData.auditResult;

  log.info(`Syncing opportunity and suggestions for ${auditData.siteId}`);
  let altTextOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === OPPORTUNITY_TYPES.MISSING_ALT_TEXT,
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
        type: OPPORTUNITY_TYPES.MISSING_ALT_TEXT,
        origin: 'AUTOMATION',
        title: 'Missing alt text for images decreases accessibility and discoverability of content',
        description: 'Missing alt text on images leads to poor seo scores, low accessibility scores and search engine failing to surface such images with keyword search',
        guidance: {
          steps: [
            'Review the list of images missing alt text',
            'For each image, determine appropriate descriptive alt text that conveys the image content and purpose',
            'Add the alt text attribute to the image tags in your content',
            'Ensure the alt text is concise but descriptive',
            'Publish the changes to apply the updates to your live site',
          ],
        },
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
    url: image.url,
    src: image.src,
    issue: 'Missing alt text',
    suggestion: 'Add descriptive alt text to this image to improve accessibility and SEO',
  }));

  log.debug(`Suggestions: ${JSON.stringify(suggestions)}`);

  await syncAltTextSuggestions({
    opportunity: altTextOppty,
    newSuggestions: suggestions.map((suggestion) => ({
      opportunityId: altTextOppty.getId(),
      type: 'ALT_TEXT_UPDATE', // Is this necessary maybe for the UI?
      data: { ...suggestion },
      rank: 1, // They share all the same importance, so what number should we use here?
    })),
    log,
  });

  log.info(`Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and alt-text audit type.`);
}
