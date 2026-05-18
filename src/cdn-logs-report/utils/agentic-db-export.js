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
import { SERVICE_PROVIDER_TYPES } from '../../utils/cdn-utils.js';

const DAILY_EXPORT_MESSAGE_DELAY_SECONDS = 5;
const ALLOWED_TRIGGERED_BY = new Set(Object.values(SERVICE_PROVIDER_TYPES));

function hasWeekOffset(auditContext) {
  return auditContext?.weekOffset !== undefined && auditContext?.weekOffset !== null;
}

function getSafeTriggeredBy(triggeredBy) {
  return ALLOWED_TRIGGERED_BY.has(triggeredBy) ? triggeredBy : undefined;
}

function getAgenticDbExportReferenceDatesForWeek(weekOffset, referenceDate = new Date()) {
  const { weeks } = generateReportingPeriods(referenceDate, weekOffset);
  const weekStart = weeks[0]?.startDate;
  if (!weekStart) {
    return [];
  }

  // runDailyAgenticExport exports the previous UTC day, so each target
  // traffic day uses the following midnight as its reference date.
  const latestCompletedReferenceDate = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  ));
  return Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(
    weekStart.getUTCFullYear(),
    weekStart.getUTCMonth(),
    weekStart.getUTCDate() + index + 1,
  ))).filter((date) => date <= latestCompletedReferenceDate);
}

function shouldRefreshWeeklyAgenticDbExports(auditContext) {
  // Keep Agentic DB refreshes behind one explicit signal. Other flags, such
  // as categoriesUpdated, may affect report generation but should not be an
  // independent DB export trigger.
  return hasWeekOffset(auditContext)
    && Boolean(auditContext?.refreshAgenticDailyExport);
}

function getFailureResult({
  siteId,
  error,
  queued = false,
}) {
  return {
    enabled: true,
    success: false,
    queued,
    siteId,
    error,
  };
}

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

async function runAgenticDbExportForReferenceDate({
  athenaClient,
  s3Client,
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
      s3Client,
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

async function runDateBasedAgenticDbExport({
  athenaClient,
  s3Client,
  s3Config,
  site,
  context,
  agenticReportConfig,
  auditContext,
}) {
  const siteId = site.getId();
  const referenceDate = getDateBasedReferenceDate(auditContext, siteId, context);

  return {
    dailyAgenticExport: await runAgenticDbExportForReferenceDate({
      athenaClient,
      s3Client,
      s3Config,
      site,
      context,
      reportConfig: agenticReportConfig,
      ...(referenceDate ? { referenceDate } : {}),
    }),
  };
}

async function queueDailyAgenticDbExport({
  auditQueue,
  siteId,
  context,
  auditContext,
  referenceDate,
  delaySeconds,
}) {
  try {
    await context.sqs.sendMessage(auditQueue, {
      type: 'cdn-logs-report',
      siteId,
      auditContext: {
        date: referenceDate.toISOString(),
        refreshAgenticDailyExport: true,
        ...(auditContext.categoriesUpdated ? { categoriesUpdated: true } : {}),
        ...(auditContext.triggeredBy ? { triggeredBy: auditContext.triggeredBy } : {}),
        sourceWeekOffset: auditContext.weekOffset,
      },
    }, null, delaySeconds);

    return {
      enabled: true,
      success: true,
      queued: true,
      siteId,
      referenceDate: referenceDate.toISOString(),
      delaySeconds,
    };
  } catch (error) {
    context.log.error(`Failed to queue daily agentic DB export for site ${siteId}: ${error.message}`, error);
    return {
      enabled: true,
      success: false,
      queued: false,
      siteId,
      referenceDate: referenceDate.toISOString(),
      delaySeconds,
      error: error.message,
    };
  }
}

async function resolveAuditQueue(context, siteId) {
  const { Configuration } = context.dataAccess;
  try {
    const configuration = await Configuration.findLatest();
    const auditQueue = configuration?.getQueues?.()?.audits;
    if (!auditQueue) {
      const error = 'Audit queue not configured';
      context.log.error(`${error} for site ${siteId}; skipping weekly DB export queueing`);
      return {
        failure: getFailureResult({ siteId, error }),
      };
    }

    return { auditQueue };
  } catch (error) {
    context.log.error(`Failed to resolve audit queue for site ${siteId}: ${error.message}`, error);
    return {
      failure: getFailureResult({ siteId, error: error.message }),
    };
  }
}

async function queueWeeklyAgenticDbExports({
  site,
  context,
  auditContext,
}) {
  const siteId = site.getId();
  const dailyAgenticExports = [];
  const referenceDates = getAgenticDbExportReferenceDatesForWeek(
    auditContext.weekOffset,
  );
  if (referenceDates.length === 0) {
    return {
      dailyAgenticExport: null,
      dailyAgenticExports,
    };
  }

  const { auditQueue, failure } = await resolveAuditQueue(context, siteId);
  if (failure) {
    return {
      dailyAgenticExport: failure,
      dailyAgenticExports,
    };
  }

  const triggeredBy = getSafeTriggeredBy(auditContext.triggeredBy);
  const exportAuditContext = { ...auditContext, triggeredBy };

  context.log.info(`Queueing weekly agentic DB exports for ${siteId}: weekOffset=${auditContext.weekOffset}, trigger=${triggeredBy || 'refreshAgenticDailyExport'}, days=${referenceDates.length}`);
  for (const [index, referenceDate] of referenceDates.entries()) {
    // Keep queueing sequential and lightly staggered so the weekly report Lambda
    // only coordinates per-day work instead of owning all seven exports.
    // eslint-disable-next-line no-await-in-loop
    dailyAgenticExports.push(await queueDailyAgenticDbExport({
      auditQueue,
      siteId,
      context,
      auditContext: exportAuditContext,
      referenceDate,
      delaySeconds: index * DAILY_EXPORT_MESSAGE_DELAY_SECONDS,
    }));
  }

  const failedExports = dailyAgenticExports.filter((result) => result && result.success === false);
  if (failedExports.length > 0) {
    context.log.warn(`Partial agentic DB export queueing failure for ${siteId}: ${failedExports.length}/${dailyAgenticExports.length} days failed`);
  }

  return {
    dailyAgenticExport: dailyAgenticExports.at(-1),
    dailyAgenticExports,
  };
}

export async function runAgenticDbExports({
  athenaClient,
  s3Client,
  s3Config,
  site,
  context,
  agenticReportConfig,
  auditContext,
  agenticReportHasData,
}) {
  const siteId = site.getId();
  if (!agenticReportConfig) {
    context.log.debug(`Skipping agentic DB export for ${siteId}: agentic report config not found`);
    return {};
  }

  if (!hasWeekOffset(auditContext)) {
    return runDateBasedAgenticDbExport({
      athenaClient,
      s3Client,
      s3Config,
      site,
      context,
      agenticReportConfig,
      auditContext,
    });
  }

  if (!shouldRefreshWeeklyAgenticDbExports(auditContext)) {
    return {};
  }

  if (!agenticReportHasData) {
    context.log.info(`Skipping weekly agentic DB exports for ${siteId}: no agentic report data found`);
    return {};
  }

  return queueWeeklyAgenticDbExports({
    site,
    context,
    auditContext,
  });
}
