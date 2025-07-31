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

import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { createFrom } from '@adobe/spacecat-helix-content-sdk';
import { LLM_404_BLOCKED_AUDIT } from './constants.js';
import {
  createExcelReport, getWeekRange, generatePeriodIdentifier, saveExcelReport,
} from './utils.js';

async function prepareReportData(opportunities) {
  if (opportunities.length === 0) {
    return [];
  }

  const opportunity = opportunities[0];
  const suggestions = await opportunity.getSuggestions();
  const reportData = [];

  // Process all suggestions for the single opportunity
  for (const suggestion of suggestions) {
    const suggestionData = suggestion.getData();

    reportData.push({
      url: suggestionData.url,
      count_404s: suggestionData.count_404s,
      suggestions: suggestionData.urlsSuggested || [],
      status: suggestionData.aiResponseReceived ? 'Suggestion Received' : 'Pending Suggestion',
      aiRationale: suggestionData.aiRationale || '',
    });
  }

  return reportData;
}

export default async function reportHandler(message, context) {
  const { log, dataAccess, env } = context;
  const { auditId, siteId } = message;

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Report handler received for audit ${auditId}`);

  const { Audit, Opportunity, Site } = dataAccess;

  const audit = await Audit.getByID(auditId);
  if (!audit) {
    log.error(`[${LLM_404_BLOCKED_AUDIT}] Audit ${auditId} not found for reporting.`);
    return notFound('Audit not found');
  }

  const site = await Site.getByID(siteId);
  if (!site) {
    log.error(`[${LLM_404_BLOCKED_AUDIT}] Site ${siteId} not found for reporting.`);
    return notFound('Site not found');
  }

  const allOpportunities = await Opportunity.allBySiteId(siteId);
  const opportunities = allOpportunities.filter((opp) => (
    opp.getAuditId() === auditId && opp.getType() === LLM_404_BLOCKED_AUDIT
  ));

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Filtered ${allOpportunities.length} total opportunities to ${opportunities.length} llm-404-blocked opportunities for audit ${auditId}`);

  if (opportunities.length === 0) {
    log.warn(`[${LLM_404_BLOCKED_AUDIT}] No opportunity found for audit ${auditId}. Skipping report generation.`);
    return ok();
  }

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Found llm-404-blocked opportunity for audit ${auditId}. Generating report.`);

  const reportData = await prepareReportData(opportunities);

  const excelWorkbook = await createExcelReport(reportData);

  const SHAREPOINT_URL = 'https://adobe.sharepoint.com/:x:/r/sites/HelixProjects/Shared%20Documents/sites/elmo-ui-data';
  const sharepointClient = await createFrom({
    clientId: env.SHAREPOINT_CLIENT_ID,
    clientSecret: env.SHAREPOINT_CLIENT_SECRET,
    authority: env.SHAREPOINT_AUTHORITY,
    domainId: env.SHAREPOINT_DOMAIN_ID,
  }, { url: SHAREPOINT_URL, type: 'onedrive' });

  const { weekStart, weekEnd } = getWeekRange(-1); // Assuming report for last week
  const periodIdentifier = generatePeriodIdentifier(weekStart, weekEnd);
  const domain = new URL(site.getBaseURL()).hostname.replace('www.', '');
  const excelFilename = `llm-404-blocked-${domain}-${periodIdentifier}.xlsx`;

  const outputLocation = site.getConfig()?.getCdnLogsConfig()?.outputLocation || domain;

  await saveExcelReport({
    workbook: excelWorkbook,
    outputLocation,
    log,
    sharepointClient,
    filename: excelFilename,
  });

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Report for audit ${auditId} generated and uploaded successfully.`);

  return ok();
}
