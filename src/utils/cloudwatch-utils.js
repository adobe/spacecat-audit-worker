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

import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

const CONTENT_SCRAPER_LOG_GROUP = '/aws/lambda/spacecat-services--content-scraper';

/**
 * Queries CloudWatch logs for bot protection errors from content scraper
 * Note: Applies a 5-minute buffer before searchStartTime to handle clock skew and log delays
 * @param {string} scrapeJobId - The scrape job ID for filtering logs
 * @param {object} context - Context with env and log
 * @param {number} searchStartTime - Search start timestamp (ms), buffer applied automatically
 * @returns {Promise<Array>} Array of bot protection events
 */
export async function queryBotProtectionLogs(scrapeJobId, context, searchStartTime) {
  const { env, log } = context;

  const cloudwatchClient = new CloudWatchLogsClient({
    region: env.AWS_REGION || 'us-east-1',
  });

  const logGroupName = env.CONTENT_SCRAPER_LOG_GROUP || CONTENT_SCRAPER_LOG_GROUP;

  // Apply 5-minute buffer to handle clock skew and log delays
  const BUFFER_MS = 5 * 60 * 1000; // 5 minutes
  const startTime = searchStartTime - BUFFER_MS;
  const endTime = Date.now();

  /* c8 ignore start */
  log.info('[BOT-CHECK] Querying CloudWatch logs:');
  log.info(`[BOT-CHECK]   Log Group: ${logGroupName}`);
  log.info(`[BOT-CHECK]   Scrape Job ID: ${scrapeJobId}`);
  log.info(`[BOT-CHECK]   Time Range: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
  log.info(`[BOT-CHECK]   Search Start Time (raw): ${new Date(searchStartTime).toISOString()}`);
  log.info('[BOT-CHECK]   Buffer Applied: 5 minutes');
  /* c8 ignore stop */

  log.debug(`Querying bot protection logs from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()} (5min buffer applied) for scrape job ${scrapeJobId}`);

  try {
    const filterPattern = `"[BOT-BLOCKED]" "${scrapeJobId}"`;

    /* c8 ignore start */
    log.info(`[BOT-CHECK] Filter Pattern: ${filterPattern}`);
    log.info('[BOT-CHECK] Sending CloudWatch query...');
    /* c8 ignore stop */

    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime,
      endTime,
      // Filter pattern to find bot protection logs for this site in the time window
      // Text pattern since logs have prefix: [BOT-BLOCKED] Bot Protection Detection in Scraper
      filterPattern,
      limit: 500, // Increased limit for sites with many URLs
    });

    const response = await cloudwatchClient.send(command);

    /* c8 ignore start */
    log.info(`[BOT-CHECK] CloudWatch query completed. Events found: ${response.events?.length || 0}`);
    /* c8 ignore stop */

    if (!response.events || response.events.length === 0) {
      /* c8 ignore start */
      log.info('[BOT-CHECK] No bot protection events found in CloudWatch response');
      /* c8 ignore stop */
      log.debug(`No bot protection logs found for scrape job ${scrapeJobId}`);
      return [];
    }

    /* c8 ignore start */
    log.info(`[BOT-CHECK] Raw CloudWatch events count: ${response.events.length}`);
    log.info(`[BOT-CHECK] Sample event message: ${response.events[0]?.message?.substring(0, 200)}`);
    /* c8 ignore stop */

    log.info(`Found ${response.events.length} bot protection events in CloudWatch logs for scrape job ${scrapeJobId}`);

    // Parse log events
    const botProtectionEvents = response.events
      .map((event) => {
        try {
          // CloudWatch log message format: "Bot Protection Detection in Scraper: { json }"
          const messageMatch = event.message.match(/Bot Protection Detection in Scraper:\s+({.*})/);
          if (messageMatch) {
            return JSON.parse(messageMatch[1]);
          }
          /* c8 ignore start */
          log.warn(`[BOT-CHECK] Event message did not match expected pattern: ${event.message?.substring(0, 100)}`);
          /* c8 ignore stop */
          return null;
        } catch (parseError) {
          log.warn(`Failed to parse bot protection log event: ${event.message}`);
          return null;
        }
      })
      .filter((event) => event !== null);

    /* c8 ignore start */
    log.info(`[BOT-CHECK] Successfully parsed ${botProtectionEvents.length} bot protection events`);
    /* c8 ignore stop */

    return botProtectionEvents;
  } catch (error) {
    log.error(`Failed to query CloudWatch logs for bot protection (scrape job ${scrapeJobId}):`, error);
    // Don't fail the entire audit run
    return [];
  }
}
