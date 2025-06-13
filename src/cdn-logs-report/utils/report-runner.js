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
import { createCDNLogsExcelReport, saveExcelReport } from './excel-generator.js';
import { getPageTypePatterns } from './page-type-classifier.js';
import {
  REPORTS_PATH,
  SUPPORTED_PROVIDERS,
  LOG_MESSAGES,
  ERROR_MESSAGES,
} from '../constants/index.js';

const QUERY_MAPPINGS = [
  {
    key: 'reqcountbycountry',
    queryFunc: weeklyBreakdownQueries.createCountryWeeklyBreakdown,
  },
  {
    key: 'reqcountbyuseragent',
    queryFunc: weeklyBreakdownQueries.createUserAgentWeeklyBreakdown,
  },
  {
    key: 'reqcountbyurlstatus',
    queryFunc: (periods, databaseName, provider, pageTypePatterns) => (
      weeklyBreakdownQueries.createUrlStatusWeeklyBreakdown(
        periods,
        databaseName,
        provider,
        pageTypePatterns,
      )
    ),
  },
  {
    key: 'reqcountbyurluseragentstatus',
    queryFunc: weeklyBreakdownQueries.createUrlUserAgentStatusBreakdown,
  },
  {
    key: 'individual_urls_by_status',
    queryFunc: weeklyBreakdownQueries.createTopBottomUrlsByStatus,
  },
];

async function getAvailableAnalysisTypes(athenaClient, databaseName, s3Config, log) {
  const ANALYSIS_TYPE_PREFIX = 'aggregated_logs_analysis_type_';
  const query = `SHOW TABLES IN ${databaseName}`;
  const results = await executeAthenaQuery(athenaClient, query, s3Config, log, databaseName);
  const tableNames = results.flatMap((row) => Object.values(row));

  const analysisTypes = tableNames
    .filter((tableName) => tableName.startsWith(ANALYSIS_TYPE_PREFIX))
    .map((tableName) => tableName.replace(ANALYSIS_TYPE_PREFIX, ''))
    .filter((analysisType) => analysisType.length > 0);

  log.info(`Found ${analysisTypes.length} analysis types: ${analysisTypes.join(', ')}`);
  return analysisTypes;
}

async function collectReportData(
  athenaClient,
  endDate,
  databaseName,
  s3Config,
  log,
  provider = null,
  site = null,
) {
  const reportData = {};
  const periods = generateReportingPeriods(endDate);
  const pageTypePatterns = site ? getPageTypePatterns(site) : null;
  const logSuffix = provider ? ` for ${provider}` : '';

  for (const { key, queryFunc } of QUERY_MAPPINGS) {
    try {
      log.info(`Collecting data for ${key}${logSuffix}...`);

      const query = queryFunc(periods, databaseName, provider, pageTypePatterns);
      // eslint-disable-next-line no-await-in-loop
      const results = await executeAthenaQuery(
        athenaClient,
        query,
        s3Config,
        log,
        databaseName,
      );
      reportData[key] = results || [];
      log.info(`Collected ${results?.length || 0} rows for ${key}${logSuffix}`);
    } catch (error) {
      log.error(`Failed to collect data for ${key}${logSuffix}: ${error.message}`);
      reportData[key] = [];
    }
  }

  return reportData;
}

export async function runReport(
  athenaClient,
  databaseName,
  s3Config,
  s3Client,
  log,
  options = {},
) {
  const {
    startDate, endDate, reportType = 'period', provider = null, site = null,
  } = options;

  let periodStart;
  let periodEnd;

  if (startDate && endDate) {
    const parsed = createDateRange(startDate, endDate);
    periodStart = parsed.startDate;
    periodEnd = parsed.endDate;
  } else {
    // For Monday audit jobs, get previous week (Monday to Sunday that just ended)
    const { weekStart, weekEnd } = getWeekRange(-1);
    periodStart = weekStart;
    periodEnd = weekEnd;
  }

  const periodIdentifier = generatePeriodIdentifier(periodStart, periodEnd);
  const providerSuffix = provider ? `-${provider}` : '';
  const logSuffix = provider ? ` for ${provider}` : '';
  const reportOutputLocation = `s3://${s3Config.bucket}/${REPORTS_PATH}/`;

  log.info(
    `Running ${reportType} report${logSuffix} for ${periodStart.toISOString()} to ${periodEnd.toISOString()} (${periodIdentifier})`,
  );

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

    const filename = `agentic-traffic${providerSuffix}-${periodIdentifier}.xlsx`;
    const key = `${REPORTS_PATH}/${provider}/${filename}`;

    log.info(`Generating Excel report${logSuffix}...`);
    const workbook = await createCDNLogsExcelReport(reportData, {
      customEndDate: periodEnd.toISOString().split('T')[0],
      filename,
    });
    const saveResult = await saveExcelReport(workbook, s3Config.bucket, key, s3Client, log);

    const excelReport = {
      filename,
      outputPath: `s3://${s3Config.bucket}/${key}`,
      saveResult,
      dataRows: Object.values(reportData).reduce(
        (total, data) => total + data.length,
        0,
      ),
    };

    log.info(`Excel report generated successfully: ${excelReport.filename}`);

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      periodIdentifier,
      reportType,
      reportOutputLocation,
      totalAnalysisTypes: analysisTypes.length,
      excelReport,
      analysisTypes,
    };
  } catch (error) {
    log.error(`Report generation failed: ${error.message}`);
    throw error;
  }
}

async function runProviderSpecificReports(
  athenaClient,
  databaseName,
  s3Config,
  s3Client,
  log,
  options = {},
) {
  const providers = SUPPORTED_PROVIDERS;
  const results = [];

  log.info(`Generating provider-specific reports for: ${providers.join(', ')}`);

  for (const provider of providers) {
    try {
      log.info(`Starting report generation for ${provider}...`);
      // eslint-disable-next-line no-await-in-loop
      const result = await runReport(
        athenaClient,
        databaseName,
        s3Config,
        s3Client,
        log,
        {
          ...options,
          provider,
          reportType: 'provider-specific',
        },
      );
      results.push({ provider, ...result });
      log.info(`Successfully generated ${provider} report`);
    } catch (error) {
      log.error(`Failed to generate ${provider} report: ${error.message}`);
      results.push({ provider, error: error.message });
    }
  }

  return results;
}

export async function runWeeklyReport(athenaClient, databaseName, s3Config, s3Client, log) {
  const providerReports = await runProviderSpecificReports(
    athenaClient,
    databaseName,
    s3Config,
    s3Client,
    log,
    { reportType: 'weekly' },
  );

  return {
    providerReports,
    totalReports: providerReports.length,
    message: LOG_MESSAGES.PROVIDER_REPORTS,
  };
}

export async function runCustomDateRangeReport(
  athenaClient,
  startDateStr,
  endDateStr,
  databaseName,
  s3Config,
  s3Client,
  log,
) {
  const providerReports = await runProviderSpecificReports(
    athenaClient,
    databaseName,
    s3Config,
    s3Client,
    log,
    {
      startDate: startDateStr,
      endDate: endDateStr,
      reportType: 'custom',
    },
  );

  return {
    providerReports,
    totalReports: providerReports.length,
    message: `${LOG_MESSAGES.PROVIDER_REPORTS} only`,
  };
}

/* c8 ignore end */
