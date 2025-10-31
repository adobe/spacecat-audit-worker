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

/**
 * Creates opportunity data for prerender audit results
 * @param {Object} auditData - Audit data with results
 * @returns {Object} - Opportunity data structure
 */
export function createOpportunityData(auditData) {
  const { auditResult } = auditData || {};
  const { scrapeForbidden } = auditResult || {};

  return {
    runbook: '',
    origin: 'AUTOMATION',
    title: 'Recover Content Visibility',
    description: 'Pre-rendering HTML for JavaScript-heavy pages ensures that all your important content is immediately visible to search engines and AI crawlers, significantly improving your content\'s discoverability and indexing.',
    guidance: {
      steps: [
        'Review URLs identified with high client-side rendering differences',
        'Implement server-side rendering for critical pages',
      ],
      recommendations: [
        {
          recommendation: 'This page highlights that your content is currently hidden behind JavaScript, which limits what LLM bots can index. The suggested optimization is to pre-render HTML so that essential text, links, and metadata are immediately visible to the LLM bots. By doing this, you ensure LLM bots see the same meaningful content as users without relying on JavaScript execution.',
        },
      ],
    },
    tags: ['isElmo'],
    data: {
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.SITE],
      thresholds: {
        contentGainRatio: 1.2,
      },
      benefits: [
        'Improved LLM visibility and brand presence',
        'Better LLM indexing and search results',
      ],
      scrapeForbidden: (scrapeForbidden === true),
    },
  };
}
