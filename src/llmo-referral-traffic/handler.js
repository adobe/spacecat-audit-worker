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

import { getStaticContent } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import ExcelJS from 'exceljs';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { formatWeekYear, getTemporalCondition } from '../utils/date-utils.js';
import { createLLMOSharepointClient, saveExcelReport } from '../utils/report-uploader.js';
import { DEFAULT_COUNTRY_PATTERNS } from '../cdn-logs-report/constants/country-patterns.js';

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

export async function referralTrafficRunner(auditUrl, context, site, auditContext = {}) {
  const { env, log } = context;
  const { S3_IMPORTER_BUCKET_NAME: importerBucket } = env;

  const { week, year } = auditContext;

  // constants
  const tempLocation = `s3://${importerBucket}/rum-metrics-compact/temp/out/`;
  const databaseName = 'rum_metrics';
  const tableName = 'compact_metrics';
  const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);

  // query build-up
  const variables = {
    tableName: `${databaseName}.${tableName}`,
    siteId: site.getSiteId(),
    temporalCondition: getTemporalCondition(week, year),
  };

  // run athena query - fetch data
  const query = await getStaticContent(variables, './src/llmo-referral-traffic/sql/referral-traffic.sql');
  const description = `[Athena Query] Fetching referral traffic data for ${site.getBaseURL()}`;
  const results = await athenaClient.query(query, databaseName, description);

  // early return if no rum data available
  if (results.length === 0) {
    return {
      auditResult: {
        rowCount: results.length,
      },
      fullAuditRef: `No OpTel Data Found for ${site.getBaseURL()}`,
    };
  }

  const pageIntents = await site.getPageIntents();
  const pageIntentMap = pageIntents.reduce((acc, cur) => {
    acc[new URL(cur.getUrl()).pathname] = cur.getPageIntent();
    return acc;
  }, {});

  // enrich with extra fields
  results.forEach((result) => {
    result.page_intent = pageIntentMap[result.path] || '';
    result.region = extractCountryCode(result.path);
  });

  // upload to sharepoint & publish via hlx admin api
  const sharepointClient = await createLLMOSharepointClient(context);

  const workbook = await createWorkbook(results);
  const llmoFolder = site.getConfig()?.getLlmoDataFolder();
  const outputLocation = `${llmoFolder}/referral-traffic`;
  const filename = `referral-traffic-w${formatWeekYear(week, year)}.xlsx`;

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
    },
    fullAuditRef: `${outputLocation}/${filename}`,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(referralTrafficRunner)
  .build();
/* c8 ignore end */
