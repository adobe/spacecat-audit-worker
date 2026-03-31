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
import { isValidUrl, prependSchema, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import {
  analyzeBlockingResponse,
  SPACECAT_USER_AGENT,
} from './checks/user-agent-access.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const LOG_PREFIX = '[HealthCheck]';
const AHREFS_TOP_PAGES_FRESHNESS_DAYS = 8;
const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

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
 * Builds the spacecat user agent access check result.
 * @param {string} status - 'ok', 'blocked', or 'error'
 * @param {number|null} statusCode - HTTP status code or null if scrape failed
 * @param {string|null} reason - Explanation for blocked/error status
 * @param {number|null} scrapedAt - Timestamp from scraper or null if scrape failed
 * @returns {object} Spacecat user-agent check result
 */
function buildSpacecatUserAgentAccessResult(status, statusCode, reason, scrapedAt) {
  return {
    status,
    statusCode,
    reason,
    userAgent: SPACECAT_USER_AGENT,
    scrapedAt,
  };
}

function buildAhrefsTopPagesImportResult(status, reason = null) {
  return {
    status,
    freshnessDays: AHREFS_TOP_PAGES_FRESHNESS_DAYS,
    reason,
  };
}

function buildEffectiveUrlNoRedirectResult(status, statusCode, checkedUrl, reason = null) {
  return {
    status,
    statusCode,
    checkedUrl,
    reason,
  };
}

function buildAuditResult(spacecatUserAgentAccess, ahrefsTopPagesImport, effectiveUrlNoRedirect) {
  return {
    spacecatUserAgentAccess,
    ahrefsTopPagesImport,
    effectiveUrlNoRedirect,
  };
}

export function getEffectiveBaseURL(site) {
  const overrideBaseURL = site.getConfig?.()?.getFetchConfig?.()?.overrideBaseURL;
  if (isValidUrl(overrideBaseURL)) {
    return overrideBaseURL;
  }
  return site.getBaseURL();
}

export async function checkAhrefsTopPagesImport(context, now = new Date()) {
  const { site, dataAccess, log } = context;
  const siteId = site.getId();
  const thresholdTimestamp = now.getTime() - (AHREFS_TOP_PAGES_FRESHNESS_DAYS * MS_IN_A_DAY);

  try {
    const siteTopPagesModel = dataAccess?.SiteTopPage;
    if (!siteTopPagesModel?.allBySiteIdAndSourceAndGeo) {
      return buildAhrefsTopPagesImportResult(
        'error',
        'SiteTopPage data access is unavailable',
      );
    }

    const result = await siteTopPagesModel.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    const topPages = Array.isArray(result) ? result : result?.data ?? [];

    if (topPages.length === 0) {
      return buildAhrefsTopPagesImportResult(
        'error',
        'No Ahrefs top-pages import records found',
      );
    }

    let hasValidImportedAt = false;

    for (const topPage of topPages) {
      const importedAt = topPage.getImportedAt?.();
      if (!importedAt) {
        // skip records with missing timestamps
        // eslint-disable-next-line no-continue
        continue;
      }

      const importedAtMs = new Date(importedAt).getTime();
      if (Number.isNaN(importedAtMs)) {
        // skip records with invalid timestamps
        // eslint-disable-next-line no-continue
        continue;
      }
      hasValidImportedAt = true;

      // The check only requires evidence of a recent successful import.
      if (importedAtMs >= thresholdTimestamp) {
        return buildAhrefsTopPagesImportResult('ok', null);
      }
    }

    if (!hasValidImportedAt) {
      return buildAhrefsTopPagesImportResult(
        'error',
        'No valid Ahrefs top-pages importedAt timestamp found',
      );
    }

    return buildAhrefsTopPagesImportResult(
      'error',
      `No Ahrefs top-pages import found in the last ${AHREFS_TOP_PAGES_FRESHNESS_DAYS} days`,
    );
  } catch (error) {
    log.error(`${LOG_PREFIX} Ahrefs top-pages health check failed for site ${siteId}: ${error.message}`, error);
    return buildAhrefsTopPagesImportResult('error', `Ahrefs check failed: ${error.message}`);
  }
}

export async function checkEffectiveUrlNoRedirect(context) {
  const { site, log } = context;
  const effectiveBaseURL = getEffectiveBaseURL(site);
  const checkedUrl = prependSchema(effectiveBaseURL);

  try {
    const response = await fetch(checkedUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': SPACECAT_USER_AGENT,
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const reason = location
        ? `Received redirect status ${response.status} to ${location}`
        : `Received redirect status ${response.status}`;
      return buildEffectiveUrlNoRedirectResult('error', response.status, checkedUrl, reason);
    }

    if (response.ok) {
      return buildEffectiveUrlNoRedirectResult('ok', response.status, checkedUrl, null);
    }

    return buildEffectiveUrlNoRedirectResult(
      'error',
      response.status,
      checkedUrl,
      `Received non-success status ${response.status} without redirect`,
    );
  } catch (error) {
    log.error(`${LOG_PREFIX} Effective URL no-redirect check failed for ${checkedUrl}: ${error.message}`, error);
    return buildEffectiveUrlNoRedirectResult(
      'error',
      null,
      checkedUrl,
      `Request failed: ${error.message}`,
    );
  }
}

/**
 * Step 2: Analyze health checks.
 * Spacecat user-agent access is scrape-based and can reuse cached analysis when
 * the scrape timestamp is unchanged. Ahrefs and effective URL checks are always fresh.
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
  const ahrefsTopPagesImportPromise = checkAhrefsTopPagesImport(context);
  const effectiveUrlNoRedirectPromise = checkEffectiveUrlNoRedirect(context);
  let spacecatUserAgentAccess = buildSpacecatUserAgentAccessResult('error', null, 'Unknown scrape failure', null);

  log.info(`${LOG_PREFIX} Step 2: Analyzing scrape result for ${baseURL}`);

  try {
    // Note: We use getScrapeJobUrlResults instead of the standard scrapeResultPaths
    // provided by the StepAudit framework because we need to detect and report scrape
    // failures (FAILED, REDIRECT status) for health-check purposes. The standard
    // scrapeResultPaths only contains successful scrapes and doesn't include failure info.
    const scrapeClient = ScrapeClient.createFrom(context);
    const scrapeUrlResults = await scrapeClient.getScrapeJobUrlResults(scrapeJobId);

    if (!scrapeUrlResults || scrapeUrlResults.length === 0) {
      log.warn(`${LOG_PREFIX} No scrape results found for ${baseURL}`);
      spacecatUserAgentAccess = buildSpacecatUserAgentAccessResult('error', null, 'No scrape results received from scraper', null);
    } else {
      // Get the first (and should be only) scrape result
      const scrapeUrlResult = scrapeUrlResults[0];
      const {
        url, status, reason, path: s3Path,
      } = scrapeUrlResult;

      // Check if the scrape failed at the network level
      if (status === 'FAILED' || status === 'REDIRECT' || !s3Path) {
        const errorReason = reason || `Scrape failed with status: ${status}`;
        log.warn(`${LOG_PREFIX} Scrape was unsuccessful for ${url}: ${status} - ${reason}`);
        spacecatUserAgentAccess = buildSpacecatUserAgentAccessResult('error', null, errorReason, null);
      } else {
        log.debug(`${LOG_PREFIX} Processing scrape result from ${s3Path}`);

        const scrapeData = await getObjectFromKey(
          s3Client,
          bucketName,
          s3Path,
          log,
        );

        if (!scrapeData) {
          log.warn(`${LOG_PREFIX} No scrape data found at ${s3Path}`);
          spacecatUserAgentAccess = buildSpacecatUserAgentAccessResult('error', null, 'Could not retrieve scrape data from S3', null);
        } else {
          const { scrapeResult } = scrapeData;
          const scrapedAt = scrapeResult?.scrapedAt ?? null;
          const statusCode = scrapeResult?.status ?? null;
          const content = scrapeResult?.rawBody || '';

          log.debug(`${LOG_PREFIX} Scrape returned status ${statusCode} with ${content.length} chars of content (scrapedAt: ${scrapedAt})`);

          // Check if we've already analyzed this exact scrape
          const { LatestAudit } = dataAccess;
          const latestAudit = await LatestAudit.findBySiteIdAndAuditType(siteId, 'health-check');
          const cachedSpacecatResult = latestAudit?.getAuditResult?.()?.spacecatUserAgentAccess;
          const previousScrapedAt = cachedSpacecatResult?.scrapedAt;

          if (previousScrapedAt && scrapedAt === previousScrapedAt && cachedSpacecatResult) {
            log.info(`${LOG_PREFIX} Scrape unchanged (scrapedAt: ${scrapedAt}), returning cached Spacecat user-agent analysis result`);
            spacecatUserAgentAccess = cachedSpacecatResult;
          } else {
            // New scrape - run analysis
            const analysis = await analyzeBlockingResponse(statusCode, content, context);
            const resultStatus = analysis.isBlocked ? 'blocked' : 'ok';
            const resultReason = analysis.isBlocked ? analysis.reason : null;

            log.info(`${LOG_PREFIX} Analysis complete for ${url}. Status: ${resultStatus}`);
            spacecatUserAgentAccess = buildSpacecatUserAgentAccessResult(
              resultStatus,
              statusCode,
              resultReason,
              scrapedAt,
            );
          }
        }
      }
    }
  } catch (error) {
    log.error(`${LOG_PREFIX} Spacecat user-agent scrape analysis failed for ${baseURL}: ${error.message}`, error);
    spacecatUserAgentAccess = buildSpacecatUserAgentAccessResult('error', null, `Spacecat user-agent check failed: ${error.message}`, null);
  }

  const [ahrefsTopPagesImport, effectiveUrlNoRedirect] = await Promise.all([
    ahrefsTopPagesImportPromise,
    effectiveUrlNoRedirectPromise,
  ]);

  return {
    auditResult: buildAuditResult(
      spacecatUserAgentAccess,
      ahrefsTopPagesImport,
      effectiveUrlNoRedirect,
    ),
    fullAuditRef,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('request-scrape', requestScrape, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('analyze-result', analyzeScrapeResult)
  .build();
