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

import { DATA_SOURCES } from '../common/constants.js';

const OpptyData = {
  runbook: '',
  origin: 'AUTOMATION',
  title: 'Hreflang implementation issues affecting international SEO',
  description: 'Hreflang tags help search engines understand which language and geographic versions of pages to serve to users in different regions. Proper hreflang implementation is crucial for international SEO and ensures users see content in their preferred language.',
  guidance: {
    steps: [
      'Review each URL with hreflang issues identified in the audit results.',
      'Ensure hreflang tags are properly implemented in the <head> section of each page.',
      'Use valid ISO 639-1 language codes and ISO 3166-1 Alpha 2 country codes (e.g., "en-US", "fr-CA").',
      'Include self-referencing hreflang tags - each page should reference itself with its own language/region.',
      'Verify that all hreflang URLs are accessible and return 200 status codes.',
      'Consider adding "x-default" hreflang for pages targeting users who speak languages not specifically targeted.',
    ],
  },
  tags: ['Traffic Acquisition'],
  data: {
    dataSources: [DATA_SOURCES.SITE],
  },
};

export function createOpportunityData() {
  return OpptyData;
}

export function createOpportunityDataForElmo() {
  return {
    ...OpptyData,
    guidance: {
      recommendations: [
        {
          insight: 'Hreflang analysis reveals implementation issues affecting international SEO and user experience',
          recommendation: 'Ensure hreflang tags are properly implemented in the <head> section of each page using valid ISO 639-1 language codes and ISO 3166-1 Alpha 2 country codes',
          type: 'CONTENT',
          rationale: 'Proper hreflang implementation helps search engines serve the correct language and regional versions of pages to users, improving international SEO and user experience',
        },
      ],
    },
    tags: [...OpptyData.tags, 'llm', 'isElmo'],
    data: {
      ...OpptyData.data,
      dataSources: [DATA_SOURCES.SITE],
      additionalMetrics: [
        {
          value: 'hreflang',
          key: 'subtype',
        },
      ],
    },
  };
}
