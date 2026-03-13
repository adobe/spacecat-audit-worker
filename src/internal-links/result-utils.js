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

/** itemTypes excluded from broken-internal-links (handled by canonical/hreflang audits) */
const EXCLUDED_ITEM_TYPES = new Set(['canonical', 'alternate']);

/**
 * No filtering applied - includes all broken links (404, 5xx, timeouts, network errors).
 * @param {Array} links - Array of broken links
 * @returns {Array} Unfiltered links
 */
export function filterByStatusIfNeeded(links) {
  return links;
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
  ) {
    const updatedAuditResult = {
      ...auditResult,
      brokenInternalLinks: prioritizedLinks,
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
          auditToUpdate.setAuditResult(updatedAuditResult);
          await auditToUpdate.save();
          contextLog.info(`Updated audit result via database lookup with ${prioritizedLinks.length} prioritized broken links`);
        } else {
          contextLog.error(`Could not find audit with ID ${auditId} to update`);
        }
      }
    } catch (error) {
      contextLog.error(`Failed to update audit result: ${error.message}`);
    }

    return updatedAuditResult;
  };
}
