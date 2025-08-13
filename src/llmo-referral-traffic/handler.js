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

import { getDateRanges, getStaticContent, isInteger } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import ExcelJS from 'exceljs';
import { createFrom } from '@adobe/spacecat-helix-content-sdk';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { getPreviousWeekYear, getTemporalCondition } from '../utils/date-utils.js';
import { saveExcelReport } from '../utils/report-uploader.js';
import { DEFAULT_COUNTRY_PATTERNS } from '../cdn-logs-report/constants/country-patterns.js';

const SHAREPOINT_URL = 'https://adobe.sharepoint.com/:x:/r/sites/HelixProjects/Shared%20Documents/sites/elmo-ui-data';

function extractCountryCode(url) {
  for (const { regex } of DEFAULT_COUNTRY_PATTERNS) {
    const re = new RegExp(regex, 'i');
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

function calculateAuditStartDate(auditContext) {
  if (!isInteger(auditContext.week) || !isInteger(auditContext.year)) {
    return new Date();
  }

  const ranges = getDateRanges(auditContext.week, auditContext.year);
  return new Date(ranges[0].startTime);
}

export async function referralTrafficRunner(auditUrl, context, site, auditContext) {
  const { env, log } = context;
  const { S3_IMPORTER_BUCKET_NAME: importerBucket } = env;

  const today = calculateAuditStartDate(auditContext);

  // constants
  const tempLocation = `s3://${importerBucket}/rum-metrics-compact/temp/out/`;
  const databaseName = 'rum_metrics';
  const tableName = 'compact_metrics';
  const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);

  // query build-up
  const variables = {
    tableName: `${databaseName}.${tableName}`,
    siteId: site.getSiteId(),
    temporalCondition: getTemporalCondition(today),
  };

  // run athena query - fetch data
  const query = await getStaticContent(variables, './src/llmo-referral-traffic/sql/referral-traffic.sql');
  const description = `[Athena Query] Fetching referral traffic data for ${site.getBaseURL()}`;
  const results = await athenaClient.query(query, databaseName, description);
  const pageIntents = await site.getPageIntents();
  const baseURL = site.getBaseURL();
  const memo = {};

  const findPageIntentByPath = (path) => {
    if (memo[path]) {
      return memo[path];
    }

    const url = `${baseURL}${path}`;
    const pageIntent = pageIntents.find((pi) => pi.getUrl() === url) || '';
    memo[path] = pageIntent;
    return pageIntent;
  };

  // enrich with extra fields
  results.forEach((result) => {
    result.page_intent = findPageIntentByPath(result.path);
    result.region = extractCountryCode(result.path);
  });

  // upload to sharepoint & publish via hlx admin api
  const sharepointClient = await createFrom({
    clientId: context.env.SHAREPOINT_CLIENT_ID,
    clientSecret: context.env.SHAREPOINT_CLIENT_SECRET,
    authority: context.env.SHAREPOINT_AUTHORITY,
    domainId: context.env.SHAREPOINT_DOMAIN_ID,
  }, { url: SHAREPOINT_URL, type: 'onedrive' });

  const workbook = await createWorkbook(results);
  const llmoFolder = site.getConfig()?.getLlmoDataFolder();
  const outputLocation = `${llmoFolder}/referral-traffic`;
  const filename = `referral-traffic-w${getPreviousWeekYear(today)}.xlsx`;

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
