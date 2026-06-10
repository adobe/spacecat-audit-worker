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
import { generateReportingPeriods } from './report-utils.js';

const WEEKLY_REFRESH_RPC = 'wrpc_refresh_agentic_traffic_weekly';

function toUtcDateString(date) {
  return date.toISOString().split('T')[0];
}

// Sunday is the last day of the ISO week; invalid/missing dates yield NaN (never 0).
function isWeekClosingSunday(trafficDate) {
  return new Date(`${trafficDate}T00:00:00.000Z`).getUTCDay() === 0;
}

/**
 * Triggers the weekly agentic rollup RPC for the ISO week containing `trafficDate`.
 * The rollup normally rides on the Sunday daily import; an empty Sunday is skipped and
 * emits no batch event, so we call the RPC directly to roll up the earlier days.
 * Best-effort: never throws.
 */
async function refreshWeeklyAgenticRollup({ site, context, trafficDate }) {
  const siteId = site.getId();
  const { log } = context;
  const postgrestClient = context?.dataAccess?.services?.postgrestClient;

  if (!postgrestClient?.rpc) {
    log.warn(`Skipping weekly agentic rollup for ${siteId}: PostgREST client unavailable`);
    return { success: false, error: 'postgrest-client-unavailable' };
  }

  let weekStart;
  let weekEnd;
  try {
    const [{ startDate, endDate }] = generateReportingPeriods(
      new Date(`${trafficDate}T00:00:00.000Z`),
      0,
    ).weeks;
    weekStart = toUtcDateString(startDate);
    weekEnd = toUtcDateString(endDate);

    const { error } = await postgrestClient.rpc(WEEKLY_REFRESH_RPC, {
      p_site_id: siteId,
      p_start_date: weekStart,
      p_end_date: weekEnd,
      p_updated_by: 'audit-worker:cdn-logs-report-weekly-refresh',
    });

    if (error) {
      log.error(`Failed weekly agentic rollup for ${siteId} (${weekStart}..${weekEnd}): ${error.message}`);
      return {
        success: false, weekStart, weekEnd, error: error.message,
      };
    }

    log.info(`Triggered weekly agentic rollup for ${siteId} (${weekStart}..${weekEnd}) after empty Sunday export`);
    return { success: true, weekStart, weekEnd };
  } catch (error) {
    log.error(`Failed weekly agentic rollup for ${siteId} (${weekStart}..${weekEnd}): ${error.message}`, error);
    return {
      success: false, weekStart, weekEnd, error: error.message,
    };
  }
}

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
  const dailyAgenticExport = await runAgenticDbExportForReferenceDate({
    athenaClient,
    s3Config,
    site,
    context,
    reportConfig: agenticReportConfig,
    ...(referenceDate ? { referenceDate } : {}),
  });

  const result = { dailyAgenticExport };

  // An empty Sunday emits no batch event, so roll up the week's earlier days directly.
  if (dailyAgenticExport?.skipped && isWeekClosingSunday(dailyAgenticExport.trafficDate)) {
    result.weeklyAgenticRefresh = await refreshWeeklyAgenticRollup({
      site,
      context,
      trafficDate: dailyAgenticExport.trafficDate,
    });
  }

  return result;
}
