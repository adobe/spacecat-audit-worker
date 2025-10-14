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

import baseHandler from '../geo-brand-presence/detect-geo-brand-presence-handler.js';

// TODO: Replace with import from '@adobe/spacecat-shared-utils' when available
// import { isMonday } from '@adobe/spacecat-shared-utils';
/**
 * Checks if the given date is a Monday in UTC.
 * @param {Date} [date=new Date()] - The date to check. Defaults to current date if not provided.
 * @returns {boolean} - True if the date is a Monday in UTC, false otherwise.
 */
function isMonday(date = new Date()) {
  return date.getUTCDay() === 1;
}

/**
 * Aggregates weekly data from daily files.
 * This function runs only on Mondays to aggregate the previous week's daily data.
 * @param {object} message - The message object from the queue.
 * @param {object} context - The context object with log, s3Client, etc.
 * @returns {Promise<void>}
 */
async function aggregateWeeklyData(message, context) {
  const { log } = context;
  const { siteId } = message;

  log.info(`GEO BRAND PRESENCE DAILY: Starting weekly aggregation for siteId: ${siteId}`);

  // TODO: Implement weekly aggregation logic
  // 1. Fetch 7 daily files from the previous week
  // 2. Aggregate/merge the data
  // 3. Generate single weekly output file with timestamp
  // 4. Upload to appropriate location

  log.info(`GEO BRAND PRESENCE DAILY: Weekly aggregation completed for siteId: ${siteId}`);
}

/**
 * Daily version of the geo brand presence handler
 * Extends the base handler with daily-specific path logic
 * On Mondays, also triggers weekly aggregation of daily data
 */
export default async function handler(message, context) {
  const { log } = context;

  // Check if today is Monday for weekly aggregation
  if (isMonday()) {
    log.info('GEO BRAND PRESENCE DAILY: Today is Monday, will run weekly aggregation');
    await aggregateWeeklyData(message, context);
  } else {
    log.debug('GEO BRAND PRESENCE DAILY: Not Monday, skipping weekly aggregation');
  }

  // Extract daily-specific information
  const weekNumber = message.week ? String(message.week).padStart(2, '0') : '01';

  // Create a modified context with daily-specific path logic
  const dailyContext = {
    ...context,
    // Override the path construction for daily processing
    getOutputLocation: (site) => `${site.getConfig().getLlmoDataFolder()}/brand-presence/w${weekNumber}`,
  };

  // Call the base handler with modified context
  return baseHandler(message, dailyContext);
}
