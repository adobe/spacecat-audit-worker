/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { isContextLogger } from '../common/context-logger.js';

export const MAX_BROKEN_LINKS_REPORTED = 500;
const DEFAULT_LINK_ITEM_TYPE = 'link';

/** itemTypes excluded from broken-internal-links (handled by canonical/hreflang audits) */
const EXCLUDED_ITEM_TYPES = new Set(['canonical', 'alternate']);

/**
 * Filters broken links to configured SEO-relevant status buckets.
 * @param {Array} links - Array of broken links
 * @param {Array<string>} allowedStatusBuckets - Buckets to retain
 * @returns {Array} Filtered links
 */
export function filterByStatusIfNeeded(links, allowedStatusBuckets = []) {
  if (!Array.isArray(allowedStatusBuckets) || allowedStatusBuckets.length === 0) {
    return links;
  }

  const allowed = new Set(allowedStatusBuckets);
  return links.filter((link) => !link?.statusBucket || allowed.has(link.statusBucket));
}

export function filterByItemTypes(links, allowedItemTypes = []) {
  if (!Array.isArray(allowedItemTypes) || allowedItemTypes.length === 0) {
    return links;
  }

  const allowed = new Set(allowedItemTypes);
  return links.filter((link) => allowed.has(link?.itemType || DEFAULT_LINK_ITEM_TYPE));
}

/**
 * Returns true if the link is from a canonical or hreflang tag.
 * Those are covered by dedicated canonical/hreflang audits and should not be
 * counted as broken internal links.
 * @param {Object} link - Link object (may have itemType)
 * @returns {boolean}
 */
export function isCanonicalOrHreflangLink(link) {
  return link?.itemType && EXCLUDED_ITEM_TYPES.has(link.itemType);
}

export function createUpdateAuditResult({ auditType, createAuditLogger }) {
  return async function updateAuditResult(
    audit,
    auditResult,
    prioritizedLinks,
    dataAccess,
    log,
    siteId,
    extraFields = {},
  ) {
    const updatedAuditResult = {
      ...auditResult,
      brokenInternalLinks: prioritizedLinks,
      ...extraFields,
    };
    const auditId = audit.getId ? audit.getId() : audit.id;
    const contextLog = isContextLogger(log)
      ? log
      : createAuditLogger(log, auditType, siteId, auditId);

    try {
      if (typeof audit.setAuditResult === 'function') {
        audit.setAuditResult(updatedAuditResult);
        await audit.save();
        contextLog.info(`Updated audit result with ${prioritizedLinks.length} prioritized broken links`);
      } else {
        const { Audit: AuditModel } = dataAccess;
        contextLog.info(`Falling back to database lookup for auditId: ${auditId}`);

        const auditToUpdate = await AuditModel.findById(auditId);

        if (auditToUpdate) {
          if (typeof auditToUpdate.setAuditResult === 'function') {
            auditToUpdate.setAuditResult(updatedAuditResult);
          } else {
            auditToUpdate.auditResult = updatedAuditResult;
          }

          if (typeof auditToUpdate.save === 'function') {
            await auditToUpdate.save();
            contextLog.info(`Updated audit result via database lookup with ${prioritizedLinks.length} prioritized broken links`);
          } else {
            contextLog.warn(`Audit ${auditId} loaded without save(); skipping persisted audit result update`);
          }
        } else {
          contextLog.warn(`Could not find audit with ID ${auditId} to update`);
        }
      }
    } catch (error) {
      contextLog.error(`Failed to update audit result: ${error.message}`);
    }

    return updatedAuditResult;
  };
}
