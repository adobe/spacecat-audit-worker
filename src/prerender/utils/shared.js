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

/*
 * Shared utilities for the Prerender audit.
 * Keeps Prerender decoupled from other audit modules.
 */

import { generateReportingPeriods as genPeriods } from '../../cdn-logs-report/utils/report-utils.js';
import { resolveConsolidatedBucketName, extractCustomerDomain } from '../../utils/cdn-utils.js';
// For sheet reading, reuse the existing implementation while keeping handler imports local
export { downloadExistingCdnSheet } from '../../llm-error-pages/utils.js';
// Re-export query builders used by prerender to avoid cross-audit imports in handler
export { weeklyBreakdownQueries } from '../../cdn-logs-report/utils/query-builder.js';

export function generateReportingPeriods(referenceDate = new Date()) {
  return genPeriods(referenceDate);
}

export async function getS3Config(site, context) {
  const customerDomain = extractCustomerDomain(site);
  const domainParts = customerDomain.split(/[._]/);
  const customerName = domainParts[0] === 'www' && domainParts.length > 1 ? domainParts[1] : domainParts[0];
  const bucket = resolveConsolidatedBucketName(context);

  return {
    bucket,
    customerName,
    customerDomain,
    databaseName: `cdn_logs_${customerDomain}`,
    tableName: `aggregated_logs_${customerDomain}_consolidated`,
    getAthenaTempLocation: () => `s3://${bucket}/temp/athena-results/`,
  };
}
