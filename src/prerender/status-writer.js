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
import { toPathname } from './utils/utils.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

/**
 * Reads the existing status.json from S3 for a site. Returns an empty object when the
 * file does not exist or when S3 access is unavailable.
 * @param {string} siteId
 * @param {Object} context - Handler context (s3Client, env, log)
 * @returns {Promise<Object>}
 */
export async function readSiteStatusJson(siteId, context) {
  const { s3Client, env, log } = context;
  if (!env?.S3_SCRAPER_BUCKET_NAME || !s3Client) {
    return {};
  }
  const statusKey = `${AUDIT_TYPE}/scrapes/${siteId}/status.json`;
  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: env.S3_SCRAPER_BUCKET_NAME, Key: statusKey }),
    );
    return JSON.parse(await response.Body.transformToString());
  } catch (e) {
    if (e.name !== 'NoSuchKey') {
      log?.warn?.(`${LOG_PREFIX} Could not read status.json: ${e.message}. siteId=${siteId}`);
    }
    return {};
  }
}

/**
 * Merges the current audit results with the existing status.json pages, derives aggregate
 * metrics, and writes the updated status.json to S3.
 *
 * Errors are caught and logged — this is non-critical post-processing and must not throw.
 *
 * @param {string} auditUrl - The site base URL
 * @param {Object} auditData - { auditResult, siteId, auditedAt, scrapeJobId, submittedUrlSet }
 * @param {Object} context - Handler context (log, s3Client, env)
 */
export async function uploadStatusSummaryToS3(auditUrl, auditData, context) {
  const { log, s3Client, env } = context;
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

    const existingStatus = await readSiteStatusJson(siteId, context);
    const existingPages = Array.isArray(existingStatus.pages) ? existingStatus.pages : [];
    const existingPageMap = new Map(existingPages.map((p) => [toPathname(p.url), p]));

    const currentPages = (auditResult.results ?? []).map((result) => {
      const wasSubmitted = !submittedUrlSet || submittedUrlSet.has(result.url);
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
          : (existingPageMap.get(toPathname(result.url))?.scrapeJobId ?? null),
        ...(result.scrapeError && { scrapeError: result.scrapeError }),
      };
    });

    if (Array.isArray(auditResult.missingPages)) {
      currentPages.push(
        ...auditResult.missingPages.map((page) => ({
          ...page,
          scrapedAt: page.scrapedAt || scrapedAt,
          scrapeJobId: page.scrapeJobId || scrapeJobId || null,
        })),
      );
    }

    const currentUrlSet = new Set(currentPages.map((p) => toPathname(p.url)));
    const mergedPages = [
      ...currentPages,
      ...existingPages.filter((p) => !currentUrlSet.has(toPathname(p.url))),
    ];

    const urlsNeedingPrerender = mergedPages.filter((p) => p.needsPrerender).length;
    const urlsScrapedSuccessfully = mergedPages.filter((p) => p.scrapingStatus === 'success').length;
    const urlsSubmittedForScraping = mergedPages.length;
    const scrapingErrorRate = urlsSubmittedForScraping > 0
      ? ((urlsSubmittedForScraping - urlsScrapedSuccessfully) / urlsSubmittedForScraping) * 100
      : null;
    const scrapeForbiddenCount = mergedPages.filter(
      (p) => p.scrapeError?.statusCode === 403,
    ).length;

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
      scrapeForbidden: auditResult.scrapeForbidden ?? false,
      scrapeForbiddenCount,
      scrapeForbiddenSince: auditResult.scrapeForbiddenSince ?? existingStatus.scrapeForbiddenSince,
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
  }
}
