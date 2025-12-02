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

import ExcelJS from 'exceljs';
import { generateReportingPeriods as genPeriods } from '../../cdn-logs-report/utils/report-utils.js';
import { resolveConsolidatedBucketName, extractCustomerDomain } from '../../utils/cdn-utils.js';
import { createLLMOSharepointClient, readFromSharePoint } from '../../utils/report-uploader.js';
import { downloadExistingCdnSheet } from '../../llm-error-pages/utils.js';

export { downloadExistingCdnSheet };
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

/**
 * Load the latest week's agentic traffic sheet for a site
 * Returns the computed weekId, baseUrl, output location and parsed rows.
 */
export async function loadLatestAgenticSheet(site, context) {
  const { log } = context;
  const s3Config = await getS3Config(site, context);
  const llmoFolder = site.getConfig()?.getLlmoDataFolder?.() || s3Config.customerName;
  const outputLocation = `${llmoFolder}/agentic-traffic`;
  const { weeks } = generateReportingPeriods();
  const latestWeek = weeks[0];
  const weekId = `w${String(latestWeek.weekNumber).padStart(2, '0')}-${latestWeek.year}`;
  const sharepointClient = await createLLMOSharepointClient(context);
  const rows = await downloadExistingCdnSheet(
    weekId,
    outputLocation,
    sharepointClient,
    log,
    readFromSharePoint,
    ExcelJS,
  );
  const baseUrl = site.getBaseURL?.() || '';
  return {
    weekId,
    baseUrl,
    outputLocation,
    rows,
  };
}

/**
 * Build an aggregate hit map from sheet rows keyed by normalized path.
 */
export function buildSheetHitsMap(rows) {
  const map = new Map();
  if (Array.isArray(rows)) {
    for (const r of rows) {
      const path = (typeof r.url === 'string' && r.url.length > 0) ? r.url : '/';
      const inc = Number(r.number_of_hits || 0) || 0;
      const prev = map.get(path) || 0;
      map.set(path, prev + inc);
    }
  }
  return map;
}
