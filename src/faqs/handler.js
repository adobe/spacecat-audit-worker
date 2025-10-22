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
import { generateReportingPeriods } from '../llm-error-pages/utils.js';

const MAX_ROWS_TO_READ = 1000;

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
    log.info(`Reading brand presence spreadsheet from: ${filename}`);

    const buffer = await readFromSharePoint(filename, outputLocation, sharepointClient, log);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      log.warn('No worksheet found in spreadsheet');
      return [];
    }

    const prompts = [];
    const maxRows = Math.min(MAX_ROWS_TO_READ, worksheet.rowCount - 1);
    const rows = worksheet.getRows(2, maxRows) || [];

    log.info(`Reading ${maxRows} rows from spreadsheet (total rows: ${worksheet.rowCount})`);

    // Columns: Category, Topics, Prompt, Origin, Region, Volume, URL, ...
    rows.forEach((row) => {
      const topic = row.getCell(2).value; // Topics
      const prompt = row.getCell(3).value; // Prompt
      const url = row.getCell(7).value || ''; // URL

      if (topic && prompt) {
        prompts.push({
          url: url.toString().trim(),
          topic: topic.toString().trim(),
          question: prompt.toString().trim(),
        });
      }
    });

    log.info(`Extracted ${prompts.length} prompts from ${maxRows} rows`);
    return prompts;
  } catch (error) {
    log.error(`Failed to read brand presence spreadsheet: ${error.message}`);
    return [];
  }
}

async function runFaqsAudit(url, context, site) {
  const {
    log,
  } = context;
  const { getOutputLocation } = context;

  log.info('Running FAQs audit');

  try {
    const week = generateReportingPeriods().weeks[0];
    const periodIdentifier = `w${week.weekNumber}-${week.year}`;
    log.info(`Running weekly audit for ${periodIdentifier}`);

    // Prepare SharePoint client and file location
    const sharepointClient = await createLLMOSharepointClient(context);
    const outputLocation = getOutputLocation
      ? getOutputLocation(site)
      : `${site.getConfig().getLlmoDataFolder()}/brand-presence`;
    const brandPresenceFilename = `brandpresence-all-${periodIdentifier}.xlsx`;

    // Read brand presence spreadsheet
    const topPrompts = await readBrandPresenceSpreadsheet(
      brandPresenceFilename,
      outputLocation,
      sharepointClient,
      log,
    );

    if (topPrompts.length === 0) {
      log.warn('No prompts found in brand presence spreadsheet');
      return {
        auditResult: {
          success: false,
          promptsByUrl: [],
        },
        fullAuditRef: url,
      };
    }

    // Group prompts by URL and topic (already limited to MAX_ROWS_TO_READ)
    const promptsByUrl = groupPromptsByUrlAndTopic(topPrompts);

    log.info(`Grouped ${topPrompts.length} prompts into ${promptsByUrl.length} topics`);

    const auditResult = {
      success: true,
      promptsByUrl,
    };

    return {
      auditResult,
      fullAuditRef: url,
    };
  } catch (error) {
    log.error(`FAQs audit failed: ${error.message}`);

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
    log.info('Audit failed, skipping Mystique message');
    return auditData;
  }

  const { promptsByUrl } = auditResult;

  if (!promptsByUrl || promptsByUrl.length === 0) {
    log.info('No grouped prompts by URL found, skipping Mystique message');
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn('SQS or Mystique queue not configured, skipping message');
    return auditData;
  }

  try {
    // Get site for additional data
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.warn('Site not found, skipping Mystique message');
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
    log.info(`Queued ${promptsByUrl.length} FAQ topics to Mystique for AI processing`);
  } catch (error) {
    log.error(`Failed to send Mystique message: ${error.message}`);
  }

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runFaqsAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
