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
 * @returns {Object} - Opportunity data structure
 */
export function createOpportunityData() {
  return {
    runbook: '',
    origin: 'AUTOMATION',
    title: 'Prerender Optimization Opportunity',
    description: 'Prerendering the page would help index significant content in the LLM that is currently not visible to the LLM agents.',
    guidance: {
      steps: [
        'Review URLs identified with high client-side rendering differences',
        'Implement server-side rendering for critical pages',
      ],
    },
    tags: ['Prerendering', 'LLM Optimisation'],
    data: {
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.SITE],
      thresholds: {
        contentGainRatio: 1.2,
      },
      benefits: [
        'Improved LLM visibility and brand presence',
        'Better LLM indexing and search results',
      ],
    },
  };
}
