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

import {
  AWSAthenaClient,
  getTop3PagesWithTrafficLostTemplate,
} from '@adobe/spacecat-shared-athena-client';
import {
  startOfWeek,
  subWeeks,
  getYear,
  getISOWeek,
} from 'date-fns';

/**
 * Helper class for traffic analysis operations
 */
export class TrafficTools {
  /**
   * Creates a new Traffic Tools instance
   * @param {Object} context - The context object with env and log
   */
  constructor(context) {
    this.context = context;
    this.env = context.env;
    this.log = context.log;
  }

  /**
   * Generates temporal condition for the last 4 weeks (current week and previous 3)
   * @returns {string} SQL temporal condition string
   */
  // eslint-disable-next-line class-methods-use-this
  generateTemporalCondition() {
    const today = new Date();
    const conditions = [];

    // Get current week and previous 3 weeks (total 4 weeks)
    for (let weekOffset = 0; weekOffset < 4; weekOffset += 1) {
      const weekStart = subWeeks(startOfWeek(today, { weekStartsOn: 1 }), weekOffset);
      const week = getISOWeek(weekStart);
      const year = getYear(weekStart);
      conditions.push(`(week=${week} AND year=${year})`);
    }

    return conditions.join(' OR ');
  }

  /**
   * Fetches traffic data from Athena
   * @param {string} siteId - Site ID
   * @param {string} temporalCondition - SQL temporal condition
   * @returns {Promise<Array>} Query results
   */
  async fetchTrafficData(siteId, temporalCondition) {
    const {
      RUM_METRICS_DATABASE: rumMetricsDatabase = 'rum_metrics',
      RUM_METRICS_COMPACT_TABLE: rumMetricsCompactTable = 'compact_metrics',
      S3_IMPORTER_BUCKET_NAME: bucketName,
    } = this.env;

    if (!bucketName) {
      throw new Error('S3_IMPORTER_BUCKET_NAME must be provided for traffic tools');
    }

    const tableName = `${rumMetricsDatabase}.${rumMetricsCompactTable}`;
    const athenaTemp = `s3://${bucketName}/rum-metrics-compact/temp/out`;
    const dimensions = ['trf_type', 'path'];

    const dimensionColumns = dimensions.join(', ');
    const dimensionColumnsPrefixed = dimensions.map((col) => `a.${col}`).join(', ');

    const query = getTop3PagesWithTrafficLostTemplate({
      siteId,
      tableName,
      temporalCondition,
      dimensionColumns,
      groupBy: dimensionColumns,
      dimensionColumnsPrefixed,
      pageViewThreshold: 1000,
      limit: null,
    });

    const description = `fetch traffic data for siteId: ${siteId} | temporalCondition: ${temporalCondition}`;

    this.log?.debug(`Traffic Tools Query: ${query}`);
    const resultLocation = `${athenaTemp}/traffic-tools/${siteId}-${Date.now()}`;
    const athenaClient = AWSAthenaClient.fromContext(this.context, resultLocation);

    const results = await athenaClient.query(query, rumMetricsDatabase, description);
    return results;
  }

  /**
   * Calculates predominant traffic type for a URL based on pageview percentages
   * @param {Object} trafficBreakdown - Traffic percentages by type
   * @param {number} trafficBreakdown.paid - Paid traffic percentage
   * @param {number} trafficBreakdown.earned - Earned traffic percentage
   * @param {number} trafficBreakdown.owned - Owned traffic percentage
   * @param {number} percentageThreshold - Threshold for determining predominance
   * @returns {string} Predominant traffic type: 'paid', 'earned', 'owned', or 'mixed'
   */
  // eslint-disable-next-line class-methods-use-this
  calculatePredominantTraffic(trafficBreakdown, percentageThreshold) {
    const { paid = 0, earned = 0, owned = 0 } = trafficBreakdown;

    // Check if any single traffic type meets or exceeds the threshold
    if (paid >= percentageThreshold) return 'paid';
    if (earned >= percentageThreshold) return 'earned';
    if (owned >= percentageThreshold) return 'owned';

    return 'mixed';
  }

  /**
   * Determines the predominant traffic type for given URLs
   * @param {Array<string>} urls - Array of URLs to analyze
   * @param {string} siteId - Site ID
   * @param {number} percentageThreshold - Threshold percentage for determining predominance
   * @returns {Promise<Object>} Dictionary with URL as key and traffic analysis as value
   */
  async determinePredominantTraffic(urls, siteId, percentageThreshold) {
    if (!Array.isArray(urls) || urls.length === 0) {
      return {};
    }

    // Generate temporal condition for last 4 weeks
    const temporalCondition = this.generateTemporalCondition();

    this.log?.info(`Determining predominant traffic for ${urls.length} URLs with threshold ${percentageThreshold}%`);

    // Fetch traffic data from Athena
    const rawResults = await this.fetchTrafficData(siteId, temporalCondition);

    // Create a map to organize data by path
    const pathTrafficMap = new Map();

    rawResults.forEach((row) => {
      const { path, trf_type: trfType, pageviews: pageviewsStr } = row;
      const pageviews = Number.parseInt(pageviewsStr || '0', 10);

      if (!pathTrafficMap.has(path)) {
        pathTrafficMap.set(path, {
          paid: 0,
          earned: 0,
          owned: 0,
          total: 0,
        });
      }

      const pathData = pathTrafficMap.get(path);
      if (trfType === 'paid' || trfType === 'earned' || trfType === 'owned') {
        pathData[trfType] = pageviews;
        pathData.total += pageviews;
      }
    });

    // Build result dictionary
    const result = {};

    urls.forEach((url) => {
      // Extract path from URL
      let path;
      try {
        const urlObj = new URL(url);
        path = urlObj.pathname;
      } catch {
        // If URL is malformed, treat it as a path
        path = url.startsWith('/') ? url : `/${url}`;
      }

      this.log?.debug(`Searching Path: '${path}' in traffic data.`);
      const trafficData = pathTrafficMap.get(path);

      if (!trafficData || trafficData.total === 0) {
        this.log?.debug(`No traffic data found for path: '${path}'`);
        // No traffic data found for this URL
        result[url] = {
          predominantTraffic: 'no traffic',
          details: {
            paid: 0,
            earned: 0,
            owned: 0,
          },
        };
      } else {
        // Calculate percentages
        const details = {
          paid: (trafficData.paid / trafficData.total) * 100,
          earned: (trafficData.earned / trafficData.total) * 100,
          owned: (trafficData.owned / trafficData.total) * 100,
        };

        const predominantTraffic = this.calculatePredominantTraffic(details, percentageThreshold);

        result[url] = {
          predominantTraffic,
          details,
        };
      }
    });

    this.log?.info(`Predominant traffic analysis complete for ${urls.length} URLs`);

    return result;
  }
}
