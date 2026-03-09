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
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { getObjectFromKey } from '../utils/s3-utils.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.SECURITY_VULNERABILITIES;

/**
 * Duplicate of: common/codefix-handler.js#readCodeChangeReport
 * Reads code change report from S3 bucket
 * @param {Object} s3Client - The S3 client instance
 * @param {string} bucketName - The S3 bucket name
 * @param {string} reportKey - The S3 key path to the report
 * @param {Object} log - Logger instance
 * @returns {Promise<Object|null>} - The report data or null if not found
 *
 * Expected report.json structure:
 * {
 *   updatedFiles: ["blocks/form/form.js"],
 *   diff: "diff --git ...",
 *   createdAt: "",
 *   updatedAt: ""
 * }
 */
async function readCodeChangeReport(s3Client, bucketName, reportKey, log) {
  try {
    log.info(`Reading code change report from S3: ${reportKey}`);

    const reportData = await getObjectFromKey(s3Client, bucketName, reportKey, log);

    if (!reportData) {
      log.warn(`No code change report found for key: ${reportKey}`);
      return null;
    }

    // If reportData is a plain string, try to parse it as JSON
    if (typeof reportData === 'string') {
      try {
        return JSON.parse(reportData);
      } catch (error) {
        log.warn(`Failed to parse report data as JSON for key: ${reportKey}, returning null`);
        return null;
      }
    }

    log.info(`Successfully read code change report from S3: ${reportKey}`);
    return reportData;
  } catch (error) {
    log.error(`Error reading code change report from S3: ${error.message}`, error);
    return null;
  }
}

/**
 * Handler for processing vulnerabilities code fix responses from Mystique
 *
 * This handler receives code fix results and updates suggestions with the generated fixes.
 *
 * Example message format:
 * {
 *   "siteId": "<site-id>",
 *   "type": "codefix:security-vulnerabilities",
 *   "data": {
 *     "opportunityId": "<uuid>",
 *     "updates": [
 *       {
 *         "suggestion_id": "<suggestion-id>", // required - used to match suggestions
 *         "fixes": [
 *           {
 *             "code_fix_path": "<s3-path>", // required - S3 path to report.json
 *             "code_fix_bucket": "<s3-bucket>" // optional - S3 bucket name
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * }
 *
 * @param {Object} message - The SQS message
 * @param {Object} context - The context object containing dataAccess, log, s3Client, etc.
 * @returns {Promise<Response>} - HTTP response
 */
export default async function handler(message, context) {
  const {
    log, dataAccess, s3Client, env,
  } = context;
  const { siteId, data } = message;
  const { Site, Opportunity, Suggestion } = dataAccess;

  log.debug(`[${AUDIT_TYPE} Code-Fix] Message received in vulnerabilities code-fix handler: ${JSON.stringify(message, null, 2)}`);

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
  const {
    opportunityId, updates,
  } = data;

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
    const errorMsg = `[${AUDIT_TYPE} Code-Fix] [Opportunity: ${opportunityId}] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    return badRequest('Site ID mismatch');
  }

  const defaultBucketName = env.S3_MYSTIQUE_BUCKET_NAME;

  // Process updates
  if (!isNonEmptyArray(updates)) {
    log.warn(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Empty updates array provided in message data. Skipping processing!`);
    return ok();
  }
  await Promise.all(updates.map(async (update) => {
    const {
      suggestion_id: suggestionId,
      fixes,
    } = update;

    // Validate suggestionId
    if (!suggestionId) {
      log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] No suggestionId provided in update data`);
      return;
    }
    const suggestion = await Suggestion.findById(suggestionId);
    if (!suggestion) {
      log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Suggestion not found for ID: ${update.suggestionId}`);
      return;
    }

    log.info(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Processing update for suggestion: ${suggestionId}`);

    if (!isNonEmptyArray(fixes)) {
      log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] No code-fixes in update data`);
      return;
    }

    // Right now we only expect one fix; the array is just used for future-proofing
    if (fixes.length > 1) {
      log.warn(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] More than one code-fix in update data. This is unexpected behaviour!`);
    }
    const { code_fix_path: codeFixPath, code_fix_bucket: codeFixBucket } = fixes[0];

    const bucketName = codeFixBucket || defaultBucketName;

    // Retrieve code-fix
    const reportData = await readCodeChangeReport(
      s3Client,
      bucketName,
      codeFixPath,
      log,
    );

    if (!reportData) {
      log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] No code-fix report found for suggestion: ${update.suggestionId}`);
      return;
    }

    suggestion.setData({
      ...suggestion.getData(),
      patchContent: reportData.diff,
      isCodeChangeAvailable: true,
    });

    suggestion.save();
  }));

  return ok();
}
