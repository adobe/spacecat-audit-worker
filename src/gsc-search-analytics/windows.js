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
const iso = (d) => d.toISOString().split('T')[0];
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/**
 * Compute the 12-week before/after windows around a fix date.
 * before = the 84 days ending the day before the fix.
 * after  = the 84 days starting the day after the fix.
 *
 * @param {string} fixDate - ISO date (YYYY-MM-DD) when the URL was fixed.
 * @returns {{before: {start: string, end: string}, after: {start: string, end: string}}}
 */
export function computeWindows(fixDate) {
  const fix = new Date(`${fixDate}T00:00:00Z`);
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
