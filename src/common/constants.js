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
 * Data sources for opportunities
 */
export const DATA_SOURCES = {
  AHREFS: 'Ahrefs',
  GSC: 'GSC',
  RUM: 'RUM',
  SITE: 'Site',
  PAGE: 'Page',
};

// Sites that require suggestion validation before showing in UI
export const SITES_REQUIRING_VALIDATION = [
  '92d24fa2-5e99-4d43-8799-84cba3385ae1', // Qualcomm
  // Add more customer site IDs here as needed
];
