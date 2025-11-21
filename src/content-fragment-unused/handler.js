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

import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { AemAnalyzer } from '../content-fragment-insights/aem-analyzer.js';
import { UNUSED_CONTENT_STATUSES } from '../content-fragment-insights/fragment-analyzer.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

// TODO: Change to Audit.AUDIT_TYPES.CONTENT_FRAGMENT_UNUSED
export const AUDIT_TYPE = 'content-fragment-unused';

export function createStatusSummary(totalFragments, unusedFragments) {
  const groupedByStatus = {};

  for (const fragment of unusedFragments) {
    const { status } = fragment;
    if (!groupedByStatus[status]) {
      groupedByStatus[status] = [];
    }
    groupedByStatus[status].push(fragment);
  }

  return UNUSED_CONTENT_STATUSES.map((status) => {
    const fragments = groupedByStatus[status] || [];
    const count = fragments.length;
    const percentage = totalFragments > 0 ? (count / totalFragments) * 100 : 0;

    let averageAge = 0;
    let oldest = 0;

    if (count > 0) {
      const ages = fragments.map((fragment) => fragment.ageInDays);
      averageAge = Math.round(ages.reduce((sum, age) => sum + age, 0) / count);
      oldest = Math.max(...ages);
    }

    return {
      status,
      count,
      percentage,
      averageAge,
      oldest,
    };
  });
}

export async function contentFragmentUnusedAuditRunner(baseURL, context, site) {
  const auditContext = { ...context, site };

  const analyzer = new AemAnalyzer(auditContext);
  const unusedFragments = await analyzer.findUnusedFragments();

  const statusSummary = createStatusSummary(
    unusedFragments.totalFragments,
    unusedFragments.unusedFragments,
  );

  return {
    fullAuditRef: baseURL,
    auditResult: {
      ...unusedFragments,
      statusSummary,
    },
  };
}

export async function createContentFragmentUnusedOpportunity(auditUrl, auditData, context) {
  const { log } = context;

  const analysis = auditData?.auditResult;
  if (!analysis) {
    log.warn('[Content Fragment Unused] Missing audit result; skipping opportunity creation');
    return;
  }

  await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
  );
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(contentFragmentUnusedAuditRunner)
  .withPostProcessors([
    createContentFragmentUnusedOpportunity,
  ])
  .build();
