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

import { ok } from '@adobe/spacecat-shared-http-utils';
import { Suggestion as SuggestionModel, Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { addAltTextSuggestions, getProjectedMetrics } from './opportunityHandler.js';
import { DATA_SOURCES } from '../common/constants.js';
import { checkGoogleConnection } from '../common/opportunity-utils.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

/**
 * Maps Mystique alt-text suggestions to the same format used in opportunityHandler.js
 * @param {Array} mystiquesuggestions - Array of suggestions from Mystique
 * @returns {Array} Array of suggestions in the same format as opportunityHandler
 */
function mapMystiqueSuggestionsToOpportunityFormat(mystiquesuggestions) {
  console.log(`[${AUDIT_TYPE}]: Mystiquesuggestions: ${JSON.stringify(mystiquesuggestions)}`);

  return mystiquesuggestions.map((suggestion) => {
    const suggestionId = `${suggestion.pageUrl}/${suggestion.imageId}`;

    return {
      id: suggestionId,
      pageUrl: suggestion.pageUrl,
      imageUrl: suggestion.imageUrl,
      altText: suggestion.altText,
      isAppropriate: suggestion.isAppropriate,
      isDecorative: suggestion.isDecorative,
      xpath: '', // TODO: Add logic to determine the xpath
      language: suggestion.language,
    };
  });
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity, Site } = dataAccess;
  const { auditId, siteId, data } = message;
  const { suggestions } = data || {};

  log.info(`[${AUDIT_TYPE}]: Received Mystique guidance for alt-text: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  const auditUrl = site.getBaseURL();

  log.info(`[${AUDIT_TYPE}]: Syncing opportunity and suggestions for ${siteId}
    and auditUrl: ${auditUrl}`);
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

  // Map Mystique suggestions first
  const mappedSuggestions = mapMystiqueSuggestionsToOpportunityFormat(suggestions || []);

  // Calculate projected metrics based on Mystique suggestions
  // (all suggestions are images without alt-text)
  const projectedMetrics = await getProjectedMetrics({
    images: mappedSuggestions.map((suggestion) => ({
      pageUrl: suggestion.pageUrl,
      src: suggestion.imageUrl,
    })),
    auditUrl,
    context,
    log,
  });

  const opportunityData = {
    ...projectedMetrics,
    decorativeImagesCount:
    mappedSuggestions.filter((suggestion) => suggestion.isDecorative === true).length,
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

  // Process suggestions from Mystique
  if (suggestions && suggestions.length > 0) {
    await addAltTextSuggestions({
      opportunity: altTextOppty,
      newSuggestionDTOs: mappedSuggestions.map((suggestion) => ({
        opportunityId: altTextOppty.getId(),
        type: SuggestionModel.TYPES.CONTENT_UPDATE,
        data: { recommendations: [suggestion] },
        rank: 1,
      })),
      log,
    });

    log.info(`[${AUDIT_TYPE}]: Successfully synced ${suggestions.length} suggestions from Mystique for siteId: ${siteId}`);
    log.info(`[${AUDIT_TYPE}]: Successfully synced Opportunity And Suggestions for site: ${auditUrl} siteId: ${siteId} and alt-text audit type.`);
  }

  log.info(`[${AUDIT_TYPE}]: Successfully processed Mystique guidance for siteId: ${siteId}`);
  return ok();
}
