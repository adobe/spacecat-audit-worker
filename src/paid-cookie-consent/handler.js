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
import { getWeekInfo } from '@adobe/spacecat-shared-utils';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import {
  getPaidTrafficAnalysisTemplate,
} from './queries.js';

const MAX_PAGES_TO_AUDIT = 3;

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

// Transform direct SQL query results to RUM-compatible segments
function transformQueryResultsToSegments(results, baseURL) {
  const segments = [];
  const urlSegmentData = [];
  const urlTrafficSourceData = [];
  const urlConsentData = [];

  // Process each row from the query results
  results.forEach((row) => {
    // Construct URL from path using baseURL (for results, not calculations)
    const url = row.path ? `${baseURL}${row.path}` : (row.url || '');

    const item = {
      url,
      pageViews: parseInt(row.pageviews || 0, 10),
      ctr: parseFloat(row.click_rate || 0),
      avgClicksPerSession: parseFloat(row.avg_clicks_per_session || 0),
      clickedSessions: parseInt(row.clicked_sessions || 0, 10),
      bounceRate: parseFloat(row.bounce_rate || 0),
      totalNumClicks: parseInt(row.total_num_clicks || 0, 10),
      source: row.utm_source || 'paid',
      consent: row.consent || '',
      referrer: row.referrer || '',
      projectedTrafficLost: (parseFloat(row.bounce_rate || 0)) * parseInt(row.pageviews || 0, 10),
    };

    if (row.segment_type === 'url') {
      urlSegmentData.push(item);
    } else if (row.segment_type === 'urlTrafficSource') {
      urlTrafficSourceData.push({ ...item, url: row.utm_source });
    } else if (row.segment_type === 'urlConsent') {
      // For urlConsent, keep the constructed URL for mystique
      urlConsentData.push({ ...item, url });
    }
  });

  // Create segments
  if (urlSegmentData.length > 0) {
    segments.push({
      key: 'url',
      value: urlSegmentData,
    });
  }

  if (urlTrafficSourceData.length > 0) {
    segments.push({
      key: 'urlTrafficSource',
      value: urlTrafficSourceData,
    });
  }

  if (urlConsentData.length > 0) {
    // Sort by projected traffic lost for clicks (highest first)
    urlConsentData.sort((a, b) => b.projectedTrafficLost - a.projectedTrafficLost);
    segments.push({
      key: 'urlConsent',
      value: urlConsentData,
    });
  }

  return segments;
}

// Helper function to execute segment query
async function executeSegmentQuery(
  athenaClient,
  dimensions,
  segmentName,
  siteId,
  temporalCondition,
  pageViewThreshold,
  config,
  log,
) {
  const dimensionColumns = dimensions.join(', ');
  const groupBy = dimensions.join(', ');
  const dimensionColumnsPrefixed = dimensions.map((dim) => `a.${dim}`).join(', ');

  const tableName = `${config.rumMetricsDatabase}.${config.rumMetricsCompactTable}`;

  const query = getPaidTrafficAnalysisTemplate({
    siteId,
    tableName,
    temporalCondition,
    trfTypeCondition: "trf_type = 'paid'",
    dimensionColumns,
    groupBy,
    dimensionColumnsPrefixed,
    pageTypeCase: "'uncategorized' as page_type",
    pageViewThreshold,
  });

  const description = `${segmentName} segment for siteId: ${siteId} | temporal: ${temporalCondition}`;

  log.debug(`[DEBUG] ${segmentName} Query:`, query);

  return athenaClient.query(query, config.rumMetricsDatabase, description);
}

