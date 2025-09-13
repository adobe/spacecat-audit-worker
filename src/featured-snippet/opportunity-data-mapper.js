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

export function createOpportunityData() {
  return {
    runbook: 'https://wiki.corp.adobe.com/display/AEMSites/SEO+%7C+Featured+Snippets',
    origin: 'AUTOMATION',
    title: 'Featured Snippet opportunity',
    description: 'Featured Snippets are special search results that appear at the top of search results, providing concise answers to user queries. They appear in 10% of all search queries and have an average CTR of 11% compared to 5% for top organic results. This opportunity identifies pages ranking for keywords that have featured snippets available but do not qualify for the featured snippet yet.',
    guidance: {
      steps: [
        'Identify keywords with Featured Snippets that your page ranks for',
        'Optimize content to answer the specific query directly and concisely',
        'Use clear headings and structured content to help Google understand your answer',
        'Include relevant keywords naturally in your featured snippet content',
        'Monitor performance and adjust content based on Featured Snippet appearance',
      ],
    },
    tags: ['Traffic acquisition'],
    data: {
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.SITE],
    },
  };
}
