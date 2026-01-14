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

const OpptyDataForTOC = {
  runbook: '',
  origin: 'AUTOMATION',
  title: 'Add Table of Content',
  description: 'Ensure table of contents (TOC) is properly implemented in the <head> section of each page. Proper TOC implementation improves accessibility and helps search engines and generative engines understand page content',
  guidance: {
    steps: [
      'Review pages flagged for TOC issues in the audit results.',
      'Use AI-generated suggestions to improve TOC quality, consistency, and SEO performance.',
      'Ensure TOC is properly implemented in the <head> section of each page.',
    ],
  },
  tags: ['Accessibility', 'SEO', 'isElmo'],
  data: {
    dataSources: [DATA_SOURCES.SITE],
  },
};

export function createOpportunityDataForTOC() {
  return OpptyDataForTOC;
}
