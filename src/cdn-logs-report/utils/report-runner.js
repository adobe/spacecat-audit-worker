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

import { generateReportingPeriods } from './report-utils.js';
import { saveExcelReport } from '../../utils/report-uploader.js';
import { createExcelReport } from './excel-generator.js';

export async function runReport(reportConfig, athenaClient, s3Config, log, options = {}) {
  const {
    site,
    sharepointClient,
    weekOffset,
  } = options;

  const referenceDate = new Date();
  const periods = generateReportingPeriods(referenceDate, weekOffset);
  const { periodIdentifier } = periods;

  log.debug(`Running ${reportConfig.name} report for ${periodIdentifier} (week offset: ${weekOffset})`);
  const llmoFolder = site.getConfig()?.getLlmoDataFolder();
  const outputLocation = `${llmoFolder}/${reportConfig.folderSuffix}`;

  try {
    const { databaseName } = s3Config;
    const { tableName } = reportConfig;

    const queryOptions = {
      periods,
      databaseName,
      tableName,
      site,
    };

    const query = await reportConfig.queryFunction(queryOptions);
    const results = await athenaClient.query(
      query,
      s3Config.databaseName,
      `[Athena Query] ${reportConfig.name}_flat_data`,
    );

    const reportData = { [reportConfig.sheetName]: results };
    const excelConfig = {
      workbookCreator: reportConfig.workbookCreator,
      sheets: [{
        name: reportConfig.sheetName,
        dataKey: reportConfig.sheetName,
        type: reportConfig.name,
      }],
    };

    const filename = `${reportConfig.filePrefix}-${periodIdentifier}.xlsx`;

    const workbook = await createExcelReport(reportData, excelConfig, site);

    await saveExcelReport({
      workbook,
      outputLocation,
      log,
      sharepointClient,
      filename,
    });
  } catch (error) {
    log.error(`${reportConfig.name} report generation failed: ${error.message}`);
    throw error;
  }
}

export async function runWeeklyReport({
  athenaClient,
  s3Config,
  reportConfig,
  log,
  site,
  sharepointClient,
  weekOffset,
}) {
  try {
    log.debug(`Starting ${reportConfig.name} report for week offset: ${weekOffset}...`);
    await runReport(reportConfig, athenaClient, s3Config, log, {
      site,
      sharepointClient,
      weekOffset,
    });
    log.debug(`Successfully completed ${reportConfig.name} report`);
  } catch (error) {
    log.error(`Failed to generate ${reportConfig.name} report: ${error.message}`);
  }
}
