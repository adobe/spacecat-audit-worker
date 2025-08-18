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

import { validateCountryCode } from '../utils/report-utils.js';

const capitalizeFirstLetter = (str) => {
  if (!str || typeof str !== 'string') return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

export const SHEET_CONFIGS = {
  agentic: {
    getHeaders: () => [
      'Agent Type',
      'User Agent',
      'Status',
      'Number of Hits',
      'Avg TTFB (ms)',
      'Country Code',
      'URL',
      'Product',
      'Category',
    ],
    headerColor: 'FFE6E6FA',
    numberColumns: [2, 3, 4],
    processData: (data) => data?.map((row) => [
      row.agent_type || 'Other',
      row.user_agent_display || 'Unknown',
      Number(row.status) || 'N/A',
      Number(row.number_of_hits) || 0,
      Number(row.avg_ttfb_ms) || 0,
      validateCountryCode(row.country_code) || 'GLOBAL',
      row.url || '',
      capitalizeFirstLetter(row.product) || 'Other',
      row.category || 'Uncategorized',
    ]) || [],
  },
};
