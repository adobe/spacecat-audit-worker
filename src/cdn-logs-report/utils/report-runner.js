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
import { weeklyBreakdownQueries } from './query-builder.js';
import {
  createDateRange,
  generatePeriodIdentifier,
  generateReportingPeriods,
} from './report-utils.js';
import { createCDNLogsExcelReport } from './excel-generator.js';
import { saveExcelReport } from './report-uploader.js';

const SUPPORTED_PROVIDERS = ['chatgpt', 'perplexity'];

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
  const reportData = {};

  const queries = {
    reqcountbycountry: await weeklyBreakdownQueries.createCountryWeeklyBreakdown(
      periods,
      databaseName,
      tableName,
      provider,
    ),
    reqcountbyuseragent: await weeklyBreakdownQueries.createUserAgentWeeklyBreakdown(
      periods,
      databaseName,
      tableName,
      provider,
    ),
    reqcountbyurlstatus: await weeklyBreakdownQueries.createUrlStatusWeeklyBreakdown(
      periods,
      databaseName,
      tableName,
      provider,
      site,
    ),
    individual_urls_by_status: await weeklyBreakdownQueries.createTopBottomUrlsByStatus(
      periods,
      databaseName,
      tableName,
      provider,
    ),
  };

  for (const [key, query] of Object.entries(queries)) {
    try {
      const sqlQueryDescription = `[Athena Query] ${key} for ${provider}`;
      // eslint-disable-next-line no-await-in-loop
      const results = await athenaClient.executeAndGetResults(
        query,
        s3Config.databaseName,
        sqlQueryDescription,
      );
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
    const filename = `agentictraffic${providerSuffix}-${periodIdentifier}.xlsx`;

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
