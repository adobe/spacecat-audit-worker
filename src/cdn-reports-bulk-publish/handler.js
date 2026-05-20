/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/**
 * Manual-only cross-site safety-net for the per-site cdn-logs-report bulk publish.
 *
 * Iterates every site with cdn-logs-report enabled, builds the report paths for
 * the current ISO week (plus the previous week on Monday UTC), and submits one
 * consolidated bulk preview + publish to admin.hlx.page.
 *
 * Registered via AuditBuilder for SQS dispatch convenience, but the runner
 * ignores `url`, `site`, and `auditContext` -- it operates across all sites.
 * The persisted audit row is keyed against whichever site triggered the run
 * and is not semantically meaningful for that site.
 *
 * Bulk-publish errors are caught and recorded in the audit result; we
 * intentionally do not propagate them, to avoid SQS redelivering a 10-minute
 * cross-site run that already hammered admin.hlx.page.
 */
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/base-audit.js';
import { bulkPublishToAdminHlx } from '../utils/report-uploader.js';
import { generateReportingPeriods } from '../cdn-logs-report/utils/report-utils.js';

const AUDIT_TYPE = 'cdn-reports-bulk-publish';
// Longer than the per-site default (3 min) because admin.hlx.page preview
// latency grows with the consolidated batch size. See SKYSI-79147 for the
// 3-min per-site default.
const POLL_TIMEOUT_MS = 10 * 60_000;

function buildReportsForSite(llmoFolder, periodIdentifier) {
  return [
    { outputLocation: `${llmoFolder}/agentic-traffic`, filename: `agentictraffic-${periodIdentifier}.xlsx` },
    { outputLocation: `${llmoFolder}/referral-traffic-cdn`, filename: `referral-traffic-${periodIdentifier}.xlsx` },
  ];
}

export async function runCdnReportsBulkPublish(_url, context) {
  const { log, dataAccess } = context;

  const configuration = await dataAccess.Configuration.findLatest();
  const allSites = await dataAccess.Site.all();
  const llmoFolders = allSites
    .filter((s) => configuration?.isHandlerEnabledForSite('cdn-logs-report', s))
    .map((s) => s.getConfig()?.getLlmoDataFolder())
    .filter(Boolean);

  const now = new Date();
  // On Monday UTC the per-site audits are still publishing last week's reports,
  // so include the previous week to catch stragglers.
  const periods = [generateReportingPeriods(now, 0).periodIdentifier];
  if (now.getUTCDay() === 1) {
    periods.push(generateReportingPeriods(now, -1).periodIdentifier);
  }

  const reports = [];
  for (const llmoFolder of llmoFolders) {
    for (const period of periods) {
      reports.push(...buildReportsForSite(llmoFolder, period));
    }
  }

  if (llmoFolders.length === 0) {
    log.warn('%s: no sites with cdn-logs-report enabled and an LLMO data folder; nothing to publish', AUDIT_TYPE);
  } else {
    log.info(`%s: bulk-publishing ${reports.length} paths across ${llmoFolders.length} sites for periods [${periods.join(', ')}]`, AUDIT_TYPE);
  }

  const result = {
    sites: llmoFolders.length,
    paths: reports.length,
    periods,
  };

  try {
    await bulkPublishToAdminHlx(reports, log, { pollTimeoutMs: POLL_TIMEOUT_MS });
    result.success = true;
  } catch (error) {
    log.error(`%s: bulk publish failed: ${error.message}`, AUDIT_TYPE);
    result.success = false;
    result.error = error.message;
  }

  return {
    auditResult: result,
    fullAuditRef: `${AUDIT_TYPE}/${periods.join(',')}`,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnReportsBulkPublish)
  .withUrlResolver(noopUrlResolver)
  .build();
