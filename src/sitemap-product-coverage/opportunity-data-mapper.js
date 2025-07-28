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
    runbook: '',
    origin: 'AUTOMATION',
    title: 'Issues found for the sitemap product coverage',
    description: '',
    guidance: {
      steps: [
        'For each affected website locale check if the all products are present in the sitemap. See the suggestion provided for details on how to resolve.',
      ],
    },
    tags: ['Traffic Acquisition'],
    data: {
      dataSources: [DATA_SOURCES.SITE],
    },
  };
}
