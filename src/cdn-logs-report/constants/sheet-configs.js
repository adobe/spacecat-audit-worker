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
/* eslint-disable camelcase */

import { classifyTrafficSource } from '@adobe/spacecat-shared-rum-api-client/src/common/traffic.js';
import { validateCountryCode } from '../utils/report-utils.js';

const HEADER_COLOR = 'FFE6E6FA';

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
    headerColor: HEADER_COLOR,
    numberColumns: [2, 3, 4],
    processData: (data) => data?.map((row) => [
      row.agent_type || 'Other',
      row.user_agent_display || 'Unknown',
      Number(row.status) || 'N/A',
      Number(row.number_of_hits) || 0,
      Number(row.avg_ttfb_ms) || 0,
      validateCountryCode(row.country_code),
      row.url || '',
      capitalizeFirstLetter(row.product) || 'Other',
      row.category || 'Uncategorized',
    ]) || [],
  },
  referral: {
    getHeaders: () => [
      'path',
      'trf_type',
      'trf_channel',
      'trf_platform',
      'device',
      'date',
      'pageviews',
      'consent',
      'bounced',
      'region',
      'user_intent',
    ],
    headerColor: HEADER_COLOR,
    numberColumns: [6],
    processData: (data, site) => data.map((row) => {
      const {
        path,
        referrer,
        utm_source,
        utm_medium,
        tracking_param,
        device,
        date,
        pageviews,
        region,
      } = row;

      const url = `${site.getBaseURL()}${path.startsWith('/') ? path : `/${path}`}`;
      const {
        type, category, vendor,
      } = classifyTrafficSource(url, referrer, utm_source, utm_medium, tracking_param);

      return [
        path,
        type,
        category,
        vendor,
        device,
        date,
        pageviews,
        '',
        '',
        validateCountryCode(region),
        '',
      ];
    }),
  },
};
