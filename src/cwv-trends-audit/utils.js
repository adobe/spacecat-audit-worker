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
  MIN_PAGEVIEWS, TREND_DAYS, CURRENT_WEEK_DAYS, S3_BASE_PATH,
  DEFAULT_DEVICE_TYPE, AUDIT_TYPE,
} from './constants.js';
import { readTrendData, formatDate, subtractDays } from './data-reader.js';
import { categorizeUrl } from './cwv-categorizer.js';

/**
 * Filters URLs by device type and minimum pageviews.
 */
function filterUrls(urlEntries, deviceType, log) {
  return urlEntries
    .map((entry) => {
      const metrics = entry.metrics?.find((m) => m.deviceType === deviceType);
      if (!metrics) return null;
      if (metrics.pageviews < MIN_PAGEVIEWS) return null;

      if (deviceType === 'undefined') {
        log.warn(`Skipping URL with undefined device type: ${entry.url}`);
        return null;
      }

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
 */
function buildTrendData(dailyData, deviceType, log) {
  return dailyData.map((day) => {
    const urls = filterUrls(day.data, deviceType, log);
    let good = 0;
    let needsImprovement = 0;
    let poor = 0;

    for (const url of urls) {
      const category = categorizeUrl(url.lcp, url.cls, url.inp);
      if (category === 'good') good += 1;
      else if (category === 'needsImprovement') needsImprovement += 1;
      else if (category === 'poor') poor += 1;
    }

    return {
      date: day.date, good, needsImprovement, poor,
    };
  });
}

/**
 * Calculates average counts over a slice of trendData entries.
 */
function averageCounts(entries) {
  if (entries.length === 0) return { good: 0, needsImprovement: 0, poor: 0 };

  const sum = entries.reduce(
    (acc, e) => ({
      good: acc.good + e.good,
      needsImprovement: acc.needsImprovement + e.needsImprovement,
      poor: acc.poor + e.poor,
    }),
    { good: 0, needsImprovement: 0, poor: 0 },
  );

  return {
    good: sum.good / entries.length,
    needsImprovement: sum.needsImprovement / entries.length,
    poor: sum.poor / entries.length,
  };
}

function pctChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

/**
 * Builds summary comparing current week avg (last 7 days) vs previous week avg (days 15-21).
 */
function buildSummary(trendData, totalUrls) {
  const len = trendData.length;
  const currentWeek = trendData.slice(Math.max(0, len - CURRENT_WEEK_DAYS));
  const previousWeek = trendData.slice(
    Math.max(0, len - 2 * CURRENT_WEEK_DAYS),
    Math.max(0, len - CURRENT_WEEK_DAYS),
  );

  const curr = averageCounts(currentWeek);
  const prev = averageCounts(previousWeek);

  const makeStat = (category) => {
    const current = Math.round(curr[category] * 100) / 100;
    const previous = Math.round(prev[category] * 100) / 100;
    const change = Math.round((current - previous) * 100) / 100;
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

/**
 * Computes weekly average for a specific URL and field.
 */
function weeklyAvgForUrl(urlKey, dailySlice, deviceType, field, log) {
  let sum = 0;
  let count = 0;

  for (const day of dailySlice) {
    const urls = filterUrls(day.data, deviceType, log);
    const match = urls.find((u) => u.url === urlKey);
    if (match && match[field] !== null && match[field] !== undefined) {
      sum += match[field];
      count += 1;
    }
  }

  return count > 0 ? sum / count : null;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Builds urlDetails from the most recent date's data,
 * with change values computed as current week avg minus previous week avg.
 */
function buildUrlDetails(dailyData, deviceType, log) {
  const latestDay = dailyData[dailyData.length - 1];
  const latestUrls = filterUrls(latestDay.data, deviceType, log);

  const len = dailyData.length;
  const currentWeekSlice = dailyData.slice(Math.max(0, len - CURRENT_WEEK_DAYS));
  const previousWeekSlice = dailyData.slice(
    Math.max(0, len - 2 * CURRENT_WEEK_DAYS),
    Math.max(0, len - CURRENT_WEEK_DAYS),
  );

  const fields = ['pageviews', 'lcp', 'cls', 'inp', 'bounceRate', 'engagement', 'clickRate'];
  const pctFields = new Set(['bounceRate', 'engagement', 'clickRate']);

  return latestUrls.map((url, index) => {
    const detail = {
      id: String(index + 1),
      url: url.url,
      status: categorizeUrl(url.lcp, url.cls, url.inp),
    };

    for (const field of fields) {
      const rawValue = url[field];
      const currentAvg = weeklyAvgForUrl(url.url, currentWeekSlice, deviceType, field, log);
      const previousAvg = weeklyAvgForUrl(url.url, previousWeekSlice, deviceType, field, log);

      if (pctFields.has(field)) {
        detail[field] = rawValue != null ? round(rawValue * 100, 1) : null;
        detail[`${field}Change`] = (currentAvg != null && previousAvg != null)
          ? round((currentAvg - previousAvg) * 100, 1)
          : null;
      } else {
        detail[field] = rawValue != null ? round(rawValue, 3) : null;
        detail[`${field}Change`] = (currentAvg != null && previousAvg != null)
          ? round(currentAvg - previousAvg, 3)
          : null;
      }
    }

    return detail;
  });
}

function emptyResult(domain, deviceType, startDate, endDate) {
  return {
    auditResult: {
      metadata: {
        domain,
        deviceType,
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
      },
      trendData: [],
      summary: {
        good: {
          current: 0, previous: 0, change: 0, percentageChange: 0, status: 'good',
        },
        needsImprovement: {
          current: 0, previous: 0, change: 0, percentageChange: 0, status: 'needsImprovement',
        },
        poor: {
          current: 0, previous: 0, change: 0, percentageChange: 0, status: 'poor',
        },
        totalUrls: 0,
      },
      urlDetails: [],
    },
    fullAuditRef: `${S3_BASE_PATH}/`,
  };
}

/**
 * CWV Trends audit runner.
 * Reads device type from site config (handler-level config under the audit type key).
 * Falls back to DEFAULT_DEVICE_TYPE ('mobile') when not configured.
 */
export default async function cwvTrendsRunner(finalUrl, context, site) {
  const { s3Client, log, env } = context;
  const bucketName = env.S3_IMPORTER_BUCKET_NAME;
  const domain = finalUrl;

  const handlerConfig = site.getConfig?.()?.getHandlers?.()?.[AUDIT_TYPE] || {};
  const deviceType = handlerConfig.deviceType || DEFAULT_DEVICE_TYPE;

  const endDate = new Date();
  const startDate = subtractDays(endDate, TREND_DAYS - 1);

  log.info(`[${AUDIT_TYPE}] siteId: ${site.getId()} | device: ${deviceType} | Reading ${TREND_DAYS} days of S3 data`);

  const dailyData = await readTrendData(s3Client, bucketName, endDate, TREND_DAYS, log);

  if (dailyData.length === 0) {
    log.warn(`[${AUDIT_TYPE}] No S3 data found for any date`);
    return emptyResult(domain, deviceType, startDate, endDate);
  }

  const trendData = buildTrendData(dailyData, deviceType, log);
  const latestUrls = filterUrls(dailyData[dailyData.length - 1].data, deviceType, log);
  const totalUrls = latestUrls.length;
  const summary = buildSummary(trendData, totalUrls);
  const urlDetails = buildUrlDetails(dailyData, deviceType, log);

  log.info(`[${AUDIT_TYPE}] Processed ${totalUrls} URLs, ${dailyData.length} days of data`);

  return {
    auditResult: {
      metadata: {
        domain,
        deviceType,
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
      },
      trendData,
      summary,
      urlDetails,
    },
    fullAuditRef: `${S3_BASE_PATH}/`,
  };
}
