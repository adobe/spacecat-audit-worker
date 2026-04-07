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

import { isValidUUID, isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { retrieveAuditById } from '../utils/data-access.js';

/**
 * Check if site has site enrollment for any of the product codes
 * (org entitlement alone is not enough).
 * @param {string[]} productCodes - Array of product codes to check
 * @param {Object} site - Site object
 * @param {Object} context - Lambda context
 * @returns {Promise<boolean>} - True if site has enrollment for any product code
 */
export async function checkProductCodeEntitlements(productCodes, site, context) {
  if (!isNonEmptyArray(productCodes)) {
    return false; // No product codes to check, deny by default
  }

  try {
    const enrollmentChecks = await Promise.all(
      productCodes.map(async (productCode) => {
        try {
          const tierClient = await TierClient.createForSite(context, site, productCode);
          const tierResult = await tierClient.checkValidEntitlement();
          return tierResult.siteEnrollment || false;
        } catch (error) {
          context.log.error(`Failed to check entitlement for product code ${productCode}:`, error);
          return false;
        }
      }),
    );
    return enrollmentChecks.some((hasEnrollment) => hasEnrollment);
  } catch (error) {
    context.log.error('Error checking product code entitlements:', error);
    return false; // Fail safe - deny audit if entitlement check fails
  }
}

export async function isAuditEnabledForSite(type, site, context) {
  const { Configuration } = context.dataAccess;
  const configuration = await Configuration.findLatest();
  const handler = configuration.getHandlers()?.[type];
  // Check if handler has productCodes and verify site enrollment for those products
  if (isNonEmptyArray(handler?.productCodes)) {
    const hasValidEnrollment = await checkProductCodeEntitlements(
      handler.productCodes,
      site,
      context,
    );
    if (!hasValidEnrollment) {
      context.log.error(`No valid site enrollment for handler ${type} with product codes ${handler.productCodes} for site ${site.getId()}`);
      return false;
    }
  } else {
    context.log.error(`Handler ${type} has no product codes`);
    return false;
  }

  return configuration.isHandlerEnabledForSite(type, site);
}

export async function loadExistingAudit(auditId, context) {
  if (!isValidUUID(auditId)) {
    throw new Error('Valid auditId is required for step execution');
  }
  const audit = await retrieveAuditById(context.dataAccess, auditId, context.log);
  if (!audit) {
    throw new Error(`Audit record ${auditId} not found`);
  }
  return audit;
}

/**
 * Extracts onDemand from an incoming auditContext so it survives
 * multi-step chains (e.g. audit → import-worker → audit continuation).
 * Only forwards onDemand when it is explicitly truthy (boolean true or string "true"),
 * so that `'onDemand' in auditContext` reliably indicates an active on-demand run.
 * @param {Object} auditContext - The incoming auditContext (may be undefined)
 * @returns {Object} `{ onDemand: true }` when active, empty object otherwise
 */
export function preserveOnDemand(auditContext) {
  const { onDemand } = auditContext || {};
  return (onDemand === true || onDemand === 'true') ? { onDemand: true } : {};
}

export async function sendContinuationMessage(message, context) {
  const { log } = context;
  const { queueUrl, payload } = message;

  try {
    const { sqs } = context;
    log.debug(`sending continuation message ${JSON.stringify(payload, null, 2)}`);
    await sqs.sendMessage(queueUrl, payload);
  } catch (e) {
    log.error(`Failed to send message to queue ${queueUrl}`, e);
    throw e;
  }
}

/**
 * Normalizes SQS `message.data` (JSON string or object) for RunnerAudit.
 * Returns a plain object, or `undefined` if missing, empty, invalid JSON, or not a plain object
 * (arrays excluded).
 * @param {unknown} data - `message.data` from the audit job payload
 * @returns {object|undefined}
 */
export function parseMessageDataForRunnerAudit(data) {
  if (data === undefined || data === null) {
    return undefined;
  }
  let parsed = data;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed;
}
