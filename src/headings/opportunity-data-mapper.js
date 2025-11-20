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
  title: 'Optimize headings to clarify content intent - suggestions prepared for review',
  description: 'Clear, well-structured headings help search engines understand page hierarchy and relevance, improving keyword visibility and indexing.',
  guidance: {
    steps: [
      'Review pages flagged for heading order or empty heading issues in the audit results.',
      'Use AI-generated suggestions to improve heading quality, consistency, and SEO performance.',
      'Adjust headings so that levels increase by at most one at a time (e.g., h1 → h2 → h3).',
      'Remove or fill any empty heading elements with descriptive text.',
      'Ensure headings follow brand guidelines and maintain consistent tone across the site.',
    ],
  },
  tags: ['Accessibility', 'SEO', 'isElmo', 'isASO'],
  data: {
    dataSources: [DATA_SOURCES.SITE],
  },
};

export function createOpportunityData() {
  return OpptyData;
}
