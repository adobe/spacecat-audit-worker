/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { CWV_THRESHOLDS, MIN_PAGEVIEWS } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncOpportunitiesAndSuggestions } from './opportunity-sync.js';
import { TREND_DAYS, S3_BASE_PATH } from './constants.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

/**
 * Reads CWV data from S3 for a 28-day period
 * @param {object} s3Client - AWS S3 client
 * @param {string} bucketName - S3 bucket name
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {object} log - Logger instance
 * @returns {Promise<Array>} Array of daily data objects
 * @throws {Error} If any S3 files are missing
 */
async function readCwvDataFromS3(s3Client, bucketName, startDate, endDate, log) {
  const cwvData = [];
  const missingDates = [];

  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const s3Key = `${S3_BASE_PATH}/cwv-trends-daily-${dateStr}/cwv-trends-daily-${dateStr}.json`;

    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      });
      const response = await s3Client.send(command);
      const bodyString = await response.Body.transformToString();
      const data = JSON.parse(bodyString);

      cwvData.push({ date: dateStr, urls: data });
      log.info(`Successfully read S3 data for ${dateStr}: ${data.length} URLs`);
    } catch (error) {
      log.error(`Missing S3 file for ${dateStr}: ${s3Key}`, { error: error.message });
      missingDates.push(dateStr);
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Fail if any dates are missing
  if (missingDates.length > 0) {
    const errorMsg = `CWV Trends Audit failed: Missing S3 data for ${missingDates.length} days: ${missingDates.join(', ')}`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  return cwvData;
}

/**
 * Filters URLs by device type and pageviews threshold
 * @param {Array} urls - Array of URL entries with metrics
 * @param {string} deviceType - Device type (mobile or desktop)
 * @param {object} log - Logger instance
 * @returns {Array} Filtered and sorted URL entries
 */
function filterUrlsByDevice(urls, deviceType, log) {
  return urls
    .map((urlEntry) => {
      // Find metrics for the specified device type
      const metrics = urlEntry.metrics?.find((m) => m.deviceType === deviceType);

      if (!metrics) {
        return null; // No data for this device type
      }

      // Skip if below pageview threshold
      if (metrics.pageviews < MIN_PAGEVIEWS) {
        return null;
      }

      // Skip "undefined" device type
      if (deviceType === 'undefined') {
        log.warn(`Skipping URL with undefined device type: ${urlEntry.url}`);
        return null;
      }

      // Flatten metrics to top level
      return {
        url: urlEntry.url,
        pageviews: metrics.pageviews,
        bounceRate: metrics.bounceRate,
        engagement: metrics.engagement,
        clickRate: metrics.clickRate,
        lcp: metrics.lcp,
        cls: metrics.cls,
        inp: metrics.inp,
        ttfb: metrics.ttfb,
      };
    })
    .filter((entry) => entry !== null) // Remove nulls
    .sort((a, b) => b.pageviews - a.pageviews); // Sort by pageviews descending
}

/**
 * Categorizes a URL based on CWV metrics
 * @param {number} lcp - Largest Contentful Paint (ms)
 * @param {number} cls - Cumulative Layout Shift (score)
 * @param {number} inp - Interaction to Next Paint (ms)
 * @returns {string|null} Category: 'good', 'needs-improvement', 'poor', or null if insufficient data
 */
function categorizeCwv(lcp, cls, inp) {
  // Handle null metrics
  if (lcp === null || cls === null || inp === null) {
    return null; // Insufficient data
  }

  const isGood = lcp <= CWV_THRESHOLDS.LCP.GOOD
    && cls <= CWV_THRESHOLDS.CLS.GOOD
    && inp <= CWV_THRESHOLDS.INP.GOOD;

  const isPoor = lcp > CWV_THRESHOLDS.LCP.POOR
    || cls > CWV_THRESHOLDS.CLS.POOR
    || inp > CWV_THRESHOLDS.INP.POOR;

  if (isGood) return 'good';
  if (isPoor) return 'poor';
  return 'needs-improvement';
}

/**
 * Calculates percentage distribution of CWV categories for a set of URLs
 * @param {Array} urls - Array of URL entries with CWV metrics
 * @returns {object} Object with good, needsImprovement, poor percentages
 */
function calculateDailyPercentages(urls) {
  const categorized = urls
    .map((url) => categorizeCwv(url.lcp, url.cls, url.inp))
    .filter((cat) => cat !== null); // Remove entries with insufficient data

  const total = categorized.length;
  if (total === 0) {
    return { good: 0, needsImprovement: 0, poor: 0 };
  }

  const counts = { good: 0, 'needs-improvement': 0, poor: 0 };
  categorized.forEach((cat) => {
    counts[cat] += 1;
  });

  return {
    good: (counts.good / total) * 100,
    needsImprovement: (counts['needs-improvement'] / total) * 100,
    poor: (counts.poor / total) * 100,
  };
}

/**
 * Generates audit result with trend data and urlDetails
 * @param {Array} dailyData - Array of daily data with filtered URLs
 * @param {string} deviceType - Device type (mobile or desktop)
 * @returns {object} Audit result object
 */
function generateAuditResult(dailyData, deviceType) {
  // Build trendData (28 entries with date + percentages)
  const trendData = dailyData.map((day) => ({
    date: day.date,
    ...calculateDailyPercentages(day.urls),
  }));

  // Calculate summary
  const summary = {
    totalUrls: dailyData[dailyData.length - 1].urls.length, // Latest day
    avgGood: trendData.reduce((sum, d) => sum + d.good, 0) / trendData.length,
    avgNeedsImprovement: trendData.reduce((sum, d) => sum + d.needsImprovement, 0) / trendData.length,
    avgPoor: trendData.reduce((sum, d) => sum + d.poor, 0) / trendData.length,
  };

  // Build urlDetails (flat structure, latest day only)
  const urlDetails = dailyData[dailyData.length - 1].urls.map((url) => ({
    url: url.url,
    pageviews: url.pageviews,
    bounceRate: url.bounceRate * 100, // Convert to percentage
    engagement: url.engagement * 100,
    clickRate: url.clickRate * 100,
    lcp: url.lcp,
    cls: url.cls,
    inp: url.inp,
    ttfb: url.ttfb,
  }));

  return {
    deviceType,
    trendData,
    summary,
    urlDetails,
  };
}

/**
 * Step 1: Collect CWV Trends Data
 * Reads 28 days of S3 data, calculates trends, and persists audit result
 * @param {object} context - Context object containing site, log, s3Client, env
 * @returns {Promise<object>} Object containing auditResult and fullAuditRef
 */
export async function collectTrendData(context) {
  const {
    site, log, s3Client, env, auditContext,
  } = context;
  const siteId = site.getId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  // Get device type from audit context (passed by scheduler)
  const deviceType = auditContext?.deviceType || 'mobile'; // Default to mobile

  log.info(`[cwv-trends-audit] siteId: ${siteId} | device: ${deviceType} | Step 1: Collecting trend data`);

  // Calculate date range (28 days)
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (TREND_DAYS - 1)); // 28 days total including today

  // Read S3 data (will throw if any files missing)
  const rawData = await readCwvDataFromS3(s3Client, bucketName, startDate, endDate, log);

  // Process data for each day
  const dailyData = rawData.map((day) => ({
    date: day.date,
    urls: filterUrlsByDevice(day.urls, deviceType, log),
  }));

  // Generate audit result
  const auditResult = generateAuditResult(dailyData, deviceType);

  log.info(`[cwv-trends-audit] Processed ${auditResult.urlDetails.length} URLs for device: ${deviceType}`);

  return {
    auditResult,
    fullAuditRef: S3_BASE_PATH,
  };
}

/**
 * Step 2: Sync Opportunities and Suggestions
 * Creates/updates device-specific opportunity and syncs suggestions
 * @param {object} context - Context object containing site, audit, log, dataAccess
 * @returns {Promise<object>} Status object with 'complete' status
 */
export async function syncOpportunityAndSuggestionsStep(context) {
  const { site, log } = context;
  const siteId = site.getId();

  log.info(`[cwv-trends-audit] siteId: ${siteId} | Step 2: Syncing opportunities and suggestions`);

  await syncOpportunitiesAndSuggestions(context);

  return {
    status: 'complete',
  };
}

export default new AuditBuilder()
  .addStep('collectTrendData', collectTrendData, AUDIT_STEP_DESTINATIONS.DEFAULT)
  .addStep('syncOpportunityAndSuggestions', syncOpportunityAndSuggestionsStep)
  .build();
