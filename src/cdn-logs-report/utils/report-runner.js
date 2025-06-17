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
import { executeAthenaQuery } from '../../utils/athena-utils.js';
import { weeklyBreakdownQueries } from '../queries/weekly-breakdown-queries.js';
import {
  getWeekRange,
  createDateRange,
  generatePeriodIdentifier,
  generateReportingPeriods,
} from './date-utils.js';
import { createCDNLogsExcelReport } from './excel-generator.js';
import { saveExcelReport } from './report-uploader.js';
import { getPageTypePatterns } from './page-type-classifier.js';
import {
  REPORTS_PATH,
  SUPPORTED_PROVIDERS,
  ERROR_MESSAGES,
} from '../constants/index.js';

async function getAvailableAnalysisTypes(athenaClient, databaseName, s3Config, log) {
  const query = `SHOW TABLES IN ${databaseName}`;
  const results = await executeAthenaQuery(athenaClient, query, s3Config, log, databaseName);
  const tableNames = results.flatMap((row) => Object.values(row));

  return tableNames
    .filter((tableName) => tableName.startsWith('aggregated_logs_analysis_type_'))
    .map((tableName) => tableName.replace('aggregated_logs_analysis_type_', ''))
    .filter((analysisType) => analysisType.length > 0);
}

async function collectReportData(
  athenaClient,
  endDate,
  databaseName,
  s3Config,
  log,
  provider,
  site,
) {
  const periods = generateReportingPeriods(endDate);
  const pageTypePatterns = site ? getPageTypePatterns(site) : null;
  const reportData = {};

  const queries = {
    reqcountbycountry: weeklyBreakdownQueries.createCountryWeeklyBreakdown(
      periods,
      databaseName,
      provider,
    ),
    reqcountbyuseragent: weeklyBreakdownQueries.createUserAgentWeeklyBreakdown(
      periods,
      databaseName,
      provider,
    ),
    reqcountbyurlstatus: weeklyBreakdownQueries.createUrlStatusWeeklyBreakdown(
      periods,
      databaseName,
      provider,
      pageTypePatterns,
    ),
    reqcountbyurluseragentstatus: weeklyBreakdownQueries.createUrlUserAgentStatusBreakdown(
      periods,
      databaseName,
      provider,
    ),
    individual_urls_by_status: weeklyBreakdownQueries.createTopBottomUrlsByStatus(
      periods,
      databaseName,
      provider,
    ),
  };

  for (const [key, query] of Object.entries(queries)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const results = await executeAthenaQuery(athenaClient, query, s3Config, log, databaseName);
      reportData[key] = results || [];
    } catch (error) {
      const providerMsg = provider ? ` for ${provider}` : '';
      log.error(`Failed to collect data for ${key}${providerMsg}: ${error.message}`);
      reportData[key] = [];
    }
  }

  return reportData;
}

export async function runReport(athenaClient, databaseName, s3Config, s3Client, log, options = {}) {
  const {
    startDate,
    endDate,
    provider,
    site,
    sharepointClient,
  } = options;

  let periodStart;
  let periodEnd;
  if (startDate && endDate) {
    const parsed = createDateRange(startDate, endDate);
    periodStart = parsed.startDate;
    periodEnd = parsed.endDate;
  } else {
    const { weekStart, weekEnd } = getWeekRange(-1);
    periodStart = weekStart;
    periodEnd = weekEnd;
  }

  const periodIdentifier = generatePeriodIdentifier(periodStart, periodEnd);
  const providerMsg = provider ? ` for ${provider}` : '';
  log.info(`Running report${providerMsg} for ${periodIdentifier}`);

  try {
    const analysisTypes = await getAvailableAnalysisTypes(
      athenaClient,
      databaseName,
      s3Config,
      log,
    );
    if (analysisTypes.length === 0) {
      throw new Error(ERROR_MESSAGES.NO_ANALYSIS_TYPES);
    }

    const reportData = await collectReportData(
      athenaClient,
      periodEnd,
      databaseName,
      s3Config,
      log,
      provider,
      site,
    );

    const providerSuffix = provider ? `-${provider}` : '';
    const filename = `agentic-traffic${providerSuffix}-${periodIdentifier}.xlsx`;
    const key = `${REPORTS_PATH}/${provider}/${filename}`;

    const workbook = await createCDNLogsExcelReport(reportData, {
      customEndDate: periodEnd.toISOString().split('T')[0],
      filename,
    });

    await saveExcelReport(workbook, s3Config.bucket, key, s3Client, log, sharepointClient);
  } catch (error) {
    log.error(`Report generation failed: ${error.message}`);
    throw error;
  }
}

export async function runReportsForAllProviders(
  athenaClient,
  databaseName,
  s3Config,
  s3Client,
  log,
  options = {},
) {
  log.info(`Generating reports for providers: ${SUPPORTED_PROVIDERS.join(', ')}`);

  for (const provider of SUPPORTED_PROVIDERS) {
    try {
      log.info(`Starting report generation for ${provider}...`);
      // eslint-disable-next-line no-await-in-loop
      await runReport(athenaClient, databaseName, s3Config, s3Client, log, {
        ...options,
        provider,
      });
      log.info(`Successfully generated ${provider} report`);
    } catch (error) {
      log.error(`Failed to generate ${provider} report: ${error.message}`);
    }
  }
}

export async function runWeeklyReport({
  athenaClient,
  databaseName,
  s3Config,
  s3Client,
  log,
  site,
  sharepointClient,
}) {
  await runReportsForAllProviders(athenaClient, databaseName, s3Config, s3Client, log, {
    site,
    sharepointClient,
  });
}

export async function runCustomDateRangeReport({
  athenaClient,
  startDateStr,
  endDateStr,
  databaseName,
  s3Config,
  s3Client,
  log,
  site,
  sharepointClient,
}) {
  await runReportsForAllProviders(athenaClient, databaseName, s3Config, s3Client, log, {
    startDate: startDateStr,
    endDate: endDateStr,
    site,
    sharepointClient,
  });
}

/* c8 ignore end */
