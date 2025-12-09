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
} from '@adobe/spacecat-shared-athena-client';
import { getWeekInfo, getTemporalCondition } from '@adobe/spacecat-shared-utils';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import {
  // getPaidTrafficAnalysisTemplate,
  getTop3PagesWithTrafficLostTemplate,
} from './queries.js';

// const MAX_PAGES_TO_AUDIT = 3;
const CUT_OFF_BOUNCE_RATE = 0.3;

const AUDIT_CONSTANTS = {
  GUIDANCE_TYPE: 'guidance:paid-cookie-consent',
  OBSERVATION: 'High bounce rate detected on paid traffic page',
};

function getConfig(env) {
  const {
    RUM_METRICS_DATABASE: rumMetricsDatabase,
    RUM_METRICS_COMPACT_TABLE: rumMetricsCompactTable,
    S3_IMPORTER_BUCKET_NAME: bucketName,
    PAID_DATA_THRESHOLD: paidDataThreshold,
  } = env;

  if (!bucketName) {
    throw new Error('S3_IMPORTER_BUCKET_NAME must be provided for paid audit');
  }

  return {
    rumMetricsDatabase: rumMetricsDatabase ?? 'rum_metrics',
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
  segmentName,
  siteId,
  temporalCondition,
  pageViewThreshold,
  limit,
  config,
  log,
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
    pageViewThreshold,
    limit,
  });

  const description = `top 3 pages for lost traffic for siteId: ${siteId} | temporal: ${temporalCondition}`;

  log.debug(`[DEBUG] ${segmentName} Query:`, query);

  const result = await athenaClient.query(query, config.rumMetricsDatabase, description);
  return result.map((item) => transformResultItem(item, baseURL));
}

// const hasValues = (segment) => segment?.value?.length > 0;

function buildMystiqueMessage(site, auditId, url) {
  return {
    type: AUDIT_CONSTANTS.GUIDANCE_TYPE,
    observation: AUDIT_CONSTANTS.OBSERVATION,
    siteId: site.getId(),
    url,
    auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      url,
    },
  };
}

export async function paidAuditRunner(auditUrl, context, site) {
  const { log, env } = context;
  const config = getConfig(env);
  const siteId = site.getId();
  const baseURL = site.getBaseURL();

  log.debug(
    `[paid-audit] [Site: ${auditUrl}] Querying paid Athena metrics with consent and referrer data (siteId: ${siteId})`,
  );

  // Get temporal parameters (7 days back from current week)
  const { week, year } = getWeekInfo();
  const temporalCondition = getTemporalCondition({ week, year, numSeries: 4 });

  const athenaClient = AWSAthenaClient.fromContext(context, `${config.athenaTemp}/paid-audit-cookie-consent/${siteId}-${Date.now()}`);

  try {
    log.debug(`[paid-audit] [Site: ${auditUrl}] Executing three separate Athena queries for paid traffic segments`);

    const lostTrafficSummary = await executeTop3TrafficLostPagesQuery(athenaClient, ['device'], 'Top 3 Pages with Traffic Lost', siteId, temporalCondition, 0, null, config, log, baseURL);
    const top3PagesTrafficLost = await executeTop3TrafficLostPagesQuery(athenaClient, ['path'], 'Top 3 Pages with Traffic Lost', siteId, temporalCondition, 0, 3, config, log, baseURL);
    const top3PagesTrafficLostByDevice = await executeTop3TrafficLostPagesQuery(athenaClient, ['path', 'device'], 'Top 3 Pages with Traffic Lost', siteId, temporalCondition, 0, null, config, log, baseURL);
    // const top3PagesTrafficLostByType =
    // await executeTop3TrafficLostPagesQuery(athenaClient,
    // ['path', 'trf_type'], 'Top 3 Pages with Traffic Lost', siteId, temporalCondition,
    // config.pageViewThreshold, null, config, log);
    // const top3PagesTrafficLostByTypeAndDevice =
    // await executeTop3TrafficLostPagesQuery(athenaClient,
    // ['path', 'trf_type', 'device'], 'Top 3 Pages with Traffic Lost', siteId, temporalCondition,
    // config.pageViewThreshold, null, config, log);

    // the following data is needed on opportunity level
    // projectedTrafficLost = sum of "traffic_loss" column across the 3 devices
    const projectedTrafficLost = lostTrafficSummary
      .reduce((sum, item) => sum + item.trafficLoss, 0);
    // projectedTrafficValue = projectedTrafficLost * 0.8
    const projectedTrafficValue = projectedTrafficLost * 0.8;
    // top 3 pages with highest projectedTrafficLost
    const top3Pages = top3PagesTrafficLost;
    // averagePageViewsTop3  /  averageTrafficLostTop3  / averageBounceRateMobileTop3
    const averagePageViewsTop3 = top3PagesTrafficLost
      .reduce((sum, item) => sum + item.pageViews, 0) / top3PagesTrafficLost.length;
    const averageTrafficLostTop3 = top3PagesTrafficLost
      .reduce((sum, item) => sum + item.trafficLoss, 0) / top3PagesTrafficLost.length;
    const top3PagesMobileOnly = top3PagesTrafficLostByDevice
      .filter((item) => item.device === 'mobile');
    const averageBounceRateMobileTop3 = top3PagesMobileOnly
      .reduce((sum, item) => sum + item.bounceRate, 0) / top3PagesMobileOnly.length;
    const totalPageViews = lostTrafficSummary.reduce((sum, item) => sum + item.pageViews, 0);
    const totalAverageBounceRate = totalPageViews > 0 ? projectedTrafficLost / totalPageViews : 0;

    const auditResult = {
      totalPageViews,
      totalAverageBounceRate,
      projectedTrafficLost,
      projectedTrafficValue,
      top3Pages,
      averagePageViewsTop3,
      averageTrafficLostTop3,
      averageBounceRateMobileTop3,
      temporalCondition,
    };
    log.info(`[paid-audit] [Site: ${auditUrl}] Audit initial result:`, JSON.stringify(auditResult, 2));
    return {
      auditResult,
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`[paid-audit] [Site: ${auditUrl}] Paid traffic Athena query failed: ${error.message}`);
    throw error;
  }
}

export async function paidConsentBannerCheck(auditUrl, auditData, context, site) {
  const {
    log, sqs, env,
  } = context;

  const { auditResult, id } = auditData;

  // // take first page which has highest projectedTrafficLost
  const selected = auditResult.top3Pages?.length > 0 ? auditResult.top3Pages[0] : null;
  const selectedPageUrl = selected?.url;
  if (!selectedPageUrl) {
    log.warn(
      `[paid-audit] [Site: ${auditUrl}] No pages with consent='show' found for consent banner audit; skipping`,
    );
    return;
  }

  const mystiqueMessage = buildMystiqueMessage(site, id, selectedPageUrl);

  const projected = selected?.trafficLoss;
  log.debug(
    `[paid-audit] [Site: ${auditUrl}] Sending consent-seen page ${selectedPageUrl} with message `
    + `(projectedTrafficLoss: ${projected}) ${JSON.stringify(mystiqueMessage, 2)} `
    + 'evaluation to mystique',
  );
  if (selected?.bounceRate >= CUT_OFF_BOUNCE_RATE) {
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
    log.debug(`[paid-audit] [Site: ${auditUrl}] Completed mystique evaluation step`);
  } else {
    log.debug(`[paid-audit] [Site: ${auditUrl}] Skipping mystique evaluation step for page ${selectedPageUrl} with bounce rate ${selected?.bounceRate}`);
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(paidAuditRunner)
  .withPostProcessors([paidConsentBannerCheck])
  .build();
