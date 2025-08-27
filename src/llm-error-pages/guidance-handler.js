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

import { badRequest, notFound, ok } from '@adobe/spacecat-shared-http-utils';
import ExcelJS from 'exceljs';
import { createLLMOSharepointClient } from '../utils/report-uploader.js';
import { generateReportingPeriods } from './utils.js';

/**
 * Handles Mystique responses for LLM error pages and updates suggestions with AI data
 * @param {Object} message - Message from Mystique with AI suggestions
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site } = dataAccess;
  const {
    siteId, periodIdentifier: inputPeriodIdentifier, llmoFolder: inputLlmoFolder, data,
  } = message;
  const {
    suggestedUrls = [], aiRationale = '', confidenceScore = 0,
    brokenUrl, userAgent,
  } = data;

  log.info(`Message received in LLM error pages guidance handler: ${JSON.stringify(message, null, 2)}`);

  // Validate site exists
  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  // Read-modify-write the weekly 404 Excel file in SharePoint
  try {
    const sharepointClient = await createLLMOSharepointClient(context);
    const week = generateReportingPeriods().weeks[0];
    const derivedPeriod = `w${week.weekNumber}-${week.year}`;
    const periodId = inputPeriodIdentifier || derivedPeriod;
    const folderName = inputLlmoFolder
      || site.getConfig()?.getLlmoDataFolder?.()
      || site.getBaseURL?.();
    const outputLocation = `${folderName}/agentic-traffic`;
    const filename = `agentictraffic-${periodId}-404-ui.xlsx`;
    const documentPath = `/sites/elmo-ui-data/${outputLocation}/${filename}`;

    const doc = sharepointClient.getDocument(documentPath);
    let workbook = new ExcelJS.Workbook();
    let sheet;
    try {
      const existingBuffer = await doc.downloadRawDocument();
      await workbook.xlsx.load(existingBuffer);
      sheet = workbook.worksheets[0] || workbook.addWorksheet('data');
    } catch {
      // If file doesn't exist yet, create a new workbook and sheet with headers
      workbook = new ExcelJS.Workbook();
      sheet = workbook.addWorksheet('data');
      sheet.addRow(['User Agent', 'URL', 'Number of Hits', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
    }

    const headers = ['User Agent', 'URL', 'Number of Hits', 'Suggested URLs', 'AI Rationale', 'Confidence score'];
    if (sheet.rowCount === 0) {
      sheet.addRow(headers);
    }

    const toPathOnly = (maybeUrl) => {
      try {
        const parsed = new URL(maybeUrl, site.getBaseURL?.() || 'https://example.com');
        return parsed.pathname + (parsed.search || '');
      } catch {
        return maybeUrl;
      }
    };

    const keyUa = userAgent;
    const keyUrl = toPathOnly(brokenUrl);

    // Suggested URLs newlines
    const suggested = suggestedUrls.join('\n');

    // Try to find existing row and update it; otherwise append with empty hits
    let updated = false;
    for (let i = 2; i <= sheet.rowCount; i += 1) {
      const uaCell = sheet.getCell(i, 1).value?.toString?.() || '';
      const urlCell = sheet.getCell(i, 2).value?.toString?.() || '';
      if (uaCell === keyUa && urlCell === keyUrl) {
        const hitsCell = sheet.getCell(i, 3).value || '';
        sheet.getRow(i).values = [
          '',
          keyUa,
          keyUrl,
          hitsCell, // preserve existing number of hits
          suggested,
          aiRationale,
          confidenceScore,
        ];
        updated = true;
        break;
      }
    }
    if (!updated) {
      sheet.addRow([
        keyUa,
        keyUrl,
        '', // hits unknown in guidance stage
        suggested,
        aiRationale,
        confidenceScore,
      ]);
    }

    // Overwrite the file
    const buffer = await workbook.xlsx.writeBuffer();
    await doc.uploadRawDocument(buffer);
    log.info(`Updated Excel 404 file with Mystique guidance: ${filename}`);
  } catch (e) {
    log.error(`Failed to update 404 Excel on Mystique callback: ${e.message}`);
    return badRequest('Failed to persist guidance');
  }

  return ok();
}
