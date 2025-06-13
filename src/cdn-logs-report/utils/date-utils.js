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

const padNumber = (num, size = 2) => String(num).padStart(size, '0');
const getDateOnly = (date) => date.toISOString().split('T')[0];

export function getISOWeekNumber(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || TIME_CONSTANTS.DAYS_PER_WEEK));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const daysDiff = ((d - yearStart) / TIME_CONSTANTS.MILLISECONDS_PER_DAY) + 1;
  return Math.ceil(daysDiff / TIME_CONSTANTS.DAYS_PER_WEEK);
}

/**
 * Get week date range (start and end) for a given ISO week
 */
export function getWeekDateRange(year, weekNumber) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));

  const weekStart = new Date(firstMonday);
  const daysOffset = (weekNumber - 1) * TIME_CONSTANTS.DAYS_PER_WEEK;
  weekStart.setUTCDate(firstMonday.getUTCDate() + daysOffset);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

/**
 * Get week range with flexible offset from reference date
 * @param {number} offsetWeeks - Number of weeks to offset (negative for past, positive for future)
 * @param {Date} referenceDate - Reference date (defaults to current date)
 */
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

function parseAndValidateDate(dateInput, isEndDate = false) {
  if (!dateInput) {
    throw new Error(ERROR_MESSAGES.DATE_INPUT_REQUIRED);
  }

  let date;
  if (typeof dateInput === 'string') {
    date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      throw new Error(ERROR_MESSAGES.DATE_FORMAT_ERROR);
    }
    // Handle date-only strings
    if (dateInput.length === 10) {
      const hours = isEndDate ? 23 : 0;
      const minutes = isEndDate ? 59 : 0;
      const seconds = isEndDate ? 59 : 0;
      const milliseconds = isEndDate ? 999 : 0;
      date.setUTCHours(hours, minutes, seconds, milliseconds);
    }
  } else {
    date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      throw new Error(ERROR_MESSAGES.DATE_FORMAT_ERROR);
    }
  }

  return date;
}

/**
 * Create and validate date range from various input types
 */
export function createDateRange(startInput, endInput) {
  const startDate = parseAndValidateDate(startInput, false);
  const endDate = parseAndValidateDate(endInput, true);

  if (startDate >= endDate) {
    throw new Error(ERROR_MESSAGES.START_BEFORE_END);
  }

  return { startDate, endDate };
}

function calculateWeekPeriods(count, referenceDate) {
  const refDate = new Date(referenceDate);
  const currentWeek = getISOWeekNumber(refDate);
  const currentYear = refDate.getUTCFullYear();
  const periods = [];

  for (let i = count - 1; i >= 0; i -= 1) {
    let weekNum = currentWeek - i;
    let year = currentYear;

    if (weekNum <= 0) {
      year = currentYear - 1;
      const lastWeekPrevYear = getISOWeekNumber(new Date(Date.UTC(year, 11, 31)));
      weekNum = lastWeekPrevYear + weekNum;
    }

    const { weekStart, weekEnd } = getWeekDateRange(year, weekNum);
    periods.push({
      weekNumber: weekNum,
      year,
      weekLabel: `Week ${weekNum}`,
      startDate: weekStart,
      endDate: weekEnd,
      dateRange: {
        start: getDateOnly(weekStart),
        end: getDateOnly(weekEnd),
      },
    });
  }

  return periods;
}

function calculateDayPeriods(count, referenceDate) {
  const endDate = new Date(referenceDate);
  endDate.setUTCHours(23, 59, 59, 999);

  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - (count - 1));
  startDate.setUTCHours(0, 0, 0, 0);

  return [{
    startDate,
    endDate,
    dateRange: {
      start: getDateOnly(startDate),
      end: getDateOnly(endDate),
    },
    label: `Last ${count}d`,
  }];
}

/**
 * Calculate periods (weeks or days) from reference date
 * @param {string} type - 'weeks' or 'days'
 * @param {number} count - Number of periods to calculate
 * @param {Date} referenceDate - Reference date (defaults to current date)
 */
export function calculatePeriods(type, count, referenceDate = new Date()) {
  const refDate = new Date(referenceDate);

  switch (type) {
    case 'weeks':
      return calculateWeekPeriods(count, refDate);
    case 'days':
      return calculateDayPeriods(count, refDate);
    default:
      throw new Error(ERROR_MESSAGES.UNSUPPORTED_PERIOD_TYPE);
  }
}

/**
 * Generate period identifier string
 */
export function generatePeriodIdentifier(startDate, endDate) {
  const start = getDateOnly(startDate);
  const end = getDateOnly(endDate);

  const diffDays = Math.ceil((endDate - startDate) / TIME_CONSTANTS.MILLISECONDS_PER_DAY);
  if (diffDays === TIME_CONSTANTS.DAYS_PER_WEEK) {
    const year = startDate.getUTCFullYear();
    const weekNum = Math.ceil(startDate.getUTCDate() / TIME_CONSTANTS.DAYS_PER_WEEK);
    return `${year}W${padNumber(weekNum)}`;
  }

  return `${start}_to_${end}`;
}

/**
 * Generate standard reporting periods (last 4 weeks + last 30 days)
 */
export function generateReportingPeriods(referenceDate = new Date()) {
  const weeks = calculatePeriods('weeks', 4, referenceDate);
  const [last30Days] = calculatePeriods('days', 30, referenceDate);

  return {
    weeks,
    last30Days,
    referenceDate: referenceDate.toISOString(),
    columns: [
      ...weeks.map((week) => week.weekLabel),
      last30Days.label,
    ],
  };
}

/* c8 ignore end */
