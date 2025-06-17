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

/**
 * returns the Date object for the previous full hour
 * @param {Date} [now] - reference date; defaults to current time
 */
export function getPreviousHour(now = new Date()) {
  return new Date(now.getTime() - 60 * 60 * 1000);
}

/**
 * extracts padded UTC year, month, day, hour strings from a Date
 * @param {Date} date
 * @returns {{year:string,month:string,day:string,hour:string}}
 */
export function getHourParts(date) {
  const year = date.getUTCFullYear().toString();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return {
    year, month, day, hour,
  };
}

/**
 * builds Athena WHERE clause for year/month/day/hour partitions
 * @param {{year:string,month:string,day:string,hour:string}} parts
 */
export function buildPartitionFilter(parts) {
  const {
    year, month, day, hour,
  } = parts;
  return `WHERE year='${year}' AND month='${month}' AND day='${day}' AND hour='${hour}'`;
}

/**
 * formats an S3 prefix path for a given base and hour parts
 * @param {string} base - e.g., 'raw' or 'aggregated'
 * @param {{year:string,month:string,day:string,hour:string}} parts
 */
export function formatS3Prefix(base, parts) {
  const {
    year, month, day, hour,
  } = parts;
  return `${base}/${year}/${month}/${day}/${hour}/`;
}
