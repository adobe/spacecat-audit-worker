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
/* eslint-disable no-await-in-loop */

import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { getS3Config, ensureTableExists, loadSql } from './utils/report-utils.js';
import { pathHasData } from '../utils/cdn-utils.js';
import { runWeeklyReport } from './utils/report-runner.js';
import { wwwUrlResolver } from '../common/base-audit.js';
import { createLLMOSharepointClient } from '../utils/report-uploader.js';
import { getConfigs } from './constants/report-configs.js';
import { getImsOrgId } from '../utils/data-access.js';

async function runCdnLogsReport(url, context, site, auditContext) {
  const { log, dataAccess } = context;
  const s3Config = await getS3Config(site, context);

  if (!s3Config?.bucket) {
    return {
      auditResult: {
        success: false,
        error: 'No CDN bucket found',
        completedAt: new Date().toISOString(),
      },
      fullAuditRef: url,
    };
  }

  log.debug(`Starting CDN logs report audit for ${url}`);

  const sharepointClient = await createLLMOSharepointClient(
    context,
    auditContext?.sharepointOptions,
  );
  const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation(), {
    pollIntervalMs: 2000,
    maxPollAttempts: 200,
  });
  /* c8 ignore next */
  const { orgId } = site.getConfig().getLlmoCdnBucketConfig() || {};
  // for non-adobe customers, use the orgId from the config
  const imsOrgId = orgId || await getImsOrgId(site, dataAccess, log);

  const reportConfigs = getConfigs(s3Config.bucket, s3Config.customerDomain, imsOrgId);

  const results = [];
  for (const reportConfig of reportConfigs) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await pathHasData(context.s3Client, reportConfig.aggregatedLocation))) {
      log.info(`No data found for ${reportConfig.name} report - skipping`);
      // eslint-disable-next-line no-continue
      continue;
    }

    if (results.length === 0) {
      // eslint-disable-next-line no-await-in-loop
      const sqlDb = await loadSql('create-database', { database: s3Config.databaseName });
      // eslint-disable-next-line no-await-in-loop
      await athenaClient.execute(sqlDb, s3Config.databaseName, `[Athena Query] Create database ${s3Config.databaseName}`);
    }

    await ensureTableExists(athenaClient, s3Config.databaseName, reportConfig, log);

    log.debug(`Running weekly report: ${reportConfig.name}...`);
    const weekOffset = auditContext?.weekOffset ?? -1;
    await runWeeklyReport({
      athenaClient,
      s3Config,
      reportConfig,
      log,
      site,
      sharepointClient,
      weekOffset,
    });

    results.push({
      name: reportConfig.name,
      table: reportConfig.tableName,
      database: s3Config.databaseName,
      customer: s3Config.customerName,
    });
  }

  return {
    auditResult: results,
    fullAuditRef: `${site.getConfig()?.getLlmoDataFolder()}`,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnLogsReport)
  .withUrlResolver(wwwUrlResolver)
  .build();
