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

import { isValidUrl, retrievePageAuthentication, stripTrailingSlash } from '@adobe/spacecat-shared-utils';
import { Audit, AsyncJob } from '@adobe/spacecat-shared-data-access';
import { JSDOM } from 'jsdom';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopPersister, noopUrlResolver } from '../common/index.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import {
  getPrefixedPageAuthToken, isValidUrls, saveIntermediateResults,
} from './utils.js';
import canonical from './canonical.js';
import metatags from './metatags.js';
import links from './links.js';
import readability from '../readability/handler.js';
import accessibility from './accessibility.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
export const PREFLIGHT_STEP_IDENTIFY = 'identify';
export const PREFLIGHT_STEP_SUGGEST = 'suggest';

export const AUDIT_BODY_SIZE = 'body-size';
export const AUDIT_LOREM_IPSUM = 'lorem-ipsum';
export const AUDIT_H1_COUNT = 'h1-count';

/**
 * NOTE: When adding a new audit check:
 * 1. Define the constant here.
 * 2. Update the AVAILABLE_CHECKS array defined in:
 *    https://github.com/adobe/spacecat-api-service/blob/main/src/controllers/preflight.js
 *    for the POST /preflight/jobs API endpoint.
 */
export const PREFLIGHT_HANDLERS = {
  canonical,
  metatags,
  links,
  readability,
  accessibility,
};

export async function scrapePages(context) {
  const { site, job } = context;
  const siteId = site.getId();

  const jobMetadata = job.getMetadata();
  const { urls, enableAuthentication = true } = jobMetadata.payload;

  if (!isValidUrls(urls)) {
    throw new Error(`[preflight-audit] site: ${siteId}. Invalid urls provided for scraping`);
  }

  return {
    urls: urls.map((url) => ({
      url: `${stripTrailingSlash(url)}`,
    })),
    siteId: site.getId(),
    type: 'preflight',
    allowCache: false,
    options: {
      enableAuthentication,
      screenshotTypes: [],
      ...(context.promiseToken ? { promiseToken: context.promiseToken } : {}),
    },
  };
}

