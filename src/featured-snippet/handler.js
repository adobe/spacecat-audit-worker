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

import { Audit, Suggestion } from '@adobe/spacecat-shared-data-access';
import { getStoredMetrics } from '@adobe/spacecat-shared-utils';

import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const ORGANIC_KEYWORDS_FEATURE_SNIPPETS = 'organic-keywords-feature-snippets';
const auditType = 'featured-snippet'; // TODO: Move to Audit.AUDIT_TYPES.FEATURED_SNIPPET;

export async function detectFeaturedSnippet(context) {
  const {
    site,
    log,
    dataAccess,
  } = context;

  const siteId = site.getId();

  // Get featured snippets data
  const storedMetricsConfig = {
    ...context,
    s3: {
      s3Bucket: context.env?.S3_IMPORTER_BUCKET_NAME,
      s3Client: context.s3Client,
    },
  };
  let metrics = await getStoredMetrics({ siteId, metric: ORGANIC_KEYWORDS_FEATURE_SNIPPETS, source: 'ahrefs' }, storedMetricsConfig);

  log.info(`[${auditType}]: Found ${metrics.length} featured snippets data for site ${siteId}`);
  if (metrics.length === 0) {
    log.info(`[${auditType}]: No featured snippets data found for site ${siteId}`);
    return [];
  }

  // TODO: Consider geo, but top pages not filtered by it?

  // Get top pages
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  log.info(`[${auditType}]: Found ${topPages.length} top pages for site ${siteId}`);
  if (topPages.length === 0) {
    log.info(`[${auditType}]: No top pages found for site ${siteId}`);
    return [];
  }

  // Find pages that are in metrics for a keyword that is their top keyword
  metrics = metrics.map((metric) => {
    const matchingTopPage = topPages.find((topPage) => {
      const topPageUrl = topPage.getUrl();
      return metric.url === topPageUrl;
    });
    return {
      ...metric,
      cpc: metric.cpc ? metric.cpc : 0,
      volume: metric.volume ? metric.volume : 0,
      traffic: metric.traffic ? metric.traffic : 0,
      hasTopPage: !!matchingTopPage,
      topKeyword: matchingTopPage?.getTopKeyword(),
    };
  });

  // Filter by conditions
  metrics = metrics
    .filter((metric) => {
      const {
        cpc = 0,
        volume = 0,
        isInformational,
        isCommercial,
        isTransactional,
        topKeyword,
        keyword,
      } = metric;

      if (!metric.hasTopPage) {
        log.info(`[${auditType}]: Metric ${metric.url} does not have a top page`);
        return false;
      }

      if ((cpc < 100 || isInformational) && volume < 500) {
        log.info(`[${auditType}]: Metric ${metric.url} does not meet volume condition for informational content`);
        return false;
      }

      if ((cpc > 100 || isCommercial || isTransactional) && volume < 200) {
        log.info(`[${auditType}]: Metric ${metric.url} does not meet volume condition for commercial/transactional content`);
        return false;
      }

      if (topKeyword !== keyword) {
        log.info(`[${auditType}]: Metric ${metric.url} does not meet top keyword condition`);
        return false;
      }

      return true;
    })
    // Remove duplicates
    .reduce((acc, metric) => {
      const { url } = metric;
      acc[url] = metric;
      return acc;
    }, {});
  return Object.values(metrics);
}

export async function opportunityAndSuggestions(context, metrics) {
  return metrics.map((metric) => ({
    ...metric,
    suggestion: `Further optimize this page for the query '${metric.keyword}' to increase the chances of qualifying for a featured snippet and a higher CTR.`,
  }));
}

export async function runAuditAndGenerateSuggestions(context) {
  const startTime = process.hrtime();

  const {
    finalUrl, log, site, audit,
  } = context;

  try {
    const metrics = await detectFeaturedSnippet(context);
    const pageOpportunities = await opportunityAndSuggestions(context, metrics);

    log.info(`[${auditType}]: Final page opportunities: ${JSON.stringify(pageOpportunities, null, 2)}`);

    // Write results to database
    const opportunity = await convertToOpportunity(
      finalUrl,
      {
        siteId: site.getId(),
        id: audit.getId(),
      },
      context,
      createOpportunityData,
      auditType,
    );

    await syncSuggestions({
      opportunity,
      newData: pageOpportunities,
      buildKey: (data) => data.url,
      context,
      mapNewSuggestion: (data) => ({
        opportunityId: opportunity.getId(),
        type: Suggestion.TYPES.CONTENT_UPDATE,
        rank: data.traffic,
        data: {
          url: data.url,
          keyword: data.keyword,
          traffic: data.traffic,
          position: data.position,
          suggestion: data.suggestion,
        },
      }),
    });

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
    const formattedElapsed = elapsedSeconds.toFixed(2);
    log.info(`[${auditType}]: Featured snippet detection completed in ${formattedElapsed} seconds for ${finalUrl}`);

    return {
      fullAuditRef: finalUrl,
      auditResult: {
        results: pageOpportunities,
        success: true,
      },
    };
  } catch (e) {
    log.error(`[${auditType}]: Featured snippet detection failed for ${finalUrl}`, e);
    return {
      fullAuditRef: finalUrl,
      auditResult: {
        error: e.message,
        success: false,
      },
    };
  }
}

export async function importFeaturedSnippets(context) {
  const {
    site,
    finalUrl,
    log,
  } = context;

  log.info(`[${auditType}]: Trigger featured snippet import step for %s`, finalUrl);
  return {
    type: ORGANIC_KEYWORDS_FEATURE_SNIPPETS,
    siteId: site.getId(),
    auditResult: { results: [] },
    fullAuditRef: finalUrl,
  };
}

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.info(`[${auditType}]: Importing top pages for ${finalUrl}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    finalUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('featured-snippet-import-step', importFeaturedSnippets, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
