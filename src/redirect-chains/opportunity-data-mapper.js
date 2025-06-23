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
    runbook: 'https://wiki.corp.adobe.com/display/AEMSites/%5BProject+Success+Studio%5D+CWV+degradation+by+redirect+chains',
    origin: 'AUTOMATION',
    title: 'Issues found for the /redirects.json file',
    description: '',
    guidance: {
      steps: [
        'For each affected entry in the /redirects.json file, check if the redirect is valid. See the suggestion provided for details on how to resolve.',
      ],
    },
    tags: ['Engagement'],
    data: {
      dataSources: [DATA_SOURCES.SITE],
    },
  };
}
