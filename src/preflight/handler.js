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

import { isNonEmptyArray, isValidUrl, retrievePageAuthentication } from '@adobe/spacecat-shared-utils';
import { Audit, AsyncJob } from '@adobe/spacecat-shared-data-access';
import { JSDOM } from 'jsdom';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopPersister } from '../common/index.js';
import { metatagsAutoDetect } from '../metatags/handler.js';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../utils/s3-utils.js';
import metatagsAutoSuggest from '../metatags/metatags-auto-suggest.js';
import { runInternalLinkChecks } from './internal-links.js';
import { validateCanonicalFormat, validateCanonicalTag } from '../canonical/handler.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
export const AUDIT_STEP_IDENTIFY = 'identify';
export const AUDIT_STEP_SUGGEST = 'suggest';
const AUDIT_CANONICAL = 'canonical';
const AUDIT_LINKS = 'links';
const AUDIT_METATAGS = 'metatags';
const AUDIT_BODY_SIZE = 'body-size';
const AUDIT_LOREM_IPSUM = 'lorem-ipsum';
const AUDIT_H1_COUNT = 'h1-count';
const AUDITS = {
  seo: [
    AUDIT_CANONICAL,
    AUDIT_LINKS,
    AUDIT_METATAGS,
    AUDIT_BODY_SIZE,
    AUDIT_LOREM_IPSUM,
    AUDIT_H1_COUNT,
  ],
};

export function isValidUrls(urls) {
  return (
    isNonEmptyArray(urls)
    && urls.every((url) => isValidUrl(url))
  );
}

async function saveIntermediateResults(job, result, logger) {
  try {
    job.setStatus(AsyncJob.Status.IN_PROGRESS);
    job.setResultType(AsyncJob.ResultType.INLINE);
    job.setResult(result);
    await job.save();
    logger.warn('Intermediate results saved successfully');
  } catch (error) {
    // ignore any intermediate errors
    logger.warn(`Failed to save intermediate results: ${error.message}`);
  }
}

export async function scrapePages(context) {
  const { site, job } = context;
  const siteId = site.getId();

  const jobMetadata = job.getMetadata();
  const { urls } = jobMetadata.payload;

  if (!isValidUrls(urls)) {
    throw new Error(`[preflight-audit] site: ${siteId}. Invalid urls provided for scraping`);
  }

  return {
    urls: urls.map((url) => {
      const urlObj = new URL(url);
      return {
        url: `${urlObj.origin}${urlObj.pathname.replace(/\/$/, '')}`,
      };
    }),
    siteId: site.getId(),
    type: 'preflight',
    allowCache: false,
    options: {
      enableAuthentication: true,
      screenshotTypes: [],
    },
  };
}

