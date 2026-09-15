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

// Message type consumed from api-service to start the analysis (phase 1).
export const SEO_GAP_ANALYSIS_TYPE = 'seo-gap-analysis';

// Processing type routed to the content-scraper seo-comparison handler. The scrape
// completion message arrives back on this type and drives aggregation (phase 2).
export const SEO_COMPARISON_PROCESSING_TYPE = 'seo-comparison';

// Number of organic SERP results to inspect (~2 pages of Google results).
export const DEFAULT_SERP_RESULTS = 20;

// Cap on competitor pages scraped per analysis, to bound cost/latency of the fan-out.
export const MAX_COMPETITORS = 15;

// URL buckets produced from the SERP.
export const BUCKET = {
  TARGET: 'target',
  BRANDED: 'branded',
  COMPETITOR: 'competitor',
  THIRD_PARTY: 'third-party',
  FILTERED: 'filtered',
};
