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

import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { getImsOrgId, syncSuggestions } from '../utils/data-access.js';
import { AemAnalyzer } from '../content-fragment-insights/aem-analyzer.js';
import { UNUSED_CONTENT_STATUSES } from '../content-fragment-insights/fragment-analyzer.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import {
  buildStoragePath,
  uploadFragmentsToS3,
  downloadFragmentsFromS3,
} from './storage/s3-storage.js';

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
  const {
    log, dataAccess, s3Client, env,
  } = context;
  const auditContext = { ...context, site };

  const imsOrgId = await getImsOrgId(site, dataAccess, log);
  if (!imsOrgId) {
    throw new Error(`[Content Fragment Unused] Missing IMS organization ID for site: ${site.getBaseURL()}`);
  }

  const awsEnv = env.AWS_ENV;
  if (!awsEnv) {
    throw new Error('[Content Fragment Unused] Missing AWS environment in environment variables');
  }

  const analyzer = new AemAnalyzer(auditContext);
  const unusedFragmentsReport = await analyzer.findUnusedFragments();

  const statusSummary = createStatusSummary(
    unusedFragmentsReport.totalFragments,
    unusedFragmentsReport.data,
  );

  const s3Path = buildStoragePath(awsEnv, imsOrgId);
  await uploadFragmentsToS3(unusedFragmentsReport.data, s3Path, s3Client, log);

  return {
    fullAuditRef: baseURL,
    auditResult: {
      totalFragments: unusedFragmentsReport.totalFragments,
      totalUnused: unusedFragmentsReport.totalUnused,
      statusSummary,
      s3Path,
    },
  };
}

export async function createContentFragmentUnusedSuggestions(auditUrl, auditData, context) {
  const { log, s3Client } = context;

  const auditResult = auditData?.auditResult;
  if (!auditResult) {
    log.warn('[Content Fragment Unused] Missing audit result; skipping suggestions creation');
    return;
  }

  const { s3Path } = auditResult;
  if (!s3Path) {
    log.warn('[Content Fragment Unused] Missing S3 path in audit result; skipping suggestions creation');
    return;
  }

  const unusedFragments = await downloadFragmentsFromS3(s3Path, s3Client, log);
  if (!unusedFragments || unusedFragments.length === 0) {
    log.warn('[Content Fragment Unused] No suggestions to create');
    return;
  }

  const enrichedAuditData = {
    ...auditData,
    auditResult: {
      ...auditResult,
      data: unusedFragments,
    },
  };

  const opportunity = await convertToOpportunity(
    auditUrl,
    enrichedAuditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
  );

  const buildKey = (fragment) => `${fragment.path}`;

  await syncSuggestions({
    context,
    opportunity,
    newData: unusedFragments,
    buildKey,
    mapNewSuggestion: (fragment) => ({
      opportunityId: opportunity.getId(),
      type: SuggestionModel.TYPES.CONTENT_UPDATE,
      rank: 0,
      data: fragment,
    }),
  });

  log.info(`[Content Fragment Unused] Created ${unusedFragments.length} suggestions for opportunity: ${opportunity.getId()}`);
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(contentFragmentUnusedAuditRunner)
  .withPostProcessors([
    createContentFragmentUnusedSuggestions,
  ])
  .build();
