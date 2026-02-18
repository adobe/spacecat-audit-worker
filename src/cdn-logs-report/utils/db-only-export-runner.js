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

/* c8 ignore start */
const EMPTY_DELIVERY = {
  source: 'db-endpoints',
  status: 'failed',
};

function toDateString(date) {
  return date.toISOString().split('T')[0];
}

function getYesterdayUtcDate() {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  return yesterday;
}

function parseUtcDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
  }

  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || toDateString(date) !== dateStr) {
    throw new Error(`Invalid date value: ${dateStr}`);
  }

  return date;
}

function getDateRange(fromDate, toDate) {
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error('Invalid date range: fromDate must be less than or equal to toDate');
  }

  const dates = [];
  const cursor = new Date(fromDate);
  while (cursor.getTime() <= toDate.getTime()) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function resolveDates(auditContext = {}) {
  const hasFrom = Boolean(auditContext.fromDate);
  const hasTo = Boolean(auditContext.toDate);

  if (hasFrom !== hasTo) {
    throw new Error('Invalid date range: fromDate and toDate must both be provided');
  }

  if (hasFrom && hasTo) {
    const fromDate = parseUtcDate(auditContext.fromDate);
    const toDate = parseUtcDate(auditContext.toDate);
    return {
      mode: 'range',
      fromDate: auditContext.fromDate,
      toDate: auditContext.toDate,
      dates: getDateRange(fromDate, toDate),
    };
  }

  if (auditContext.date) {
    const date = parseUtcDate(auditContext.date);
    return {
      mode: 'single',
      fromDate: auditContext.date,
      toDate: auditContext.date,
      dates: [date],
    };
  }

  const yesterday = getYesterdayUtcDate();
  const dateStr = toDateString(yesterday);
  return {
    mode: 'single',
    fromDate: dateStr,
    toDate: dateStr,
    dates: [yesterday],
  };
}

export async function runDbOnlyDailyAgenticExport({
  auditContext,
  siteId,
  log,
  runDailyExport,
}) {
  const {
    mode, fromDate, toDate, dates,
  } = resolveDates(auditContext);
  const runs = [];

  for (const date of dates) {
    const trafficDate = toDateString(date);
    try {
      // eslint-disable-next-line no-await-in-loop
      const run = await runDailyExport(date);
      runs.push(run);
    } catch (error) {
      log.error(`Failed daily agentic export for site ${siteId} on ${trafficDate}: ${error.message}`);
      runs.push({
        enabled: true,
        success: false,
        siteId,
        trafficDate,
        rowCount: 0,
        delivery: EMPTY_DELIVERY,
        error: error.message,
      });
    }
  }

  const firstRun = runs[0];
  return {
    enabled: true,
    mode,
    siteId,
    fromDate,
    toDate,
    runs,
    success: runs.every((run) => run.success),
    // keep single-day compatibility
    trafficDate: firstRun?.trafficDate,
    rowCount: firstRun?.rowCount ?? 0,
    delivery: firstRun?.delivery ?? EMPTY_DELIVERY,
    ...(firstRun?.error && { error: firstRun.error }),
  };
}
/* c8 ignore end */
