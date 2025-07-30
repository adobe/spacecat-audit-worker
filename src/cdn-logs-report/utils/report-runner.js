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

import {
  createDateRange,
  generatePeriodIdentifier,
  generateReportingPeriods,
  buildSiteFilters,
} from './report-utils.js';
import { saveExcelReport } from '../../utils/report-uploader.js';
import { createExcelReport } from './excel-generator.js';
import { REPORT_CONFIGS } from '../constants/report-configs.js';

const REPORT_TYPES = Object.keys(REPORT_CONFIGS);

async function collectReportData(
  athenaClient,
  endDate,
  s3Config,
  log,
  provider,
  site,
  filters,
  queries,
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

  const resolvedQueries = {};
  for (const [key, queryFunction] of Object.entries(queries)) {
    // eslint-disable-next-line no-await-in-loop
    resolvedQueries[key] = await queryFunction(baseQueryOptions);
  }
  /* c8 ignore start */
  for (const [key, query] of Object.entries(resolvedQueries)) {
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
  /* c8 ignore end */
  return reportData;
}

export async function runReport(athenaClient, s3Config, log, options = {}) {
  const {
    startDate,
    endDate,
    provider,
    site,
    sharepointClient,
    reportType = 'agentic',
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

  const reportConfig = REPORT_CONFIGS[reportType];
  const periodIdentifier = generatePeriodIdentifier(periodStart, periodEnd);
  log.info(`Running ${reportType} report for ${provider} for ${periodIdentifier}`);
  const { filters } = site.getConfig().getCdnLogsConfig() || {};
  const llmoFolder = site.getConfig()?.getLlmoDataFolder() || s3Config.customerName;
  const outputLocation = `${llmoFolder}/${reportConfig.folderSuffix}`;

  try {
    const reportData = await collectReportData(
      athenaClient,
      referenceDate,
      s3Config,
      log,
      provider,
      site,
      filters,
      reportConfig.queries,
    );

    const filename = `${reportConfig.filePrefix}-${provider}-${periodIdentifier}.xlsx`;

    const workbook = await createExcelReport(reportData, reportConfig, {
      customEndDate: referenceDate.toISOString().split('T')[0],
      filename,
      site,
    });

    await saveExcelReport({
      workbook,
      outputLocation,
      log,
      sharepointClient,
      filename,
    });
  } catch (error) {
    log.error(`${reportType} report generation failed: ${error.message}`);
    throw error;
  }
}

export async function runReportsForAllProviders(
  athenaClient,
  s3Config,
  log,
  options = {},
) {
  const { reportType = 'agentic' } = options;
  const reportConfig = REPORT_CONFIGS[reportType];
  const supportedProviders = reportConfig.providers || [];

  log.info(`Generating ${reportType} reports for providers: ${supportedProviders.join(', ')}`);

  for (const provider of supportedProviders) {
    try {
      log.info(`Starting ${reportType} report generation for ${provider}...`);
      // eslint-disable-next-line no-await-in-loop
      await runReport(athenaClient, s3Config, log, {
        ...options,
        provider,
      });
      log.info(`Successfully generated ${reportType} ${provider} report`);
    } catch (error) {
      log.error(`Failed to generate ${reportType} ${provider} report: ${error.message}`);
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
  for (const reportType of REPORT_TYPES) {
    try {
      log.info(`Starting weekly ${reportType} reports...`);
      // eslint-disable-next-line no-await-in-loop
      await runReportsForAllProviders(athenaClient, s3Config, log, {
        site,
        sharepointClient,
        reportType,
      });
      log.info(`Successfully completed weekly ${reportType} reports`);
      /* c8 ignore start */
    } catch (error) {
      log.error(`Failed to generate weekly ${reportType} reports: ${error.message}`);
    }
    /* c8 ignore end */
  }
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
  for (const reportType of REPORT_TYPES) {
    try {
      log.info(`Starting custom date range ${reportType} reports...`);
      // eslint-disable-next-line no-await-in-loop
      await runReportsForAllProviders(athenaClient, s3Config, log, {
        startDate: startDateStr,
        endDate: endDateStr,
        site,
        sharepointClient,
        reportType,
      });
      log.info(`Successfully completed custom date range ${reportType} reports`);
      /* c8 ignore start */
    } catch (error) {
      log.error(`Failed to generate custom date range ${reportType} reports: ${error.message}`);
    }
    /* c8 ignore end */
  }
}
