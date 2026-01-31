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

import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { getWeekInfo, getTemporalCondition } from '@adobe/spacecat-shared-utils';
import { getBounceGapMetricsTemplate, getTop3PagesWithTrafficLostTemplate } from './queries.js';
import { calculateBounceGapLoss as calculateGenericBounceGapLoss } from './bounce-gap-calculator.js';
import { getCPCData, calculateProjectedTrafficValue, DEFAULT_CPC } from './ahrefs-cpc.js';

function getConfig(env) {
  const {
    RUM_METRICS_DATABASE: rumMetricsDatabase,
    RUM_METRICS_COMPACT_TABLE: rumMetricsCompactTable,
    S3_BUCKET_NAME: bucketName,
    PAID_DATA_THRESHOLD: paidDataThreshold,
  } = env;

  return {
    rumMetricsDatabase: rumMetricsDatabase ?? 'spacecat',
    rumMetricsCompactTable: rumMetricsCompactTable ?? 'compact_metrics',
    bucketName,
    pageViewThreshold: paidDataThreshold ?? 1000,
    athenaTemp: `s3://${bucketName}/rum-metrics-compact/temp/out`,
  };
}

function transformResultItem(item, baseURL) {
  return {
    path: item.path,
    url: item.path ? new URL(item.path, baseURL).toString() : undefined,
    device: item.device,
    trafficLoss: parseFloat(item.traffic_loss || 0),
    pageViews: parseInt(item.pageviews || 0, 10),
    pctPageviews: parseFloat(item.pct_pageviews || 0),
    clickRate: parseFloat(item.click_rate || 0),
    bounceRate: parseFloat(item.bounce_rate || 0),
    engagementRate: parseFloat(item.engagement_rate || 0),
    engagedScrollRate: parseFloat(item.engaged_scroll_rate || 0),
    source: item.utm_source || 'paid',
    referrer: item.referrer || '',
  };
}

async function executeTop3TrafficLostPagesQuery(
  athenaClient,
  dimensions,
  siteId,
  temporalCondition,
  limit,
  config,
  baseURL,
) {
  const dimensionColumns = dimensions.join(', ');
  const groupBy = dimensions.join(', ');
  const dimensionColumnsPrefixed = dimensions.map((dim) => `a.${dim}`).join(', ');
  const tableName = `${config.rumMetricsDatabase}.${config.rumMetricsCompactTable}`;

  const query = getTop3PagesWithTrafficLostTemplate({
    siteId,
    tableName,
    temporalCondition,
    dimensionColumns,
    groupBy,
    dimensionColumnsPrefixed,
    pageViewThreshold: 0,
    limit,
  });

  const result = await athenaClient.query(query, config.rumMetricsDatabase, `top3 pages: ${siteId}`);
  return result.map((item) => transformResultItem(item, baseURL));
}

async function executeBounceGapMetricsQuery(athenaClient, siteId, temporalCondition, config) {
  const tableName = `${config.rumMetricsDatabase}.${config.rumMetricsCompactTable}`;
  const query = getBounceGapMetricsTemplate({ siteId, tableName, temporalCondition });
  const result = await athenaClient.query(query, config.rumMetricsDatabase, `bounce gap: ${siteId}`);
  return result.map((item) => ({
    trfType: item.trf_type,
    consent: item.consent,
    pageViews: parseInt(item.pageviews || 0, 10),
    bounceRate: parseFloat(item.bounce_rate || 0),
  }));
}

function calculateBounceGapLoss(bounceGapData, log) {
  const TREATMENT = 'show';
  const CONTROL = 'hidden';

  const groupedByTrafficType = {};
  for (const row of bounceGapData) {
    if (!groupedByTrafficType[row.trfType]) groupedByTrafficType[row.trfType] = {};
    groupedByTrafficType[row.trfType][row.consent] = {
      pageViews: row.pageViews,
      bounceRate: row.bounceRate,
    };
  }

  const hasShowData = Object.values(groupedByTrafficType).some((g) => g[TREATMENT]);
  const hasHiddenData = Object.values(groupedByTrafficType).some((g) => g[CONTROL]);

  if (!hasShowData || !hasHiddenData) {
    log.warn(`[paid-audit] Missing consent data - show:${hasShowData} hidden:${hasHiddenData}`);
    return { projectedTrafficLost: 0, hasShowData, hasHiddenData };
  }

  const result = calculateGenericBounceGapLoss(groupedByTrafficType, log, TREATMENT, CONTROL);
  return {
    projectedTrafficLost: result.totalLoss,
    hasShowData,
    hasHiddenData,
    byTrafficType: result.byGroup,
  };
}

