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
import { hasText } from '@adobe/spacecat-shared-utils';

const CONTENT_SCRAPER_LOG_GROUP = '/aws/lambda/spacecat-services--content-scraper';

/**
 * Queries CloudWatch logs for bot protection errors from content scraper
 * Note: Applies a 5-minute buffer before searchStartTime to handle clock skew and log delays
 * @param {object} params - Query parameters
 * @param {string} [params.jobId] - Scrape job ID for filtering logs (preferred, more precise)
 * @param {string} [params.siteUrl] - Site URL for filtering logs (fallback if no jobId)
 * @param {object} context - Context with env and log
 * @param {number} searchStartTime - Search start timestamp (ms), buffer applied automatically
 * @returns {Promise<Array>} Array of bot protection events
 */
export async function queryBotProtectionLogs({ jobId, siteUrl }, context, searchStartTime) {
  const { env, log } = context;

  const cloudwatchClient = new CloudWatchLogsClient({
    region: env.AWS_REGION || 'us-east-1',
  });

  const logGroupName = env.CONTENT_SCRAPER_LOG_GROUP || CONTENT_SCRAPER_LOG_GROUP;

  // Apply 5-minute buffer to handle clock skew and log delays
  const BUFFER_MS = 5 * 60 * 1000; // 5 minutes
  const startTime = searchStartTime - BUFFER_MS;
  const endTime = Date.now();

  // Prefer jobId for more precise filtering, fall back to siteUrl
  const useJobId = hasText(jobId);
  const filterBy = useJobId ? `jobId ${jobId}` : `site ${siteUrl}`;

  log.debug(`Querying bot protection logs from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()} (5min buffer applied) for ${filterBy}`);

  try {
    // If we have jobId, filter by both [BOT-BLOCKED] and jobId for precision
    // Otherwise, filter by [BOT-BLOCKED] only and filter by siteUrl in memory
    const filterPattern = useJobId ? `"[BOT-BLOCKED]" "${jobId}"` : '"[BOT-BLOCKED]"';

    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime,
      endTime,
      // Filter pattern to find bot protection logs in the time window
      // Text pattern since logs have prefix: [BOT-BLOCKED] Bot Protection Detection in Scraper
      filterPattern,
      limit: 500, // Increased limit for sites with many URLs
    });

    const response = await cloudwatchClient.send(command);

    if (!response.events || response.events.length === 0) {
      log.debug(`No bot protection logs found in time window for ${filterBy}`);
      return [];
    }

    log.info(`Found ${response.events.length} potential bot protection events in CloudWatch logs for ${filterBy}`);

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

    // If filtering by siteUrl (not jobId), apply additional URL filtering
    const filteredEvents = useJobId ? botProtectionEvents : botProtectionEvents.filter((event) => {
      // Filter by site URL - handle both with and without trailing slashes
      const eventUrl = event.url?.toLowerCase();
      const normalizedSiteUrl = siteUrl.toLowerCase().replace(/\/$/, '');
      return eventUrl && (
        eventUrl.startsWith(`${normalizedSiteUrl}/`)
        || eventUrl === normalizedSiteUrl
      );
    });

    log.info(`Found ${filteredEvents.length} bot protection events for ${filterBy} after filtering`);

    return filteredEvents;
  } catch (error) {
    log.error(`Failed to query CloudWatch logs for bot protection (${filterBy}):`, error);
    // Don't fail the entire audit run
    return [];
  }
}
