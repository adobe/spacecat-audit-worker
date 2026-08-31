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

const DAYS = 84; // 12 weeks
// GSC finalizes data with a ~2-3 day lag; treat the trailing 3 days as not yet available.
export const GSC_LAG_DAYS = 3;
// GSC retains ~16 months of history; older data falls off and returns empty.
export const RETENTION_DAYS = 480;

const iso = (d) => d.toISOString().split('T')[0];
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const toUtc = (s) => new Date(`${s}T00:00:00Z`);

/**
 * True when the value is a strict YYYY-MM-DD string denoting a real calendar day.
 * Rejects non-strings and values that JS Date silently rolls over (e.g. 2026-02-30
 * → Mar 2), which would otherwise anchor the windows to the wrong date.
 *
 * @param {*} fixDate - candidate date value.
 * @returns {boolean}
 */
export function isValidFixDate(fixDate) {
  if (typeof fixDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fixDate)) {
    return false;
  }
  const d = toUtc(fixDate);
  return !Number.isNaN(d.getTime()) && iso(d) === fixDate;
}

/**
 * Compute the 12-week before/after windows around a fix date.
 * before = the 84 days ending the day before the fix.
 * after  = the 84 days starting the day after the fix.
 *
 * @param {string} fixDate - ISO date (YYYY-MM-DD) when the URL was fixed.
 * @returns {{before: {start: string, end: string}, after: {start: string, end: string}}}
 */
export function computeWindows(fixDate) {
  const fix = toUtc(fixDate);
  if (Number.isNaN(fix.getTime())) {
    throw new Error(`Invalid fix date: ${fixDate}`);
  }
  const beforeEnd = addDays(fix, -1);
  const afterStart = addDays(fix, 1);
  return {
    before: { start: iso(addDays(beforeEnd, -(DAYS - 1))), end: iso(beforeEnd) },
    after: { start: iso(afterStart), end: iso(addDays(afterStart, DAYS - 1)) },
  };
}

/**
 * Assess whether GSC data is fully available for each window as of `now`:
 * - afterComplete: the after window has fully elapsed past GSC's freshness lag.
 * - beforeComplete: the before window's start is still within GSC's retention horizon.
 *
 * @param {{before:{start:string,end:string}, after:{start:string,end:string}}} windows
 * @param {Date} now - reference "current" time.
 * @returns {{beforeComplete: boolean, afterComplete: boolean}}
 */
export function assessCompleteness(windows, now) {
  const lagHorizon = addDays(now, -GSC_LAG_DAYS);
  const retentionHorizon = addDays(now, -RETENTION_DAYS);
  return {
    afterComplete: toUtc(windows.after.end) <= lagHorizon,
    beforeComplete: toUtc(windows.before.start) >= retentionHorizon,
  };
}
