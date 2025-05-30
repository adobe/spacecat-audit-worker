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
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Structured_Data_Runbook.docx?d=wf814159992be44a58b72ce1950c0c9ab&csf=1&web=1&e=5Qq6vm',
    origin: 'AUTOMATION',
    title: 'Missing or invalid structured data',
    description: 'Structured data (JSON-LD) is a way to organize and label important information on your website so that search engines can understand it more easily. It\'s important because it can lead to improved visibility in search.',
    guidance: {
      steps: [],
    },
    tags: ['Traffic acquisition'],
    data: {
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.GSC, DATA_SOURCES.SITE],
    },
  };
}
