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

const AUDIT_NAME = 'BRAND_PRESENCE_ENRICHER';
const SHEET_NAME = 'shared-all';
const RELATED_URL_COLUMN = 'Related URL';

// Column indices from the brand presence spreadsheet (1-based)
const SPREADSHEET_COLUMNS = {
  PROMPT: 3,
  URL: 7,
};

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
 * Reads the brand presence spreadsheet, enriches rows missing URLs using ContentAI,
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

  // Get output location from site config
  const outputLocation = `${site.getConfig().getLlmoDataFolder()}/brand-presence`;
  const filename = 'brandpresence-shared-all.xlsx';

  log.info(`%s: Reading spreadsheet from ${outputLocation}/${filename}`, AUDIT_NAME);

  let sharepointClient;
  let workbook;
  let worksheet;

  try {
    // Create SharePoint client
    sharepointClient = await createLLMOSharepointClient(context);

    // Read the Excel file from SharePoint
    const buffer = await readFromSharePoint(filename, outputLocation, sharepointClient, log);
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Get the "shared-all" sheet
    worksheet = workbook.getWorksheet(SHEET_NAME);
    if (!worksheet) {
      const availableSheets = workbook.worksheets.map((ws) => ws.name).join(', ');
      log.error(`%s: Sheet "${SHEET_NAME}" not found. Available sheets: ${availableSheets}`, AUDIT_NAME);
      return {
        auditResult: {
          success: false,
          error: `Sheet "${SHEET_NAME}" not found`,
          siteId,
          baseURL,
        },
        fullAuditRef: auditUrl,
      };
    }

    log.info(`%s: Found sheet "${SHEET_NAME}" with ${worksheet.rowCount} rows`, AUDIT_NAME);
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

  // Return audit result in the same format as geo-brand-presence
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
