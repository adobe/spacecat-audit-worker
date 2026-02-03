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
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { createLLMOSharepointClient, readFromSharePoint } from '../utils/report-uploader.js';
import { getPreviousWeekTriples } from '../utils/date-utils.js';
import { SPREADSHEET_COLUMNS, validateContentAI } from './utils.js';

const MAX_ROWS_TO_READ = 200;
const WEEKS_TO_LOOK_BACK = 4;

/**
 * Groups prompts by URL and topic
 * @param {Array} prompts - Array of prompt objects with url, topic, question
 * @returns {Array} Grouped prompts [{ url, topic, prompts: [] }]
 */
function groupPromptsByUrlAndTopic(prompts) {
  const groupMap = new Map();

  prompts.forEach((prompt) => {
    const { url, topic, question } = prompt;

    const key = `${url || 'global'}|||${topic}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        url,
        topic,
        prompts: [],
      });
    }

    groupMap.get(key).prompts.push(question);
  });

  return Array.from(groupMap.values());
}

/**
 * Reads brand presence spreadsheet and extracts prompts
 * @param {string} filepath - Path to the spreadsheet file
 * @param {Object} sharepointClient - SharePoint client
 * @param {Object} log - Logger
 * @returns {Array} Array of prompt objects
 */
async function readBrandPresenceSpreadsheet(filename, outputLocation, sharepointClient, log) {
  try {
    log.info(`[FAQ] Reading brand presence spreadsheet from: ${filename}`);

    const buffer = await readFromSharePoint(filename, outputLocation, sharepointClient, log);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      log.warn('[FAQ] No worksheet found in spreadsheet');
      return [];
    }

    const prompts = [];
    const maxRows = Math.min(MAX_ROWS_TO_READ, worksheet.rowCount - 1);
    const rows = worksheet.getRows(2, maxRows) || [];

    log.info(`[FAQ] Reading ${maxRows} rows from spreadsheet (total rows: ${worksheet.rowCount})`);

    // Extract data using named column constants
    rows.forEach((row) => {
      const topic = row.getCell(SPREADSHEET_COLUMNS.TOPICS).value;
      const prompt = row.getCell(SPREADSHEET_COLUMNS.PROMPT).value;
      const url = row.getCell(SPREADSHEET_COLUMNS.URL).value || '';

      if (topic && prompt) {
        prompts.push({
          url: url.toString().trim(),
          topic: topic.toString().trim(),
          question: prompt.toString().trim(),
        });
      }
    });

    log.info(`[FAQ] Extracted ${prompts.length} prompts from ${maxRows} rows`);
    return prompts;
  } catch (error) {
    // File not found is expected when trying multiple weeks
    if (error.message?.includes('resource could not be found') || error.message?.includes('itemNotFound')) {
      log.info(`[FAQ] Brand presence file not found: ${filename}`);
    } else {
      // Unexpected error
      log.error(`[FAQ] Failed to read brand presence spreadsheet: ${error.message}`);
    }
    return [];
  }
}

/**
 * Deduplicates prompts based on question text
 * Prioritizes prompts with URL, then keeps the first occurrence
 * @param {Array} prompts - Array of prompt objects with url, topic, and question
 * @returns {Array} Deduplicated array of prompts
 */
function deduplicatePrompts(prompts) {
  const seenQuestions = new Map();

  prompts.forEach((prompt) => {
    const questionKey = prompt.question.toLowerCase().trim();
    const existing = seenQuestions.get(questionKey);

    if (!existing) {
      // First occurrence of this question
      seenQuestions.set(questionKey, prompt);
    } else {
      // Duplicate found - prioritize the one with a URL
      const existingHasUrl = existing.url && existing.url.length > 0;
      const currentHasUrl = prompt.url && prompt.url.length > 0;

      // Replace existing if current has URL and existing doesn't
      if (currentHasUrl && !existingHasUrl) {
        seenQuestions.set(questionKey, prompt);
      }
      // Otherwise keep existing (either it has URL, or both don't have URL - keep first)
    }
  });

  return Array.from(seenQuestions.values());
}

/**
 * Sorts prompts with URLs first, then prompts without URLs
 * @param {Array} prompts - Array of prompt objects with url, topic, and question
 * @returns {Array} Sorted array of prompts
 */
function sortPrompts(prompts) {
  return prompts.sort((a, b) => {
    const aHasUrl = a.url && a.url.length > 0;
    const bHasUrl = b.url && b.url.length > 0;

    if (aHasUrl && !bHasUrl) return -1;
    if (!aHasUrl && bHasUrl) return 1;
    return 0;
  });
}

async function runFaqsAudit(url, context, site) {
  const {
    log,
  } = context;
  const { getOutputLocation } = context;

  log.info('[FAQ] Running FAQs audit');

  try {
    const contentAIStatus = await validateContentAI(site, context);

    // Check if Content AI is properly configured and working
    if (!contentAIStatus.uid || !contentAIStatus.genSearchEnabled || !contentAIStatus.isWorking) {
      let errorMessage;
      if (!contentAIStatus.uid) {
        errorMessage = 'Content AI configuration not found';
        log.warn('[FAQ] Content AI configuration does not exist for this site, skipping audit');
      } else if (!contentAIStatus.genSearchEnabled) {
        errorMessage = 'Content AI generative search not enabled';
        log.warn(`[FAQ] Content AI generative search not enabled for index ${contentAIStatus.indexName}, skipping audit`);
      } else {
        errorMessage = 'Content AI search endpoint validation failed';
        log.warn(`[FAQ] Content AI search endpoint is not working for index ${contentAIStatus.indexName}, skipping audit`);
      }

      return {
        auditResult: {
          success: false,
          error: errorMessage,
          promptsByUrl: [],
        },
        fullAuditRef: url,
      };
    }

    log.info(`[FAQ] Content AI validation successful - UID: ${contentAIStatus.uid}, Index: ${contentAIStatus.indexName}, GenSearch: ${contentAIStatus.genSearchEnabled}`);

    // Prepare SharePoint client and file location
    const sharepointClient = await createLLMOSharepointClient(context);
    const outputLocation = getOutputLocation
      ? getOutputLocation(site)
      : `${site.getConfig().getLlmoDataFolder()}/brand-presence`;

    // Try to find brand presence spreadsheet from the last weeks (most recent first)
    const weekTriples = getPreviousWeekTriples(new Date(), WEEKS_TO_LOOK_BACK);
    // Convert to unique weeks since triples may contain multiple entries per week
    const uniqueWeeks = new Map();
    weekTriples.forEach(({ year, week }) => {
      const key = `${year}-${week}`;
      if (!uniqueWeeks.has(key)) {
        uniqueWeeks.set(key, { weekNumber: week, year });
      }
    });
    const weeks = Array.from(uniqueWeeks.values());

    let topPrompts = [];
    let usedPeriodIdentifier = null;

    for (const week of weeks) {
      const periodIdentifier = `w${week.weekNumber}-${week.year}`;
      const brandPresenceFilename = `brandpresence-all-${periodIdentifier}.xlsx`;

      log.info(`[FAQ] Attempting to read brand presence file for ${periodIdentifier}`);

      // eslint-disable-next-line no-await-in-loop
      const prompts = await readBrandPresenceSpreadsheet(
        brandPresenceFilename,
        outputLocation,
        sharepointClient,
        log,
      );

      if (prompts.length > 0) {
        topPrompts = sortPrompts(prompts);
        usedPeriodIdentifier = periodIdentifier;
        log.info(`[FAQ] Successfully found brand presence data for ${periodIdentifier} with ${prompts.length} prompts`);
        break;
      }

      log.info(`[FAQ] No data found for ${periodIdentifier}, will try next week`);
    }

    if (topPrompts.length === 0) {
      log.warn(`[FAQ] No prompts found in brand presence spreadsheet from the last ${WEEKS_TO_LOOK_BACK} weeks`);
      return {
        auditResult: {
          success: false,
          error: `No brand presence data found in the last ${WEEKS_TO_LOOK_BACK} weeks`,
          promptsByUrl: [],
        },
        fullAuditRef: url,
      };
    }

    log.info(`[FAQ] Using brand presence data from ${usedPeriodIdentifier}`);

    // Deduplicate prompts before grouping
    const uniquePrompts = deduplicatePrompts(topPrompts);
    log.info(`[FAQ] Deduplicated ${topPrompts.length} prompts to ${uniquePrompts.length} unique prompts`);

    // Group prompts by URL and topic (already limited to MAX_ROWS_TO_READ)
    const promptsByUrl = groupPromptsByUrlAndTopic(uniquePrompts);

    log.info(`[FAQ] Grouped ${uniquePrompts.length} prompts into ${promptsByUrl.length} topics`);

    const auditResult = {
      success: true,
      promptsByUrl,
    };

    return {
      auditResult,
      fullAuditRef: url,
    };
  } catch (error) {
    log.error(`[FAQ] Audit failed: ${error.message}`);

    return {
      auditResult: {
        success: false,
        promptsByUrl: [],
      },
      fullAuditRef: url,
    };
  }
}

// Post processor for sending message to Mystique
async function sendMystiqueMessagePostProcessor(auditUrl, auditData, context) {
  const {
    log, sqs, env, dataAccess, audit,
  } = context;
  const { siteId, auditResult } = auditData;

  // Skip if audit failed
  if (!auditResult.success) {
    log.info('[FAQ] Audit failed, skipping Mystique message');
    return auditData;
  }

  const { promptsByUrl } = auditResult;

  if (!promptsByUrl || promptsByUrl.length === 0) {
    log.info('[FAQ] No grouped prompts by URL found, skipping Mystique message');
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn('[FAQ] SQS or Mystique queue not configured, skipping message');
    return auditData;
  }

  try {
    // Get site for additional data
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.warn('[FAQ] Site not found, skipping Mystique message');
      return auditData;
    }

    const message = {
      type: 'guidance:faqs',
      siteId,
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        faqs: promptsByUrl,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`[FAQ] Queued ${promptsByUrl.length} FAQ groups to Mystique`);
  } catch (error) {
    log.error(`[FAQ] Failed to send Mystique message: ${error.message}`);
  }

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runFaqsAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
