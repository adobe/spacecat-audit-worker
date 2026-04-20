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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { warnOnInvalidSuggestionData } from '../utils/data-access.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.SECURITY_VULNERABILITIES;

/**
 * Handler for processing vulnerabilities code fix results from starfish-auto-code.
 *
 * Receives a pointer to an S3 report, reads it once, and updates matching
 * suggestions with the diffs from applied results.
 *
 * Expected message format:
 * {
 *   "siteId": "<site-id>",
 *   "type": "codefix:security-vulnerabilities",
 *   "data": {
 *     "opportunityId": "<uuid>",
 *     "reportBucket": "<s3-bucket>",
 *     "reportPath": "results/<job-id>/report.json"
 *   }
 * }
 *
 * @param {Object} message - The SQS message
 * @param {Object} context - The context object containing dataAccess, log, s3Client, etc.
 * @returns {Promise<Response>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess, s3Client } = context;
  const { siteId, data } = message;
  const { Site, Opportunity, Suggestion } = dataAccess;

  log.debug(`[${AUDIT_TYPE} Code-Fix] Message received: ${JSON.stringify(message, null, 2)}`);

  // Validate siteId
  if (!siteId) {
    log.error(`[${AUDIT_TYPE} Code-Fix] No siteId provided in message`);
    return badRequest('No siteId provided in message');
  }
  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Site not found`);
    return notFound('Site not found');
  }

  // Validate data
  if (!data) {
    log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] No data provided in message`);
    return badRequest('No data provided in message');
  }
  const { opportunityId, reportBucket, reportPath } = data;

  // Verify opportunityId
  if (!opportunityId) {
    log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] No opportunityId provided in message data`);
    return badRequest('No opportunityId provided in message data');
  }
  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) {
    log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    log.error(`[${AUDIT_TYPE} Code-Fix] [Opportunity: ${opportunityId}] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`);
    return badRequest('Site ID mismatch');
  }

  // Validate report pointer
  if (!reportBucket || !reportPath) {
    log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Missing reportBucket or reportPath in message data`);
    return badRequest('Missing reportBucket or reportPath in message data');
  }

  // Fetch report from S3
  let reportData;
  try {
    const raw = await getObjectFromKey(s3Client, reportBucket, reportPath, log);
    if (!raw) {
      log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] No report found at s3://${reportBucket}/${reportPath}`);
      return ok();
    }
    reportData = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Failed to read report from s3://${reportBucket}/${reportPath}: ${error.message}`);
    return ok();
  }

  // Check job-level status
  if (reportData.status === 'failed') {
    log.warn(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Job failed (report status: failed). No results to process.`);
    return ok();
  }

  // Validate results array
  const { results } = reportData;
  if (!Array.isArray(results) || results.length === 0) {
    log.warn(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Report has no results to process.`);
    return ok();
  }

  // Collect applied suggestion IDs and batch-fetch
  const appliedResults = results.filter((r) => r.status === 'applied');
  if (appliedResults.length === 0) {
    log.info(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] No applied results in report. Nothing to update.`);
    return ok();
  }

  const suggestionIds = appliedResults.map((r) => r.suggestionId);
  const { data: existingSuggestions = [] } = await Suggestion.batchGetByKeys(
    suggestionIds.map((id) => ({ suggestionId: id })),
  );
  const suggestionMap = new Map(existingSuggestions.map((s) => [s.getId(), s]));

  // Update matching suggestions
  const toSave = [];
  for (const result of appliedResults) {
    const { suggestionId, diff } = result;

    if (!diff) {
      log.warn(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Applied result for suggestion ${suggestionId} has no diff. Skipping.`);
    } else {
      const suggestion = suggestionMap.get(suggestionId);
      if (!suggestion) {
        log.warn(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Suggestion not found for ID: ${suggestionId}. Skipping.`);
      } else {
        const updatedData = {
          ...suggestion.getData(),
          patchContent: diff,
          isCodeChangeAvailable: true,
        };
        warnOnInvalidSuggestionData(updatedData, opportunity.getType(), log);
        suggestion.setData(updatedData);
        toSave.push(suggestion);
      }
    }
  }

  if (toSave.length > 0) {
    await Suggestion.saveMany(toSave);
  }

  log.info(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Updated ${toSave.length} suggestions from report.`);
  return ok();
}
