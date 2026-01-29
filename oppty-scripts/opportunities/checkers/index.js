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

import { checkAltTextFixed } from './alt-text-checker.js';
import {
  checkBacklinksFixed,
  checkBacklinksFixedBatch,
} from './backlinks-checker.js';
import { checkInternalLinksFixed, checkInternalLinksFixedBatch, closeSharedBrowser } from './internal-links-checker.js';
import { checkMetaTagsFixed } from './meta-tags-checker.js';
import { checkSitemapFixed } from './sitemap-checker.js';
import { checkStructuredDataFixed } from './structured-data-checker.js';

/**
 * Map of opportunity types to their checker functions
 */
export const CHECKERS = {
  'alt-text': checkAltTextFixed,
  'broken-backlinks': checkBacklinksFixed,
  'broken-internal-links': checkInternalLinksFixed,
  'meta-tags': checkMetaTagsFixed,
  sitemap: checkSitemapFixed,
  'structured-data': checkStructuredDataFixed,
};

/**
 * Map of opportunity types to their batch checker functions (if available)
 */
export const BATCH_CHECKERS = {
  'broken-backlinks': checkBacklinksFixedBatch,
  'broken-internal-links': checkInternalLinksFixedBatch,
};

/**
 * Get the appropriate checker function for an opportunity type
 * @param {string} opportunityType - Opportunity type (CLI format)
 * @returns {Function} Checker function
 */
export function getChecker(opportunityType) {
  const checker = CHECKERS[opportunityType];
  if (!checker) {
    throw new Error(`No checker found for opportunity type: ${opportunityType}`);
  }
  return checker;
}

/**
 * Get the appropriate batch checker function for an opportunity type
 * Returns null if no batch checker is available
 * @param {string} opportunityType - Opportunity type (CLI format)
 * @returns {Function|null} Batch checker function or null
 */
export function getBatchChecker(opportunityType) {
  return BATCH_CHECKERS[opportunityType] || null;
}

/**
 * Cleanup all checker resources (e.g., close browser instances)
 * @param {object} log - Logger instance
 */
export async function cleanupCheckers(log) {
  try {
    // Close shared browser for internal links and backlinks (they use the same instance)
    await closeSharedBrowser(log);
  } catch (error) {
    log.debug(`Error cleaning up checkers: ${error.message}`);
  }
}

export default getChecker;
