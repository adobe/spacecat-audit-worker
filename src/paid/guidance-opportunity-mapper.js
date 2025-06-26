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

export function mapToPaidOpportunity(siteId, auditId, audit, guidance = []) {
  // TODO: check first that there is guidance
  // Add valid data
  // confirm what should be sent exactly
  const pageGuidance = guidance[0];
  return {
    siteId,
    auditId,
    type: audit.getAuditType(),
    origin: 'AUTOMATION',
    title: 'Cookie Consent Banner',
    description: `Recommendation: ${pageGuidance.recommendation}. Rationale: ${pageGuidance.recommendation}}`,
    guidance: {
      recommendations: [
        {
          insight: pageGuidance.insight,
          rationale: pageGuidance.rationale,
          recommendation: pageGuidance.recommendation,
          // TODO: fix required to ensure body is saved to shareport and we have a link to it
          runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
          type: 'guidance',
        },
      ],
    },
    status: 'NEW',
    tags: [
      'Engagement',
    ],
  };
}
