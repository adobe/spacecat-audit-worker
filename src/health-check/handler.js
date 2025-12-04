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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import {
  analyzeBlockingResponse,
  SPACECAT_USER_AGENT,
} from './checks/user-agent-access.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const LOG_PREFIX = '[HealthCheck]';

/**
 * Step 1: Request a scrape of the site's homepage with default processing.
 * This uses the scraper infrastructure which applies the Spacecat user agent.
 * We use processingType: 'default' with no options to maximize cache hits
 * with other audits (e.g., readability, experimentation-opportunities).
 */
export async function requestScrape(context) {
  const { site, finalUrl, log } = context;

  const baseURL = site.getBaseURL();
  const siteId = site.getId();

  log.info(`${LOG_PREFIX} Step 1: Requesting scrape for ${baseURL}`);

  return {
    auditResult: {
      status: 'scraping',
    },
    fullAuditRef: finalUrl,
    urls: [{ url: baseURL }],
    siteId,
    processingType: 'default',
  };
}

/**
 * Helper to build a uniform audit result structure.
 * @param {string} status - 'ok', 'blocked', or 'error'
 * @param {number|null} statusCode - HTTP status code or null if scrape failed
 * @param {string|null} reason - Explanation for blocked/error status
 * @param {number|null} scrapedAt - Timestamp from scraper or null if scrape failed
 * @returns {object} Uniform audit result structure
 */
function buildAuditResult(status, statusCode, reason, scrapedAt) {
  return {
    spacecatUserAgentAccess: {
      status,
      statusCode,
      reason,
      userAgent: SPACECAT_USER_AGENT,
      scrapedAt,
    },
  };
}

/**
 * Step 2: Analyze the scrape result to determine if the user agent was blocked.
 * If the scrape result is the same as the one we analyzed in the previous audit
 * (same scrapedAt timestamp), we skip re-analysis and return the cached result.
 */
export async function analyzeScrapeResult(context) {
  const {
    site,
    audit,
    auditContext,
    log,
    s3Client,
    env,
    dataAccess,
  } = context;

  const baseURL = site.getBaseURL();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const fullAuditRef = audit.getFullAuditRef();
  const siteId = site.getId();
  const { scrapeJobId } = auditContext;

  log.info(`${LOG_PREFIX} Step 2: Analyzing scrape result for ${baseURL}`);

  // Note: We use getScrapeJobUrlResults instead of the standard scrapeResultPaths
  // provided by the StepAudit framework because we need to detect and report scrape
  // failures (FAILED, REDIRECT status) for health-check purposes. The standard
  // scrapeResultPaths only contains successful scrapes and doesn't include failure info.
  const scrapeClient = ScrapeClient.createFrom(context);
  const scrapeUrlResults = await scrapeClient.getScrapeJobUrlResults(scrapeJobId);

  if (!scrapeUrlResults || scrapeUrlResults.length === 0) {
    log.warn(`${LOG_PREFIX} No scrape results found for ${baseURL}`);
    return {
      auditResult: buildAuditResult('error', null, 'No scrape results received from scraper', null),
      fullAuditRef,
    };
  }

  // Get the first (and should be only) scrape result
  const scrapeUrlResult = scrapeUrlResults[0];
  const {
    url, status, reason, path: s3Path,
  } = scrapeUrlResult;

  // Check if the scrape failed at the network level
  if (status === 'FAILED' || status === 'REDIRECT' || !s3Path) {
    const errorReason = reason || `Scrape failed with status: ${status}`;
    log.warn(`${LOG_PREFIX} Scrape was unsuccessful for ${url}: ${status} - ${reason}`);
    return {
      auditResult: buildAuditResult('error', null, errorReason, null),
      fullAuditRef,
    };
  }

  log.debug(`${LOG_PREFIX} Processing scrape result from ${s3Path}`);

  const scrapeData = await getObjectFromKey(
    s3Client,
    bucketName,
    s3Path,
    log,
  );

  if (!scrapeData) {
    log.warn(`${LOG_PREFIX} No scrape data found at ${s3Path}`);
    return {
      auditResult: buildAuditResult('error', null, 'Could not retrieve scrape data from S3', null),
      fullAuditRef,
    };
  }

  const { scrapeResult } = scrapeData;
  const scrapedAt = scrapeResult?.scrapedAt ?? null;
  const statusCode = scrapeResult?.status ?? null;
  const content = scrapeResult?.rawBody || '';

  log.debug(`${LOG_PREFIX} Scrape returned status ${statusCode} with ${content.length} chars of content (scrapedAt: ${scrapedAt})`);

  // Check if we've already analyzed this exact scrape
  const { LatestAudit } = dataAccess;
  const latestAudit = await LatestAudit.findBySiteIdAndAuditType(siteId, 'health-check');

  if (latestAudit) {
    const previousScrapedAt = latestAudit.getAuditResult()?.spacecatUserAgentAccess?.scrapedAt;

    if (previousScrapedAt && scrapedAt === previousScrapedAt) {
      log.info(`${LOG_PREFIX} Scrape unchanged (scrapedAt: ${scrapedAt}), returning cached analysis result`);
      return {
        auditResult: latestAudit.getAuditResult(),
        fullAuditRef: latestAudit.getFullAuditRef(),
      };
    }
  }

  // New scrape - run analysis
  const analysis = await analyzeBlockingResponse(statusCode, content, context);
  const resultStatus = analysis.isBlocked ? 'blocked' : 'ok';
  const resultReason = analysis.isBlocked ? analysis.reason : null;

  log.info(`${LOG_PREFIX} Analysis complete for ${url}. Status: ${resultStatus}`);

  return {
    auditResult: buildAuditResult(resultStatus, statusCode, resultReason, scrapedAt),
    fullAuditRef,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('request-scrape', requestScrape, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('analyze-result', analyzeScrapeResult)
  .build();
