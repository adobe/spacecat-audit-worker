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
import { TIME_CONSTANTS, ERROR_MESSAGES } from '../constants/index.js';

export function formatDateString(date) {
  return date.toISOString().split('T')[0];
}

function getWeekNumber(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export function getWeekRange(offsetWeeks = 0, referenceDate = new Date()) {
  const refDate = new Date(referenceDate);
  const isSunday = refDate.getUTCDay() === TIME_CONSTANTS.ISO_SUNDAY;
  const daysToMonday = isSunday ? 6 : refDate.getUTCDay() - TIME_CONSTANTS.ISO_MONDAY;

  const weekStart = new Date(refDate);
  const totalOffset = daysToMonday - (offsetWeeks * TIME_CONSTANTS.DAYS_PER_WEEK);
  weekStart.setUTCDate(refDate.getUTCDate() - totalOffset);
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

export function createDateRange(startInput, endInput) {
  const startDate = new Date(startInput);
  const endDate = new Date(endInput);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error(ERROR_MESSAGES.DATE_FORMAT_ERROR);
  }

  if (startDate >= endDate) {
    throw new Error(ERROR_MESSAGES.START_BEFORE_END);
  }

  // Set proper times
  startDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(23, 59, 59, 999);

  return { startDate, endDate };
}

export function generatePeriodIdentifier(startDate, endDate) {
  const start = formatDateString(startDate);
  const end = formatDateString(endDate);

  // Check if it's a 7-day week period
  const diffDays = Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000));
  if (diffDays === 7) {
    const year = startDate.getUTCFullYear();
    const weekNum = getWeekNumber(startDate);
    return `${year}W${String(weekNum).padStart(2, '0')}`;
  }

  return `${start}_to_${end}`;
}

export function generateReportingPeriods(referenceDate = new Date()) {
  const { weekStart, weekEnd } = getWeekRange(-1, referenceDate);

  const weekNumber = getWeekNumber(weekStart);
  const year = weekStart.getUTCFullYear();

  const weeks = [{
    weekNumber,
    year,
    weekLabel: `Week ${weekNumber}`,
    startDate: weekStart,
    endDate: weekEnd,
    dateRange: {
      start: formatDateString(weekStart),
      end: formatDateString(weekEnd),
    },
  }];

  return {
    weeks,
    referenceDate: referenceDate.toISOString(),
    columns: [`Week ${weekNumber}`],
  };
}

/* c8 ignore end */
