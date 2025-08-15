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

/* c8 ignore start */

import {
  startOfWeek, subWeeks, addDays, getYear, getISOWeek, getMonth,
} from 'date-fns';

/**
 * Returns a list of unique (year, month, week) triples for the previous calendar week.
 * A week starts on monday and may span multiple months or years.
 *
 * @param {Date} [today=new Date()] - The reference date (defaults to today).
 * @returns {Array<{ year: number, month: number, week: number }>} Array of unique triples.
 */
function getPreviousWeekTriples(today = new Date()) {
  const start = subWeeks(startOfWeek(today, { weekStartsOn: 1 }), 1); // previous monday
  const triplesSet = new Set();

  for (let i = 0; i < 7; i += 1) {
    const d = addDays(start, i);
    const triple = `${getYear(d)}-${getMonth(d) + 1}-${getISOWeek(d)}`;
    triplesSet.add(triple);
  }

  return Array.from(triplesSet).map((t) => {
    const [year, month, week] = t.split('-').map(Number);
    return { year, month, week };
  });
}

/**
 * Generates a SQL-like temporal condition string for the previous calendar week.
 *
 * Examples:
 * - Single: `year = 2025 AND month = 7 AND week = 30`
 * - Multiple: `(year = 2024 AND month = 12 AND week = 1) OR (...)`
 *
 * @param {Date} [today=new Date()] - Optional reference date.
 * @returns {string} SQL-style conditional string.
 */
export function getTemporalCondition(today = new Date()) {
  const triples = getPreviousWeekTriples(today);

  if (triples.length === 0) {
    throw new Error(`Invalid date: ${today}`);
  }

  const parts = triples.map(({ year, month, week }) => {
    const paddedMonth = String(month).padStart(2, '0');
    const paddedWeek = String(week).padStart(2, '0');
    return `(year = ${year} AND month = ${paddedMonth} AND week = ${paddedWeek})`;
  });

  return parts.length === 1
    ? parts[0].slice(1, -1) // remove outer parentheses
    : parts.join(' OR ');
}

export function getPreviousWeekYear(today = new Date()) {
  const start = subWeeks(startOfWeek(today, { weekStartsOn: 1 }), 1);
  const year = getYear(start);
  const week = getISOWeek(start);
  return `${week}-${year}`;
}

/* c8 ignore end */
