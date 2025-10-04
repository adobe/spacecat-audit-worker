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
import ExcelJS from 'exceljs';
import { getLastNumberOfWeeks } from '@adobe/spacecat-shared-utils';
import { startOfISOWeek, addDays, format } from 'date-fns';
import { createLLMOSharepointClient, readFromSharePoint } from '../utils/report-uploader.js';

/**
 * Validates that the patterns file exists in SharePoint and has the required structure.
 * Expected file location: {llmoFolder}/agentic-traffic/patterns/patterns.xlsx
 * Expected worksheets: 'shared-products' and 'shared-pagetype'
 * Expected columns: 'name' and 'regex'
 *
 * @param {Object} site - The site object
 * @param {Object} context - The context object containing log and env
 * @throws {Error} If the file doesn't exist or has invalid structure
 */
export async function validatePatternsFile(site, context) {
  const { log } = context;
  const sharepointClient = await createLLMOSharepointClient(context);
  const llmoFolder = site.getConfig()?.getLlmoDataFolder();
  const outputLocation = `${llmoFolder}/agentic-traffic/patterns`;
  const filename = 'patterns.xlsx';

  try {
    log.info(`Validating patterns file at ${outputLocation}/${filename}`);
    const buffer = await readFromSharePoint(filename, outputLocation, sharepointClient, log);

    // Parse the Excel file to validate structure
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Validate 'shared-products' worksheet
    const productsSheet = workbook.getWorksheet('shared-products');
    if (!productsSheet) {
      throw new Error("Missing required worksheet 'shared-products'");
    }

    // Validate 'shared-pagetype' worksheet
    const pagetypeSheet = workbook.getWorksheet('shared-pagetype');
    if (!pagetypeSheet) {
      throw new Error("Missing required worksheet 'shared-pagetype'");
    }

    // Validate columns in products sheet
    const productsHeaders = productsSheet.getRow(1).values;
    if (!productsHeaders.includes('name') || !productsHeaders.includes('regex')) {
      throw new Error("'shared-products' worksheet must have 'name' and 'regex' columns");
    }

    // Validate columns in pagetype sheet
    const pagetypeHeaders = pagetypeSheet.getRow(1).values;
    if (!pagetypeHeaders.includes('name') || !pagetypeHeaders.includes('regex')) {
      throw new Error("'shared-pagetype' worksheet must have 'name' and 'regex' columns");
    }

    log.info('Patterns file validation successful');
  } catch (error) {
    log.error(`Patterns file validation failed: ${error.message}`);
    throw error;
  }
}

/**
 * Validates that the URLs file exists in SharePoint and has the required structure.
 * Expected file location: {llmoFolder}/prompts/urls.xlsx
 * Expected worksheet: 'URLs'
 * Expected columns: 'category', 'region', 'topic', 'url'
 *
 * @param {Object} site - The site object
 * @param {Object} context - The context object containing log and env
 * @throws {Error} If the file doesn't exist or has invalid structure
 */
export async function validateUrlsFile(site, context) {
  const { log } = context;
  const sharepointClient = await createLLMOSharepointClient(context);
  const llmoFolder = site.getConfig()?.getLlmoDataFolder();
  const outputLocation = `${llmoFolder}/prompts`;
  const filename = 'urls.xlsx';

  try {
    log.info(`Validating URLs file at ${outputLocation}/${filename}`);
    const buffer = await readFromSharePoint(filename, outputLocation, sharepointClient, log);

    // Parse the Excel file to validate structure
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Validate 'URLs' worksheet
    const urlsSheet = workbook.getWorksheet('URLs');
    if (!urlsSheet) {
      throw new Error("Missing required worksheet 'URLs'");
    }

    // Validate columns
    const headers = urlsSheet.getRow(1).values;
    const requiredColumns = ['category', 'region', 'topic', 'url'];
    for (const col of requiredColumns) {
      if (!headers.includes(col)) {
        throw new Error(`'URLs' worksheet must have '${col}' column`);
      }
    }

    log.info('URLs file validation successful');
  } catch (error) {
    log.error(`URLs file validation failed: ${error.message}`);
    throw error;
  }
}

export function getLastSunday() {
  const { year, week } = getLastNumberOfWeeks(1)[0];
  const weekStart = startOfISOWeek(new Date(year, 0, 4));
  const targetWeekStart = addDays(weekStart, (week - 1) * 7);
  const lastSunday = format(addDays(targetWeekStart, 6), 'yyyy-MM-dd');
  return lastSunday;
}
/* c8 ignore end */
