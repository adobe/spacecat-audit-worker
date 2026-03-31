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

import {
  badRequest, noContent, notFound, ok,
} from '@adobe/spacecat-shared-http-utils';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import ExcelJS from 'exceljs';
import { getPreviousWeekTriples } from '../utils/date-utils.js';
import {
  createLLMOSharepointClient,
  publishToAdminHlx,
  readFromSharePoint,
  uploadToSharePoint,
} from '../utils/report-uploader.js';
import { SPREADSHEET_COLUMNS } from '../faqs/utils.js';

const WEEKS_TO_LOOK_BACK = 4;
const MAX_URLS_TO_WRITE = 5;
const CELL_DELIMITER = '; ';
const RELATED_URLS_COLUMN_HEADER = 'Related URLs';

function normalizeText(value) {
  return value
    .toString()
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isLikelyHtmlPage(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const pathname = (parsed.pathname || '').toLowerCase();
    // Trailing slash or no file extension generally indicates HTML page routes.
    if (pathname.endsWith('/') || !pathname.includes('.')) {
      return true;
    }

    const extension = pathname.split('.').pop();
    return extension === 'html' || extension === 'htm';
  } catch {
    return false;
  }
}

function normalizePromptItems(payload) {
  const prompts = Array.isArray(payload?.prompts) ? payload.prompts : [];
  return prompts
    .map((item) => ({
      prompt: item?.prompt?.toString().trim(),
      region: (item?.input_region || item?.region || 'GLOBAL').toString().trim(),
      searchCountry: item?.search_country || null,
      searchLanguage: item?.search_language || null,
      localeReason: item?.locale_reason || null,
      queries: Array.isArray(item?.queries) ? item.queries : [],
      relatedUrls: Array.isArray(item?.related_urls)
        ? item.related_urls
          .filter((entry) => entry?.url)
          .map((entry) => ({
            url: entry.url,
            score: entry.score ?? null,
          }))
        : [],
    }))
    .filter((item) => item.prompt);
}

function getSheetCandidates() {
  const weekTriples = getPreviousWeekTriples(new Date(), WEEKS_TO_LOOK_BACK);
  const uniqueWeeks = new Map();
  weekTriples.forEach(({ year, week }) => {
    const key = `${year}-${week}`;
    if (!uniqueWeeks.has(key)) {
      uniqueWeeks.set(key, { weekNumber: week, year });
    }
  });
  return Array.from(uniqueWeeks.values())
    .map(({ weekNumber, year }) => ({
      periodIdentifier: `w${weekNumber}-${year}`,
      filename: `brandpresence-all-w${weekNumber}-${year}.xlsx`,
    }));
}

function buildPromptRegionMap(promptItems) {
  const map = new Map();
  promptItems.forEach((item) => {
    const key = `${normalizeText(item.prompt)}|||${normalizeText(item.region)}`;
    const topUrls = item.relatedUrls
      .map((entry) => entry.url)
      .filter((url) => isLikelyHtmlPage(url))
      .slice(0, MAX_URLS_TO_WRITE);
    if (topUrls.length > 0) {
      map.set(key, topUrls);
    }
  });
  return map;
}

async function loadLatestWorkbook(outputLocation, sharepointClient, log) {
  const workbook = new ExcelJS.Workbook();
  const candidates = getSheetCandidates();

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await readFromSharePoint(
        candidate.filename,
        outputLocation,
        sharepointClient,
        log,
      );
      // eslint-disable-next-line no-await-in-loop
      await workbook.xlsx.load(buffer);
      return {
        workbook,
        filename: candidate.filename,
        periodIdentifier: candidate.periodIdentifier,
      };
    } catch (error) {
      if (error.message?.includes('resource could not be found')
        || error.message?.includes('itemNotFound')) {
        // try an older weekly workbook
      } else {
        log.error(`[RELATED_URLS] Failed reading ${candidate.filename}: ${error.message}`);
      }
    }
  }

  return null;
}

