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

import { randomUUID } from 'crypto';

export function mapToPaidOpportunity(siteId, url, audit, guidance = []) {
  const pageGuidance = guidance[0];
  // const auditType = audit?.getAuditType();
  return {
    siteId,
    auditId: audit.getAuditId(),
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
          type: 'guidance',
        },
      ],
    },
    data: {
      // projectedTrafficLost: pageGuidance.projectedTrafficLost || 0,
      // projectedTrafficValue: pageGuidance.projectedTrafficValue || 0,
      dataSources: [
        'Ahrefs',
        'Site',
        'RUM',
      ],
      page: url,
    },
    status: 'NEW',
    tags: [
      'Engagement',
    ],
  };
}

export function mapToPaidSuggestion(opportunityId, url, guidance = []) {
  const pageGuidance = guidance[0] || {};
  return {
    opportunityId,
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: 'NEW',
    data: {
      recommendations: [
        {
          id: randomUUID(),
          pageUrl: url,
        },
      ],
      suggestionValue: pageGuidance.body,
    },
  };
}
