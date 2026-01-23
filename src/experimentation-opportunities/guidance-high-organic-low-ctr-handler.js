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

import { notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { convertToOpportunityEntity } from './opportunity-data-mapper.js';
import { HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE } from './handler.js';

const MAX_HIGH_ORGANIC_LOW_CTR_OPPORTUNITIES = 3;

/**
 * Checks if any suggestions in the array were manually modified (updatedBy !== 'system')
 * @param {Array} suggestions - Array of suggestion objects
 * @returns {boolean} - True if any suggestion was manually modified
 */
function hasManuallyModifiedSuggestions(suggestions) {
  return suggestions.some((suggestion) => {
    const suggestionUpdatedBy = suggestion.getUpdatedBy();
    return suggestionUpdatedBy && suggestionUpdatedBy !== 'system';
  });
}

/**
 * Gets the eviction score for an opportunity. Higher score = higher priority to keep.
 * Currently uses pageViews as the metric. This function can be modified to use
 * different metrics like opportunityImpact in the future.
 * @param {Object} opportunity - The opportunity object
 * @returns {number} - The eviction score (higher = more important to keep)
 */
function getEvictionScore(opportunity) {
  return opportunity.getData()?.pageViews || 0;
}

/**
 * Finds the opportunity with the lowest eviction score (candidate for removal).
 * @param {Array} opportunities - Array of opportunity objects
 * @returns {Object} - The opportunity with the lowest eviction score
 */
function findLowestScoringOpportunity(opportunities) {
  return opportunities.reduce((lowest, current) => {
    const lowestScore = getEvictionScore(lowest);
    const currentScore = getEvictionScore(current);
    return currentScore < lowestScore ? current : lowest;
  });
}

/**
 * Filters opportunities to get only high-organic-low-ctr type.
 * @param {Array} opportunities - Array of opportunity objects
 * @returns {Array} - Filtered array of high-organic-low-ctr opportunities
 */
function filterHighOrganicLowCtrOpportunities(opportunities) {
  return opportunities.filter((oppty) => oppty.getType() === HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE);
}

/**
 * Removes an opportunity and all its associated suggestions.
 * @param {Object} opportunity - The opportunity to remove
 * @returns {Promise<void>}
 */
async function removeOpportunityWithSuggestions(opportunity) {
  const suggestions = await opportunity.getSuggestions();
  await Promise.all(suggestions.map((s) => s.remove()));
  await opportunity.remove();
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { url, guidance, suggestions } = data;
  log.info(`Message received in high-organic-low-ctr handler: ${JSON.stringify(message, null, 2)}`);
  /* c8 ignore start */
  let audit;
  try {
    audit = await Audit.findById(auditId);
  } catch (error) {
    log.error(`Error finding audit by ID ${auditId}: ${error.message}`, error);
    throw error;
  }
  /* c8 ignore stop */
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }

  let auditResult;
  try {
    auditResult = audit.getAuditResult();
    log.info(`Audit result retrieved for auditId ${auditId}, has experimentationOpportunities: ${!!auditResult?.experimentationOpportunities}`);
    /* c8 ignore start */
  } catch (error) {
    log.error(`Error getting audit result for auditId ${auditId}: ${error.message}`, error);
    throw error;
  }
  /* c8 ignore stop */
  const auditOpportunity = auditResult?.experimentationOpportunities
    ?.filter((oppty) => oppty.type === HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE)
    ?.find((oppty) => oppty.page === url);

  if (!auditOpportunity) {
    log.info(
      `No raw opportunity found of type '${HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE}' for URL: ${url}. Nothing to process.`,
    );
    return notFound();
  }

  log.info(`Audit opportunity found for URL: ${url}, pageViews: ${auditOpportunity.pageViews}`);

  const entity = convertToOpportunityEntity(siteId, auditId, auditOpportunity, guidance);

  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  let opportunity = existingOpportunities.find(
    (oppty) => oppty.getData()?.page === url,
  );

  log.info(`Existing opportunity found for URL: ${url}, pageViews: ${opportunity?.getData()?.pageViews}`);

  if (!opportunity) {
    log.info(`No existing opportunity found for URL: ${url}. Creating a new one.`);
    // New opportunity flow - check capacity before creating
    const existingHighOrganicOpportunities = filterHighOrganicLowCtrOpportunities(
      existingOpportunities,
    );

    if (existingHighOrganicOpportunities.length >= MAX_HIGH_ORGANIC_LOW_CTR_OPPORTUNITIES) {
      const newPageViews = auditOpportunity.pageViews || 0;
      const lowestOpportunity = findLowestScoringOpportunity(existingHighOrganicOpportunities);
      const lowestScore = getEvictionScore(lowestOpportunity);

      if (newPageViews > lowestScore) {
        const lowestPage = lowestOpportunity.getData()?.page;
        log.info(
          `Replacing ${HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE} opportunity for ${lowestPage} `
          + `(pageViews: ${lowestScore}) with ${url} (pageViews: ${newPageViews})`,
        );
        await removeOpportunityWithSuggestions(lowestOpportunity);
      } else {
        log.warn(
          `Max opportunities (${MAX_HIGH_ORGANIC_LOW_CTR_OPPORTUNITIES}) for ${HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE} `
          + `already exist. New opportunity for ${url} (pageViews: ${newPageViews}) has lower pageViews `
          + 'than existing opportunities. Dropping.',
        );
        return ok();
      }
    }

    log.info(`No existing Opportunity found for page: ${url}. Creating a new one.`);
    opportunity = await Opportunity.create(entity);
  } else {
    log.info(`Existing Opportunity found for page: ${url}. Updating it with new data.`);
    const existingSuggestions = await opportunity.getSuggestions();
    // Manual protection check: any manual suggestions found, skip all updates
    if (existingSuggestions.length > 0 && hasManuallyModifiedSuggestions(existingSuggestions)) {
      log.info(`Existing suggestions for page: ${url} were manually modified. Skipping all updates to preserve data consistency.`);
      return ok();
    }
    log.info(`Existing Opportunity found for page: ${url}. Updating it with new data.`);
    opportunity.setAuditId(auditId);
    opportunity.setData({
      ...opportunity.getData(),
      ...entity.data,
    });
    opportunity.setGuidance(entity.guidance);
    opportunity.setUpdatedBy('system');
    opportunity = await opportunity.save();
    // Delete previous suggestions if any exist
    await Promise.all(existingSuggestions.map((suggestion) => suggestion.remove()));
  }

  // map the suggestions received from M to PSS
  const requiresValidation = Boolean(context.site?.requiresValidation);

  const suggestionData = {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: requiresValidation ? SuggestionModel.STATUSES.PENDING_VALIDATION
      : SuggestionModel.STATUSES.NEW,
    data: {
      variations: suggestions,
    },
    kpiDeltas: {
      estimatedKPILift: 0,
    },
  };

  await Suggestion.create(suggestionData);

  return ok();
}
