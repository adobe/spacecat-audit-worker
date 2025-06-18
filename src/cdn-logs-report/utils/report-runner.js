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
  createDateRange,
  generatePeriodIdentifier,
  generateReportingPeriods,
} from './date-utils.js';
import { createCDNLogsExcelReport } from './excel-generator.js';
import { saveExcelReport } from './report-uploader.js';
import { getPageTypePatterns } from './page-type-classifier.js';
import {
  SUPPORTED_PROVIDERS,
} from '../constants/core.js';

async function collectReportData(
  athenaClient,
  endDate,
  s3Config,
  log,
  provider,
  site,
) {
  const { databaseName, tableName } = s3Config;
  const periods = generateReportingPeriods(endDate);
  const pageTypePatterns = site ? getPageTypePatterns(site) : null;
  const reportData = {};

  const queries = {
    reqcountbycountry: weeklyBreakdownQueries.createCountryWeeklyBreakdown(
      periods,
      databaseName,
      tableName,
      provider,
    ),
    reqcountbyuseragent: weeklyBreakdownQueries.createUserAgentWeeklyBreakdown(
      periods,
      databaseName,
      tableName,
      provider,
    ),
    reqcountbyurlstatus: weeklyBreakdownQueries.createUrlStatusWeeklyBreakdown(
      periods,
      databaseName,
      tableName,
      provider,
      pageTypePatterns,
    ),
    individual_urls_by_status: weeklyBreakdownQueries.createTopBottomUrlsByStatus(
      periods,
      databaseName,
      tableName,
      provider,
    ),
  };

  for (const [key, query] of Object.entries(queries)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const results = await executeAthenaQuery(athenaClient, query, s3Config, log);
      reportData[key] = results || [];
    } catch (error) {
      const providerMsg = provider ? ` for ${provider}` : '';
      log.error(`Failed to collect data for ${key}${providerMsg}: ${error.message}`);
      reportData[key] = [];
    }
  }

  return reportData;
}

export async function runReport(athenaClient, s3Config, log, options = {}) {
  const {
    startDate,
    endDate,
    provider,
    site,
    sharepointClient,
  } = options;

  let periodStart;
  let periodEnd;
  let referenceDate;

  if (startDate && endDate) {
    const parsed = createDateRange(startDate, endDate);
    periodStart = parsed.startDate;
    periodEnd = parsed.endDate;
    referenceDate = periodEnd;
  } else {
    referenceDate = new Date();
    const periods = generateReportingPeriods(referenceDate);
    const week = periods.weeks[0];
    periodStart = week.startDate;
    periodEnd = week.endDate;
  }

  const periodIdentifier = generatePeriodIdentifier(periodStart, periodEnd);
  const providerMsg = provider ? ` for ${provider}` : '';
  log.info(`Running report${providerMsg} for ${periodIdentifier}`);

  try {
    const reportData = await collectReportData(
      athenaClient,
      referenceDate,
      s3Config,
      log,
      provider,
      site,
    );

    const providerSuffix = provider ? `-${provider}` : '';
    const filename = `agentic-traffic${providerSuffix}-${periodIdentifier}.xlsx`;

    const workbook = await createCDNLogsExcelReport(reportData, {
      customEndDate: referenceDate.toISOString().split('T')[0],
      filename,
    });

    await saveExcelReport({
      workbook,
      customerName: s3Config.customerName,
      log,
      sharepointClient,
      filename,
    });
  } catch (error) {
    log.error(`Report generation failed: ${error.message}`);
    throw error;
  }
}

export async function runReportsForAllProviders(
  athenaClient,
  s3Config,
  log,
  options = {},
) {
  log.info(`Generating reports for providers: ${SUPPORTED_PROVIDERS.join(', ')}`);

  for (const provider of SUPPORTED_PROVIDERS) {
    try {
      log.info(`Starting report generation for ${provider}...`);
      // eslint-disable-next-line no-await-in-loop
      await runReport(athenaClient, s3Config, log, {
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
  s3Config,
  log,
  site,
  sharepointClient,
}) {
  await runReportsForAllProviders(athenaClient, s3Config, log, {
    site,
    sharepointClient,
  });
}

export async function runCustomDateRangeReport({
  athenaClient,
  startDateStr,
  endDateStr,
  s3Config,
  log,
  site,
  sharepointClient,
}) {
  await runReportsForAllProviders(athenaClient, s3Config, log, {
    startDate: startDateStr,
    endDate: endDateStr,
    site,
    sharepointClient,
  });
}

/* c8 ignore end */
