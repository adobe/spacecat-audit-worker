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

const RUNBOOK_URL = 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/Doc.aspx?sourcedoc=%7B19613D9B-93D4-4112-B7C8-DBE0D9DCC55B%7D&file=Experience_Success_Studio_High_Organic_Traffic_Low_CTR_Runbook.docx&action=default&mobileredirect=true';

export function convertToOpportunityEntity(siteId, auditId, subType) {
  const opportunityConfigs = {
    'guidance:geo-brand-presence': {
      title: 'GEO Brand Improvement Opportunity detected',
      description: 'The page is not optimized for the GEO Brand presence.',
      dataSources: [DATA_SOURCES.SITE, DATA_SOURCES.AHREFS],
    },
    'guidance:geo-faq': {
      title: 'LLM Prompt Improvement: Add FAQs to Pages',
      description: 'The page is not optimized for the GEO FAQ presence.',
      dataSources: [DATA_SOURCES.SITE, DATA_SOURCES.PAGE, DATA_SOURCES.AHREFS],
    },
  };

  const config = opportunityConfigs[subType] || opportunityConfigs['guidance:geo-brand-presence'];

  return {
    siteId,
    auditId,
    runbook: RUNBOOK_URL,
    type: 'generic-opportunity',
    origin: 'AUTOMATION',
    title: config.title,
    description: config.description,
    status: 'NEW',
    tags: ['Awareness', 'Engagement', 'isElmo'],
    data: {
      subType,
      dataSources: config.dataSources,
    },
  };
}
