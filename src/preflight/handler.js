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
import { validateCanonicalFormat, validateCanonicalRecursively, validateCanonicalTag } from '../canonical/handler.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
export const AUDIT_STEP_IDENTIFY = 'identify';
export const AUDIT_STEP_SUGGEST = 'suggest';
const AUDIT_NAMES = ['canonical', 'links', 'metatags', 'body-size', 'lorem-ipsum', 'h1-count'];

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
    urls: urls.map((url) => ({ url })),
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
    site, job, s3Client, log, env,
  } = context;

  const jobMetadata = job.getMetadata();
  /**
   * @type {{urls: string[], step: AUDIT_STEP_IDENTIFY | AUDIT_STEP_SUGGEST}}
   */
  const { urls, step = AUDIT_STEP_IDENTIFY } = jobMetadata.payload;
  const normalizedStep = step.toLowerCase();

  log.info(`[preflight-audit] site: ${site.getId()}. Preflight audit started for jobId: ${job.getId()} and step: ${normalizedStep}`);

  if (job.getStatus() !== AsyncJob.Status.IN_PROGRESS) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Job not in progress for jobId: ${job.getId()}. Status: ${job.getStatus()}`);
  }

  const pageAuthToken = await retrievePageAuthentication(site, context);
  const baseURL = new URL(urls[0]).origin;
  const authHeader = { headers: { Authorization: `token ${pageAuthToken}` } };

  // Initialize results
  const result = urls.map((url) => ({
    pageUrl: url,
    step: normalizedStep,
    audits: AUDIT_NAMES.map((name) => ({ name, type: 'seo', opportunities: [] })),
  }));
  const resultMap = new Map(result.map((r) => [r.pageUrl, r]));

  // Canonical checks
  const canonicalResults = await Promise.all(
    urls.map(async (url) => {
      const { canonicalUrl, checks: tagChecks } = await validateCanonicalTag(url, log, authHeader);
      const allChecks = [...tagChecks];
      if (canonicalUrl) {
        log.info(`Found Canonical URL: ${canonicalUrl}`);
        allChecks.push(...validateCanonicalFormat(canonicalUrl, baseURL, log));
        allChecks.push(...(await validateCanonicalRecursively(canonicalUrl, log, authHeader)));
      }
      return { url, checks: allChecks.filter((c) => !c.success) };
    }),
  );
  canonicalResults.forEach(({ url, checks }) => {
    const audit = resultMap.get(url).audits.find((a) => a.name === 'canonical');
    checks.forEach((check) => audit.opportunities.push({ ...check }));
  });

  // Retrieve scraped pages
  const prefix = `scrapes/${site.getId()}/`;
  const allKeys = await getObjectKeysUsingPrefix(s3Client, env.S3_SCRAPER_BUCKET_NAME, prefix, log);
  const targetKeys = new Set(urls.map((u) => `scrapes/${site.getId()}${new URL(u).pathname.replace(/\/$/, '')}/scrape.json`));
  const scrapedObjects = await Promise.all(
    allKeys
      .filter((key) => targetKeys.has(key))
      .map(async (Key) => ({
        Key, data: await getObjectFromKey(s3Client, env.S3_SCRAPER_BUCKET_NAME, Key, log),
      })),
  );

  // Internal link checks
  const { auditResult } = await runInternalLinkChecks(scrapedObjects, pageAuthToken, context);
  if (isNonEmptyArray(auditResult.brokenInternalLinks)) {
    auditResult.brokenInternalLinks.forEach(({ pageUrl, href, status }) => {
      const audit = resultMap.get(pageUrl).audits.find((a) => a.name === 'links');
      audit.opportunities.push({
        check: 'broken-internal-links',
        issue: {
          url: href,
          issue: `Status ${status}`,
          seoImpact: 'High',
          seoRecommendation: 'Fix or remove broken links',
        },
      });
    });
  }

  // Meta tags checks
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
    const audit = resultMap.get(pageUrl)?.audits.find((a) => a.name === 'metatags');
    return tags && Object.values(tags).forEach((data) => audit.opportunities.push({ ...data }));
  });

  // DOM-based checks: body size, lorem ipsum, h1 count, bad links
  scrapedObjects.forEach(({ data }) => {
    const { finalUrl, scrapeResult: { rawBody } } = data;
    const doc = new JSDOM(rawBody).window.document;

    const auditsByName = Object.fromEntries(
      resultMap.get(finalUrl).audits.map((auditEntry) => [auditEntry.name, auditEntry]),
    );

    const textContent = doc.body.textContent.replace(/\n/g, '').trim();

    if (textContent.length > 0 && textContent.length <= 100) {
      auditsByName['body-size'].opportunities.push({
        check: 'content-length',
        issue: 'Body < 100 chars',
        seoImpact: 'Moderate',
        seoRecommendation: 'Add content',
      });
    }

    if (/lorem ipsum/i.test(textContent)) {
      auditsByName['lorem-ipsum'].opportunities.push({
        check: 'lorem-ipsum',
        issue: 'Contains lorem ipsum',
        seoImpact: 'High',
        seoRecommendation: 'Replace placeholder text',
      });
    }

    const headingCount = doc.querySelectorAll('h1').length;
    if (headingCount !== 1) {
      auditsByName['h1-count'].opportunities.push({
        check: headingCount > 1 ? 'multiple-h1' : 'missing-h1',
        issue: headingCount > 1 ? `Found ${headingCount} H1 tags` : 'No H1 tag',
        seoImpact: 'High',
        seoRecommendation: 'Use exactly one H1 tag',
      });
    }

    const insecureLinks = Array.from(doc.querySelectorAll('a'))
      .filter((anchor) => anchor.href.startsWith('http://'))
      .map((anchor) => ({
        url: anchor.href,
        issue: 'Use HTTPS',
        seoImpact: 'High',
        seoRecommendation: 'Update to HTTPS',
      }));

    if (insecureLinks.length > 0) {
      auditsByName.links.opportunities.push({ check: 'bad-links', issue: insecureLinks });
    }
  });

  log.info(JSON.stringify(result));
  job.setStatus(AsyncJob.Status.COMPLETED);
  job.setResultType(AsyncJob.ResultType.INLINE);
  job.setResult(result);
  job.setEndedAt(new Date().toISOString());
  await job.save();

  log.info(`[preflight-audit] site: ${site.getId()}. Preflight audit completed for jobId: ${job.getId()}`);
};

export default new AuditBuilder()
  .withPersister(noopPersister)
  .addStep('scrape-pages', scrapePages, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('preflight-audit', preflightAudit)
  .withAsyncJob()
  .build();