export const preflightAudit = async (context) => {
  const startTime = Date.now();
  const startTimestamp = new Date().toISOString();

  const {
    site, job, s3Client, log, dataAccess, scrapeResultMap,
  } = context;
  const { AsyncJob: AsyncJobEntity } = dataAccess;
  const { S3_SCRAPER_BUCKET_NAME } = context.env;
  const jobId = job.getId();

  const jobMetadata = job.getMetadata();
  /**
   * @type {{
   *   urls: string[],
   *   step: PREFLIGHT_STEP_IDENTIFY | PREFLIGHT_STEP_SUGGEST, checks?: string[],
   * }}
   */
  const {
    urls,
    step: rawStep = PREFLIGHT_STEP_IDENTIFY,
    checks,
    enableAuthentication = true,
  } = jobMetadata.payload;
  const step = rawStep.toLowerCase();
  context.step = step;
  const previewUrls = urls.map((url) => {
    if (!isValidUrl(url)) {
      throw new Error(`[preflight-audit] site: ${site.getId()}. Invalid URL provided: ${url}`);
    }
    return stripTrailingSlash(url);
  });

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Preflight audit started.`);

  if (job.getStatus() !== AsyncJob.Status.IN_PROGRESS) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Job not in progress for jobId: ${job.getId()}. Status: ${job.getStatus()}`);
  }

  const timeExecutionBreakdown = [];

  try {
    let pageAuthToken = null;
    if (enableAuthentication) {
      const options = {
        ...(context.promiseToken ? { promiseToken: context.promiseToken } : {}),
      };
      pageAuthToken = await retrievePageAuthentication(site, context, options);
      pageAuthToken = getPrefixedPageAuthToken(site, pageAuthToken, options);
    }

    const previewBaseURL = new URL(previewUrls[0]).origin;
    const authHeader = pageAuthToken ? { headers: { Authorization: pageAuthToken } } : {};

    // Retrieve scraped pages
    const s3Keys = new Set(scrapeResultMap.values());
    const scrapedObjects = await Promise.all(
      [...s3Keys].map(async (Key) => ({
        Key, data: await getObjectFromKey(s3Client, S3_SCRAPER_BUCKET_NAME, Key, log),
      })),
    );

    // Initialize results
    const auditsResult = previewUrls.map((url) => ({
      pageUrl: url,
      step,
      audits: [],
    }));
    const audits = new Map(auditsResult.map((r) => [r.pageUrl, r]));

    // DOM-based checks: body size, lorem ipsum, h1 count
    if (!checks || checks.includes(AUDIT_BODY_SIZE) || checks.includes(AUDIT_LOREM_IPSUM)
      || checks.includes(AUDIT_H1_COUNT)) {
      const domStartTime = Date.now();
      const domStartTimestamp = new Date().toISOString();
      // Create DOM-based audit entries for all pages
      previewUrls.forEach((url) => {
        const pageResult = audits.get(url);
        if (!checks || checks.includes(AUDIT_BODY_SIZE)) {
          pageResult.audits.push({ name: AUDIT_BODY_SIZE, type: 'seo', opportunities: [] });
        }
        if (!checks || checks.includes(AUDIT_LOREM_IPSUM)) {
          pageResult.audits.push({ name: AUDIT_LOREM_IPSUM, type: 'seo', opportunities: [] });
        }
        if (!checks || checks.includes(AUDIT_H1_COUNT)) {
          pageResult.audits.push({ name: AUDIT_H1_COUNT, type: 'seo', opportunities: [] });
        }
      });

      scrapedObjects.forEach(({ data }) => {
        const { finalUrl, scrapeResult: { rawBody } } = data;
        const pageResult = audits.get(stripTrailingSlash(finalUrl));
        const doc = new JSDOM(rawBody).window.document;

        const auditsByName = Object.fromEntries(
          pageResult.audits.map((auditEntry) => [auditEntry.name, auditEntry]),
        );

        const textContent = doc.body.textContent.replace(/\n/g, '').trim();

        if (!checks || checks.includes(AUDIT_BODY_SIZE)) {
          if (textContent.length > 0 && textContent.length <= 100) {
            auditsByName[AUDIT_BODY_SIZE].opportunities.push({
              check: 'content-length',
              issue: 'Body content length is below 100 characters',
              seoImpact: 'Moderate',
              seoRecommendation: 'Add more meaningful content to the page',
            });
          }
        }

        if ((!checks || checks.includes(AUDIT_LOREM_IPSUM)) && /lorem ipsum/i.test(textContent)) {
          auditsByName[AUDIT_LOREM_IPSUM].opportunities.push({
            check: 'placeholder-text',
            issue: 'Found Lorem ipsum placeholder text in the page content',
            seoImpact: 'High',
            seoRecommendation: 'Replace placeholder text with meaningful content',
          });
        }

        if (!checks || checks.includes(AUDIT_H1_COUNT)) {
          const headingCount = doc.querySelectorAll('h1').length;
          if (headingCount !== 1) {
            auditsByName[AUDIT_H1_COUNT].opportunities.push({
              check: headingCount > 1 ? 'multiple-h1' : 'missing-h1',
              issue: headingCount > 1 ? `Found ${headingCount} H1 tags` : 'No H1 tag found on the page',
              seoImpact: 'High',
              seoRecommendation: 'Use exactly one H1 tag per page for better SEO structure',
            });
          }
        }
      });
      const domEndTime = Date.now();
      const domEndTimestamp = new Date().toISOString();
      const domElapsed = ((domEndTime - domStartTime) / 1000).toFixed(2);
      log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. DOM-based audit completed in ${domElapsed} seconds`);

      timeExecutionBreakdown.push({
        name: 'dom',
        duration: `${domElapsed} seconds`,
        startTime: domStartTimestamp,
        endTime: domEndTimestamp,
      });

      await saveIntermediateResults(context, auditsResult, 'DOM-based audit');
    }

    // Execute all preflight handlers
    const handlerResults = await Object.keys(PREFLIGHT_HANDLERS).reduce(
      async (accPromise, handler) => {
        const acc = await accPromise;
        const res = await PREFLIGHT_HANDLERS[handler](context, {
          checks,
          authHeader,
          previewBaseURL,
          previewUrls,
          step,
          audits,
          auditsResult,
          s3Keys,
          scrapedObjects,
          pageAuthToken,
          urls,
          timeExecutionBreakdown,
          scrapeResultMap,
        });
        return [...acc, res];
      },
      Promise.resolve([]),
    );

    const endTime = Date.now();
    const endTimestamp = new Date().toISOString();
    const totalElapsed = ((endTime - startTime) / 1000).toFixed(2);

    // Add profiling results to each page auditsResult
    const resultWithProfiling = auditsResult.map((pageResult) => ({
      ...pageResult,
      profiling: {
        total: `${totalElapsed} seconds`,
        startTime: startTimestamp,
        endTime: endTimestamp,
        breakdown: timeExecutionBreakdown,
      },
    }));

    log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. resultWithProfiling: ${JSON.stringify(resultWithProfiling)}`);

    const jobEntity = await AsyncJobEntity.findById(jobId);
    const anyProcessing = handlerResults.some((r) => r && r.processing === true);
    jobEntity.setResultType(AsyncJob.ResultType.INLINE);
    jobEntity.setResult(resultWithProfiling);
    if (anyProcessing) {
      // Keep the job in progress while waiting for Mystique guidance
      jobEntity.setStatus(AsyncJob.Status.IN_PROGRESS);
      // Do not set endedAt yet
    } else {
      jobEntity.setStatus(AsyncJob.Status.COMPLETED);
      jobEntity.setEndedAt(new Date().toISOString());
    }
    await jobEntity.save();
  } catch (error) {
    log.error(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Error during preflight audit.`, error);
    const jobEntity = await AsyncJobEntity.findById(jobId);
    jobEntity.setStatus(AsyncJob.Status.FAILED);
    jobEntity.setError({
      code: 'EXCEPTION',
      message: error.message,
      details: error.stack,
    });
    jobEntity.setEndedAt(new Date().toISOString());
    await jobEntity.save();
    throw error;
  }

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Preflight audit completed.`);
};

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withPersister(noopPersister)
  .addStep('scrape-pages', scrapePages, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('preflight-audit', preflightAudit)
  .withAsyncJob()
  .build();
