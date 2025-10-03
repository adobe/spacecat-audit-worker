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
  title: 'Heading structure issues affecting accessibility and SEO',
  description: 'Ensure heading elements (h1–h6) are used in a logical, hierarchical order without skipping levels, and that no heading is empty. Proper heading structure improves accessibility and helps search engines and generative engines understand page content. AI-powered suggestions are available to help improve heading quality and consistency.',
  guidance: {
    steps: [
      'Review pages flagged for heading order or empty heading issues in the audit results.',
      'Use AI-generated suggestions to improve heading quality, consistency, and SEO performance.',
      'Adjust headings so that levels increase by at most one at a time (e.g., h1 → h2 → h3).',
      'Remove or fill any empty heading elements with descriptive text.',
      'Ensure headings follow brand guidelines and maintain consistent tone across the site.',
    ],
  },
  tags: ['Accessibility', 'SEO'],
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
          insight: 'Headings analysis of page content reveals structure issues affecting accessibility and SEO',
          recommendation: 'Ensure heading elements (h1–h6) are used in a logical, hierarchical order without skipping levels, and that no heading is empty',
          type: 'CONTENT',
          rationale: 'Proper heading structure improves accessibility and helps search engines and generative engines understand page content',
        },
      ],
    },
    tags: [...OpptyData.tags, 'llm', 'isElmo'],
    data: {
      ...OpptyData.data,
      dataSources: [DATA_SOURCES.SITE],
      additionalMetrics: [
        {
          value: 'headings',
          key: 'subtype',
        },
      ],
    },
  };
}
