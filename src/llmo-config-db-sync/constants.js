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

export const UPSERT_BATCH_SIZE = 3000;
export const FETCH_BATCH_SIZE = 5000;
// Max values per `.in(col, [...])` filter. Each UUID adds ~39 URL chars after
// encoding; staying ~100 keeps requests well under the 8KB proxy URL limit
// that triggers HTTP 414.
export const IN_QUERY_CHUNK_SIZE = 100;
export const PROMPT_ID_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';
export const TOPIC_ID_NAMESPACE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

export const PROD_SITE_ID = '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3';
export const PROD_BRAND_ID = '3e3556f0-6494-4e8f-858f-01f2c358861a';
export const DEV_BRAND_ID = '019cb903-1184-742b-9a16-bc7a8696962f';

// Temporary: hardcoded site IDs for which the S3-to-DB config sync is enabled.
export const ALLOWED_SITE_IDS = [
  '00000000-0000-0000-0000-000000000001', // dev
  '00000000-0000-0000-0000-000000000002', // prod - to be removed
  'c2473d89-e997-458d-a86d-b4096649c12b', // dev URL
  PROD_SITE_ID, // prod URL
];

export const CATEGORY_COMPARE_FIELDS = ['name', 'origin', 'status'];
export const TOPIC_COMPARE_FIELDS = ['name', 'description', 'status'];
export const PROMPT_COMPARE_FIELDS = ['name', 'regions', 'category_id', 'status', 'origin', 'source'];
export const BRAND_ALIAS_COMPARE_FIELDS = ['regions'];
export const COMPETITOR_COMPARE_FIELDS = ['aliases', 'regions', 'url'];
