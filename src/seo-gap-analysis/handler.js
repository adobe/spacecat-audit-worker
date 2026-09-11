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

import { ok, notFound, internalServerError } from '@adobe/spacecat-shared-http-utils';
import { hasText, isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { AsyncJob } from '@adobe/spacecat-shared-data-access';
import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import BrightDataClient from '../support/bright-data-client.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { bucketSerpResults } from './serp.js';
import { computeSeoGap } from './gap.js';
import {
  DEFAULT_SERP_RESULTS,
  MAX_COMPETITORS,
  SEO_COMPARISON_PROCESSING_TYPE,
} from './constants.js';

/**
 * Phase 1 — SERP discovery + scrape fan-out.
 *
 * Consumes the `seo-gap-analysis` message emitted by api-service, runs the keyword through
 * the Bright Data SERP, buckets the results relative to the target, records the buckets on
 * the AsyncJob, then submits the target + competitor URLs to the content-scraper
 * `seo-comparison` handler. The scrape completion re-enters this worker as a `seo-comparison`
 * message and is handled by {@link aggregate} (phase 2).
 *
 * @param {object} message - `{ jobId, keyword, targetUrl, filterDomains, currentRanking, locale }`
 * @param {object} context - Universal Lambda context.
 * @returns {Promise<Response>}
 */
export async function analyze(message, context) {
  const { log, env } = context;
  const { AsyncJob: AsyncJobEntity } = context.dataAccess;
  const {
    jobId,
    keyword,
    targetUrl,
    filterDomains = [],
    locale = null,
  } = message;

  if (!hasText(jobId) || !hasText(keyword) || !hasText(targetUrl)) {
    log.error('[seo-gap-analysis] Missing required fields (jobId, keyword, targetUrl)');
    return notFound();
  }

  const job = await AsyncJobEntity.findById(jobId);
  if (!job) {
    log.error(`[seo-gap-analysis] AsyncJob ${jobId} not found`);
    return notFound();
  }

  try {
    job.setStatus(AsyncJob.Status.IN_PROGRESS);
    await job.save();

    const brightData = BrightDataClient.createFrom(context);
    const results = await brightData.googleSearchByQuery(keyword, DEFAULT_SERP_RESULTS, locale);

    const buckets = bucketSerpResults(results, {
      targetUrl,
      filterDomains,
      maxCompetitors: MAX_COMPETITORS,
    });

    // Always scrape the target so phase 2 has a baseline to diff against, plus each competitor.
    const urls = [targetUrl, ...buckets.competitors.map((c) => c.url)]
      .map((url) => ({ url }));

    log.info(
      `[seo-gap-analysis] job=${jobId} keyword="${keyword}" competitors=${buckets.competitors.length} `
      + `branded=${buckets.branded.length} filtered=${buckets.filtered.length}`,
    );

    const scrapeClient = ScrapeClient.createFrom(context);
    const scrapeJob = await scrapeClient.createScrapeJob({
      urls,
      processingType: SEO_COMPARISON_PROCESSING_TYPE,
      maxScrapeAge: 24,
      // Correlation: echoed back on the scrape completion so phase 2 can resolve the AsyncJob
      // and know which URL is the target. Also carried into completionQueueUrl routing via
      // the scrape stack's env config (AUDIT_JOBS_QUEUE_URL).
      metaData: {
        seoGapAnalysisJobId: jobId,
        targetUrl,
        completionQueueUrl: env?.AUDIT_JOBS_QUEUE_URL,
      },
    });

    // Persist buckets + the scrape job id onto the AsyncJob metadata for observability and
    // as a fallback correlation key.
    const metadata = job.getMetadata() || {};
    job.setMetadata({
      ...metadata,
      seoGapAnalysis: {
        keyword,
        targetUrl,
        scrapeJobId: scrapeJob.id,
        buckets,
      },
    });
    await job.save();

    return ok({ jobId, scrapeJobId: scrapeJob.id });
  } catch (e) {
    log.error(`[seo-gap-analysis] job=${jobId} failed in phase 1: ${e.message}`, e);
    job.setStatus(AsyncJob.Status.FAILED);
    job.setError({ code: e.code ?? 'EXCEPTION', message: e.message, details: e.stack });
    job.setEndedAt(new Date().toISOString());
    await job.save();
    return internalServerError();
  }
}

/**
 * Reads a single scraped page snapshot from S3.
 *
 * @param {object} scrapeResult - One entry of the completion message `scrapeResults`.
 * @param {object} context - Lambda context (s3Client, env, log).
 * @returns {Promise<object|null>} The seo-comparison snapshot, or null when unavailable.
 */
async function readSnapshot(scrapeResult, context) {
  const { s3Client, env, log } = context;
  const key = scrapeResult?.location || scrapeResult?.metadata?.path;
  if (!hasText(key)) {
    return null;
  }
  const obj = await getObjectFromKey(s3Client, env.S3_SCRAPER_BUCKET_NAME, key, log);
  // The stored object nests the eval output under `scrapeResult` (see content-scraper).
  return obj?.scrapeResult ? { ...obj.scrapeResult, finalUrl: obj.finalUrl } : null;
}

/**
 * Phase 2 — aggregate scrape results and compute the gap report.
 *
 * Triggered by the content-scraper `seo-comparison` completion message. Loads every scraped
 * snapshot, separates the target from the competitors, computes the SEO/GEO/AEO gap report,
 * and writes it onto the originating AsyncJob (COMPLETED).
 *
 * @param {object} message - The scrape completion message.
 * @param {object} context - Universal Lambda context.
 * @returns {Promise<Response>}
 */
export async function aggregate(message, context) {
  const { log } = context;
  const { AsyncJob: AsyncJobEntity } = context.dataAccess;

  // Correlation id is echoed by the content-scraper handler (auditContext) or carried on the
  // per-result jobMetadata / message metaData.
  const seoGapAnalysisJobId = message?.auditContext?.seoGapAnalysisJobId
    ?? message?.metaData?.seoGapAnalysisJobId
    ?? message?.scrapeResults?.[0]?.metadata?.jobMetadata?.seoGapAnalysisJobId;
  const targetUrl = message?.auditContext?.targetUrl
    ?? message?.metaData?.targetUrl;

  if (!hasText(seoGapAnalysisJobId)) {
    log.warn('[seo-gap-analysis] completion message missing seoGapAnalysisJobId; ignoring');
    return notFound();
  }

  const job = await AsyncJobEntity.findById(seoGapAnalysisJobId);
  if (!job) {
    log.error(`[seo-gap-analysis] AsyncJob ${seoGapAnalysisJobId} not found for aggregation`);
    return notFound();
  }

  try {
    const scrapeResults = isNonEmptyArray(message?.scrapeResults) ? message.scrapeResults : [];
    const snapshots = (await Promise.all(
      scrapeResults.map((r) => readSnapshot(r, context)),
    )).filter(Boolean);

    const effectiveTarget = targetUrl
      ?? job.getMetadata()?.seoGapAnalysis?.targetUrl;

    const isTarget = (s) => effectiveTarget
      && (s.url === effectiveTarget || s.finalUrl === effectiveTarget);
    const target = snapshots.find(isTarget) || null;
    const competitors = snapshots.filter((s) => !isTarget(s));

    const report = computeSeoGap(target, competitors);

    job.setStatus(AsyncJob.Status.COMPLETED);
    job.setResult(report);
    job.setEndedAt(new Date().toISOString());
    await job.save();

    log.info(
      `[seo-gap-analysis] job=${seoGapAnalysisJobId} completed: `
      + `${report.summary.gapsFound}/${report.summary.totalFactors} gaps across ${competitors.length} competitors`,
    );

    return ok({ jobId: seoGapAnalysisJobId });
  } catch (e) {
    log.error(`[seo-gap-analysis] job=${seoGapAnalysisJobId} failed in phase 2: ${e.message}`, e);
    job.setStatus(AsyncJob.Status.FAILED);
    job.setError({ code: e.code ?? 'EXCEPTION', message: e.message, details: e.stack });
    job.setEndedAt(new Date().toISOString());
    await job.save();
    return internalServerError();
  }
}
