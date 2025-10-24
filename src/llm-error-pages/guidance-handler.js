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
import {
  createLLMOSharepointClient, publishToAdminHlx, readFromSharePoint, uploadToSharePoint,
} from '../utils/report-uploader.js';
import {
  generateReportingPeriods,
  getS3Config,
  toPathOnly,
  SPREADSHEET_COLUMNS,
} from './utils.js';

/**
 * Handles Mystique responses for LLM error pages and updates suggestions with AI data
 * @param {Object} message - Message from Mystique with AI suggestions
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site, Audit } = dataAccess;
  const { siteId, data, auditId } = message;
  const { brokenLinks } = data;

  log.debug(`Message received in LLM error pages guidance handler: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }
  const s3Config = await getS3Config(site, context);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }

  // Read-modify-write the weekly 404 Excel file in SharePoint
  try {
    const sharepointClient = await createLLMOSharepointClient(context);
    const week = generateReportingPeriods().weeks[0];
    const derivedPeriod = `w${week.weekNumber}-${week.year}`;
    const llmoFolder = site.getConfig()?.getLlmoDataFolder?.() || s3Config.customerName;
    const outputDir = `${llmoFolder}/agentic-traffic`;
    const filename = `agentictraffic-errors-404-${derivedPeriod}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    const existingBuffer = await readFromSharePoint(filename, outputDir, sharepointClient, log);
    await workbook.xlsx.load(existingBuffer);
    const sheet = workbook.worksheets[0] || workbook.addWorksheet('data');

    const baseUrl = site.getBaseURL?.() || 'https://example.com';
    const col = (name) => SPREADSHEET_COLUMNS.indexOf(name) + 1;

    // Create a map of broken URLs for quick lookup
    const brokenUrlsMap = new Map();
    log.debug(`Processing ${brokenLinks.length} broken links from Mystique`);

    brokenLinks.forEach((brokenLink) => {
      const {
        suggestedUrls, aiRationale, urlFrom, urlTo,
      } = brokenLink;
      const keyUrl = toPathOnly(urlTo, baseUrl);

      if (!suggestedUrls || suggestedUrls.length === 0) {
        log.warn(`No suggested URLs for broken link: ${urlTo}`);
      }

      brokenUrlsMap.set(keyUrl, {
        userAgents: urlFrom,
        suggestedUrls: suggestedUrls || [],
        aiRationale: aiRationale || '',
      });
    });

    let updatedRows = 0;

    for (let i = 2; i <= sheet.rowCount; i += 1) {
      const urlCell = sheet.getCell(i, col('URL')).value?.toString?.() || '';
      if (urlCell) {
        const pathOnlyUrl = toPathOnly(urlCell, baseUrl);
        // Look up the URL in brokenUrls and update if found
        const brokenUrlData = brokenUrlsMap.get(pathOnlyUrl);
        if (brokenUrlData) {
          const suggested = brokenUrlData.suggestedUrls.join('\n');

          sheet.getCell(i, col('Suggested URLs')).value = suggested;
          sheet.getCell(i, col('AI Rationale')).value = brokenUrlData.aiRationale;
          updatedRows += 1;

          log.debug(`Updated row ${i} for URL: ${pathOnlyUrl} with ${brokenUrlData.suggestedUrls.length} suggestions`);
        } else {
          log.info(`No Mystique data found for URL: ${pathOnlyUrl}`);
        }
      }
    }

    log.debug(`Updated ${updatedRows} rows with Mystique suggestions`);

    // Overwrite the file
    const buffer = await workbook.xlsx.writeBuffer();
    await uploadToSharePoint(buffer, filename, outputDir, sharepointClient, log);
    await publishToAdminHlx(filename, outputDir, log);
    log.debug(`Updated Excel 404 file with Mystique guidance: ${filename}`);
  } catch (e) {
    log.error(`Failed to update 404 Excel on Mystique callback: ${e.message}`);
    return badRequest('Failed to persist guidance');
  }

  return ok();
}