const hasValues = (segment) => segment?.value?.length > 0;

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
  const baseURL = await site.getBaseURL();

  log.info(
    `[paid-audit] [Site: ${auditUrl}] Querying paid Athena metrics with consent and referrer data (siteId: ${siteId})`,
  );

  // Get temporal parameters (7 days back from current week)
  const { temporalCondition } = getWeekInfo();

  const athenaClient = AWSAthenaClient.fromContext(context, `${config.athenaTemp}/paid-audit-cookie-consent/${siteId}-${Date.now()}`);

  try {
    log.info(`[paid-audit] [Site: ${auditUrl}] Executing three separate Athena queries for paid traffic segments`);

    // Execute all three segment queries
    const urlResults = await executeSegmentQuery(athenaClient, ['path'], 'URL', siteId, temporalCondition, config.pageViewThreshold, config, log);

    const urlTrafficSourceResults = await executeSegmentQuery(athenaClient, ['path', 'utm_source'], 'URL Traffic Source', siteId, temporalCondition, config.pageViewThreshold, config, log);

    const urlConsentResults = await executeSegmentQuery(athenaClient, ['path', 'consent'], 'URL Consent', siteId, temporalCondition, config.pageViewThreshold, config, log);

    // Combine results manually with segment type identifiers
    const results = [
      ...urlResults.map((row) => ({ ...row, segment_type: 'url' })),
      ...urlTrafficSourceResults.map((row) => ({ ...row, segment_type: 'urlTrafficSource' })),
      ...urlConsentResults.map((row) => ({ ...row, segment_type: 'urlConsent' })),
    ];

    log.info(`[paid-audit] [Site: ${auditUrl}] Processing ${results?.length} combined query result rows`);

    // Transform query results to RUM-compatible segments
    const allSegments = transformQueryResultsToSegments(results, baseURL);

    log.info(`[paid-audit] [Site: ${auditUrl}] Processing ${allSegments?.length} segments`);
    const auditResult = allSegments.filter(hasValues);
    return {
      auditResult,
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`[paid-audit] [Site: ${auditUrl}] Paid traffic Athena query failed: ${error.message}`);
    throw error;
  }
}

function selectPagesForConsentBannerAudit(auditResult, auditUrl) {
  if (!auditResult || !Array.isArray(auditResult) || auditResult === 0) {
    throw new Error(`Failed to find valid page for consent banner audit for AuditUrl ${auditUrl}`);
  }

  const urlConsentItems = auditResult
    .find((item) => item.key === 'urlConsent')?.value;

  if (!urlConsentItems) {
    throw new Error(`Failed to find urlConsent segment for consent banner audit for AuditUrl ${auditUrl}`);
  }

  // Filter by consent == "show", bounce rate >= 0.7, then find URL with max projected traffic loss
  const seenConsentItems = urlConsentItems
    .filter((item) => item.consent === 'show')
    .filter((item) => item.bounceRate >= 0.7)
    .sort((a, b) => b.projectedTrafficLost - a.projectedTrafficLost);

  return seenConsentItems.slice(0, MAX_PAGES_TO_AUDIT);
}

export async function paidConsentBannerCheck(auditUrl, auditData, context, site) {
  const {
    log, sqs, env,
  } = context;

  const { auditResult, id } = auditData;
  const pagesToAudit = selectPagesForConsentBannerAudit(auditResult, auditUrl);

  // take first page which has highest projectedTrafficLost
  const selected = pagesToAudit?.[0];
  const selectedPage = selected?.url;

  if (!selectedPage) {
    log.warn(
      `[paid-audit] [Site: ${auditUrl}] No pages with consent='show' found for consent banner audit; skipping`,
    );
    return;
  }

  const mystiqueMessage = buildMystiqueMessage(site, id, selectedPage);

  const projected = selected?.projectedTrafficLost;
  log.info(
    `[paid-audit] [Site: ${auditUrl}] Sending consent-seen page ${selectedPage} with message `
    + `(projectedTrafficLoss: ${projected}) ${JSON.stringify(mystiqueMessage, 2)} `
    + 'evaluation to mystique',
  );
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info(`[paid-audit] [Site: ${auditUrl}] Completed mystique evaluation step`);
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(paidAuditRunner)
  .withPostProcessors([paidConsentBannerCheck])
  .build();
