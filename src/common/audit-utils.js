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
 * Check if site has valid entitlement for any of the product codes
 * @param {string[]} productCodes - Array of product codes to check
 * @param {Object} site - Site object
 * @param {Object} context - Lambda context
 * @returns {Promise<boolean>} - True if site has entitlement for any product code
 */
export async function checkProductCodeEntitlements(productCodes, site, context) {
  if (!isNonEmptyArray(productCodes)) {
    return false; // No product codes to check, deny by default
  }

  try {
    // Check entitlements for each product code
    const entitlementChecks = await Promise.all(
      productCodes.map(async (productCode) => {
        try {
          const tierClient = await TierClient.createForSite(context, site, productCode);
          const tierResult = await tierClient.checkValidEntitlement();
          return tierResult.entitlement || false;
        } catch (error) {
          context.log.error(`Failed to check entitlement for product code ${productCode}:`, error);
          return false;
        }
      }),
    );
    // Return true if site has entitlement for any of the product codes
    return entitlementChecks.some((hasEntitlement) => hasEntitlement);
  } catch (error) {
    context.log.error('Error checking product code entitlements:', error);
    return false; // Fail safe - deny audit if entitlement check fails
  }
}

export async function isAuditEnabledForSite(type, site, context) {
  const { Configuration } = context.dataAccess;
  const configuration = await Configuration.findLatest();
  const handler = configuration.getHandlers()?.[type];
  // Check if handler has productCodes and verify entitlements
  if (isNonEmptyArray(handler?.productCodes)) {
    const hasValidEntitlement = await checkProductCodeEntitlements(
      handler.productCodes,
      site,
      context,
    );
    if (!hasValidEntitlement) {
      context.log.error(`No valid entitlement for handler ${type} with product codes 
        ${handler.productCodes} for site ${site.getId()}`);
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

export async function sendContinuationMessage(message, context) {
  const { log } = context;
  const { queueUrl, payload } = message;

  try {
    const { sqs } = context;
    log.info(`sending continuation message ${JSON.stringify(payload, null, 2)}`);
    await sqs.sendMessage(queueUrl, payload);
  } catch (e) {
    log.error(`Failed to send message to queue ${queueUrl}`, e);
    throw e;
  }
}
