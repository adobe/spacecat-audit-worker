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
 * Registered as a plain HANDLERS entry (not via AuditBuilder) because:
 * - it operates across all sites, so the per-site siteProvider / urlResolver /
 *   isAuditEnabledForSite gates in RunnerAudit don't apply
 * - persisting a per-site Audit row would be misleading (no real subject site)
 *
 * SQS message shape: { type: 'cdn-reports-bulk-publish' }. No siteId required.
 */
import { ok } from '@adobe/spacecat-shared-http-utils';
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

export default async function cdnReportsBulkPublish(message, context) {
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
    return ok({ sites: 0, paths: 0, periods });
  }

  log.info(`%s: bulk-publishing ${reports.length} paths across ${llmoFolders.length} sites for periods [${periods.join(', ')}]`, AUDIT_TYPE);

  // Let errors propagate; the dispatcher converts them to 5xx so SQS surfaces
  // the failure (and eventually routes to DLQ) instead of silently swallowing
  // a safety-net failure.
  await bulkPublishToAdminHlx(reports, log, { pollTimeoutMs: POLL_TIMEOUT_MS });

  return ok({ sites: llmoFolders.length, paths: reports.length, periods });
}
