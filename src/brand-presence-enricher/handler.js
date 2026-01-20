/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// TODO: basic code to provide xlsx manipulation and the
// basic structure to start building the enrichment audit.
// Note: Once BP data will be migrated to a DB
// this section of the code should be removed and updated
import ExcelJS from 'exceljs';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import {
  createLLMOSharepointClient,
  readFromSharePoint,
  saveExcelReport,
} from '../utils/report-uploader.js';
import { promptToLinks } from './prompt-to-links.js';

const AUDIT_NAME = 'brand-presence-enriched';
const RELATED_URL_COLUMN = 'Related URL';

// Regex to parse brand presence sheet names: brandpresence-<provider>-w<WW>-<YYYY>
const RE_SHEET_NAME = /^brandpresence-(?<webSearchProvider>.+?)-w(?<week>\d{2})-(?<year>\d{4})(?:-\d+)?$/;

// Column indices from the brand presence spreadsheet (1-based)
const SPREADSHEET_COLUMNS = {
  PROMPT: 3,
  URL: 7,
};

/**
 * Fetches the list of brand presence sheets from the query-index SharePoint file
 * and returns the latest one based on week/year in the filename.
 * @param {Object} site - The site object to get LLMO data folder from
 * @param {Object} context - The context object containing env and log
 * @param {Object} sharepointClient - The SharePoint client instance
 * @returns {Promise<{ sourceFolder: string, filename: string, sheetName: string } | null>}
 */
async function findLatestBrandPresenceSheet(site, context, sharepointClient) {
  const { log } = context;
  const siteId = site.getId();

  log.info(`%s: Starting query-index fetch to find latest sheet for siteId: ${siteId}`, AUDIT_NAME);

  // Get the site's LLMO data folder
  const dataFolder = site.getConfig()?.getLlmoDataFolder?.();
  if (!dataFolder) {
    log.error(`%s: No LLMO data folder configured for site ${siteId}`, AUDIT_NAME);
    return null;
  }

  log.info(`%s: Reading query-index from SharePoint for siteId: ${siteId}, path: ${dataFolder}/query-index.xlsx`, AUDIT_NAME);

  // Read the query-index.xlsx file from SharePoint
  const queryIndexBuffer = await readFromSharePoint('query-index.xlsx', dataFolder, sharepointClient, log);

  log.info(`%s: Query-index file downloaded for siteId: ${siteId} (${queryIndexBuffer.length} bytes)`, AUDIT_NAME);

  // Parse the Excel file to extract paths
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(queryIndexBuffer);

  const latestPaths = [];
  const regularPaths = [];

  // Iterate through all worksheets to find path data
  workbook.worksheets.forEach((worksheet) => {
    worksheet.eachRow((row, rowNumber) => {
      // Skip header row
      if (rowNumber === 1) return;

      // Look for path-like data in any column
      row.eachCell((cell) => {
        const cellValue = cell.value;
        if (cellValue && typeof cellValue === 'string') {
          // Check for brand-presence/latest/ first (priority)
          if (cellValue.includes('/brand-presence/latest/')) {
            const filename = cellValue.split('/').pop();
            if (filename) {
              const filenameWithoutExt = filename.replace(/\.json$/i, '');
              if (!latestPaths.includes(filenameWithoutExt)) {
                latestPaths.push(filenameWithoutExt);
              }
            }
          } else if (cellValue.includes('/brand-presence/') && !cellValue.includes('/brand-presence/latest/')) {
            const filename = cellValue.split('/').pop();
            if (filename) {
              const filenameWithoutExt = filename.replace(/\.json$/i, '');
              if (!regularPaths.includes(filenameWithoutExt)) {
                regularPaths.push(filenameWithoutExt);
              }
            }
          }
        }
      });
    });
  });

  // Use latest paths if available, otherwise fall back to regular paths
  const allPaths = latestPaths.length > 0 ? latestPaths : regularPaths;
  const brandPresenceFolder = latestPaths.length > 0 ? 'brand-presence/latest' : 'brand-presence';
  const sourceFolder = `${dataFolder}/${brandPresenceFolder}`;

  log.info(`%s: Found ${allPaths.length} brand presence sheets for siteId: ${siteId}`, AUDIT_NAME);

  if (allPaths.length === 0) {
    log.warn(`%s: No brand presence sheets found in query-index for siteId: ${siteId}`, AUDIT_NAME);
    return null;
  }

  // Parse and sort sheets by week/year to find the latest one
  const parsedSheets = allPaths
    .map((sheetName) => {
      const match = RE_SHEET_NAME.exec(sheetName);
      if (!match) {
        log.debug(`%s: Skipping invalid sheet name format: ${sheetName}`, AUDIT_NAME);
        return null;
      }
      const { week, year } = match.groups;
      return {
        sheetName,
        week: parseInt(week, 10),
        year: parseInt(year, 10),
        // Create a sortable date value (year * 100 + week for simple comparison)
        sortKey: parseInt(year, 10) * 100 + parseInt(week, 10),
      };
    })
    .filter((sheet) => sheet !== null);

  if (parsedSheets.length === 0) {
    log.warn(`%s: No valid brand presence sheets found after parsing for siteId: ${siteId}`, AUDIT_NAME);
    return null;
  }

  // Sort by sortKey descending to get the latest first
  parsedSheets.sort((a, b) => b.sortKey - a.sortKey);

  const latestSheet = parsedSheets[0];
  const filename = `${latestSheet.sheetName}.xlsx`;

  log.info(`%s: Latest brand presence sheet for siteId: ${siteId} is ${filename} (week ${latestSheet.week}, year ${latestSheet.year})`, AUDIT_NAME);

  return {
    sourceFolder,
    filename,
    sheetName: latestSheet.sheetName,
  };
}

