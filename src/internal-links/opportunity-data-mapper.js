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

// import { calculateKpiDeltasForAudit } from './helpers';

export function createOpportunityData() {
  const kpiDeltas = {}; // calculateKpiDeltasForAudit(auditData);
  return {
    runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Broken_Internal_Links_Runbook.docx?web=1',
    origin: 'AUTOMATION',
    title: 'Broken internal links are impairing user experience and SEO crawlability',
    description: 'We\'ve detected broken internal links on your website. Broken links can negatively impact user experience and SEO. Please review and fix these links to ensure smooth navigation and accessibility.',
    guidance: {
      steps: [
        'Update each broken internal link to valid URLs.',
        'Test the implemented changes manually to ensure they are working as expected.',
        'Monitor internal links for 404 errors in RUM tool over time to ensure they are functioning correctly.',
      ],
    },
    tags: [
      'Traffic acquisition',
      'Engagement',
    ],
    data: kpiDeltas,
  };
}
