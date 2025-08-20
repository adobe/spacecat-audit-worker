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
  generatePeriodIdentifier,
  generateReportingPeriods,
  buildSiteFilters,
} from './report-utils.js';
import { saveExcelReport } from '../../utils/report-uploader.js';
import { createExcelReport } from './excel-generator.js';
import { AGENTIC_REPORT_CONFIG } from '../constants/report-configs.js';

export async function runReport(athenaClient, s3Config, log, options = {}) {
  const {
    site,
    sharepointClient,
    weekOffset,
  } = options;

  const referenceDate = new Date();
  const periods = generateReportingPeriods(referenceDate, weekOffset);
  const week = periods.weeks[0];
  const periodStart = week.startDate;
  const periodEnd = week.endDate;
  const periodIdentifier = generatePeriodIdentifier(periodStart, periodEnd);

  log.info(`Running agentic report for ${periodIdentifier} (week offset: ${weekOffset})`);
  const { filters } = site.getConfig().getCdnLogsConfig() || {};
  const llmoFolder = site.getConfig()?.getLlmoDataFolder() || s3Config.customerName;
  const outputLocation = `${llmoFolder}/${AGENTIC_REPORT_CONFIG.folderSuffix}`;

  try {
    const { databaseName, tableName } = s3Config;
    const siteFilters = buildSiteFilters(filters);

    const queryOptions = {
      periods,
      databaseName,
      tableName,
      siteFilters,
      site,
    };

    const query = await AGENTIC_REPORT_CONFIG.queryFunction(queryOptions);
    const results = await athenaClient.query(
      query,
      s3Config.databaseName,
      '[Athena Query] agentic_flat_data',
    );

    const reportData = { [AGENTIC_REPORT_CONFIG.sheetName]: results };
    const reportConfig = {
      workbookCreator: AGENTIC_REPORT_CONFIG.workbookCreator,
      sheets: [{ name: AGENTIC_REPORT_CONFIG.sheetName, dataKey: AGENTIC_REPORT_CONFIG.sheetName, type: 'agentic' }],
    };

    const filename = `${AGENTIC_REPORT_CONFIG.filePrefix}-${periodIdentifier}.xlsx`;

    const workbook = await createExcelReport(reportData, reportConfig);

    await saveExcelReport({
      workbook,
      outputLocation,
      log,
      sharepointClient,
      filename,
    });
  } catch (error) {
    log.error(`Agentic report generation failed: ${error.message}`);
    throw error;
  }
}

export async function runWeeklyReport({
  athenaClient,
  s3Config,
  log,
  site,
  sharepointClient,
  weekOffset,
}) {
  try {
    log.info(`Starting agentic report for week offset: ${weekOffset}...`);
    await runReport(athenaClient, s3Config, log, {
      site,
      sharepointClient,
      weekOffset,
    });
    log.info('Successfully completed agentic report');
  } catch (error) {
    log.error(`Failed to generate agentic report: ${error.message}`);
  }
}
