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
 * Maximum number of URLs shortlisted for a domain-wide RCV suggestion.
 * These URLs are ranked by agentic-traffic × content-gain score and used
 * to source the experiment prompts stored on the domain-wide suggestion.
 */
export const DOMAIN_WIDE_URL_SHORTLIST_LIMIT = 10;
/**
 * Hard cap on the total number of prompts stored on a domain-wide suggestion.
 * Caps DRS experiment cost for the Impact Validation Engine pre/post cycle.
 */
export const DOMAIN_WIDE_MAX_PROMPTS = 100;
