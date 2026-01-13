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

import { OPPORTUNITY_TYPES, mergeTagsWithHardcodedTags } from '@adobe/spacecat-shared-utils';
import { DATA_SOURCES } from '../common/constants.js';

/**
 * Creates opportunity data for Wikipedia analysis
 * @param {Object} props - The props object from convertToOpportunity
 * @param {Array} props.guidance - The guidance array
 * @returns {Object} Opportunity data
 */
export function createOpportunityData({ guidance }) {
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Wikipedia_Analysis_Runbook.docx',
    origin: 'AUTOMATION',
    type: 'wikipedia-analysis',
    title: 'LLM discoverability: Improve Wikipedia presence',
    description: 'Enhance your company\'s Wikipedia page to improve visibility in Large Language Model (LLM) responses. A well-maintained Wikipedia presence increases the likelihood of being cited by AI systems like ChatGPT, Claude, and Perplexity.',
    status: 'NEW',
    guidance,
    tags: mergeTagsWithHardcodedTags(OPPORTUNITY_TYPES.WIKIPEDIA_ANALYSIS, ['llmo', 'isElmo']),
    data: {
      dataSources: [DATA_SOURCES.SITE, DATA_SOURCES.PAGE],
    },
  };
}
