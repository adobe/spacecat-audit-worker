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

/* eslint-disable no-param-reassign */
/* c8 ignore start */

import {
  getStaticContent, getWeekInfo, isoCalendarWeek,
} from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import ExcelJS from 'exceljs';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { createLLMOSharepointClient, saveExcelReport } from '../utils/report-uploader.js';
import { DEFAULT_COUNTRY_PATTERNS } from '../common/country-patterns.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const COMPILED_COUNTRY_PATTERNS = DEFAULT_COUNTRY_PATTERNS.map(({ name, regex }) => {
  let flags = '';

  if (regex.startsWith('(?i)')) {
    flags += 'i';
    regex = regex.slice(4);
  }

  return { name, re: new RegExp(regex, flags) };
});

function extractCountryCode(url) {
  for (const { re } of COMPILED_COUNTRY_PATTERNS) {
    const match = url.match(re);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }
  return 'GLOBAL';
}

async function createWorkbook(results) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  if (results.length === 0) return workbook;

  // set headers from first object
  const headers = Object.keys(results[0]);
  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: 20,
  }));

  for (const item of results) {
    worksheet.addRow(item);
  }

  return workbook;
}

export async function triggerTrafficAnalysisImport(context) {
  const {
    site, finalUrl, log, auditContext = {},
  } = context;

  const siteId = site.getId();
  let week;
  let year;

  if (auditContext.week && auditContext.year) {
    ({ week, year } = getWeekInfo(auditContext.week, auditContext.year));
  } else {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    ({ week, year } = isoCalendarWeek(yesterday));
  }

  log.info(
    `[llmo-referral-traffic] Triggering traffic-analysis import for site: ${siteId}, `
    + `week: ${week}, year: ${year}`,
  );

  return {
    type: 'traffic-analysis',
    siteId,
    auditResult: {
      status: 'import-triggered',
      week,
      year,
    },
    auditContext: {
      week,
      year,
    },
    fullAuditRef: finalUrl,
    allowCache: false,
  };
}

export async function referralTrafficRunner(context) {
  const {
    env, log, audit, site,
  } = context;
  const { S3_IMPORTER_BUCKET_NAME: importerBucket } = env;

  const auditResult = audit.getAuditResult();
  const { week, year } = auditResult;
  const { temporalCondition } = getWeekInfo(week, year);
  const siteId = site.getSiteId();
  const baseURL = site.getBaseURL();

  log.info(
    `[llmo-referral-traffic] Starting referral traffic extraction for site: ${siteId}, `
    + `week: ${week}, year: ${year}`,
  );

  // constants
  const tempLocation = `s3://${importerBucket}/rum-metrics-compact/temp/out/`;
  const databaseName = 'rum_metrics';
  const tableName = 'compact_metrics';
  const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);

  // query build-up
  const variables = {
    tableName: `${databaseName}.${tableName}`,
    siteId,
    temporalCondition,
  };

  // Step 1: Check if ANY OpTel data exists for this domain
  log.info(`[llmo-referral-traffic] Checking for OpTel data availability for ${baseURL}`);
  const checkOptelQuery = await getStaticContent(
    variables,
    './src/llmo-referral-traffic/sql/check-optel-data.sql',
  );
  const optelCheckDescription = `[Athena Query] Checking OpTel data availability for ${baseURL}`;
  const optelCheckResults = await athenaClient.query(
    checkOptelQuery,
    databaseName,
    optelCheckDescription,
  );

  const hasOptelData = optelCheckResults.length > 0 && optelCheckResults[0].row_count > 0;

  if (!hasOptelData) {
    log.info(`[llmo-referral-traffic] No OpTel data available for ${baseURL} - skipping spreadsheet creation`);
    return {
      auditResult: {
        rowCount: 0,
        hasOptelData: false,
      },
      fullAuditRef: `No OpTel Data Available for ${baseURL}`,
    };
  }

  log.info(`[llmo-referral-traffic] OpTel data found for ${baseURL}, checking for LLM referral traffic`);

  // Step 2: Fetch LLM referral traffic data
  const query = await getStaticContent(variables, './src/llmo-referral-traffic/sql/referral-traffic.sql');
  const description = `[Athena Query] Fetching LLM referral traffic data for ${baseURL}`;
  const results = await athenaClient.query(query, databaseName, description);

  // If OpTel data exists but no LLM referral traffic, create empty spreadsheet
  if (results.length === 0) {
    log.info(`[llmo-referral-traffic] OpTel data exists but no LLM referral traffic found for ${baseURL} - creating empty spreadsheet`);

    const sharepointClient = await createLLMOSharepointClient(context);
    const workbook = await createWorkbook(results); // Creates empty workbook
    const llmoFolder = site.getConfig()?.getLlmoDataFolder();
    const outputLocation = `${llmoFolder}/referral-traffic`;
    const filename = `referral-traffic-w${String(week).padStart(2, '0')}-${year}.xlsx`;

    await saveExcelReport({
      sharepointClient,
      workbook,
      filename,
      outputLocation,
      log,
    });

    return {
      auditResult: {
        filename,
        outputLocation,
        rowCount: 0,
        hasOptelData: true,
        hasLlmTraffic: false,
      },
      fullAuditRef: `${outputLocation}/${filename}`,
    };
  }

  // LLM referral traffic data found - enrich and create spreadsheet
  log.info(`[llmo-referral-traffic] Found ${results.length} LLM referral traffic records for ${baseURL}`);
  log.info('[llmo-referral-traffic] Enriching data with page intents and region information');
  const pageIntents = await site.getPageIntents();
  log.info(`[llmo-referral-traffic] Retrieved ${pageIntents.length} page intents for site ${siteId}`);
  const pageIntentMap = pageIntents.reduce((acc, cur) => {
    acc[new URL(cur.getUrl()).pathname] = cur.getPageIntent();
    return acc;
  }, {});

  // enrich with extra fields
  results.forEach((result) => {
    result.page_intent = pageIntentMap[result.path] || '';
    result.region = extractCountryCode(result.path);
  });
  log.info(`[llmo-referral-traffic] Data enrichment completed for ${results.length} rows`);

  // upload to sharepoint & publish via hlx admin api
  const sharepointClient = await createLLMOSharepointClient(context);

  const workbook = await createWorkbook(results);
  const llmoFolder = site.getConfig()?.getLlmoDataFolder();
  const outputLocation = `${llmoFolder}/referral-traffic`;
  const filename = `referral-traffic-w${String(week).padStart(2, '0')}-${year}.xlsx`;

  await saveExcelReport({
    sharepointClient,
    workbook,
    filename,
    outputLocation,
    log,
  });

  return {
    auditResult: {
      filename,
      outputLocation,
      rowCount: results.length,
      hasOptelData: true,
      hasLlmTraffic: true,
    },
    fullAuditRef: `${outputLocation}/${filename}`,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'trigger-traffic-analysis-import',
    triggerTrafficAnalysisImport,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'run-referral-traffic',
    referralTrafficRunner,
  )
  .build();
/* c8 ignore end */
