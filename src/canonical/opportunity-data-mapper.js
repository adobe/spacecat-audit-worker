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
  runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Acquisition%20-%20SEO/Experience_Success_Studio_Canonical_Runbook.docx?d=w53f8a3edfd554beab12083570672da00&csf=1&web=1&e=NJSdWD',
  origin: 'AUTOMATION',
  title: 'Canonical URLs to clarify your SEO strategy to search engines are ready',
  description: 'Canonical tags prevent duplicate content confusion — consolidating signals strengthens ranking authority.',
  guidance: {
    steps: [
      'Review each URL with canonical issues identified in the audit results.',
      'Ensure canonical tags are properly implemented in the <head> section of each page.',
      'Use lowercase, absolute URLs for canonical tags to avoid formatting issues.',
    ],
  },
  tags: ['Traffic Acquisition', 'SEO'],
  data: {
    dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.SITE],
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
          insight: 'Canonical URL analysis reveals issues affecting SEO and content deduplication',
          recommendation: 'Ensure canonical tags are properly implemented in the <head> section of each page using lowercase, absolute URLs',
          type: 'CONTENT',
          rationale: 'Proper canonical URL implementation helps search engines understand which version of a page is preferred, preventing duplicate content issues and improving search rankings',
        },
      ],
    },
    tags: [...OpptyData.tags, 'llm', 'isElmo'],
    data: {
      ...OpptyData.data,
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.SITE],
      additionalMetrics: [
        {
          value: 'canonical',
          key: 'subtype',
        },
      ],
    },
  };
}
