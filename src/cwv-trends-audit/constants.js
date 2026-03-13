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

export const AUDIT_TYPE = 'cwv-trends-audit';
export const TREND_DAYS = 28;
export const CURRENT_WEEK_DAYS = 7;
export const S3_BASE_PATH = 'metrics/cwv-trends';
export const MIN_PAGEVIEWS = 1000;
export const DEFAULT_DEVICE_TYPE = 'mobile';

// Core Web Vitals thresholds based on https://web.dev/articles/vitals
export const CWV_THRESHOLDS = {
  LCP: { GOOD: 2500, POOR: 4000 },
  CLS: { GOOD: 0.1, POOR: 0.25 },
  INP: { GOOD: 200, POOR: 500 },
};

export const OPPORTUNITY_TITLES = {
  mobile: 'Mobile Web Performance Trends Report',
  desktop: 'Desktop Web Performance Trends Report',
};
