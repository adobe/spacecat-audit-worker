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
    },
  };
}

export const preflightAudit = async (context) => {
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

  log.info(`[preflight-audit] site: ${site.getId()}. Preflight audit started for jobId: ${job.getId()} and step: ${normalizedStep}`);

  if (job.getStatus() !== AsyncJob.Status.IN_PROGRESS) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Job not in progress for jobId: ${job.getId()}. Status: ${job.getStatus()}`);
  }

  try {
    const startTime = process.hrtime.bigint();
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
    const canonicalStartTime = process.hrtime.bigint();
    const canonicalResults = await Promise.all(
      normalizedUrls.map(async (url) => {
        const {
          canonicalUrl,
          checks: tagChecks,
        } = await validateCanonicalTag(url, log, authHeader, true);
        const allChecks = [...tagChecks];
        if (canonicalUrl) {
          log.info(`Found Canonical URL: ${canonicalUrl}`);
          allChecks.push(...validateCanonicalFormat(canonicalUrl, baseURL, log, true));
        }
        return { url, checks: allChecks.filter((c) => !c.success) };
      }),
    );
    const canonicalEndTime = process.hrtime.bigint();
    const canonicalElapsed = Number(canonicalEndTime - canonicalStartTime) / 1e9;
    log.info(`[preflight-audit] Canonical checks completed in ${canonicalElapsed.toFixed(2)} seconds`);

    canonicalResults.forEach(({ url, checks }) => {
      const audit = resultMap.get(url).audits.find((a) => a.name === AUDIT_CANONICAL);
      checks.forEach((check) => audit.opportunities.push({
        check: check.check,
        issue: check.explanation,
        seoImpact: check.seoImpact || 'Moderate',
        seoRecommendation: check.explanation,
      }));
    });

    // Retrieve scraped pages
    const scrapeStartTime = process.hrtime.bigint();
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
    const scrapeEndTime = process.hrtime.bigint();
    const scrapeElapsed = Number(scrapeEndTime - scrapeStartTime) / 1e9;
    log.info(`[preflight-audit] Page scraping completed in ${scrapeElapsed.toFixed(2)} seconds`);

    // Internal link checks
    const linksStartTime = process.hrtime.bigint();
    const { auditResult } = await runInternalLinkChecks(scrapedObjects, pageAuthToken, context);
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
    const linksEndTime = process.hrtime.bigint();
    const linksElapsed = Number(linksEndTime - linksStartTime) / 1e9;
    log.info(`[preflight-audit] Internal link checks completed in ${linksElapsed.toFixed(2)} seconds`);

    // Meta tags checks
    const metatagsStartTime = process.hrtime.bigint();
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
    const metatagsEndTime = process.hrtime.bigint();
    const metatagsElapsed = Number(metatagsEndTime - metatagsStartTime) / 1e9;
    log.info(`[preflight-audit] Meta tags checks completed in ${metatagsElapsed.toFixed(2)} seconds`);

    // DOM-based checks: body size, lorem ipsum, h1 count, bad links
    const domStartTime = process.hrtime.bigint();
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
    const domEndTime = process.hrtime.bigint();
    const domElapsed = Number(domEndTime - domStartTime) / 1e9;
    log.info(`[preflight-audit] DOM-based checks completed in ${domElapsed.toFixed(2)} seconds`);

    const endTime = process.hrtime.bigint();
    const totalElapsed = Number(endTime - startTime) / 1e9;
    log.info(`[preflight-audit] Total audit time: ${totalElapsed.toFixed(2)} seconds`);
    log.info(`[preflight-audit] Breakdown:
      - Canonical checks: ${canonicalElapsed.toFixed(2)}s
      - Page scraping: ${scrapeElapsed.toFixed(2)}s
      - Internal link checks: ${linksElapsed.toFixed(2)}s
      - Meta tags checks: ${metatagsElapsed.toFixed(2)}s
      - DOM-based checks: ${domElapsed.toFixed(2)}s`);

    // Add profiling results to each page result
    const resultWithProfiling = result.map((pageResult) => ({
      ...pageResult,
      profiling: {
        total: Number(totalElapsed).toFixed(2),
        breakdown: {
          canonical: Number(canonicalElapsed).toFixed(2),
          scraping: Number(scrapeElapsed).toFixed(2),
          links: Number(linksElapsed).toFixed(2),
          metatags: Number(metatagsElapsed).toFixed(2),
          dom: Number(domElapsed).toFixed(2),
        },
      },
    }));

    log.info(JSON.stringify(resultWithProfiling));
    job.setStatus(AsyncJob.Status.COMPLETED);
    job.setResultType(AsyncJob.ResultType.INLINE);
    job.setResult(resultWithProfiling);
    job.setEndedAt(new Date().toISOString());
    await job.save();
  } catch (error) {
    log.error(`[preflight-audit] site: ${site.getId()}. Error during preflight audit for jobId: ${job.getId()}`, error);
    job.setStatus(AsyncJob.Status.FAILED);
    job.setError({ code: '', message: error.message });
    await job.save();
    throw error;
  }

  log.info(`[preflight-audit] site: ${site.getId()}. Preflight audit completed for jobId: ${job.getId()}`);
};

export default new AuditBuilder()
  .withPersister(noopPersister)
  .addStep('scrape-pages', scrapePages, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('preflight-audit', preflightAudit)
  .withAsyncJob()
  .build();
