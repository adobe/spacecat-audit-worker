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
import { Audit as AuditModel, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';

const getImageSuggestionIdentifier = (suggestion) => `${suggestion.pageUrl}/${suggestion.src}`;

/**
 * Synchronizes existing suggestions with new data
 * by removing existing suggestions and adding new ones.
 *
 * @param {Object} params - The parameters for the sync operation.
 * @param {Object} params.opportunity - The opportunity object to synchronize suggestions for.
 * @param {Array} params.newSuggestionDTOs - Array of new data objects (not models) to sync.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export async function syncAltTextSuggestions({ opportunity, newSuggestionDTOs, log }) {
  const existingSuggestions = await opportunity.getSuggestions();

  const ignoredSuggestions = await opportunity.getSuggestionsByStatus(
    SuggestionModel.STATUSES.SKIPPED,
  );
  const ignoredSuggestionIds = ignoredSuggestions.map((s) => s.getData().recommendations[0].id);

  // Remove existing suggestions that were not ignored
  await Promise.all(existingSuggestions
    .filter(
      (suggestion) => !ignoredSuggestionIds.includes(suggestion.getData().recommendations[0].id),
    )
    .map((suggestion) => suggestion.remove()));

  const suggestionsToAdd = newSuggestionDTOs.filter(
    (s) => !ignoredSuggestionIds.includes(s.data.recommendations[0].id),
  );

  // Add new suggestions to oppty
  if (isNonEmptyArray(suggestionsToAdd)) {
    const updateResult = await opportunity.addSuggestions(suggestionsToAdd);

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
export default async function convertToOpportunity(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  const { detectedTags } = auditData.auditResult;

  log.info(`Syncing opportunity and suggestions for ${auditData.siteId}`);
  let altTextOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === AuditModel.AUDIT_TYPES.ALT_TEXT,
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
        type: AuditModel.AUDIT_TYPES.ALT_TEXT,
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
    id: getImageSuggestionIdentifier(image),
  }));

  log.debug(`Suggestions: ${JSON.stringify(suggestions)}`);

  await syncAltTextSuggestions({
    opportunity: altTextOppty,
    newSuggestionDTOs: suggestions.map((suggestion) => ({
      opportunityId: altTextOppty.getId(),
      type: SuggestionModel.TYPES.CONTENT_UPDATE,
      data: { recommendations: [suggestion] },
      rank: 1,
    })),
    log,
  });

  log.info(`Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and alt-text audit type.`);
}
