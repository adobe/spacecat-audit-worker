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

import { getObjectFromKey } from '../utils/s3-utils.js';
import { S3_BASE_PATH } from './constants.js';

export function formatDate(date) {
  return date.toISOString().split('T')[0];
}

export function subtractDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

function buildS3Key(dateStr) {
  return `${S3_BASE_PATH}/cwv-trends-daily-${dateStr}.json`;
}

/**
 * Reads CWV trend data from S3 for a given number of days ending on endDate.
 * Fetches all dates in parallel and skips missing ones gracefully.
 *
 * @param {object} s3Client - AWS S3 client
 * @param {string} bucketName - S3 bucket name
 * @param {Date} endDate - End date (inclusive)
 * @param {number} days - Number of days to read
 * @param {object} log - Logger instance
 * @returns {Promise<Array<{date: string, data: Array}>>} Daily data sorted chronologically
 */
export async function readTrendData(s3Client, bucketName, endDate, days, log) {
  const promises = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = subtractDays(endDate, i);
    const dateStr = formatDate(date);
    const key = buildS3Key(dateStr);

    promises.push(
      getObjectFromKey(s3Client, bucketName, key, log)
        .then((raw) => {
          let parsed = raw;
          if (typeof raw === 'string') {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
          }
          if (parsed && Array.isArray(parsed)) {
            return { date: dateStr, data: parsed };
          }
          log.warn(`Empty or invalid S3 data for date ${dateStr}`);
          return null;
        })
        .catch(() => {
          log.warn(`Missing S3 data for date ${dateStr}, skipping`);
          return null;
        }),
    );
  }

  const results = await Promise.all(promises);
  return results.filter(Boolean);
}
