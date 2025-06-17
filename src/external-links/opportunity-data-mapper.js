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

/**
 * Creates an opportunity data object for the broken external links audit.
 * @param {Object} props - The properties for the opportunity data object.
 * @param {Object} props.kpiDeltas - The KPI deltas for the audit.
 * @returns {Object} The opportunity data object.
 */
export function createOpportunityData({ kpiDeltas }) {
  return {
    runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Broken_External_Links_Runbook.docx?web=1',
    origin: 'AUTOMATION',
    title: 'Broken external links are impairing user experience and SEO crawlability',
    description: 'We\'ve detected broken external links on your website. Broken external links can negatively impact user experience, SEO, and your site\'s credibility. Please review and fix these links to ensure smooth navigation and maintain trust with your users.',
    guidance: {
      steps: [
        'Update each broken external link to valid URLs or remove them if no longer relevant.',
        'Test the implemented changes manually to ensure they are working as expected.',
        'Monitor external links for 404 errors in RUM tool over time to ensure they are functioning correctly.',
        'Consider implementing a link checking system to proactively monitor external link health.',
      ],
    },
    tags: [
      'Traffic acquisition',
      'Engagement',
      'User Experience',
    ],
    data: {
      ...kpiDeltas,
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.RUM, DATA_SOURCES.SITE],
    },
  };
}
