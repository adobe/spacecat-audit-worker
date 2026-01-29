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

/**
 * Mapping of CLI-friendly opportunity type names to internal audit type names
 */
export const OPPORTUNITY_TYPE_MAPPING = {
  'broken-backlinks': 'broken-backlinks',
  'broken-internal-links': 'broken-internal-links',
  'alt-text': 'alt-text',
  'structured-data': 'structured-data',
  sitemap: 'sitemap',
  'meta-tags': 'meta-tags',
};

/**
 * Valid opportunity types that can be processed
 */
export const VALID_OPPORTUNITY_TYPES = Object.keys(OPPORTUNITY_TYPE_MAPPING);

/**
 * Opportunity statuses
 */
export const OPPORTUNITY_STATUSES = {
  NEW: 'NEW',
  RESOLVED: 'RESOLVED',
  IGNORED: 'IGNORED',
  IN_PROGRESS: 'IN_PROGRESS',
};

/**
 * SpaceCat API configuration
 */
export const API_BASE_URL = process.env.SPACECAT_API_BASE_URL || 'https://spacecat.experiencecloud.live/api/v1';

/**
 * Valid suggestion statuses
 */
export const SUGGESTION_STATUSES = {
  NEW: 'NEW',
  OUTDATED: 'OUTDATED',
  FIXED: 'FIXED',
  ERROR: 'ERROR',
  SKIPPED: 'SKIPPED',
  PENDING_VALIDATION: 'PENDING_VALIDATION',
};

/**
 * Fix entity types
 */
export const FIX_TYPES = {
  REDIRECT_UPDATE: 'REDIRECT_UPDATE',
  EXPERIMENT: 'EXPERIMENT',
  CONTENT_UPDATE: 'CONTENT_UPDATE',
  METADATA_UPDATE: 'METADATA_UPDATE',
};

/**
 * Fix entity statuses
 */
export const FIX_STATUSES = {
  PENDING: 'PENDING',
  DEPLOYED: 'DEPLOYED',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  ROLLED_BACK: 'ROLLED_BACK',
};

/**
 * Default configuration values
 */
export const DEFAULTS = {
  STATUS: SUGGESTION_STATUSES.OUTDATED,
  MARK_FIXED: false,
  FIX_TYPE: FIX_TYPES.CONTENT_UPDATE,
  FIX_STATUS: FIX_STATUSES.PUBLISHED,
};