function updateWorksheetWithRelatedUrls(worksheet, promptRegionMap) {
  if (!worksheet) {
    return {
      updatedCount: 0,
      scannedRows: 0,
      unmatchedRows: 0,
    };
  }
  const targetWorksheet = worksheet;

  const totalDataRows = targetWorksheet.rowCount - 1;
  const rows = targetWorksheet.getRows(2, totalDataRows) || [];
  const headerRow = targetWorksheet.getRow(1);
  const headerValues = headerRow.values || [];

  let relatedUrlsCol = 0;
  for (let i = 1; i < headerValues.length; i += 1) {
    const headerText = headerValues[i]?.toString?.().trim();
    if (headerText && normalizeText(headerText) === normalizeText(RELATED_URLS_COLUMN_HEADER)) {
      relatedUrlsCol = i;
      break;
    }
  }

  if (relatedUrlsCol === 0) {
    relatedUrlsCol = Math.max(targetWorksheet.columnCount, headerValues.length - 1) + 1;
    targetWorksheet.getCell(1, relatedUrlsCol).value = RELATED_URLS_COLUMN_HEADER;
  }

  let updatedCount = 0;
  let scannedRows = 0;
  let unmatchedRows = 0;

  rows.forEach((row) => {
    const targetRow = row;
    const promptValue = targetRow.getCell(SPREADSHEET_COLUMNS.PROMPT).value;
    const regionValue = targetRow.getCell(SPREADSHEET_COLUMNS.REGION).value;
    if (!promptValue) {
      return;
    }
    scannedRows += 1;

    const prompt = promptValue.toString().trim();
    const region = regionValue ? regionValue.toString().trim() : 'GLOBAL';
    const key = `${normalizeText(prompt)}|||${normalizeText(region)}`;
    const topUrls = promptRegionMap.get(key);
    if (!topUrls || topUrls.length === 0) {
      unmatchedRows += 1;
      return;
    }

    // Excel displays newlines in a single cell nicely across platforms.
    targetRow.getCell(relatedUrlsCol).value = topUrls.join(CELL_DELIMITER);
    updatedCount += 1;
  });

  return {
    updatedCount,
    scannedRows,
    unmatchedRows,
    relatedUrlsCol,
  };
}

export default async function handler(message, context) {
  const { log, dataAccess, getOutputLocation } = context;
  const { Site } = dataAccess;
  const { siteId, data } = message;
  const { presignedUrl } = data || {};

  if (!presignedUrl) {
    log.error('[RELATED_URLS] No presigned URL provided in message data');
    return badRequest('Presigned URL is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[RELATED_URLS] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const outputLocation = getOutputLocation
    ? getOutputLocation(site)
    : `${site.getConfig().getLlmoDataFolder()}/brand-presence`;

  try {
    const response = await fetch(presignedUrl);
    if (!response.ok) {
      log.error(
        `[RELATED_URLS] Failed to fetch related-urls data: ${response.status} ${response.statusText}`,
      );
      return badRequest(`Failed to fetch related-urls data: ${response.statusText}`);
    }

    const payload = await response.json();
    const promptItems = normalizePromptItems(payload);
    if (promptItems.length === 0) {
      return noContent();
    }

    const promptsWithUrls = promptItems.filter(
      (item) => item.relatedUrls.length > 0 && item.region,
    );
    if (promptsWithUrls.length === 0) {
      return noContent();
    }

    const promptRegionMap = buildPromptRegionMap(promptsWithUrls);

    const sharepointClient = await createLLMOSharepointClient(context);
    const workbookMeta = await loadLatestWorkbook(outputLocation, sharepointClient, log);
    if (!workbookMeta) {
      return notFound(`No brand presence sheet found in the last ${WEEKS_TO_LOOK_BACK} weeks`);
    }

    try {
      const worksheet = workbookMeta.workbook.worksheets[0];
      const {
        updatedCount,
      } = updateWorksheetWithRelatedUrls(worksheet, promptRegionMap);

      if (updatedCount === 0) {
        return noContent();
      }

      const buffer = await workbookMeta.workbook.xlsx.writeBuffer();
      await uploadToSharePoint(
        buffer,
        workbookMeta.filename,
        outputLocation,
        sharepointClient,
        log,
      );
      await publishToAdminHlx(workbookMeta.filename, outputLocation, log);
      log.info(`[RELATED_URLS] Updated ${updatedCount} rows in ${workbookMeta.filename}`);
    } catch (e) {
      log.error(`[RELATED_URLS] Failed to update brand presence sheet: ${e.message}`);
      return badRequest('Failed to update brand presence sheet');
    }

    return ok();
  } catch (error) {
    log.error(`[RELATED_URLS] Error processing related-urls guidance: ${error.message}`, error);
    return badRequest(`Error processing related-urls guidance: ${error.message}`);
  }
}