/**
 * Finds or creates the "Related URL" column in the worksheet
 * @param {ExcelJS.Worksheet} worksheet - The worksheet to modify
 * @param {Object} log - Logger instance
 * @returns {number} The column index of the Related URL column
 */
function ensureRelatedUrlColumn(worksheet, log) {
  const headerRow = worksheet.getRow(1);
  let relatedUrlColumnIndex = null;

  // Search for existing "Related URL" column
  headerRow.eachCell((cell, colNumber) => {
    if (cell.value && cell.value.toString().trim() === RELATED_URL_COLUMN) {
      relatedUrlColumnIndex = colNumber;
    }
  });

  // If not found, add it as a new column
  if (!relatedUrlColumnIndex) {
    // Find the last column with data
    let lastColumn = 1;
    headerRow.eachCell((cell, colNumber) => {
      if (cell.value) {
        lastColumn = colNumber;
      }
    });

    relatedUrlColumnIndex = lastColumn + 1;
    headerRow.getCell(relatedUrlColumnIndex).value = RELATED_URL_COLUMN;
    log.info(`%s: Added "${RELATED_URL_COLUMN}" column at index ${relatedUrlColumnIndex}`, AUDIT_NAME);
  } else {
    log.info(`%s: Found existing "${RELATED_URL_COLUMN}" column at index ${relatedUrlColumnIndex}`, AUDIT_NAME);
  }

  return relatedUrlColumnIndex;
}

/**
 * The brand presence enricher audit runner.
 * Reads the latest brand presence spreadsheet, enriches rows missing URLs using ContentAI,
 * and saves the updated spreadsheet.
 *
 * @async
 * @param {string} auditUrl - The URL to run audit against
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @param {Object} site - The site object
 * @returns {Object} - Returns an object with the audit result.
 */
