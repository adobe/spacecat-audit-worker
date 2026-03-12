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

export const PROVIDERS = Object.freeze([
  'ai-mode',
  'all',
  'chatgpt',
  'copilot',
  'gemini',
  'google-ai-overview',
  'perplexity',
]);

export const PROVIDERS_SET = new Set(PROVIDERS);
export const BRAND_PRESENCE_REGEX = /brandpresence-(.+?)-w(\d{1,2})-(\d{4})-.*\.json$/;

export const URL_STORE_STATUS = Object.freeze({
  CREATED: 'created',
  FAILED: 'failed',
});

export const OFFSITE_DOMAINS = Object.freeze({
  'youtube.com': {
    auditType: 'youtube-analysis',
    datasetIds: [SCRAPE_DATASET_IDS.YOUTUBE_VIDEOS, SCRAPE_DATASET_IDS.YOUTUBE_COMMENTS],
  },
  'reddit.com': {
    auditType: 'reddit-analysis',
    datasetIds: [SCRAPE_DATASET_IDS.REDDIT_POSTS, SCRAPE_DATASET_IDS.REDDIT_COMMENTS],
  },
  'wikipedia.org': {
    auditType: 'wikipedia-analysis',
    datasetIds: [SCRAPE_DATASET_IDS.WIKIPEDIA],
  },
});

export const DRS_TOP_URLS_LIMIT = 100;
export const FETCH_PAGE_SIZE = 80000;
export const FETCH_TIMEOUT_MS = 60000;
export const INCLUDE_COLUMNS = ['Sources', 'Region', 'answer_contains_brandname', 'Mentions', 'Citations', 'Prompt', 'Topic', 'Category'].join(',');
export const REDDIT_COMMENTS_DAYS_BACK = 30;
export const TOP_CITED_DRS_CONFIG = Object.freeze({
  auditType: 'top-cited-analysis',
  datasetIds: [SCRAPE_DATASET_IDS.TOP_CITED],
});
