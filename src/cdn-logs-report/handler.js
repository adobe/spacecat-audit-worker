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

/* c8 ignore start */
import { createFrom } from '@adobe/spacecat-helix-content-sdk';
import { AuditBuilder } from '../common/audit-builder.js';
import { getS3Config, ensureTableExists } from './utils/aws-utils.js';
import { runWeeklyReport, runCustomDateRangeReport } from './utils/report-runner.js';
import {
  AUDIT_TYPES, MESSAGE_TYPES, ERROR_MESSAGES, SHAREPOINT_URL,
} from './constants/core.js';

async function createAuditResult(reportType, auditUrl, additionalData = {}) {
  return {
    auditResult: {
      success: true,
      reportType,
      timestamp: new Date().toISOString(),
      ...additionalData,
    },
    fullAuditRef: auditUrl,
  };
}

async function runCdnLogsReport(url, context, site) {
  const {
    log, athenaClient,
  } = context;
  const message = context.message || {};

  log.info(`Starting CDN logs report audit for ${url}`);

  const s3Config = getS3Config(site, context);
  const sharepointClient = await createFrom({
    clientId: process.env.SHAREPOINT_CLIENT_ID,
    clientSecret: process.env.SHAREPOINT_CLIENT_SECRET,
    authority: process.env.SHAREPOINT_AUTHORITY,
    domainId: process.env.SHAREPOINT_DOMAIN_ID,
  }, { url: SHAREPOINT_URL, type: 'onedrive' });

  await ensureTableExists(athenaClient, s3Config, log);

  if (message.type === MESSAGE_TYPES.CUSTOM_DATE_RANGE) {
    const { startDate, endDate } = message;

    if (!startDate || !endDate) {
      throw new Error(ERROR_MESSAGES.MISSING_DATE_RANGE);
    }

    log.info(`Running custom date range report: ${startDate} to ${endDate}`);
    await runCustomDateRangeReport({
      athenaClient,
      startDateStr: startDate,
      endDateStr: endDate,
      s3Config,
      log,
      site,
      sharepointClient,
    });

    return createAuditResult(AUDIT_TYPES.CUSTOM, url, {
      dateRange: { startDate, endDate },
    });
  }

  log.info('Running weekly report...');
  await runWeeklyReport({
    athenaClient,
    s3Config,
    log,
    site,
    sharepointClient,
  });

  return createAuditResult(AUDIT_TYPES.WEEKLY, url);
}

export default new AuditBuilder()
  .withRunner(runCdnLogsReport)
  .build();

/* c8 ignore end */
