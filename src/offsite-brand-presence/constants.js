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

import { SCRAPE_DATASET_IDS } from '@adobe/spacecat-shared-drs-client';
import { Audit } from '@adobe/spacecat-shared-data-access';

export const PROVIDERS = Object.freeze([
  'ai-mode',
  'all',
  'chatgpt',
  'copilot',
  'gemini',
  'google-ai-overviews',
  'perplexity',
]);

export const PROVIDERS_SET = new Set(PROVIDERS);
export const BRAND_PRESENCE_REGEX = /brandpresence-(.+?)-w(\d{1,2})-(\d{4})(?:-.*)?$/;

// Region codes whose brand-presence rows are processed. Limited to English-speaking markets.
export const ACCEPTED_REGIONS = Object.freeze(new Set(['US', 'GB', 'CA', 'AU', 'IE', 'NZ']));

export const URL_STORE_STATUS = Object.freeze({
  CREATED: 'created',
  FAILED: 'failed',
});

export const OFFSITE_DOMAINS = Object.freeze({
  'youtube.com': {
    auditType: Audit.AUDIT_TYPES.YOUTUBE_ANALYSIS,
    datasetIds: [SCRAPE_DATASET_IDS.YOUTUBE_VIDEOS, SCRAPE_DATASET_IDS.YOUTUBE_COMMENTS],
  },
  'reddit.com': {
    auditType: Audit.AUDIT_TYPES.REDDIT_ANALYSIS,
    datasetIds: [SCRAPE_DATASET_IDS.REDDIT_POSTS, SCRAPE_DATASET_IDS.REDDIT_COMMENTS],
  },
});

// Recognized only to keep their URLs out of the top-cited bucket; not DRS-scraped here.
// wikipedia-analysis is handled independently by Mystique (fetches Wikipedia directly).
export const TOP_CITED_EXCLUDED_DOMAINS = Object.freeze(['wikipedia.org']);

export const CITED_ANALYSIS_DRS_CONFIG = Object.freeze({
  auditType: Audit.AUDIT_TYPES.CITED_ANALYSIS,
  datasetIds: [SCRAPE_DATASET_IDS.TOP_CITED],
});

export const DRS_URLS_LIMIT = 70;
export const FETCH_PAGE_SIZE = 80000;
export const FETCH_TIMEOUT_MS = 60000;
export const USER_AGENT = 'Offsite Audits - Spacecat/1.0';
export const INCLUDE_COLUMNS = ['Sources', 'Region', 'answer_contains_brandname', 'Mentions', 'Citations', 'Prompt', 'Topics', 'Category'].join(',');
export const RETRIABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
export const RETRY_DELAY_MS = 500;
export const YOUTUBE_URL_REGEX = /^(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)(?:[/?#]|$)/;
export const REDDIT_URL_REGEX = /^https:\/\/(www)?\.?reddit\.com\/([rt]|user)\/[a-zA-Z0-9_/%-]+\/(comments\/[a-zA-Z0-9_-]+\/.+\/?|.*)$/;

// DRS job completion polling (offsite-brand-presence-drs-status handler).
export const DRS_POLL_INTERVAL_SECONDS = 300; // 5 minutes between polls
export const DRS_POLL_MAX_WAIT_SECONDS = 3600; // 60 minute total budget
export const DRS_STATUS_AUDIT_TYPE = 'offsite-brand-presence-drs-status';
export const DRS_TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
]);
// Terminal statuses that produced usable scraped data. Used to decide which
// downstream analysis audits to auto-trigger after DRS scraping completes.
export const DRS_SUCCESS_STATUSES = new Set([
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
]);

// Minimum elapsed time before re-triggering the same analysis audit for a site.
// Prevents duplicate analysis runs caused by SQS at-least-once redelivery of
// the DRS status poll completion message.
export const AUDIT_TRIGGER_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
