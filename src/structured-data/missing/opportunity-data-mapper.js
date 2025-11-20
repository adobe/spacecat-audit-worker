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

import { DATA_SOURCES } from '../../common/constants.js';

export function createOpportunityData(siteId, auditId, guidance) {
  return {
    siteId,
    auditId,
    runbook: 'https://wiki.corp.adobe.com/display/AEMSites/Missing+Structured+Data',
    origin: 'AUTOMATION',
    title: 'Missing structured data',
    description: 'Structured data (JSON-LD) is a way to organize and label important information on your website so that search engines can understand it more easily. It\'s important because it can lead to improved visibility in search.',
    guidance,
    tags: ['isElmo', 'Traffic acquisition'],
    data: {
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.RUM, DATA_SOURCES.SITE],
    },
  };
}
