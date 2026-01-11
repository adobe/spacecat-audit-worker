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

/**
 * Queries CloudWatch logs for bot protection events from content scraper.
 *
 * Uses audit creation time as the search start time because:
 * - When triggered during onboarding: audit is created after onboarding starts,
 *   then immediately calls content scraper, so audit creation time captures all scraper logs
 * - When triggered via "run audit" command: audit is created at command time,
 *   then immediately calls content scraper, so audit creation time captures all scraper logs
 *
 * @param {string} jobId - The scrape job ID
 * @param {object} context - Context with env and log
 * @param {number} searchStartTime - Timestamp (ms) to start searching logs from
 * @returns {Promise<Array>} Array of bot protection events
 */
export async function queryBotProtectionLogs(jobId, context, searchStartTime) {
  const { env, log } = context;

  const cloudwatchClient = new CloudWatchLogsClient({
    region: env.AWS_REGION || /* c8 ignore next */ 'us-east-1',
  });

  const logGroupName = env.CONTENT_SCRAPER_LOG_GROUP || '/aws/lambda/spacecat-services--content-scraper';

  // Query logs from search start time (audit creation or onboard start) to now
  const startTime = searchStartTime;
  const endTime = Date.now();

  log.debug(`Querying bot protection logs from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

  try {
    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime,
      endTime,
      // Filter pattern to find bot protection logs
      filterPattern: `{ $.jobId = "${jobId}" && $.errorCategory = "bot-protection" }`,
      limit: 100, // Max URLs per job
    });

    const response = await cloudwatchClient.send(command);

    if (!response.events || response.events.length === 0) {
      log.debug(`No bot protection logs found for job ${jobId}`);
      return [];
    }

    log.info(`Found ${response.events.length} bot protection events in CloudWatch logs`);

    // Parse log events
    const botProtectionEvents = response.events
      .map((event) => {
        try {
          // CloudWatch log message format: "Bot Protection Detection in Scraper: { json }"
          const messageMatch = event.message.match(/Bot Protection Detection in Scraper:\s+({.*})/);
          if (messageMatch) {
            return JSON.parse(messageMatch[1]);
          }
          return null;
        } catch (parseError) {
          log.warn(`Failed to parse bot protection log event: ${event.message}`);
          return null;
        }
      })
      .filter((event) => event !== null);

    return botProtectionEvents;
  } catch (error) {
    log.error('Failed to query CloudWatch logs for bot protection:', error);
    // Don't fail the entire audit run
    return [];
  }
}
