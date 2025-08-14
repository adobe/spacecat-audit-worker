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
    title: 'Canonical URL issues affecting SEO',
    description: 'Canonical URLs help search engines understand which version of a page is the preferred one to index. Issues with canonical URLs can lead to duplicate content problems, diluted page authority, and reduced search rankings.',
    guidance: {
      steps: [
        'Review each URL with canonical issues identified in the audit results.',
        'Ensure canonical tags are properly implemented in the <head> section of each page.',
        'Use lowercase, absolute URLs for canonical tags to avoid formatting issues.',
      ],
    },
    tags: ['Traffic Acquisition', 'SEO'],
    data: {
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.SITE],
    },
  };
}
