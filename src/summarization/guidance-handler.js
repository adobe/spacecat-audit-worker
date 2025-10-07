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

import { badRequest, notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { getSuggestionValue } from './utils.js';
import { syncSuggestions } from '../utils/data-access.js';

/**
 * Handles Mystique response for summarization and updates pages with AI suggestions
 * @param {Object} message - Message from Mystique with AI suggestions
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, Audit, Opportunity,
  } = dataAccess;
  const { siteId, data, auditId } = message;
  const { guidance, suggestions } = data;

  log.info(`Message received in summarization guidance handler: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }

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
  const entity = createOpportunityData(siteId, auditId, wrappedGuidance);
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

  try {
    opportunity.setAuditId(auditId);
    opportunity.setUpdatedBy('system');

    const suggestionValue = getSuggestionValue(suggestions, log);
    const newData = [{
      suggestionValue,
      bKey: `summarization:${site.getBaseURL()}`,
    }];

    await syncSuggestions({
      context,
      opportunity,
      newData,
      buildKey: (dataItem) => dataItem.bKey,
      mapNewSuggestion: (dataItem) => ({
        opportunityId: opportunity.getId(),
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

    log.info(`Saved summarization opportunity: ${opportunity.getId()}`);
  } catch (e) {
    log.error(`Failed to save summarization opportunity on Mystique callback: ${e.message}`);
    return badRequest('Failed to persist summarization opportunity');
  }

  return ok();
}
