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
    siteId,
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

  const jobMetadata = job.getMetadata();
  /**
   * @type {{urls: string[], step: AUDIT_STEP_IDENTIFY | AUDIT_STEP_SUGGEST}}
   */
  const { urls, step = AUDIT_STEP_IDENTIFY } = jobMetadata.payload;
  const normalizedStep = step.toLowerCase();

  log.info(`[preflight-audit] site: ${site.getId()}. Preflight audit started for jobId: ${job.getId()}`);
  log.info(`[preflight-audit] site: ${site.getId()}. Step: ${normalizedStep}`);

  if (job.getStatus() !== AsyncJob.Status.IN_PROGRESS) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Job not in progress for jobId: ${job.getId()}. Status: ${job.getStatus()}`);
  }

  const pageAuthToken = await retrievePageAuthentication(site, context);
  const baseURL = new URL(urls[0]).origin;
  const authHeader = { headers: { Authorization: `token ${pageAuthToken}` } };

  const result = urls.map((url) => ({
    pageUrl: url,
    step: normalizedStep,
    audits: [],
  }));

  result.forEach((item) => {
    item.audits.push({
      name: 'canonical',
      type: 'seo',
      opportunities: [],
    });
  });

  const canonicalChecks = urls.map(async (url) => {
    const checks = [];
    const {
      canonicalUrl, checks: canonicalTagChecks,
    } = await validateCanonicalTag(url, log, authHeader);
    checks.push(...canonicalTagChecks);

    if (canonicalUrl) {
      log.info(`Found Canonical URL: ${canonicalUrl}`);

      const urlFormatChecks = validateCanonicalFormat(canonicalUrl, baseURL, log);
      checks.push(...urlFormatChecks);

      const urlContentCheck = await validateCanonicalRecursively(canonicalUrl, log, authHeader);
      checks.push(...urlContentCheck);
    }
    return { url, checks };
  });

  const canonicalResults = await Promise.all(canonicalChecks);

  canonicalResults.forEach(({ url, checks }) => {
    const auditResult = result.find((item) => item.pageUrl === url);
    if (auditResult) {
      checks.forEach((check) => {
        if (!check.success) {
          auditResult.audits.find((audit) => audit.name === 'canonical').opportunities.push({
            ...check,
          });
        }
      });
    }
  });

  const storagePathSet = new Set(urls.map((url) => {
    const pathname = new URL(url).pathname.replace(/\/$/, '');
    return `scrapes/${site.getId()}${pathname}/scrape.json`;
  }));

  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}/`;
  const scrapedObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, prefix, log);
  const scrapedObjects = await Promise.all(
    scrapedObjectKeys
      .filter((key) => storagePathSet.has(key))
      .map(async (key) => ({
        url: key,
        data: await getObjectFromKey(s3Client, bucketName, key, log),
      })),
  );

  result.forEach((item) => {
    item.audits.push({
      name: 'links',
      type: 'seo',
      opportunities: [],
    });
  });

  const { auditResult } = await runInternalLinkChecks(scrapedObjects, pageAuthToken, context);
  if (isNonEmptyArray(auditResult.brokenInternalLinks)) {
    for (const url of urls) {
      const brokenLinks = auditResult.brokenInternalLinks.filter((link) => link.pageUrl === url);
      const linkAudits = result.find((item) => item.pageUrl === url);
      if (linkAudits) {
        brokenLinks.forEach((brokenLink) => {
          linkAudits.audits.find((audit) => audit.name === 'links').opportunities.push({
            check: 'broken-internal-links',
            issue: {
              url: brokenLink.href,
              issue: `Link returning ${brokenLink.status} status code`,
              seoImpact: 'High',
              seoRecommendation: 'Fix or remove broken links to improve user experience',
            },
          });
        });
      }
    }
  }

  result.forEach((item) => {
    item.audits.push({
      name: 'metatags',
      type: 'seo',
      opportunities: [],
    });
  });

  const {
    seoChecks, detectedTags, extractedTags,
  } = await metatagsAutoDetect(site, storagePathSet, context);

  if (Object.keys(detectedTags).length > 0) {
    const allTags = {
      detectedTags,
      healthyTags: seoChecks.getFewHealthyTags(),
      extractedTags,
    };

    const updatedDetectedTags = normalizedStep === AUDIT_STEP_SUGGEST
      ? await metatagsAutoSuggest(allTags, context, site, { forceAutoSuggest: true })
      : detectedTags;

    for (const url of urls) {
      const path = new URL(url).pathname.replace(/\/$/, '');
      const tags = updatedDetectedTags[path];
      const tagAudits = result.find((item) => item.pageUrl === url);
      if (tags && tagAudits) {
        Object.entries(tags).forEach(([tagName, tagData]) => {
          tagAudits.audits.find((audit) => audit.name === 'metatags').opportunities.push({
            tagName,
            tagContent: tagData.tagContent,
            issue: tagData.issue,
            issueDetails: tagData.issueDetails,
            seoImpact: tagData.seoImpact,
            seoRecommendation: tagData.seoRecommendation,
            ...(normalizedStep === AUDIT_STEP_SUGGEST ? {
              aiSuggestion: tagData.aiSuggestion,
              aiRationale: tagData.aiRationale,
            } : {}),
          });
        });
      }
    }
  }

  result.forEach((item) => {
    item.audits.push({
      name: 'body-size',
      type: 'seo',
      opportunities: [],
    });
  });

  result.forEach((item) => {
    item.audits.push({
      name: 'lorem-ipsum',
      type: 'seo',
      opportunities: [],
    });
  });

  result.forEach((item) => {
    item.audits.push({
      name: 'h1-count',
      type: 'seo',
      opportunities: [],
    });
  });

  scrapedObjects.forEach(({ data }) => {
    const html = data.scrapeResult.rawBody;
    const dom = new JSDOM(html);

    const bodyEl = dom.window.document.querySelector('body');
    const text = bodyEl.textContent.replace(/\n/g, '').trim();
    const { length } = text;

    // only check pages that actually have some visible text
    if (length > 0 && length <= 100) {
      const bodySizeAudits = result.find((item) => item.pageUrl === data.finalUrl);
      bodySizeAudits.audits.find((audit) => audit.name === 'body-size').opportunities.push({
        check: 'content-length',
        issue: 'Body content length is below 100 characters',
        seoImpact: 'Moderate',
        seoRecommendation: 'Add more meaningful content to the page',
      });
    }

    const isLoremIpsum = text.toLowerCase().includes('lorem ipsum');
    if (isLoremIpsum) {
      const loremIpsumAudits = result.find((item) => item.pageUrl === data.finalUrl);
      loremIpsumAudits.audits.find((audit) => audit.name === 'lorem-ipsum').opportunities.push({
        check: 'lorem-ipsum',
        issue: 'Page body text contains "lorem ipsum"',
        seoImpact: 'High',
        seoRecommendation: 'Remove placeholder text and replace with meaningful content',
      });
    }

    if (data.tags.h1.length > 1 || data.tags.h1.length === 0) {
      const h1CountAudits = result.find((item) => item.pageUrl === data.finalUrl);
      const h1Count = data.tags.h1.length;
      if (h1Count > 1) {
        h1CountAudits.audits.find((audit) => audit.name === 'h1-count').opportunities.push({
          check: 'multiple-h1',
          issue: `Page contains ${h1Count} H1 tags`,
          seoImpact: 'High',
          seoRecommendation: 'Use only one H1 tag per page for better SEO structure',
        });
      }
      if (h1Count === 0) {
        h1CountAudits.audits.find((audit) => audit.name === 'h1-count').opportunities.push({
          check: 'missing-h1',
          issue: 'No H1 tag found on the page',
          seoImpact: 'High',
          seoRecommendation: 'Add an H1 tag to the page for better SEO structure',
        });
      }
    }
  });

  scrapedObjects.forEach(({ data }) => {
    const html = data.scrapeResult.rawBody;
    const dom = new JSDOM(html);
    const badResults = [];

    [...dom.window.document.querySelectorAll('a')].forEach((link) => {
      if (link.href && link.href.startsWith('http://')) {
        const httpLink = {
          url: link.href,
          issue: 'Link using HTTP instead of HTTPS',
          seoImpact: 'High',
          seoRecommendation: 'Update all links to use HTTPS protocol',
        };
        badResults.push(httpLink);
      }
    });

    const linkAudits = result.find((item) => item.pageUrl === data.finalUrl);
    linkAudits.audits.find((audit) => audit.name === 'links').opportunities.push({
      check: 'bad-links',
      issue: badResults,
    });
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
