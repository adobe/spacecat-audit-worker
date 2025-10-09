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

export function createOpportunityData(siteId, auditId, guidance) {
  return {
    siteId,
    auditId,
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
    origin: 'AUTOMATION',
    type: 'generic-opportunity',
    title: 'Content Summarization Improvements for High Traffic Content Pages',
    description: 'Content summarization elements such as summary and key points improve content discoverability and user engagement.',
    status: 'NEW',
    guidance,
    tags: ['isElmo'],
    data: {
      subType: 'summarization',
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.PAGE],
    },
  };
}