export const preflightAudit = async (context) => {
  const startTime = Date.now();
  const startTimestamp = new Date().toISOString();

  const {
    site, job, s3Client, log,
  } = context;
  const { S3_SCRAPER_BUCKET_NAME } = context.env;

  const jobMetadata = job.getMetadata();
  /**
   * @type {{urls: string[], step: AUDIT_STEP_IDENTIFY | AUDIT_STEP_SUGGEST}}
   */
  const { urls, step = AUDIT_STEP_IDENTIFY } = jobMetadata.payload;
  const normalizedStep = step.toLowerCase();
  const normalizedUrls = urls.map((url) => {
    if (!isValidUrl(url)) {
      throw new Error(`[preflight-audit] site: ${site.getId()}. Invalid URL provided: ${url}`);
    }
    const urlObj = new URL(url);
    return `${urlObj.origin}${urlObj.pathname.replace(/\/$/, '')}`;
  });

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Preflight audit started.`);

  if (job.getStatus() !== AsyncJob.Status.IN_PROGRESS) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Job not in progress for jobId: ${job.getId()}. Status: ${job.getStatus()}`);
  }
  const intermediateStepLogger = (checkName) => ({
    warn: (message) => log.warn(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. ${checkName}: ${message}`),
  });

  try {
    const pageAuthToken = await retrievePageAuthentication(site, context);
    const baseURL = new URL(normalizedUrls[0]).origin;
    const authHeader = { headers: { Authorization: `token ${pageAuthToken}` } };

    // Initialize results
    const result = normalizedUrls.map((url) => ({
      pageUrl: url,
      step: normalizedStep,
      audits: AUDITS.seo.map((auditName) => ({ name: auditName, type: 'seo', opportunities: [] })),
    }));
    const resultMap = new Map(result.map((r) => [r.pageUrl, r]));

    // Canonical checks
    const canonicalStartTime = Date.now();
    const canonicalStartTimestamp = new Date().toISOString();
    const canonicalResults = await Promise.all(
      normalizedUrls.map(async (url) => {
        const {
          canonicalUrl,
          checks: tagChecks,
        } = await validateCanonicalTag(url, log, authHeader, true);
        const allChecks = [...tagChecks];
        if (canonicalUrl) {
          log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Found Canonical URL: ${canonicalUrl}`);
          allChecks.push(...validateCanonicalFormat(canonicalUrl, baseURL, log, true));
        }
        return { url, checks: allChecks.filter((c) => !c.success) };
      }),
    );
    const canonicalEndTime = Date.now();
    const canonicalEndTimestamp = new Date().toISOString();
    const canonicalElapsed = ((canonicalEndTime - canonicalStartTime) / 1000).toFixed(2);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Canonical audit completed in ${canonicalElapsed} seconds`);

    canonicalResults.forEach(({ url, checks }) => {
      const audit = resultMap.get(url).audits.find((a) => a.name === AUDIT_CANONICAL);
      checks.forEach((check) => audit.opportunities.push({
        check: check.check,
        issue: check.explanation,
        seoImpact: check.seoImpact || 'Moderate',
        seoRecommendation: check.explanation,
      }));
    });

    const canonicalAuditLogger = intermediateStepLogger('canonical audit');
    await saveIntermediateResults(job, result, canonicalAuditLogger);

    // Retrieve scraped pages
    const prefix = `scrapes/${site.getId()}/`;
    const allKeys = await getObjectKeysUsingPrefix(s3Client, S3_SCRAPER_BUCKET_NAME, prefix, log);
    const targetKeys = new Set(normalizedUrls.map((u) => `scrapes/${site.getId()}${new URL(u).pathname.replace(/\/$/, '')}/scrape.json`));
    const scrapedObjects = await Promise.all(
      allKeys
        .filter((key) => targetKeys.has(key))
        .map(async (Key) => ({
          Key, data: await getObjectFromKey(s3Client, S3_SCRAPER_BUCKET_NAME, Key, log),
        })),
    );

    // Internal link checks
    const internalLinksStartTime = Date.now();
    const internalLinksStartTimestamp = new Date().toISOString();
    const { auditResult } = await runInternalLinkChecks(scrapedObjects, context, {
      pageAuthToken: `token ${pageAuthToken}`,
    });
    if (isNonEmptyArray(auditResult.brokenInternalLinks)) {
      auditResult.brokenInternalLinks.forEach(({ pageUrl, href, status }) => {
        const audit = resultMap.get(pageUrl).audits.find((a) => a.name === AUDIT_LINKS);
        audit.opportunities.push({
          check: 'broken-internal-links',
          issue: {
            url: href,
            issue: `Status ${status}`,
            seoImpact: 'High',
            seoRecommendation: 'Fix or remove broken links to improve user experience and SEO',
          },
        });
      });
    }
    const internalLinksEndTime = Date.now();
    const internalLinksEndTimestamp = new Date().toISOString();
    const internalLinksElapsed = ((internalLinksEndTime - internalLinksStartTime) / 1000)
      .toFixed(2);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Internal links audit completed in ${internalLinksElapsed} seconds`);

    const internalLinksAuditLogger = intermediateStepLogger('internal links audit');
    await saveIntermediateResults(job, result, internalLinksAuditLogger);

    // Meta tags checks
    const metatagsStartTime = Date.now();
    const metatagsStartTimestamp = new Date().toISOString();
    const {
      seoChecks,
      detectedTags,
      extractedTags,
    } = await metatagsAutoDetect(site, targetKeys, context);
    const tagCollection = normalizedStep === AUDIT_STEP_SUGGEST
      ? await metatagsAutoSuggest({
        detectedTags,
        healthyTags: seoChecks.getFewHealthyTags(),
        extractedTags,
      }, context, site, { forceAutoSuggest: true })
      : detectedTags;
    Object.entries(tagCollection).forEach(([path, tags]) => {
      const pageUrl = `${baseURL}${path}`;
      const audit = resultMap.get(pageUrl)?.audits.find((a) => a.name === AUDIT_METATAGS);
      return tags && Object.values(tags).forEach((data, tag) => audit.opportunities.push({
        ...data,
        tagName: Object.keys(tags)[tag],
      }));
    });
    const metatagsEndTime = Date.now();
    const metatagsEndTimestamp = new Date().toISOString();
    const metatagsElapsed = ((metatagsEndTime - metatagsStartTime) / 1000).toFixed(2);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Meta tags audit completed in ${metatagsElapsed} seconds`);

    const metaTagsAuditLogger = intermediateStepLogger('meta tags audit');
    await saveIntermediateResults(job, result, metaTagsAuditLogger);

    // DOM-based checks: body size, lorem ipsum, h1 count, bad links
    const domStartTime = Date.now();
    const domStartTimestamp = new Date().toISOString();
    scrapedObjects.forEach(({ data }) => {
      const { finalUrl, scrapeResult: { rawBody } } = data;
      const doc = new JSDOM(rawBody).window.document;

      const auditsByName = Object.fromEntries(
        resultMap.get(finalUrl).audits.map((auditEntry) => [auditEntry.name, auditEntry]),
      );

      const textContent = doc.body.textContent.replace(/\n/g, '').trim();

      if (textContent.length > 0 && textContent.length <= 100) {
        auditsByName[AUDIT_BODY_SIZE].opportunities.push({
          check: 'content-length',
          issue: 'Body content length is below 100 characters',
          seoImpact: 'Moderate',
          seoRecommendation: 'Add more meaningful content to the page',
        });
      }

      if (/lorem ipsum/i.test(textContent)) {
        auditsByName[AUDIT_LOREM_IPSUM].opportunities.push({
          check: 'placeholder-text',
          issue: 'Found Lorem ipsum placeholder text in the page content',
          seoImpact: 'High',
          seoRecommendation: 'Replace placeholder text with meaningful content',
        });
      }

      const headingCount = doc.querySelectorAll('h1').length;
      if (headingCount !== 1) {
        auditsByName[AUDIT_H1_COUNT].opportunities.push({
          check: headingCount > 1 ? 'multiple-h1' : 'missing-h1',
          issue: headingCount > 1 ? `Found ${headingCount} H1 tags` : 'No H1 tag found on the page',
          seoImpact: 'High',
          seoRecommendation: 'Use exactly one H1 tag per page for better SEO structure',
        });
      }

      const insecureLinks = Array.from(doc.querySelectorAll('a'))
        .filter((anchor) => anchor.href.startsWith('http://'))
        .map((anchor) => ({
          url: anchor.href,
          issue: 'Link using HTTP instead of HTTPS',
          seoImpact: 'High',
          seoRecommendation: 'Update all links to use HTTPS protocol',
        }));

      if (insecureLinks.length > 0) {
        auditsByName[AUDIT_LINKS].opportunities.push({ check: 'bad-links', issue: insecureLinks });
      }
    });
    const domEndTime = Date.now();
    const domEndTimestamp = new Date().toISOString();
    const domElapsed = ((domEndTime - domStartTime) / 1000).toFixed(2);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. DOM-based audit completed in ${domElapsed} seconds`);

    const domAuditLogger = intermediateStepLogger('DOM-based audit');
    await saveIntermediateResults(job, result, domAuditLogger);

    const endTime = Date.now();
    const endTimestamp = new Date().toISOString();
    const totalElapsed = ((endTime - startTime) / 1000).toFixed(2);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Total audit time: ${totalElapsed} seconds`);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Audit started at: ${startTimestamp}`);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Audit completed at: ${endTimestamp}`);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Breakdown:
      - Canonical audit: ${canonicalElapsed}s (${canonicalStartTimestamp} - ${canonicalEndTimestamp})
      - Internal links audit: ${internalLinksElapsed}s (${internalLinksStartTimestamp} - ${internalLinksEndTimestamp})
      - Meta tags audit: ${metatagsElapsed}s (${metatagsStartTimestamp} - ${metatagsEndTimestamp})
      - DOM-based audit: ${domElapsed}s (${domStartTimestamp} - ${domEndTimestamp})`);

    // Add profiling results to each page result
    const resultWithProfiling = result.map((pageResult) => ({
      ...pageResult,
      profiling: {
        total: `${totalElapsed} seconds`,
        startTime: startTimestamp,
        endTime: endTimestamp,
        breakdown: [
          {
            name: 'canonical',
            duration: `${canonicalElapsed} seconds`,
            startTime: canonicalStartTimestamp,
            endTime: canonicalEndTimestamp,
          },
          {
            name: 'links',
            duration: `${internalLinksElapsed} seconds`,
            startTime: internalLinksStartTimestamp,
            endTime: internalLinksEndTimestamp,
          },
          {
            name: 'metatags',
            duration: `${metatagsElapsed} seconds`,
            startTime: metatagsStartTimestamp,
            endTime: metatagsEndTimestamp,
          },
          {
            name: 'dom',
            duration: `${domElapsed} seconds`,
            startTime: domStartTimestamp,
            endTime: domEndTimestamp,
          },
        ],
      },
    }));

    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. ${JSON.stringify(resultWithProfiling)}`);

    job.setStatus(AsyncJob.Status.COMPLETED);
    job.setResultType(AsyncJob.ResultType.INLINE);
    job.setResult(resultWithProfiling);
    job.setEndedAt(new Date().toISOString());
    await job.save();
  } catch (error) {
    log.error(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Error during preflight audit.`, error);
    job.setStatus(AsyncJob.Status.FAILED);
    job.setError({ code: '', message: error.message });
    await job.save();
    throw error;
  }

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${normalizedStep}. Preflight audit completed.`);
};

export default new AuditBuilder()
  .withPersister(noopPersister)
  .addStep('scrape-pages', scrapePages, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('preflight-audit', preflightAudit)
  .withAsyncJob()
  .build();
