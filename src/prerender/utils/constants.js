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
 * Minimum successful HTML comparisons required before the no-opportunity OUTDATED sync runs
 * when scrape failures are also high. Aligns with ELMO `hasEnoughScrapedPages` (50 URLs).
 */
export const PRERENDER_NO_OPP_OUTDATE_MIN_SUCCESSFUL_SCRAPES = 50;

/**
 * Scrape error rate (percent of submitted URLs without a successful comparison) above which
 * the no-opportunity OUTDATED sync is skipped when successful scrapes are below
 * PRERENDER_NO_OPP_OUTDATE_MIN_SUCCESSFUL_SCRAPES.
 * Aligns with ELMO `scrapingErrorRateHigh` (30%).
 */
export const PRERENDER_NO_OPP_OUTDATE_SCRAPE_ERROR_RATE_PCT = 30;
