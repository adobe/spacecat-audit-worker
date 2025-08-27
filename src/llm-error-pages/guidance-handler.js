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
  const { Audit, Site } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
    brokenLinks, opportunityId,
  } = data;
  log.info(`Message received in LLM error pages guidance handler: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }
  const { Opportunity } = dataAccess;
  const opportunity = await Opportunity.findById(opportunityId);

  if (!opportunity) {
    log.error(`[LLM Error Pages Guidance] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    const errorMsg = `[${opportunity.getType()} Guidance] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    return badRequest('Site ID mismatch');
  }

  // Read-modify-write the weekly 404 Excel file in SharePoint
  try {
    const sharepointClient = await createLLMOSharepointClient(context);
    const week = generateReportingPeriods().weeks[0];
    const derivedPeriod = `w${week.weekNumber}-${week.year}`;
    const folderName = site.getConfig()?.getLlmoDataFolder?.() || site.getBaseURL?.();
    const outputLocation = `${folderName}/agentic-traffic`;
    const filename = `agentictraffic-${derivedPeriod}-404-ui.xlsx`;
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
      sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    }

    const toPathOnly = (maybeUrl) => {
      try {
        const parsed = new URL(maybeUrl, site.getBaseURL?.() || 'https://example.com');
        return parsed.pathname + (parsed.search || '');
      } catch {
        return maybeUrl;
      }
    };

    // Create a map of broken URLs for quick lookup
    const brokenUrlsMap = new Map();
    brokenLinks.forEach((brokenLink) => {
      const {
        suggestedUrls, aiRationale, urlFrom, urlTo,
      } = brokenLink;
      const keyUrl = toPathOnly(urlTo);
      brokenUrlsMap.set(keyUrl, {
        userAgent: urlFrom,
        suggestedUrls: suggestedUrls || [],
        aiRationale: aiRationale || '',
      });
    });

    // First, collect all existing URLs from the Excel file into a Set for O(1) lookup
    const existingUrls = new Set();
    for (let i = 2; i <= sheet.rowCount; i += 1) {
      const urlCell = sheet.getCell(i, 2).value?.toString?.() || '';
      if (urlCell) {
        const pathOnlyUrl = toPathOnly(urlCell);
        existingUrls.add(pathOnlyUrl);

        // Look up the URL in brokenUrls and update if found
        const brokenUrlData = brokenUrlsMap.get(pathOnlyUrl);
        if (brokenUrlData) {
          const suggested = brokenUrlData.suggestedUrls.join('\n');
          sheet.getRow(i).values = [
            brokenUrlData.userAgent,
            pathOnlyUrl,
            suggested,
            brokenUrlData.aiRationale,
            '',
          ];
          log.info(`Updated row ${i} for URL: ${pathOnlyUrl} with broken URL data`);
        }
      }
    }

    // Add new rows only for broken links that weren't in the Excel file
    brokenLinks.forEach((brokenLink) => {
      const {
        suggestedUrls, aiRationale, urlFrom, urlTo,
      } = brokenLink;
      const keyUrl = toPathOnly(urlTo);

      // Only add if this URL doesn't already exist
      if (!existingUrls.has(keyUrl)) {
        const suggested = suggestedUrls?.join('\n') || '';
        sheet.addRow([
          urlFrom,
          keyUrl,
          suggested,
          aiRationale || '',
          '',
        ]);
        log.info(`Added new row for URL: ${keyUrl}`);
      }
    });

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
