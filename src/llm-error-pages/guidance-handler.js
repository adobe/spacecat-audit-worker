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
import { generateReportingPeriods, getS3Config, toPathOnly } from './utils.js';

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

  log.info(`Message received in LLM error pages guidance handler: ${JSON.stringify(message, null, 2)}`);

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

    // Create a map of broken URLs for quick lookup
    const brokenUrlsMap = new Map();
    log.info(`Processing ${brokenLinks.length} broken links from Mystique`);

    brokenLinks.forEach((brokenLink, index) => {
      const {
        suggestedUrls, aiRationale, urlFrom, urlTo,
      } = brokenLink;
      const keyUrl = toPathOnly(urlTo, baseUrl);

      // Debug logging for Mystique response structure
      log.info(`Broken link ${index + 1}: urlTo="${urlTo}", urlFrom="${urlFrom}", suggestedUrls=${JSON.stringify(suggestedUrls)}, keyUrl="${keyUrl}"`);

      if (!suggestedUrls || suggestedUrls.length === 0) {
        log.warn(`No suggested URLs for broken link: ${urlTo}`);
      }

      brokenUrlsMap.set(keyUrl, {
        userAgents: urlFrom,
        suggestedUrls: suggestedUrls || [],
        aiRationale: aiRationale || '',
      });
    });

    // Process each row in the Excel file and update with broken links data if found
    log.info(`Processing Excel sheet with ${sheet.rowCount} rows`);
    let updatedRows = 0;

    for (let i = 2; i <= sheet.rowCount; i += 1) {
      const urlCell = sheet.getCell(i, 6).value?.toString?.() || ''; // Column 6: URL
      const userAgentCell = sheet.getCell(i, 2).value?.toString?.() || ''; // Column 2: User Agent

      if (urlCell) {
        const pathOnlyUrl = toPathOnly(urlCell, baseUrl);
        log.info(`Row ${i}: Checking URL="${pathOnlyUrl}", UserAgent="${userAgentCell}"`);

        // Look up the URL in brokenUrls and update if found
        const brokenUrlData = brokenUrlsMap.get(pathOnlyUrl);
        if (brokenUrlData) {
          log.info(`Found match for URL: ${pathOnlyUrl}, Mystique userAgents: "${brokenUrlData.userAgents}", Excel userAgent: "${userAgentCell}"`);

          const suggested = brokenUrlData.suggestedUrls.join('\n');

          // Update only the Suggested URLs and AI Rationale columns
          sheet.getCell(i, 9).value = suggested; // Column 9: Suggested URLs
          sheet.getCell(i, 10).value = brokenUrlData.aiRationale; // Column 10: AI Rationale
          updatedRows += 1;

          log.info(`✅ Updated row ${i} for URL: ${pathOnlyUrl} with ${brokenUrlData.suggestedUrls.length} suggestions`);
        } else {
          log.info(`No Mystique data found for URL: ${pathOnlyUrl}`);
        }
      }
    }

    log.info(`Updated ${updatedRows} rows with Mystique suggestions`);

    // Overwrite the file
    const buffer = await workbook.xlsx.writeBuffer();
    await uploadToSharePoint(buffer, filename, outputDir, sharepointClient, log);
    await publishToAdminHlx(filename, outputDir, log);
    log.info(`Updated Excel 404 file with Mystique guidance: ${filename}`);
  } catch (e) {
    log.error(`Failed to update 404 Excel on Mystique callback: ${e.message}`);
    return badRequest('Failed to persist guidance');
  }

  return ok();
}
