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

import { runDailyAgenticExport } from '../agentic-daily-export.js';

/**
 * Resolves the reference date for the daily export from auditContext.date.
 * Returns undefined (so the export defaults to "yesterday") when no valid date
 * is provided.
 */
function getDateBasedReferenceDate(auditContext, siteId, context) {
  if (!auditContext?.date) {
    return undefined;
  }

  const referenceDate = new Date(auditContext.date);
  if (Number.isNaN(referenceDate.getTime())) {
    context.log.error(`Invalid date in auditContext for ${siteId}: ${auditContext.date}`);
    return undefined;
  }

  return referenceDate;
}

/**
 * Runs the daily agentic DB export for a single reference date, returning a
 * failure marker instead of throwing so it never blocks the rest of the audit.
 */
async function runAgenticDbExportForReferenceDate({
  athenaClient,
  s3Config,
  site,
  context,
  reportConfig,
  referenceDate = new Date(),
}) {
  const siteId = site.getId();
  try {
    return await runDailyAgenticExport({
      athenaClient,
      s3Config,
      site,
      context,
      reportConfig,
      referenceDate,
    });
  } catch (error) {
    context.log.error(`Failed daily agentic export for site ${siteId}: ${error.message}`, error);
    return {
      enabled: true,
      success: false,
      siteId,
      error: error.message,
    };
  }
}

/**
 * Exports the agentic traffic for a single UTC day to PostgreSQL. The day is
 * `auditContext.date - 1` for a date-based (backfill) run, or yesterday for a
 * normal scheduled run.
 */
export async function runAgenticDbExports({
  athenaClient,
  s3Config,
  site,
  context,
  agenticReportConfig,
  auditContext,
}) {
  const siteId = site.getId();
  if (!agenticReportConfig) {
    context.log.debug(`Skipping agentic DB export for ${siteId}: agentic report config not found`);
    return {};
  }

  const referenceDate = getDateBasedReferenceDate(auditContext, siteId, context);
  return {
    dailyAgenticExport: await runAgenticDbExportForReferenceDate({
      athenaClient,
      s3Config,
      site,
      context,
      reportConfig: agenticReportConfig,
      ...(referenceDate ? { referenceDate } : {}),
    }),
  };
}
