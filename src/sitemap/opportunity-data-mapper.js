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
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Sitemap_Runbook.docx?d=w6e82533ac43841949e64d73d6809dff3&csf=1&web=1&e=GDaoxS',
    origin: 'AUTOMATION',
    title: 'Sitemap issues found',
    description: '',
    guidance: {
      steps: [
        'Verify each URL in the sitemap, identifying any that do not return a 200 (OK) status code.',
        'Check RUM data to identify any sitemap pages with unresolved 3xx, 4xx or 5xx status codes – it should be none of them.',
      ],
    },
    tags: ['Traffic Acquisition'],
    data: {
      dataSources: [DATA_SOURCES.SITE],
    },
  };
}
