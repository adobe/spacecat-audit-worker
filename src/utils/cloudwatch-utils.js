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
 * @param {object} params - Query parameters
 * @param {string} params.siteUrl - Site URL for filtering logs
 * @param {object} context - Context with env and log
 * @param {number} searchStartTime - Search start timestamp (ms), buffer applied automatically
 * @returns {Promise<Array>} Array of bot protection events
 */
export async function queryBotProtectionLogs({ siteUrl }, context, searchStartTime) {
  const { env, log } = context;

  const cloudwatchClient = new CloudWatchLogsClient({
    region: env.AWS_REGION || 'us-east-1',
  });

  const logGroupName = env.CONTENT_SCRAPER_LOG_GROUP || CONTENT_SCRAPER_LOG_GROUP;
  const region = env.AWS_REGION || 'us-east-1';

  // Apply 5-minute buffer to handle clock skew and log delays
  const BUFFER_MS = 5 * 60 * 1000; // 5 minutes
  const startTime = searchStartTime - BUFFER_MS;
  const endTime = Date.now();

  /* c8 ignore next */
  log.info(`[CLOUDWATCH-QUERY] Querying log group: ${logGroupName}, region: ${region}, timeRange: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

  try {
    // Filter by [BOT-BLOCKED] in CloudWatch, then filter by siteUrl in memory
    const filterPattern = '"[BOT-BLOCKED]"';

    const command = new FilterLogEventsCommand({
      logGroupName,
      startTime,
      endTime,
      filterPattern,
      limit: 500, // Increased limit for sites with many URLs
    });

    const response = await cloudwatchClient.send(command);

    /* c8 ignore next */
    log.info(`[CLOUDWATCH-QUERY] CloudWatch returned ${response.events?.length || 0} raw events`);

    if (!response.events || response.events.length === 0) {
      return [];
    }

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

    /* c8 ignore next */
    log.info(`[CLOUDWATCH-QUERY] Parsed ${botProtectionEvents.length} bot protection events from CloudWatch`);

    // Extract base domain from siteUrl (e.g., "https://www.abbvie.com" -> "abbvie.com")
    const extractDomain = (url) => {
      try {
        const urlObj = new URL(url);
        // Remove www. prefix if present
        return urlObj.hostname.replace(/^www\./, '');
      /* c8 ignore start */
      } catch {
        return url;
      }
      /* c8 ignore stop */
    };

    const siteDomain = extractDomain(siteUrl.toLowerCase());
    /* c8 ignore next */
    log.info(`[CLOUDWATCH-QUERY] Filtering by domain: ${siteDomain}`);

    // Filter by domain - match if event URL contains the site domain
    const filteredEvents = botProtectionEvents.filter((event) => {
      const eventUrl = event.url?.toLowerCase();
      /* c8 ignore next */
      if (!eventUrl) return false;

      const eventDomain = extractDomain(eventUrl);
      const matches = eventDomain === siteDomain;

      /* c8 ignore start */
      if (!matches) {
        log.debug(`[CLOUDWATCH-QUERY] Event domain ${eventDomain} does not match site domain ${siteDomain}`);
      }
      /* c8 ignore stop */

      return matches;
    });

    /* c8 ignore next */
    log.info(`[CLOUDWATCH-QUERY] After filtering by siteUrl ${siteUrl}: ${filteredEvents.length} matching events`);

    return filteredEvents;
  } catch (error) {
    log.error(`Failed to query CloudWatch logs for bot protection (site ${siteUrl}):`, error);
    // Don't fail the entire audit run
    return [];
  }
}
