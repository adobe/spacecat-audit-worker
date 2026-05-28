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
import { ok } from '@adobe/spacecat-shared-http-utils';
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

export default async function cdnReportsBulkPublish(message, context) {
  const { log, dataAccess } = context;

  const configuration = await dataAccess.Configuration.findLatest();
  const allSites = await dataAccess.Site.all();
  // Folders must be a single safe path segment without `--` (Helix uses `--`
  // as the {branch}--{repo}--{owner} separator). Anything else breaks
  // admin.hlx.page bulk-preview and poisons the whole batch.
  const VALID_FOLDER = /^[a-z0-9][a-z0-9_-]*$/i;
  const llmoFolders = allSites
    .filter((s) => configuration?.isHandlerEnabledForSite('cdn-logs-report', s))
    .map((s) => s.getConfig()?.getLlmoDataFolder())
    .filter((f) => f && VALID_FOLDER.test(f) && !f.includes('--'));

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

  if (llmoFolders.length === 0) {
    log.warn('%s: no enabled sites; nothing to publish', AUDIT_TYPE);
    return ok({ sites: 0, paths: 0, periods });
  }

  log.info(`%s: bulk-publishing ${reports.length} paths across ${llmoFolders.length} sites for periods [${periods.join(', ')}]`, AUDIT_TYPE);

  try {
    await bulkPublishToAdminHlx(reports, log, { pollTimeoutMs: POLL_TIMEOUT_MS });
    return ok({
      sites: llmoFolders.length, paths: reports.length, periods, success: true,
    });
  } catch (error) {
    log.error(`%s: bulk publish failed (${reports.length} paths, ${llmoFolders.length} sites): ${error.message}`, AUDIT_TYPE);
    return ok({
      sites: llmoFolders.length,
      paths: reports.length,
      periods,
      success: false,
      error: error.message,
    });
  }
}
