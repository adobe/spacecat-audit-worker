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

const { AUDIT_STEP_DESTINATIONS } = Audit;

export function isValidUrls(urls) {
  return (
    isNonEmptyArray(urls)
    && urls.every((page) => isValidUrl(page.url))
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
    urls,
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
  const { urls } = jobMetadata.payload;

  if (job.getStatus() !== AsyncJob.Status.IN_PROGRESS) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Job not in progress for jobId: ${job.getId()}. Status: ${job.getStatus()}`);
  }

  const result = {
    audits: [],
  };

  result.audits.push({
    name: 'canonical',
    type: 'seo',
    opportunities: [],
  });

  const storagePathSet = new Set(urls.map((url) => {
    const pathname = new URL(url.url).pathname.replace(/\/$/, '');
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

  result.audits.push({
    name: 'internal-links',
    type: 'seo',
    opportunities: [],
  });

  const pageAuthToken = await retrievePageAuthentication(site, context);

  const { auditResult } = await runInternalLinkChecks(scrapedObjects, pageAuthToken, context);
  if (isNonEmptyArray(auditResult.brokenInternalLinks)) {
    for (const { url } of urls) {
      const brokenLinks = auditResult.brokenInternalLinks.filter((link) => link.pageUrl === url);
      brokenLinks.forEach((link) => {
        result.audits[1].opportunities.push({
          ...link,
        });
      });
    }
  }

  result.audits.push({
    name: 'metatags',
    type: 'seo',
    opportunities: [],
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

    const updatedDetectedTags = await metatagsAutoSuggest(allTags, context, site);

    for (const { url } of urls) {
      const path = new URL(url).pathname.replace(/\/$/, '');
      const tags = updatedDetectedTags[path];
      if (tags) {
        Object.entries(tags).forEach(([tagName, tagData]) => {
          result.audits[2].opportunities.push({
            tagName,
            tagContent: tagData.tagContent,
            issue: tagData.issue,
            issueDetails: tagData.issueDetails,
            seoImpact: tagData.seoImpact,
            seoRecommendation: tagData.seoRecommendation,
            aiSuggestion: tagData.aiSuggestion,
            aiRationale: tagData.aiRationale,
          });
        });
      }
    }
  }

  result.audits.push({
    name: 'body-size',
    type: 'seo',
    opportunities: [],
  });

  result.audits.push({
    name: 'lorem-ipsum',
    type: 'seo',
    opportunities: [],
  });

  scrapedObjects.forEach(({ data }) => {
    const html = data.scrapeResult.rawBody;
    const dom = new JSDOM(html);

    const bodyEl = dom.window.document.querySelector('body');
    const text = bodyEl.textContent.replace(/\n/g, '').trim();
    const { length } = text;

    // only check pages that actually have some visible text
    if (length > 0 && length <= 100) {
      result.audits[3].opportunities.push({
        url: data.scrapeResult.finalUrl,
        length,
        excerpt: `${text.slice(0, 100)}…`,
        message: `Page body text is only ${length} characters; should be >100.`,
      });
    }

    const isLoremIpsum = text.toLowerCase().includes('lorem ipsum');
    if (isLoremIpsum) {
      result.audits[4].opportunities.push({
        url: data.scrapeResult.finalUrl,
        message: 'Page body text contains "lorem ipsum".',
      });
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