function calculateSitewideBounceDelta(bounceGapData) {
  let totalPVShow = 0;
  let totalBouncesShow = 0;
  let totalPVHidden = 0;
  let totalBouncesHidden = 0;
  for (const row of bounceGapData) {
    if (row.consent === 'show') {
      totalPVShow += row.pageViews;
      totalBouncesShow += row.pageViews * row.bounceRate;
    } else if (row.consent === 'hidden') {
      totalPVHidden += row.pageViews;
      totalBouncesHidden += row.pageViews * row.bounceRate;
    }
  }
  const sitewideShowBR = totalPVShow > 0 ? totalBouncesShow / totalPVShow : 0;
  const sitewideHiddenBR = totalPVHidden > 0 ? totalBouncesHidden / totalPVHidden : 0;
  return Math.max(0, sitewideShowBR - sitewideHiddenBR);
}

/**
 * Fetches all audit data needed for opportunity creation.
 * Called by the guidance handler to get fresh data from Athena.
 */
export async function getAuditData(context, siteId, baseURL) {
  const { log, env } = context;
  const config = getConfig(env);
  const { week, year } = getWeekInfo();
  const temporalCondition = getTemporalCondition({ week, year, numSeries: 4 });

  const athenaClient = AWSAthenaClient.fromContext(context, `${config.athenaTemp}/guidance/${siteId}-${Date.now()}`);

  // Execute all queries
  const bounceGapData = await executeBounceGapMetricsQuery(
    athenaClient,
    siteId,
    temporalCondition,
    config,
  );
  const {
    projectedTrafficLost,
    hasShowData,
    hasHiddenData,
    byTrafficType,
  } = calculateBounceGapLoss(bounceGapData, log);

  if (!hasShowData || !hasHiddenData) {
    return null;
  }

  const sitewideBounceDelta = calculateSitewideBounceDelta(bounceGapData);
  const cpcData = await getCPCData(context, siteId);
  const projectedTrafficValue = calculateProjectedTrafficValue(byTrafficType, cpcData);

  const top3Pages = await executeTop3TrafficLostPagesQuery(
    athenaClient,
    ['path'],
    siteId,
    temporalCondition,
    3,
    config,
    baseURL,
  );
  const lostTrafficSummary = await executeTop3TrafficLostPagesQuery(
    athenaClient,
    ['device'],
    siteId,
    temporalCondition,
    null,
    config,
    baseURL,
  );
  const top3ByDevice = await executeTop3TrafficLostPagesQuery(
    athenaClient,
    ['path', 'device'],
    siteId,
    temporalCondition,
    null,
    config,
    baseURL,
  );

  const averagePageViewsTop3 = top3Pages
    .reduce((sum, item) => sum + item.pageViews, 0) / top3Pages.length;
  const averageTrafficLostTop3 = top3Pages
    .reduce((sum, item) => sum + item.trafficLoss, 0) / top3Pages.length;
  const top3Mobile = top3ByDevice.filter((item) => item.device === 'mobile');
  const averageBounceRateMobileTop3 = top3Mobile
    .reduce((sum, item) => sum + item.bounceRate, 0) / top3Mobile.length;
  const totalPageViews = lostTrafficSummary.reduce((sum, item) => sum + item.pageViews, 0);
  const totalAverageBounceRate = totalPageViews > 0 ? projectedTrafficLost / totalPageViews : 0;

  return {
    totalPageViews,
    totalAverageBounceRate,
    projectedTrafficLost,
    projectedTrafficValue,
    sitewideBounceDelta,
    top3Pages,
    averagePageViewsTop3,
    averageTrafficLostTop3,
    averageBounceRateMobileTop3,
    temporalCondition,
    appliedCPC: cpcData.paidCPC,
    cpcSource: cpcData.source,
    defaultCPC: DEFAULT_CPC,
    ...(cpcData.source === 'ahrefs' && { ahrefsOrganicCPC: cpcData.organicCPC, ahrefsPaidCPC: cpcData.paidCPC }),
  };
}
