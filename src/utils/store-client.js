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

/* eslint-disable max-classes-per-file */

/**
 * Store Client - Utility for fetching data from the URL Store and Guidelines Store.
 *
 * Reads directly from the shared data-access layer (`context.dataAccess`) rather than
 * calling spacecat-api-service over HTTP. This mirrors how every other audit reads its
 * data and removes the dependency on the legacy `x-api-key` auth, which was retired on
 * 2026-06-01 for these routes (see RouteScopedLegacyApiKeyHandler in spacecat-api-service).
 *
 * Backing models (same ones the API controllers use):
 * - URL Store:            dataAccess.AuditUrl.allBySiteIdAndAuditType
 * - Sentiment topics:     dataAccess.SentimentTopic.allBySiteIdEnabled
 * - Sentiment guidelines: dataAccess.SentimentGuideline.allBySiteIdAndAuditType
 *
 * Note: the Content Store is fetched directly by Mystique (not here) because content can
 * exceed SQS message size limits (256KB).
 */

import { Audit } from '@adobe/spacecat-shared-data-access';

// Page size for cursor-based pagination over the url-store and sentiment collections.
const STORE_PAGE_SIZE = 500;

/**
 * Error thrown when a store returns empty results
 */
export class StoreEmptyError extends Error {
  constructor(storeName, siteId, details = '') {
    const msg = `${storeName} returned empty results for siteId: ${siteId}`;
    super(details ? `${msg}. ${details}` : msg);
    this.name = 'StoreEmptyError';
    this.storeName = storeName;
    this.siteId = siteId;
  }
}

/**
 * Audit types for URL Store queries (maps to audit types in url-store)
 * Matched against the `audits` set on each AuditUrl record.
 */
export const URL_TYPES = {
  WIKIPEDIA: Audit.AUDIT_TYPES.WIKIPEDIA_ANALYSIS,
  REDDIT: Audit.AUDIT_TYPES.REDDIT_ANALYSIS,
  YOUTUBE: Audit.AUDIT_TYPES.YOUTUBE_ANALYSIS,
  CITED: Audit.AUDIT_TYPES.CITED_ANALYSIS,
};

/**
 * Audit types for guidelines queries.
 * Matched against the `audits` set on each SentimentGuideline record.
 */
export const GUIDELINE_TYPES = {
  WIKIPEDIA_ANALYSIS: Audit.AUDIT_TYPES.WIKIPEDIA_ANALYSIS,
  REDDIT_ANALYSIS: Audit.AUDIT_TYPES.REDDIT_ANALYSIS,
  YOUTUBE_ANALYSIS: Audit.AUDIT_TYPES.YOUTUBE_ANALYSIS,
  CITED_ANALYSIS: Audit.AUDIT_TYPES.CITED_ANALYSIS,
};

/**
 * Maps an AuditUrl model instance to a plain object, matching the shape the
 * spacecat-api-service AuditUrlDto previously returned over HTTP.
 * @param {object} auditUrl - AuditUrl model instance
 * @returns {object}
 */
function toAuditUrlJson(auditUrl) {
  return {
    siteId: auditUrl.getSiteId(),
    url: auditUrl.getUrl(),
    byCustomer: auditUrl.getByCustomer(),
    audits: auditUrl.getAudits(),
    createdAt: auditUrl.getCreatedAt(),
    updatedAt: auditUrl.getUpdatedAt(),
    createdBy: auditUrl.getCreatedBy(),
    updatedBy: auditUrl.getUpdatedBy(),
  };
}

/**
 * Maps a SentimentTopic model instance to a plain object (matches SentimentTopicDto).
 * @param {object} topic - SentimentTopic model instance
 * @returns {object}
 */
function toSentimentTopicJson(topic) {
  return {
    siteId: topic.getSiteId(),
    topicId: topic.getTopicId(),
    name: topic.getName(),
    description: topic.getDescription(),
    enabled: topic.getEnabled(),
    createdAt: topic.getCreatedAt(),
    updatedAt: topic.getUpdatedAt(),
    createdBy: topic.getCreatedBy(),
    updatedBy: topic.getUpdatedBy(),
  };
}

/**
 * Maps a SentimentGuideline model instance to a plain object (matches SentimentGuidelineDto).
 * @param {object} guideline - SentimentGuideline model instance
 * @returns {object}
 */
function toSentimentGuidelineJson(guideline) {
  return {
    siteId: guideline.getSiteId(),
    guidelineId: guideline.getGuidelineId(),
    name: guideline.getName(),
    instruction: guideline.getInstruction(),
    audits: guideline.getAudits() || [],
    enabled: guideline.getEnabled(),
    createdAt: guideline.getCreatedAt(),
    updatedAt: guideline.getUpdatedAt(),
    createdBy: guideline.getCreatedBy(),
    updatedBy: guideline.getUpdatedBy(),
  };
}

/**
 * Store Client class for accessing the URL and Guidelines stores via the
 * shared data-access layer.
 */