export async function brandPresenceEnricherRunner(auditUrl, context, site) {
  const { log } = context;

  log.info(`%s: Starting brand presence enricher audit for ${auditUrl}`, AUDIT_NAME);

  const siteId = site.getId();
  const baseURL = site.getBaseURL();

  let sharepointClient;
  let workbook;
  let worksheet;
  let outputLocation;
  let filename;

  try {
    // Create SharePoint client
    sharepointClient = await createLLMOSharepointClient(context);

    // Find the latest brand presence sheet
    const latestSheet = await findLatestBrandPresenceSheet(site, context, sharepointClient);

    if (!latestSheet) {
      log.error(`%s: No brand presence sheets found for siteId: ${siteId}`, AUDIT_NAME);
      return {
        auditResult: {
          success: false,
          error: 'No brand presence sheets found in query-index',
          siteId,
          baseURL,
        },
        fullAuditRef: auditUrl,
      };
    }

    outputLocation = latestSheet.sourceFolder;
    filename = latestSheet.filename;

    log.info(`%s: Reading latest spreadsheet from ${outputLocation}/${filename}`, AUDIT_NAME);

    // Read the Excel file from SharePoint
    const buffer = await readFromSharePoint(filename, outputLocation, sharepointClient, log);
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Get the first worksheet (brand presence sheets typically have one main sheet)
    [worksheet] = workbook.worksheets;
    if (!worksheet) {
      log.error(`%s: No worksheets found in ${filename}`, AUDIT_NAME);
      return {
        auditResult: {
          success: false,
          error: `No worksheets found in ${filename}`,
          siteId,
          baseURL,
        },
        fullAuditRef: auditUrl,
      };
    }

    log.info(`%s: Found worksheet "${worksheet.name}" with ${worksheet.rowCount} rows`, AUDIT_NAME);
  } catch (error) {
    log.error(`%s: Failed to read spreadsheet: ${error.message}`, AUDIT_NAME);
    return {
      auditResult: {
        success: false,
        error: `Failed to read spreadsheet: ${error.message}`,
        siteId,
        baseURL,
      },
      fullAuditRef: auditUrl,
    };
  }

  // Ensure the "Related URL" column exists
  const relatedUrlColumnIndex = ensureRelatedUrlColumn(worksheet, log);

  // Track enrichment stats
  let rowsProcessed = 0;
  let rowsEnriched = 0;
  let rowsSkipped = 0;
  let rowsErrored = 0;

  // Iterate through rows (skip header row)
  const totalRows = worksheet.rowCount;
  log.info(`%s: Processing ${totalRows - 1} data rows`, AUDIT_NAME);

  for (let rowIndex = 2; rowIndex <= totalRows; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const urlCell = row.getCell(SPREADSHEET_COLUMNS.URL);
    const promptCell = row.getCell(SPREADSHEET_COLUMNS.PROMPT);
    const relatedUrlCell = row.getCell(relatedUrlColumnIndex);

    const urlValue = urlCell.value ? urlCell.value.toString().trim() : '';
    const promptValue = promptCell.value ? promptCell.value.toString().trim() : '';
    const existingRelatedUrl = relatedUrlCell.value ? relatedUrlCell.value.toString().trim() : '';

    rowsProcessed += 1;

    // Skip if URL already exists or no prompt
    if (urlValue || existingRelatedUrl) {
      rowsSkipped += 1;
    } else if (!promptValue) {
      log.debug(`%s: Row ${rowIndex} has no prompt, skipping`, AUDIT_NAME);
      rowsSkipped += 1;
    } else {
      // Call promptToLinks to get the related URL
      try {
        log.debug(`%s: Enriching row ${rowIndex} with prompt: "${promptValue.substring(0, 50)}..."`, AUDIT_NAME);

        // eslint-disable-next-line no-await-in-loop
        const urls = await promptToLinks(promptValue, site, context);

        if (urls && urls.length > 0) {
          const [firstUrl] = urls;
          relatedUrlCell.value = firstUrl;
          rowsEnriched += 1;
          log.debug(`%s: Row ${rowIndex} enriched with URL: ${firstUrl}`, AUDIT_NAME);
        } else {
          log.debug(`%s: Row ${rowIndex} - no URLs returned from promptToLinks`, AUDIT_NAME);
          rowsSkipped += 1;
        }
      } catch (error) {
        log.warn(`%s: Failed to enrich row ${rowIndex}: ${error.message}`, AUDIT_NAME);
        rowsErrored += 1;
      }
    }
  }

  log.info(
    `%s: Enrichment complete. Processed: ${rowsProcessed}, Enriched: ${rowsEnriched}, Skipped: ${rowsSkipped}, Errors: ${rowsErrored}`,
    AUDIT_NAME,
  );

  // Save and publish the updated spreadsheet
  try {
    log.info(`%s: Saving updated spreadsheet to ${outputLocation}/${filename}`, AUDIT_NAME);

    await saveExcelReport({
      workbook,
      outputLocation,
      log,
      sharepointClient,
      filename,
    });

    log.info('%s: Spreadsheet saved and published successfully', AUDIT_NAME);
  } catch (error) {
    log.error(`%s: Failed to save spreadsheet: ${error.message}`, AUDIT_NAME);
    return {
      auditResult: {
        success: false,
        error: `Failed to save spreadsheet: ${error.message}`,
        siteId,
        baseURL,
        rowsProcessed,
        rowsEnriched,
        rowsSkipped,
        rowsErrored,
      },
      fullAuditRef: auditUrl,
    };
  }

  // Return audit result
  return {
    auditResult: {
      success: true,
      siteId,
      baseURL,
      outputLocation,
      filename,
      rowsProcessed,
      rowsEnriched,
      rowsSkipped,
      rowsErrored,
    },
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(brandPresenceEnricherRunner)
  .build();
