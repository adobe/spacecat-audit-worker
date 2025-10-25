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

import {
  badRequest, noContent, notFound, ok,
} from '@adobe/spacecat-shared-http-utils';
import { createGenericOpportunityData, createSpecificOpportunityData } from './opportunity-data-mapper.js';
import { getJsonSummarySuggestion, getMarkdownSummarySuggestion } from './utils.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';

async function createSpecificOpportunity(siteId, auditId, baseUrl, guidance, context) {
  const opportunity = await convertToOpportunity(
    baseUrl,
    {
      siteId,
      auditId,
      id: auditId,
    },
    context,
    createSpecificOpportunityData,
    'summarization',
    { guidance },
  );
  return opportunity;
}

async function createGenericOpportunity(siteId, auditId, guidance, context) {
  const { dataAccess } = context;
  const { Opportunity } = dataAccess;
  const wrappedGuidance = {
    recommendations: guidance.map((g) => ({
      insight: g.insight,
      rationale: g.rationale,
      recommendation: g.recommendation,
      type: 'CONTENT_UPDATE',
    })),
  };
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  let opportunity = existingOpportunities.find(
    (oppty) => oppty.getData()?.subType === 'summarization',
  );
  const entity = createGenericOpportunityData(siteId, auditId, wrappedGuidance);
  if (!opportunity) {
    opportunity = await Opportunity.create(entity);
  } else {
    opportunity.setAuditId(auditId);
    opportunity.setData({
      ...opportunity.getData(),
      ...entity.data,
    });
    opportunity.setGuidance(wrappedGuidance);
    opportunity.setUpdatedBy('system');
    opportunity = await opportunity.save();
  }
  return opportunity;
}

async function addSuggestionsToSpecificOpportunity(
  specificOpportunity,
  suggestions,
  context,
) {
  const suggestionValues = getJsonSummarySuggestion(suggestions);

  await syncSuggestions({
    context,
    opportunity: specificOpportunity,
    newData: suggestionValues,
    buildKey: (suggestion) => `${suggestion.url}-${suggestion.insertAfter}`,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: specificOpportunity.getId(),
      type: 'CODE_CHANGE',
      rank: 10,
      data: suggestion,
    }),
  });
}

async function addSuggestionsToGenericOpportunity(
  genericOpportunity,
  suggestions,
  baseUrl,
  context,
) {
  const { auditId } = context;
  const { log } = context;

  genericOpportunity.setAuditId(auditId);
  genericOpportunity.setUpdatedBy('system');

  const suggestionValue = getMarkdownSummarySuggestion(suggestions, log);
  const newData = [{
    suggestionValue,
    bKey: `summarization:${baseUrl}`,
  }];

  await syncSuggestions({
    context,
    opportunity: genericOpportunity,
    newData,
    buildKey: (dataItem) => dataItem.bKey,
    mapNewSuggestion: (dataItem) => ({
      opportunityId: genericOpportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: 1,
      status: 'NEW',
      data: {
        suggestionValue: dataItem.suggestionValue,
      },
      kpiDeltas: {
        estimatedKPILift: 0,
      },
    }),
  });

  log.info(`Saved summarization opportunity: ${genericOpportunity.getId()}`);
}

/**
 * Handles Mystique response for summarization and updates pages with AI suggestions
 * @param {Object} message - Message from Mystique with AI suggestions
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Audit,
    Site,
  } = dataAccess;
  const { siteId, data, auditId } = message;
  const { guidance, suggestions } = data;

  log.info(`Message received in summarization guidance handler: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const baseUrl = site.getBaseURL();

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }

  if (suggestions.length === 0) {
    log.info(`No suggestions found for siteId: ${siteId}`);
    return noContent();
  }

  const genericOpportunity = await createGenericOpportunity(
    siteId,
    auditId,
    guidance,
    context,
  );
  const specificOpportunity = await createSpecificOpportunity(
    siteId,
    auditId,
    baseUrl,
    guidance,
    context,
  );

  try {
    await addSuggestionsToGenericOpportunity(genericOpportunity, suggestions, baseUrl, context);
    await addSuggestionsToSpecificOpportunity(specificOpportunity, suggestions, baseUrl, context);
  } catch (e) {
    log.error(`Failed to save summarization opportunity on Mystique callback: ${e.message}`);
    return badRequest('Failed to persist summarization opportunity');
  }

  return ok();
}
