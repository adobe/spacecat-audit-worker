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
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/base-audit.js';
import { bulkPublishToAdminHlx } from '../utils/report-uploader.js';
import { generateReportingPeriods } from '../cdn-logs-report/utils/report-utils.js';

const AUDIT_TYPE = 'cdn-reports-bulk-publish';
const POLL_TIMEOUT_MS = 10 * 60_000;

function buildReportsForSite(llmoFolder, periodIdentifier) {
  return [
    { outputLocation: `${llmoFolder}/agentic-traffic`, filename: `agentictraffic-${periodIdentifier}.xlsx` },
    { outputLocation: `${llmoFolder}/referral-traffic-cdn`, filename: `referral-traffic-${periodIdentifier}.xlsx` },
  ];
}

async function runCdnReportsBulkPublish(url, context) {
  const { log, dataAccess } = context;

  const configuration = await dataAccess.Configuration.findLatest();
  const allSites = await dataAccess.Site.all();
  const llmoFolders = allSites
    .filter((s) => configuration?.isHandlerEnabledForSite('cdn-logs-report', s))
    .map((s) => s.getConfig()?.getLlmoDataFolder())
    .filter(Boolean);

  const now = new Date();
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

  log.info(`%s: bulk-publishing ${reports.length} paths across ${llmoFolders.length} sites for periods [${periods.join(', ')}]`, AUDIT_TYPE);

  await bulkPublishToAdminHlx(reports, log, { pollTimeoutMs: POLL_TIMEOUT_MS });

  return {
    auditResult: {
      sites: llmoFolders.length,
      paths: reports.length,
      periods,
    },
    fullAuditRef: `${AUDIT_TYPE}/${periods.join(',')}`,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnReportsBulkPublish)
  .withUrlResolver(wwwUrlResolver)
  .build();
