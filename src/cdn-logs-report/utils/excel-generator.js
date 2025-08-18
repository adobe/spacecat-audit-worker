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

import ExcelJS from 'exceljs';
import { SHEET_CONFIGS } from '../constants/sheet-configs.js';

const EXCEL_CONFIG = {
  DEFAULT_COLUMN_WIDTH: 15,
  NUMBER_FORMAT: '#,##0',
  FONT: {
    bold: true,
    size: 11,
    color: { argb: 'FF000000' },
  },
  CONTENT_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function getSheetConfig(type) {
  const config = SHEET_CONFIGS[type];
  /* c8 ignore start */
  if (!config) {
    throw new Error(`Unknown sheet type: ${type}`);
  }
  /* c8 ignore stop */

  return {
    /* c8 ignore next */
    headers: config.getHeaders(),
    headerColor: config.headerColor,
    numberColumns: config.numberColumns,
    processData: config.processData,
  };
}

function styleHeaders(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = EXCEL_CONFIG.FONT;
}

function formatColumns(worksheet, config) {
  worksheet.columns.forEach((_, index) => {
    const column = worksheet.getColumn(index + 1);

    let maxLength = 0;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const cellValue = cell.value ? cell.value.toString() : '';
      maxLength = Math.max(maxLength, cellValue.length);
    });
    column.width = Math.min(Math.max(maxLength + 2, 10), 60);
  });

  if (config.numberColumns) {
    config.numberColumns.forEach((colIndex) => {
      const column = worksheet.getColumn(colIndex + 1);
      column.numFmt = EXCEL_CONFIG.NUMBER_FORMAT;
    });
  }
}

export function createSheet(workbook, name, data, type) {
  const worksheet = workbook.addWorksheet(name);
  const config = getSheetConfig(type);

  worksheet.addRow(config.headers);
  styleHeaders(worksheet);

  const processedData = config.processData(data);
  processedData.forEach((row) => worksheet.addRow(row));

  formatColumns(worksheet, config);

  return worksheet;
}

export async function createExcelReport(reportData, reportConfig, options = {}) {
  const { site } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = reportConfig.workbookCreator;
  workbook.created = new Date();

  const sheets = [...reportConfig.sheets];

  if (reportConfig.conditionalSheets) {
    reportConfig.conditionalSheets.forEach((conditionalSheet) => {
      if (conditionalSheet.condition(site)) {
        sheets.push(conditionalSheet.sheet);
      }
    });
  }

  for (const sheet of sheets) {
    const data = reportData[sheet.dataKey];
    createSheet(workbook, sheet.name, data, sheet.type);
  }

  return workbook;
}
