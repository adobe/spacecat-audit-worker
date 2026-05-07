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

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { normalizePathname } from './utils.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

/**
 * Reads and parses the site status.json side-car from S3.
 * Returns empty defaults when the file does not exist yet.
 *
 * @param {Object} s3Client - AWS S3 client
 * @param {string} bucketName - S3 bucket name
 * @param {string} siteId - Site identifier
 * @param {Object} log - Logger
 * @returns {Promise<{existingStatus: Object, existingPages: Object[]}>}
 */
export async function readSiteStatusJson(s3Client, bucketName, siteId, log) {
  try {
    const key = `${AUDIT_TYPE}/scrapes/${siteId}/status.json`;
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    const parsed = JSON.parse(await response.Body.transformToString());
    const existingPages = Array.isArray(parsed.pages) ? parsed.pages : [];
    return { existingStatus: parsed, existingPages };
  } catch (e) {
    if (e.name !== 'NoSuchKey') {
      log.warn(`${LOG_PREFIX} Could not read existing status.json for siteId=${siteId}: ${e.message} — starting fresh`);
    }
    return { existingStatus: {}, existingPages: [] };
  }
}

/**
 * Post processor to upload a status JSON file to S3 after audit completion.
 * Merges the current scrape results with existing pages and writes status.json back to S3.
 *
 * @param {string} auditUrl - Audited URL (site base URL)
 * @param {Object} auditData - Audit data with results
 * @param {Object} context - Processing context
 * @returns {Promise<void>}
 */
export async function uploadStatusSummaryToS3(auditUrl, auditData, context) {
  const {
    log, s3Client, env,
  } = context;
  const {
    auditResult,
    siteId,
    auditedAt,
    scrapeJobId,
    submittedUrlSet,
  } = auditData;

  try {
    if (!auditResult) {
      log.warn(`${LOG_PREFIX} Missing auditResult, skipping status summary upload`);
      return;
    }

    const scrapedAt = auditedAt || new Date().toISOString();
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const statusKey = `${AUDIT_TYPE}/scrapes/${siteId}/status.json`;

    // Read existing status.json before building currentPages so we can look up prior scrapeJobIds.
    // Pages from the current run overwrite any prior entry for the same URL.
    const { existingStatus, existingPages } = await readSiteStatusJson(
      s3Client,
      bucketName,
      siteId,
      log,
    );

    const existingPageMap = new Map(existingPages.map((p) => [normalizePathname(p.url), p]));

    const currentPages = (auditResult.results ?? []).map((result) => {
      // Only stamp the current scrapeJobId for URLs actually submitted to this job.
      // For fallback URLs that weren't submitted, preserve the existing scrapeJobId.
      const wasSubmitted = !submittedUrlSet || submittedUrlSet.has(result.url);
      // Preserve gone from existing entry; set it permanently for 410 errors
      const existingEntry = existingPageMap.get(normalizePathname(result.url));
      const isGone = result.scrapeError?.statusCode === 410;
      const wasGone = existingEntry?.gone === true;
      return {
        url: result.url,
        scrapingStatus: result.error ? 'error' : 'success',
        needsPrerender: result.needsPrerender || false,
        isDeployedAtEdge: !!result.isDeployedAtEdge,
        usedEarlyClientSideHtml: !!result.usedEarlyClientSideHtml,
        wordCountBefore: result.wordCountBefore || 0,
        wordCountAfter: result.wordCountAfter || 0,
        contentGainRatio: result.contentGainRatio || 0,
        scrapedAt,
        scrapeJobId: wasSubmitted
          ? (scrapeJobId || null)
          : (existingEntry?.scrapeJobId ?? null),
        ...(result.scrapeError && { scrapeError: result.scrapeError }),
        ...((isGone || wasGone) && { gone: true }),
      };
    });

    // missingPages should be precomputed by getScrapeJobStats and passed via auditResult.
    if (Array.isArray(auditResult.missingPages)) {
      currentPages.push(
        ...auditResult.missingPages.map((page) => ({
          ...page,
          scrapedAt: page.scrapedAt || scrapedAt,
          scrapeJobId: page.scrapeJobId || scrapeJobId || null,
        })),
      );
    }

    const currentUrlSet = new Set(currentPages.map((p) => normalizePathname(p.url)));
    const mergedPages = [
      ...currentPages,
      ...existingPages.filter((p) => !currentUrlSet.has(normalizePathname(p.url))),
    ];

    // Derive aggregate metrics from the full merged page set and latest audit metadata.
    const urlsNeedingPrerender = mergedPages.filter((p) => p.needsPrerender).length;
    const urlsScrapedSuccessfully = mergedPages.filter((p) => p.scrapingStatus === 'success').length;
    const urlsSubmittedForScraping = mergedPages.length;
    const scrapingErrorRate = urlsSubmittedForScraping > 0
      ? ((urlsSubmittedForScraping - urlsScrapedSuccessfully) / urlsSubmittedForScraping) * 100
      : null;
    const scrapeForbiddenCount = mergedPages.filter(
      (p) => p.scrapeError?.statusCode === 403,
    ).length;

    const has403Urls = currentPages.some((p) => p.scrapeError?.statusCode === 403);
    const latestScrapeForbidden = auditResult.scrapeForbidden ?? has403Urls;

    const statusSummary = {
      baseUrl: auditUrl,
      siteId,
      auditType: AUDIT_TYPE,
      scrapeJobId: scrapeJobId || existingStatus.scrapeJobId || null,
      lastUpdated: scrapedAt,
      urlsNeedingPrerender,
      urlsSubmittedForScraping,
      urlsScrapedSuccessfully,
      scrapingErrorRate,
      scrapeForbidden: latestScrapeForbidden,
      scrapeForbiddenCount,
      lastAuditSuccess: auditResult.lastAuditSuccess !== false,
      pages: mergedPages,
    };
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: statusKey,
      Body: JSON.stringify(statusSummary, null, 2),
      ContentType: 'application/json',
    }));

    const { pages: _, ...logSummary } = statusSummary;
    const logFields = Object.entries(logSummary).map(([k, v]) => `${k}=${v}`).join(', ');
    log.info(`${LOG_PREFIX} prerender_status_upload: statusKey=${statusKey}, pagesCount=${statusSummary.pages.length}, ${logFields}`);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to upload status summary to S3: ${error.message}. baseUrl=${auditUrl}, siteId=${siteId}`, error);
    // Don't throw - this is a non-critical post-processing step
  }
}
