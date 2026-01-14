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

import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { resolveConsolidatedBucketName, extractCustomerDomain } from './cdn-utils.js';
import { generateReportingPeriods } from '../cdn-logs-report/utils/report-utils.js';
import { weeklyBreakdownQueries } from '../cdn-logs-report/utils/query-builder.js';

const DEFAULT_TOP_AGENTIC_URLS_LIMIT = 200;

/**
 * Builds S3 config for Athena queries.
 * @param {Object} site - Site object
 * @param {Object} context - Context with env
 * @returns {Promise<Object>} S3 config object
 */
async function getS3Config(site, context) {
  const customerDomain = extractCustomerDomain(site);
  const domainParts = customerDomain.split(/[._]/);
  const customerName = domainParts[0] === 'www' && domainParts.length > 1 ? domainParts[1] : domainParts[0];
  const bucket = resolveConsolidatedBucketName(context);

  return {
    bucket,
    customerName,
    customerDomain,
    databaseName: `cdn_logs_${customerDomain}`,
    tableName: `aggregated_logs_${customerDomain}_consolidated`,
    getAthenaTempLocation: () => `s3://${bucket}/temp/athena-results/`,
  };
}

/**
 * Fetch top Agentic URLs using Athena.
 * Find last week's top agentic URLs, filters out pooled 'Other',
 * groups by URL, and returns the top URLs by total hits.
 * @param {Object} site - Site object
 * @param {Object} context - Context with log, env, etc.
 * @param {number} limit - Maximum number of URLs to return
 * @returns {Promise<Array<string>>} Array of top agentic URLs
 */
export async function getTopAgenticUrlsFromAthena(
  site,
  context,
  limit = DEFAULT_TOP_AGENTIC_URLS_LIMIT,
) {
  const { log } = context;
  // Use finalUrl from context if available (it's a hostname, so add https://),
  // otherwise fall back to site.getBaseURL() which already includes the protocol
  const baseUrl = context.finalUrl
    ? `https://${context.finalUrl}`
    : site.getBaseURL();
  try {
    const s3Config = await getS3Config(site, context);
    const periods = generateReportingPeriods();
    const recentWeeks = periods.weeks;
    const oneWeekPeriods = { weeks: [recentWeeks[0]] };
    const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());
    const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit({
      periods: oneWeekPeriods,
      databaseName: s3Config.databaseName,
      tableName: s3Config.tableName,
      site,
      limit,
    });
    log.info(`Agentic URLs - Executing Athena query for top agentic URLs... baseUrl=${baseUrl}`);
    const results = await athenaClient.query(
      query,
      s3Config.databaseName,
      '[Athena Query] Top Agentic URLs',
    );

    if (!Array.isArray(results) || results.length === 0) {
      log.warn(`Agentic URLs - Athena returned no agentic rows. baseUrl=${baseUrl}`);
      return [];
    }

    // Validate baseUrl before constructing URLs
    let resolvedBaseUrl = baseUrl;
    try {
      // eslint-disable-next-line no-new
      new URL(baseUrl);
    } catch {
      log.warn(`Agentic URLs - Invalid baseUrl: ${baseUrl}, cannot construct absolute URLs`);
      resolvedBaseUrl = null;
    }

    const topUrls = results
      .filter((row) => typeof row?.url === 'string' && row.url.length > 0)
      .map((row) => {
        const path = row.url;
        // If path is already an absolute URL, return it as-is
        if (path.startsWith('http://') || path.startsWith('https://')) {
          return path;
        }
        // If we have a valid base URL, construct the full URL
        if (resolvedBaseUrl) {
          return new URL(path, resolvedBaseUrl).toString();
        }
        // No valid base URL, return null to filter out
        return null;
      })
      .filter((url) => url !== null);

    log.info(`Agentic URLs - Selected ${topUrls.length} top agentic URLs via Athena. baseUrl=${baseUrl}`);
    log.info(`Agentic URLs - Top URLs: ${topUrls.join(', ')}`);
    return topUrls;
  } catch (e) {
    log?.warn?.(`Agentic URLs - Athena agentic URL fetch failed: ${e.message}. baseUrl=${baseUrl}`);
    return [];
  }
}
