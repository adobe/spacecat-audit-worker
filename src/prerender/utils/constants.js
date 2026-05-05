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

export const CONTENT_GAIN_THRESHOLD = 1.1;
export const TOP_AGENTIC_URLS_LIMIT = 2000;
export const DAILY_BATCH_SIZE = 320;
export const TOP_ORGANIC_URLS_LIMIT = 200;
/**
 * URLs processed within this window are treated as recently scraped and skipped.
 */
export const PRERENDER_RECENT_PROCESSING_TIME_DAYS = 7;
export const MODE_AI_ONLY = 'ai-only';
export const MYSTIQUE_BATCH_SIZE = DAILY_BATCH_SIZE;

/**
 * HTTP status codes that indicate permanent failures eligible for skip-list treatment.
 * Once a URL hits one of these codes, it is assigned a skipUntil timestamp and excluded
 * from future audit batches until the probe window opens.
 *
 * Must be codes where retrying on the next natural 7-day cycle is unlikely to succeed.
 */
export const SKIPPABLE_HTTP_STATUS_CODES = new Set([401, 403, 404, 406, 410, 444]);

/**
 * Skip window configuration per HTTP status code: [firstFailureDays, repeatFailureDays].
 *
 * The natural audit cadence is 7 days per URL (PRERENDER_RECENT_PROCESSING_TIME_DAYS).
 * All skip windows must exceed 7 days to save at least one audit cycle.
 *   - 14d = skip 1 extra cycle (probe on the 3rd natural window)
 *   - 28d = skip 3 extra cycles
 *   - 84d = skip 11 extra cycles (~3 months)
 */
export const SKIP_UNTIL_DAYS_BY_STATUS = {
  404: [14, 28], // Page not found: likely gone but pages get restored — probe after 2/4 cycles
  403: [14, 28], // Forbidden / bot-blocked: blocks can be lifted — probe after 2/4 cycles
  401: [84, 84], // Unauthorized: won't recover until customer configures credentials
  410: [84, 84], // Gone: server explicitly signals permanent removal
  406: [14, 28], // Not acceptable: server rejects scraper headers
  444: [14, 28], // Connection closed (nginx): active blocking
};
