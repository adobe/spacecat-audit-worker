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

import { isNonEmptyArray, tracingFetch } from '@adobe/spacecat-shared-utils';
import { Audit as AuditModel, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import suggestionsEngine from './suggestionsEngine.js';
import { getRUMUrl, toggleWWW } from '../support/utils.js';
import { CPC, PENALTY_PER_IMAGE, RUM_INTERVAL } from './constants.js';
import { DATA_SOURCES } from '../common/constants.js';
import { checkGoogleConnection } from '../common/opportunity-utils.js';

const getImageSuggestionIdentifier = (suggestion) => `${suggestion.pageUrl}/${suggestion.src}`;
const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

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

  const IGNORED_STATUSES = [SuggestionModel.STATUSES.SKIPPED, SuggestionModel.STATUSES.FIXED];
  const ignoredSuggestions = existingSuggestions.filter(
    (s) => IGNORED_STATUSES.includes(s.getStatus()),
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
      log.error(`[${AUDIT_TYPE}]: Suggestions for siteId ${opportunity.getSiteId()} contains ${updateResult.errorItems.length} items with errors`);
      updateResult.errorItems.forEach((errorItem) => {
        log.error(`[${AUDIT_TYPE}]: Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
      });

      if (!isNonEmptyArray(updateResult.createdItems)) {
        throw new Error(`[${AUDIT_TYPE}]: Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
      }
    }
  }
}

const getProjectedMetrics = async ({
  images, auditUrl, context, log,
}) => {
  let finalUrl;
  let results;

  try {
    finalUrl = await getRUMUrl(auditUrl);
    const rumAPIClient = RUMAPIClient.createFrom(context);
    const options = {
      domain: finalUrl,
      interval: RUM_INTERVAL,
    };

    results = await rumAPIClient.query('traffic-acquisition', options);
  } catch (err) {
    log.error(`[${AUDIT_TYPE}]: Failed to get RUM results for ${auditUrl} with error: ${err.message}`);
    return {
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
    };
  }

  const pageUrlToOrganicTrafficMap = results.reduce((acc, page) => {
    acc[page.url] = {
      organicTraffic: page.earned,
      imagesWithoutAltText: 0,
    };
    return acc;
  }, {});

  images.forEach((image) => {
    const fullPageUrl = new URL(image.pageUrl, auditUrl).toString();

    // Images from RUM (might) come with www while our scraper gives us always non-www pages
    if (pageUrlToOrganicTrafficMap[fullPageUrl]) {
      pageUrlToOrganicTrafficMap[fullPageUrl].imagesWithoutAltText += 1;
    } else if (pageUrlToOrganicTrafficMap[toggleWWW(fullPageUrl)]) {
      pageUrlToOrganicTrafficMap[toggleWWW(fullPageUrl)].imagesWithoutAltText += 1;
    } else {
      log.debug(`[${AUDIT_TYPE}]: Page URL ${fullPageUrl} or ${toggleWWW(fullPageUrl)} not found in RUM API results`);
    }
  });

  const projectedTrafficLost = Object.values(pageUrlToOrganicTrafficMap)
    .reduce(
      (acc, page) => acc + (page.organicTraffic * PENALTY_PER_IMAGE * page.imagesWithoutAltText),
      0,
    );

  const projectedTrafficValue = projectedTrafficLost * CPC;
  return {
    projectedTrafficLost: Math.round(projectedTrafficLost),
    projectedTrafficValue: Math.round(projectedTrafficValue),
  };
};

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export default async function convertToOpportunity(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  const { detectedImages, siteId, auditId } = auditData;

  log.info(`[${AUDIT_TYPE}]: Syncing opportunity and suggestions for ${siteId}`);
  let altTextOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === AUDIT_TYPE,
    );
  } catch (e) {
    log.error(`[${AUDIT_TYPE}]: Fetching opportunities for siteId ${siteId} failed with error: ${e.message}`);
    throw new Error(`[${AUDIT_TYPE}]: Failed to fetch opportunities for siteId ${siteId}: ${e.message}`);
  }

  const projectedMetrics = await getProjectedMetrics({
    images:
      detectedImages.imagesWithoutAltText
        .map((image) => ({ src: image.src, pageUrl: image.pageUrl })),
    auditUrl,
    context,
    log,
  });

  const opportunityData = {
    ...projectedMetrics,
    decorativeImagesCount: detectedImages.decorativeImagesCount,
  };
  opportunityData.dataSources = [
    DATA_SOURCES.RUM,
    DATA_SOURCES.SITE,
    DATA_SOURCES.AHREFS,
    DATA_SOURCES.GSC,
  ];

  const isGoogleConnected = await checkGoogleConnection(auditUrl, context);

  if (!isGoogleConnected && opportunityData.dataSources) {
    opportunityData.dataSources = opportunityData.dataSources
      .filter((source) => source !== DATA_SOURCES.GSC);
  }

  try {
    if (!altTextOppty) {
      const opportunityDTO = {
        siteId,
        auditId,
        runbook: 'https://adobe.sharepoint.com/:w:/s/aemsites-engineering/EeEUbjd8QcFOqCiwY0w9JL8BLMnpWypZ2iIYLd0lDGtMUw?e=XSmEjh',
        type: AUDIT_TYPE,
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
        data: opportunityData,
        tags: ['seo', 'accessibility'],
      };
      altTextOppty = await Opportunity.create(opportunityDTO);
      log.debug(`[${AUDIT_TYPE}]: Opportunity created`);
    } else {
      altTextOppty.setAuditId(auditId);
      altTextOppty.setData(opportunityData);
      altTextOppty.setUpdatedBy('system');
      await altTextOppty.save();
    }
  } catch (e) {
    log.error(`[${AUDIT_TYPE}]: Creating alt-text opportunity for siteId ${siteId} failed with error: ${e.message}`, e);
    throw new Error(`[${AUDIT_TYPE}]: Failed to create alt-text opportunity for siteId ${siteId}: ${e.message}`);
  }

  const imageUrls = detectedImages.imagesWithoutAltText.map(
    (image) => {
      const el = { url: new URL(image.src, auditUrl).toString() };

      if (image.blob) {
        el.blob = image.blob;
      }
      el.language = image.language;
      return el;
    },
  ).filter((image) => image !== null);

  const imageSuggestions = await suggestionsEngine.getImageSuggestions(
    imageUrls,
    context,
    tracingFetch,
  );

  const suggestions = detectedImages.imagesWithoutAltText.map((image) => {
    const imageUrl = new URL(image.src, auditUrl).toString();
    return {
      id: getImageSuggestionIdentifier(image),
      pageUrl: new URL(image.pageUrl, auditUrl).toString(),
      imageUrl,
      altText: imageSuggestions[imageUrl]?.suggestion || '',
      isAppropriate: imageSuggestions[imageUrl]?.is_appropriate ?? null,
      xpath: image.xpath,
      language: image.language,
    };
  });

  log.debug(`[${AUDIT_TYPE}]: Suggestions: ${JSON.stringify(suggestions)}`);

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

  log.info(`[${AUDIT_TYPE}]: Successfully synced Opportunity And Suggestions for site: ${auditUrl} siteId: ${siteId} and alt-text audit type.`);
}
