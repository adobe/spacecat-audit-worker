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
    runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/',
    origin: 'AUTOMATION',
    title: 'Content Fragment requests are failing and breaking digital experiences',
    description: 'Fixing broken Content Fragment requests by publishing missing content or setting up proper redirects ensures seamless API responses, prevents application errors and maintains consistent digital experiences across all touchpoints.',
    guidance: {
      steps: [
        'Review the requested Content Fragment paths grouped by suggestion type.',
        'Compare each requested path with its suggested path to identify the issue and what changed.',
        'Generate a short, user-friendly description of the difference.',
      ],
    },
    tags: ['Headless'],
    data: {
      dataSources: [DATA_SOURCES.SITE],
    },
  };
}
