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

import { getObjectFromKey } from '../utils/s3-utils.js';
import { S3_BASE_PATH } from './constants.js';

// Maximum allowed JSON size: 15 MB (larger than typical 9-10 MB files)
const MAX_JSON_SIZE_BYTES = 15 * 1024 * 1024;

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
 * Validates JSON data size and structure.
 */
function validateJsonData(raw, dateStr, log) {
  // Parse if needed (before size check to ensure consistent validation)
  let parsed = raw;
  if (typeof raw === 'string') {
    // Check size of string first
    const sizeBytes = Buffer.byteLength(raw, 'utf8');
    if (sizeBytes > MAX_JSON_SIZE_BYTES) {
      log.warn(`JSON data for ${dateStr} exceeds size limit: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);
      return null;
    }

    try {
      parsed = JSON.parse(raw);
    } catch {
      log.warn(`Failed to parse JSON for date ${dateStr}`);
      return null;
    }
  } else {
    // For already-parsed objects, check serialized size
    const serialized = JSON.stringify(raw);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');
    if (sizeBytes > MAX_JSON_SIZE_BYTES) {
      log.warn(`JSON data for ${dateStr} exceeds size limit: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);
      return null;
    }
  }

  // Validate structure
  if (!parsed || !Array.isArray(parsed)) {
    log.warn(`Invalid JSON structure for date ${dateStr}: expected array`);
    return null;
  }

  return parsed;
}

/**
 * Reads CWV trend data from S3 for a given number of days ending on endDate.
 * Fetches all dates in parallel and skips missing ones gracefully.
 * Validates JSON size and structure.
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
          const parsed = validateJsonData(raw, dateStr, log);
          if (parsed) {
            return { date: dateStr, data: parsed };
          }
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
