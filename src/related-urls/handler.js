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

import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { createLLMOSharepointClient, readFromSharePoint } from '../utils/report-uploader.js';
import { getPreviousWeekTriples } from '../utils/date-utils.js';
import { SPREADSHEET_COLUMNS } from '../faqs/utils.js';

const MAX_PROMPTS = 200;
const WEEKS_TO_LOOK_BACK = 4;
const DEFAULT_FANOUT_COUNT = 4;

async function readBrandPresenceSpreadsheet(filename, outputLocation, sharepointClient, log) {
  try {
    const buffer = await readFromSharePoint(filename, outputLocation, sharepointClient, log);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return [];
    }

    const totalDataRows = worksheet.rowCount - 1;
    const rows = worksheet.getRows(2, totalDataRows) || [];
    const prompts = [];

    rows.forEach((row) => {
      const prompt = row.getCell(SPREADSHEET_COLUMNS.PROMPT).value;
      const region = row.getCell(SPREADSHEET_COLUMNS.REGION).value;
      const url = row.getCell(SPREADSHEET_COLUMNS.URL).value || '';
      if (prompt) {
        prompts.push({
          prompt: prompt.toString().trim(),
          region: region ? region.toString().trim() : 'GLOBAL',
          url: url.toString().trim(),
        });
      }
    });

    return prompts;
  } catch (error) {
    if (error.message?.includes('resource could not be found') || error.message?.includes('itemNotFound')) {
      // try an older weekly workbook
    } else {
      log.error(`[RELATED_URLS] Failed to read brand presence spreadsheet: ${error.message}`);
    }
    return [];
  }
}

function sortPromptsWithoutUrlsFirst(prompts) {
  return prompts.sort((a, b) => {
    const aHasUrl = Boolean(a.url && a.url.length > 0);
    const bHasUrl = Boolean(b.url && b.url.length > 0);
    if (!aHasUrl && bHasUrl) return -1;
    if (aHasUrl && !bHasUrl) return 1;
    return 0;
  });
}

function deduplicatePrompts(prompts) {
  const seen = new Map();
  prompts.forEach((prompt) => {
    const key = `${prompt.prompt.toLowerCase().trim()}|||${prompt.region.toLowerCase().trim()}`;
    if (!seen.has(key)) {
      seen.set(key, prompt);
    }
  });
  return Array.from(seen.values());
}

async function runRelatedUrlsAudit(url, context, site) {
  const { log } = context;
  const { getOutputLocation } = context;

  try {
    const sharepointClient = await createLLMOSharepointClient(context);
    const outputLocation = getOutputLocation
      ? getOutputLocation(site)
      : `${site.getConfig().getLlmoDataFolder()}/brand-presence`;

    const weekTriples = getPreviousWeekTriples(new Date(), WEEKS_TO_LOOK_BACK);
    const uniqueWeeks = new Map();
    weekTriples.forEach(({ year, week }) => {
      const key = `${year}-${week}`;
      if (!uniqueWeeks.has(key)) {
        uniqueWeeks.set(key, { weekNumber: week, year });
      }
    });
    const weeks = Array.from(uniqueWeeks.values());

    let prompts = [];
    for (const week of weeks) {
      const periodIdentifier = `w${week.weekNumber}-${week.year}`;
      const filename = `brandpresence-all-${periodIdentifier}.xlsx`;
      // eslint-disable-next-line no-await-in-loop
      const currentWeekPrompts = await readBrandPresenceSpreadsheet(
        filename,
        outputLocation,
        sharepointClient,
        log,
      );
      if (currentWeekPrompts.length > 0) {
        prompts = currentWeekPrompts;
        break;
      }
    }

    if (prompts.length === 0) {
      return {
        auditResult: {
          success: false,
          error: `No brand presence data found in the last ${WEEKS_TO_LOOK_BACK} weeks`,
          promptRegions: [],
        },
        fullAuditRef: url,
      };
    }

    const sortedPrompts = sortPromptsWithoutUrlsFirst(prompts);
    const uniquePrompts = deduplicatePrompts(sortedPrompts);
    const topPrompts = uniquePrompts.slice(0, MAX_PROMPTS);
    const promptRegions = topPrompts.map((item) => ({
      prompt: item.prompt,
      region: item.region,
    }));
    const baseURL = site.getBaseURL();

    return {
      auditResult: {
        success: true,
        baseURL,
        fanoutCount: DEFAULT_FANOUT_COUNT,
        promptRegions,
      },
      fullAuditRef: url,
    };
  } catch (error) {
    log.error(`[RELATED_URLS] Audit failed: ${error.message}`);
    return {
      auditResult: {
        success: false,
        promptRegions: [],
      },
      fullAuditRef: url,
    };
  }
}

async function sendMystiqueMessagePostProcessor(auditUrl, auditData, context) {
  const {
    log, sqs, env, dataAccess, audit,
  } = context;
  const { siteId, auditResult } = auditData;

  if (!auditResult.success) {
    return auditData;
  }

  const { promptRegions } = auditResult;
  if (!promptRegions || promptRegions.length === 0) {
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn('[RELATED_URLS] SQS or Mystique queue not configured, skipping message');
    return auditData;
  }

  try {
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.warn('[RELATED_URLS] Site not found, skipping Mystique message');
      return auditData;
    }
    const baseURL = auditResult.baseURL || site.getBaseURL();
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');

    const message = {
      traceId: randomUUID(),
      type: 'guidance:related-urls',
      siteId,
      auditId: audit?.getId() || `test-audit-related-urls-${timestamp}`,
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      url: site.getBaseURL(),
      data: {
        baseURL,
        fanoutCount: auditResult.fanoutCount || DEFAULT_FANOUT_COUNT,
        promptRegions,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`[RELATED_URLS] Queued ${promptRegions.length} prompt-region items to Mystique`);
  } catch (error) {
    log.error(`[RELATED_URLS] Failed to send Mystique message: ${error.message}`);
  }

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runRelatedUrlsAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
