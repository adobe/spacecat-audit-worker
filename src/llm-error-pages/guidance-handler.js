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
import { generateReportingPeriods, getS3Config } from './utils.js';

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
  const s3Config = getS3Config(site);

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
    const filename = `agentictraffic-${derivedPeriod}-404-ui.xlsx`;

    const workbook = new ExcelJS.Workbook();
    const existingBuffer = await readFromSharePoint(filename, outputDir, sharepointClient, log);
    await workbook.xlsx.load(existingBuffer);
    const sheet = workbook.worksheets[0] || workbook.addWorksheet('data');

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
        userAgents: urlFrom,
        suggestedUrls: suggestedUrls || [],
        aiRationale: aiRationale || '',
      });
    });

    // Process each row in the Excel file and update with broken links data if found
    for (let i = 2; i <= sheet.rowCount; i += 1) {
      const urlCell = sheet.getCell(i, 2).value?.toString?.() || '';
      const userAgentCell = sheet.getCell(i, 1).value?.toString?.() || '';
      if (urlCell) {
        const pathOnlyUrl = toPathOnly(urlCell);

        // Look up the URL in brokenUrls and update if found
        const brokenUrlData = brokenUrlsMap.get(pathOnlyUrl);
        if (brokenUrlData && brokenUrlData.userAgents.includes(userAgentCell)) {
          const suggested = brokenUrlData.suggestedUrls.join('\n');
          const row = sheet.getRow(i);
          row.values = [
            userAgentCell,
            pathOnlyUrl,
            suggested,
            brokenUrlData.aiRationale,
            '',
          ];
          row.commit();
          log.info(`Updated row ${i} for URL: ${pathOnlyUrl} with broken URL data`);
        }
      }
    }

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
