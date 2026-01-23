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

import { ok, notFound, badRequest } from '@adobe/spacecat-shared-http-utils';
import { Opportunity as OpportunityModel } from '@adobe/spacecat-shared-data-access';

import { sendOpportunitySuggestionsToMystique } from './utils/generate-individual-opportunities.js';

// Valid opportunity statuses for processing
const VALID_OPPORTUNITY_STATUSES = [
  OpportunityModel.STATUSES.NEW,
  OpportunityModel.STATUSES.IN_PROGRESS,
];

/**
 * Handler for triggering A11y codefix flow for an existing opportunity.
 *
 * This handler receives a message with a site ID and opportunity ID,
 * fetches the opportunity's suggestions, filters them for code fix eligibility,
 * and sends them to Mystique for processing.
 *
 * Expected message format:
 * {
 *   type: 'trigger:a11y-codefix',
 *   siteId: string,
 *   data: {
 *     opportunityId: string,
 *     opportunityType: string
 *   },
 *   auditContext: {
 *     slackContext: { channelId, threadTs }
 *   }
 * }
 *
 * @param {Object} message - The SQS message
 * @param {Object} context - The audit context
 * @returns {Promise<Response>} The response
 */
export default async function handler(message, context) {
  const {
    log, dataAccess, sqs, env,
  } = context;
  const { siteId, data = {}, auditContext = {} } = message;
  const { opportunityId, opportunityType } = data;

  log.info(`[A11yCodefix] Received trigger for site ${siteId}, opportunity ${opportunityId} (${opportunityType})`);

  if (!siteId) {
    log.error('[A11yCodefix] Missing siteId in message');
    return badRequest('Missing siteId');
  }

  if (!opportunityId) {
    log.error('[A11yCodefix] Missing opportunityId in message data');
    return badRequest('Missing opportunityId');
  }

  const { Site, Opportunity } = dataAccess;

  try {
    const site = await Site.findById(siteId);
    if (!site) {
      log.error(`[A11yCodefix] Site not found: ${siteId}`);
      return notFound('Site not found');
    }

    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) {
      log.error(`[A11yCodefix] Opportunity not found: ${opportunityId}`);
      return notFound('Opportunity not found');
    }

    if (opportunity.getSiteId() !== siteId) {
      log.error(`[A11yCodefix] Opportunity ${opportunityId} does not belong to site ${siteId}`);
      return badRequest('Opportunity does not belong to the specified site');
    }

    const opportunityStatus = opportunity.getStatus();
    if (!VALID_OPPORTUNITY_STATUSES.includes(opportunityStatus)) {
      log.warn(`[A11yCodefix] Opportunity ${opportunityId} has invalid status: ${opportunityStatus}. Expected: ${VALID_OPPORTUNITY_STATUSES.join(', ')}`);
      return badRequest(`Opportunity has invalid status: ${opportunityStatus}. Expected: ${VALID_OPPORTUNITY_STATUSES.join(' or ')}`);
    }

    log.info(`[A11yCodefix] Processing opportunity ${opportunityId} (${opportunityType}) for site ${site.getBaseURL()}`);

    // Create enhanced context with site and other required properties
    const enhancedContext = {
      ...context,
      site,
      sqs,
      env,
      auditContext,
    };

    const result = await sendOpportunitySuggestionsToMystique(
      opportunityId,
      enhancedContext,
      { skipMystiqueEnabledCheck: true },
    );

    if (!result.success) {
      log.error(`[A11yCodefix] Failed to send suggestions to Mystique: ${result.error}`);
      // Return ok to avoid retries - the error is already logged
      return ok({ success: false, error: result.error });
    }

    log.info(`[A11yCodefix] Successfully triggered codefix flow for opportunity ${opportunityId}`);
    return ok({
      success: true,
      opportunityId,
      siteId,
      messagesProcessed: result.messagesProcessed || 0,
    });
  } catch (error) {
    log.error(`[A11yCodefix] Error processing trigger: ${error.message}`, error);
    // Return ok to avoid infinite retries
    return ok({ success: false, error: error.message });
  }
}
