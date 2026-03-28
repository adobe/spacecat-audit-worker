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

import {
  MIN_PAGEVIEWS, TREND_DAYS, S3_BASE_PATH,
  DEVICE_TYPES, AUDIT_TYPE,
} from './constants.js';
import { readTrendData, formatDate, subtractDays } from './data-reader.js';
import { categorizeUrl } from './cwv-categorizer.js';

/**
 * Validates a URL string for basic sanity.
 */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Filters URLs by device type and minimum pageviews.
 */
function filterUrls(urlEntries, deviceType, log) {
  return urlEntries
    .map((entry) => {
      // Validate URL
      if (!isValidUrl(entry.url)) {
        log.warn(`Skipping invalid URL: ${entry.url}`);
        return null;
      }

      const metrics = entry.metrics?.find((m) => m.deviceType === deviceType);
      if (!metrics) return null;
      if (metrics.pageviews < MIN_PAGEVIEWS) return null;

      return {
        url: entry.url,
        pageviews: metrics.pageviews,
        bounceRate: metrics.bounceRate,
        engagement: metrics.engagement,
        clickRate: metrics.clickRate,
        lcp: metrics.lcp,
        cls: metrics.cls,
        inp: metrics.inp,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.pageviews - a.pageviews);
}

/**
 * Builds trend data: per-day counts of good/needsImprovement/poor URLs.
 * Returns both trendData and a cache of filtered URLs per day for performance.
 */
function buildTrendData(dailyData, deviceType, log) {
  const filteredCache = new Map();
  const trendData = dailyData.map((day) => {
    const urls = filterUrls(day.data, deviceType, log);
    filteredCache.set(day.date, urls);

    let good = 0;
    let needsImprovement = 0;
    let poor = 0;

    for (const url of urls) {
      const category = categorizeUrl(url.lcp, url.cls, url.inp) || 'good';
      if (category === 'good') good += 1;
      else if (category === 'needsImprovement') needsImprovement += 1;
      else if (category === 'poor') poor += 1;
    }

    return {
      date: day.date, good, needsImprovement, poor,
    };
  });

  return { trendData, filteredCache };
}

function pctChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

/**
 * Builds summary comparing current day vs 7 days before (point-to-point comparison).
 * Current = value on the most recent day
 * Previous = value 7 days before the most recent day
 */
function buildSummary(trendData, totalUrls) {
  const len = trendData.length;

  // Point-to-point comparison: last day vs 7 days before
  const currentDay = trendData[len - 1];
  const previousDay = len >= 8 ? trendData[len - 8] : trendData[0];

  const makeStat = (category) => {
    const current = currentDay[category];
    const previous = previousDay[category];
    const change = current - previous;
    return {
      current,
      previous,
      change,
      percentageChange: pctChange(current, previous),
      status: category,
    };
  };

  return {
    good: makeStat('good'),
    needsImprovement: makeStat('needsImprovement'),
    poor: makeStat('poor'),
    totalUrls,
  };
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Builds urlDetails from the most recent date's data,
 * with change values computed as point-to-point (current day vs 7 days before).
 * Uses cached filtered URLs for performance.
 */
function buildUrlDetails(dailyData, filteredCache, deviceType, log) {
  const len = dailyData.length;
  const latestDay = dailyData[len - 1];
  const latestUrls = filteredCache.get(latestDay.date)
  /* c8 ignore next */ || filterUrls(latestDay.data, deviceType, log);

  // Point-to-point comparison: current day vs 7 days before
  const previousDayIndex = len >= 8 ? len - 8 : 0;
  const previousDay = dailyData[previousDayIndex];
  const previousUrls = filteredCache.get(previousDay.date)
  /* c8 ignore next */ || filterUrls(previousDay.data, deviceType, log);

  const fields = ['pageviews', 'lcp', 'cls', 'inp', 'bounceRate', 'engagement', 'clickRate'];
  const pctFields = new Set(['bounceRate', 'engagement', 'clickRate']);

  const previousUrlMap = new Map(previousUrls.map((u) => [u.url, u]));

  return latestUrls.map((url, index) => {
    const detail = {
      id: String(index + 1),
      url: url.url,
      status: categorizeUrl(url.lcp, url.cls, url.inp) || 'good',
    };

    const prevUrl = previousUrlMap.get(url.url);
    for (const field of fields) {
      const rawValue = url[field];
      const previousValue = prevUrl?.[field] ?? null;

      if (pctFields.has(field)) {
        detail[field] = rawValue != null ? round(rawValue * 100, 1) : 0;
        detail[`${field}Change`] = (rawValue != null && previousValue != null)
          ? round((rawValue - previousValue) * 100, 1)
          : 0;
      } else {
        detail[field] = rawValue != null ? round(rawValue, 3) : 0;
        detail[`${field}Change`] = (rawValue != null && previousValue != null)
          ? round(rawValue - previousValue, 3)
          : 0;
      }
    }

    return detail;
  });
}

/**
 * Builds the audit result for a single device type from the daily data.
 */
function buildDeviceResult(dailyData, domain, deviceType, startDate, endDate, log) {
  const { trendData, filteredCache } = buildTrendData(dailyData, deviceType, log);
  const latestDay = dailyData[dailyData.length - 1];
  const latestUrls = filteredCache.get(latestDay.date);
  const totalUrls = latestUrls.length;
  const summary = buildSummary(trendData, totalUrls);
  const urlDetails = buildUrlDetails(dailyData, filteredCache, deviceType, log);

  log.info(`[${AUDIT_TYPE}] device: ${deviceType} | Processed ${totalUrls} URLs`);

  return {
    metadata: {
      domain,
      deviceType,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
    },
    trendData,
    summary,
    urlDetails,
  };
}

/**
 * Parses a date string (YYYY-MM-DD) or returns the current date if invalid.
 * Exported for testing.
 */
export function parseEndDate(dateString, log) {
  if (!dateString || typeof dateString !== 'string') {
    return new Date();
  }

  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    log?.warn(`[${AUDIT_TYPE}] Invalid endDate format "${dateString}", using current date`);
    return new Date();
  }

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (Number.isNaN(date.getTime())) {
    log?.warn(`[${AUDIT_TYPE}] Invalid endDate "${dateString}", using current date`);
    return new Date();
  }

  return date;
}

/**
 * CWV Trends audit runner.
 * Processes both mobile and desktop device types from the same S3 data.
 * Returns auditResult as an array of per-device results so that the
 * opportunity handler can create one opportunity per device type.
 * Requires minimum 28 days of data.
 */
export default async function cwvTrendsRunner(finalUrl, context, site, auditContext = {}) {
  const { s3Client, log, env } = context;
  const bucketName = env.S3_IMPORTER_BUCKET_NAME;
  const domain = finalUrl;

  const siteId = site.getId();

  const endDate = parseEndDate(auditContext.endDate, log);
  const startDate = subtractDays(endDate, TREND_DAYS - 1);

  log.info(`[${AUDIT_TYPE}] siteId: ${siteId} | Reading ${TREND_DAYS} days of S3 data`);

  const dailyData = await readTrendData(s3Client, bucketName, siteId, endDate, TREND_DAYS, log);

  // Require minimum 28 days of data
  if (dailyData.length < TREND_DAYS) {
    const error = `Insufficient data: ${dailyData.length} days found, ${TREND_DAYS} required`;
    log.error(`[${AUDIT_TYPE}] ${error}`);
    throw new Error(error);
  }

  const auditResult = DEVICE_TYPES.map(
    (dt) => buildDeviceResult(dailyData, domain, dt, startDate, endDate, log),
  );

  log.info(`[${AUDIT_TYPE}] Processed results for ${DEVICE_TYPES.join(', ')} | ${dailyData.length} days of data`);

  return {
    auditResult,
    fullAuditRef: `${S3_BASE_PATH}/${siteId}/rum/cwv-trends/`,
  };
}