export default class StoreClient {
  /**
   * Creates a StoreClient from the Lambda context.
   * @param {Object} context - The Lambda context
   * @param {Object} context.dataAccess - The shared data-access layer
   * @param {Object} context.log - Logger instance
   * @returns {StoreClient} - StoreClient instance
   */
  static createFrom(context) {
    const { dataAccess, log } = context || {};
    return new StoreClient({ dataAccess }, log);
  }

  /**
   * @param {Object} config - Configuration object
   * @param {Object} config.dataAccess - The shared data-access layer
   * @param {Object} log - Logger instance
   */
  constructor(config, log = console) {
    const { dataAccess } = config || {};
    this.dataAccess = dataAccess;
    this.log = log;
  }

  /**
   * Validates that the given dataAccess collections are available.
   * @param {string[]} required - Collection names this operation needs
   * @throws {Error} If any required collection is missing
   */
  #ensureConfigured(required) {
    const dataAccess = this.dataAccess || {};
    const missing = required.filter((name) => !dataAccess[name]);
    if (missing.length > 0) {
      throw new Error(`StoreClient is not configured: missing dataAccess collections ${missing.join(', ')}`);
    }
  }

  /**
   * Drains a cursor-paginated collection query into a single array.
   * @param {(cursor: string|null) => Promise<{data?: Array, cursor?: string|null}>} queryFn
   *   Invoked once per page with the current cursor
   * @returns {Promise<Array>} All items across every page
   */
  // eslint-disable-next-line class-methods-use-this
  async #fetchAllPages(queryFn) {
    const items = [];
    let cursor = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      const result = await queryFn(cursor);
      items.push(...(result?.data ?? []));
      cursor = result?.cursor ?? null;
    } while (cursor);
    return items;
  }

  /**
   * Fetches URLs from the URL Store for a given site and audit type.
   * Reads dataAccess.AuditUrl.allBySiteIdAndAuditType, paginating until exhausted.
   *
   * @param {string} siteId - The site ID
   * @param {string} auditType - The audit type (e.g., 'wikipedia-analysis', 'reddit-analysis')
   * @param {Object} [queryParams={}] - Optional `{ sortBy, sortOrder }` forwarded to the query
   *   (defaults: `sortBy='createdAt'`, `sortOrder='desc'`)
   * @returns {Promise<Array<Object>>} Array of URL objects
   * @throws {StoreEmptyError} If no URLs are found
   */
  async getUrls(siteId, auditType, queryParams = {}) {
    this.#ensureConfigured(['AuditUrl']);
    const { sortBy = 'createdAt', sortOrder = 'desc' } = queryParams;
    const { AuditUrl } = this.dataAccess;

    this.log.info(`[StoreClient] Fetching ${auditType} URLs for siteId: ${siteId}`);

    const items = await this.#fetchAllPages((cursor) => AuditUrl.allBySiteIdAndAuditType(
      siteId,
      auditType,
      {
        limit: STORE_PAGE_SIZE,
        cursor,
        sortBy,
        sortOrder,
      },
    ));

    if (items.length === 0) {
      throw new StoreEmptyError('urlStore', siteId, `No ${auditType} URLs found`);
    }

    const urls = items.map(toAuditUrlJson);
    this.log.info(`[StoreClient] Found ${urls.length} ${auditType} URLs for siteId: ${siteId}`);
    return urls;
  }

  /**
   * Fetches sentiment config (topics and guidelines) for a site and audit type.
   * Reads dataAccess.SentimentTopic (enabled topics) and dataAccess.SentimentGuideline
   * (guidelines for the audit type, or all enabled guidelines when no audit type given).
   *
   * @param {string} siteId - The site ID
   * @param {string} [auditType] - The audit type to filter guidelines (e.g., 'wikipedia-analysis')
   * @returns {Promise<Object>} Config object with topics and guidelines arrays
   * @throws {StoreEmptyError} If no guidelines are found
   */
  async getGuidelines(siteId, auditType) {
    this.#ensureConfigured(['SentimentTopic', 'SentimentGuideline']);
    const { SentimentTopic, SentimentGuideline } = this.dataAccess;

    this.log.info(`[StoreClient] Fetching sentiment config for siteId: ${siteId}, audit: ${auditType}`);

    const topicItems = await this.#fetchAllPages(
      (cursor) => SentimentTopic.allBySiteIdEnabled(siteId, { limit: STORE_PAGE_SIZE, cursor }),
    );
    const guidelineItems = await this.#fetchAllPages((cursor) => (auditType
      ? SentimentGuideline.allBySiteIdAndAuditType(
        siteId,
        auditType,
        { limit: STORE_PAGE_SIZE, cursor },
      )
      : SentimentGuideline.allBySiteIdEnabled(siteId, { limit: STORE_PAGE_SIZE, cursor })));

    const topics = topicItems.map(toSentimentTopicJson);
    const guidelines = guidelineItems.map(toSentimentGuidelineJson);

    if (guidelines.length === 0) {
      throw new StoreEmptyError('guidelinesStore', siteId, `No guidelines found for audit type: ${auditType}`);
    }

    this.log.info(`[StoreClient] Found ${topics.length} topics and ${guidelines.length} guidelines for siteId: ${siteId}`);
    return { topics, guidelines };
  }
}
