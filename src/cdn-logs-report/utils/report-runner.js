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

import { weeklyBreakdownQueries } from './query-builder.js';
import {
  createDateRange,
  generatePeriodIdentifier,
  generateReportingPeriods,
  buildSiteFilters,
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
  filters,
) {
  const { databaseName, tableName } = s3Config;
  const periods = generateReportingPeriods(endDate);
  const reportData = {};
  const siteFilters = buildSiteFilters(filters);

  const baseQueryOptions = {
    periods,
    databaseName,
    tableName,
    provider,
    siteFilters,
    site,
  };

  const queries = {
    reqcountbycountry: await weeklyBreakdownQueries.createCountryWeeklyBreakdown(
      baseQueryOptions,
    ),
    reqcountbyuseragent: await weeklyBreakdownQueries.createUserAgentWeeklyBreakdown(
      baseQueryOptions,
    ),
    reqcountbyurlstatus: await weeklyBreakdownQueries.createUrlStatusWeeklyBreakdown(
      baseQueryOptions,
    ),
    top_bottom_urls_by_status: await weeklyBreakdownQueries.createTopBottomUrlsByStatus(
      baseQueryOptions,
    ),
    error_404_urls: await weeklyBreakdownQueries.createError404Urls(baseQueryOptions),
    error_503_urls: await weeklyBreakdownQueries.createError503Urls(baseQueryOptions),
    success_urls_by_category: await weeklyBreakdownQueries.createSuccessUrlsByCategory(
      baseQueryOptions,
    ),
    top_urls: await weeklyBreakdownQueries.createTopUrls(baseQueryOptions),
  };

  for (const [key, query] of Object.entries(queries)) {
    try {
      if (query === null) {
        reportData[key] = [];
        // eslint-disable-next-line no-continue
        continue;
      }

      const sqlQueryDescription = `[Athena Query] ${key} for ${provider}`;
      // eslint-disable-next-line no-await-in-loop
      const results = await athenaClient.query(
        query,
        s3Config.databaseName,
        sqlQueryDescription,
      );
      reportData[key] = results;
    } catch (error) {
      log.error(`Failed to collect data for ${key} for ${provider}: ${error.message}`);
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
  log.info(`Running report for ${provider} for ${periodIdentifier}`);
  const { outputLocation, filters } = site.getConfig().getCdnLogsConfig() || {};

  try {
    const reportData = await collectReportData(
      athenaClient,
      referenceDate,
      s3Config,
      log,
      provider,
      site,
      filters,
    );

    const filename = `agentictraffic-${provider}-${periodIdentifier}.xlsx`;

    const workbook = await createCDNLogsExcelReport(reportData, {
      customEndDate: referenceDate.toISOString().split('T')[0],
      filename,
      site,
    });

    await saveExcelReport({
      workbook,
      outputLocation: outputLocation || s3Config.customerName,
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
