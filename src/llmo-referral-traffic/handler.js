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
import { fetchAgenticUrlClassificationRules } from '../common/agentic-url-classification-rules.js';
import { createClassifier } from '../common/agentic-url-classification.js';
import { sanitizeSpreadsheetValue } from '../common/spreadsheet-safe.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

// Explicit weekly column order. topic/category always present (empty when not
// classifying) so the Excel schema is stable regardless of rule availability.
// Headers are NOT inferred from the data so layout cannot drift when the SQL
// projection or enrichment changes.
const WEEKLY_COLUMNS = [
  'path', 'trf_type', 'trf_channel', 'trf_platform', 'device', 'date',
  'pageviews', 'consent', 'bounced', 'page_intent', 'region', 'topic', 'category',
];

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

  // explicit headers (I6): never inferred from the data, so topic/category are
  // always present and the column order is stable
  worksheet.columns = WEEKLY_COLUMNS.map((header) => ({
    header,
    key: header,
    width: 20,
  }));

  for (const item of results) {
    const row = {};
    for (const col of WEEKLY_COLUMNS) {
      // sanitize against spreadsheet formula injection on visitor-influenced cells
      row[col] = sanitizeSpreadsheetValue(item[col] ?? '');
    }
    worksheet.addRow(row);
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
  const siteId = site.getId();
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

  // run athena query - fetch data
  const query = await getStaticContent(variables, './src/llmo-referral-traffic/sql/referral-traffic.sql');
  const description = `[Athena Query] Fetching referral traffic data for ${baseURL}`;
  const results = await athenaClient.query(query, databaseName, description);

  // early return if no rum data available
  if (results.length === 0) {
    log.info(`[llmo-referral-traffic] No OpTel data found for ${baseURL}`);
    return {
      auditResult: {
        rowCount: results.length,
      },
      fullAuditRef: `No OpTel Data Found for ${baseURL}`,
    };
  }

  log.info('[llmo-referral-traffic] Enriching data with page intents and region information');
  const pageIntents = await site.getPageIntents();
  log.info(`[llmo-referral-traffic] Retrieved ${pageIntents.length} page intents for site ${siteId}`);
  const pageIntentMap = pageIntents.reduce((acc, cur) => {
    acc[new URL(cur.getUrl()).pathname] = cur.getPageIntent();
    return acc;
  }, {});

  // fetch agentic URL classification rules (topic + category); gate enrichment
  // on rules being present so rows are not blanket-tagged as 'Other'.
  // Timed: the Postgres fetch latency adds to Lambda runtime and is the first
  // thing to check during latency investigations.
  const rulesFetchStart = Date.now();
  const classificationRules = await fetchAgenticUrlClassificationRules(site, context);
  log.info(`[llmo-referral-traffic] Fetched agentic classification rules in ${Date.now() - rulesFetchStart}ms`);
  const classifier = createClassifier(classificationRules, { log });
  // M5: distinguish a failed fetch from a site that simply has no rules. The
  // classifier is null in both cases, so the fetch error shape disambiguates.
  if (classifier) {
    log.info('[llmo-referral-traffic] Agentic classification rules found; enriching with topic and category');
  } else if (classificationRules?.error) {
    log.warn('[llmo-referral-traffic] Failed to fetch agentic classification rules; leaving topic/category empty');
  } else {
    log.info('[llmo-referral-traffic] No agentic classification rules for site; skipping topic/category enrichment');
  }

  // enrich with extra fields. topic/category default to '' when not classifying.
  results.forEach((result) => {
    result.page_intent = pageIntentMap[result.path] || '';
    result.region = extractCountryCode(result.path);
    const { topic, category } = classifier
      ? classifier.classify(result.path)
      : { topic: '', category: '' };
    result.topic = topic;
    result.category = category;
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
