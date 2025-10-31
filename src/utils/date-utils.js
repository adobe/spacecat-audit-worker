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

import {
  startOfWeek, subWeeks, addDays, getYear, getISOWeek, getMonth,
} from 'date-fns';
import { getDateRanges, isInteger } from '@adobe/spacecat-shared-utils';

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
 * Generates a SQL-like temporal condition string for a calendar week.
 * If week and year are provided, uses that specific week.
 * Otherwise, uses the previous calendar week from today.
 *
 * Examples:
 * - Single: `year = 2025 AND month = 7 AND week = 30`
 * - Multiple: `(year = 2024 AND month = 12 AND week = 1) OR (...)`
 *
 * @param {number} [week] - Optional ISO week number (1-53).
 * @param {number} [year] - Optional year.
 * @returns {string} SQL-style conditional string.
 */
export function getTemporalCondition(week, year) {
  // If week and year are valid integers, use them directly
  if (isInteger(week) && isInteger(year)) {
    const paddedWeek = String(week).padStart(2, '0');
    const ranges = getDateRanges(week, year);

    // Create unique year-month combinations
    const yearMonthSet = new Set(
      ranges.map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`),
    );

    const monthConditions = Array.from(yearMonthSet).map((yearMonth) => {
      const [y, month] = yearMonth.split('-');
      return `(year = ${y} AND month = ${month} AND week = ${paddedWeek})`;
    });

    return monthConditions.length === 1
      ? monthConditions[0].slice(1, -1)
      : monthConditions.join(' OR ');
  }

  // Otherwise, use previous week from today
  const today = new Date();
  const triples = getPreviousWeekTriples(today);

  if (triples.length === 0) {
    throw new Error(`Invalid date: ${today}`);
  }

  const parts = triples.map(({ year: y, month, week: w }) => {
    const paddedMonth = String(month).padStart(2, '0');
    const paddedWeek = String(w).padStart(2, '0');
    return `(year = ${y} AND month = ${paddedMonth} AND week = ${paddedWeek})`;
  });

  return parts.length === 1
    ? parts[0].slice(1, -1) // remove outer parentheses
    : parts.join(' OR ');
}

/**
 * Formats week and year into a string in format "{week}-{year}".
 * If week and year are provided, formats them directly.
 * Otherwise, calculates the previous week from today.
 *
 * @param {number} [week] - Optional ISO week number (1-53).
 * @param {number} [year] - Optional year.
 * @returns {string} Formatted week-year string (e.g., "10-2025")
 */
export function formatWeekYear(week, year) {
  // If week and year are valid integers, use them directly
  if (isInteger(week) && isInteger(year)) {
    const paddedWeek = String(week).padStart(2, '0');
    return `${paddedWeek}-${year}`;
  }

  // Otherwise, calculate previous week from today
  const today = new Date();
  const start = subWeeks(startOfWeek(today, { weekStartsOn: 1 }), 1);
  const prevYear = getYear(start);
  const prevWeek = getISOWeek(start);
  const paddedWeek = String(prevWeek).padStart(2, '0');
  return `${paddedWeek}-${prevYear}`;
}
