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
import { generateSuggestionData } from '../internal-links/suggestions-generator.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export function validPages(urls) {
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

  if (!validPages(urls)) {
    throw new Error(`[preflight-audit] site: ${siteId}. Invalid pages provided for scraping`);
  }

  return {
    urls,
    siteId,
    type: 'preflight',
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

  if (!validPages(urls)) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Invalid pages provided`);
  }

  if (job.getStatus() !== AsyncJob.Status.IN_PROGRESS) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Job not in progress for jobId: ${job.getId()}. Status: ${job.getStatus()}`);
  }

  const result = {
    audits: [],
  };

  // canonical
  result.audits.push({
    name: 'canonical',
    type: 'seo',
    opportunities: [],
  });

  const urlsSet = new Set(urls.map((page) => {
    const pathname = new URL(page.url).pathname.replace(/\/$/, '');
    return `scrapes/${site.getId()}${pathname}/scrape.json`;
  }));

  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}/`;
  const scrapedObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, prefix, log);
  const scrapedObjects = await Promise.all(
    scrapedObjectKeys
      .filter((key) => urlsSet.has(key))
      .map(async (key) => ({
        url: key,
        data: await getObjectFromKey(s3Client, bucketName, key, log),
      })),
  );

  // internal-links
  result.audits.push({
    name: 'internal-links',
    type: 'seo',
    opportunities: [],
  });

  const pageAuthToken = await retrievePageAuthentication(site, context);

  const brokenLinks = await runInternalLinkChecks(scrapedObjects, pageAuthToken, context);
  if (!isNonEmptyArray(brokenLinks)) {
    const baseUrl = site.getBaseURL();
    const suggestionData = await generateSuggestionData(baseUrl, brokenLinks, context, site);
    for (const url of urls) {
      const { url: pageUrl } = url;
      const suggestions = suggestionData[pageUrl];
      if (suggestions) {
        result.audits[1].opportunities.push({
          url: pageUrl,
          suggestions,
        });
      }
    }
  }

  log.info('INTERNAL LINKS CHECKS', JSON.stringify(result, null, 2));

  // metatags
  result.audits.push({
    name: 'metatags',
    type: 'seo',
    opportunities: [],
  });

  const {
    seoChecks, detectedTags, extractedTags,
  } = await metatagsAutoDetect(site, urlsSet, context);

  const allTags = {
    detectedTags,
    healthyTags: seoChecks.getFewHealthyTags(),
    extractedTags,
  };

  if (Object.keys(detectedTags).length > 0) {
    const updatedDetectedTags = await metatagsAutoSuggest(allTags, context, site);
    for (const url of urls) {
      const { url: pageUrl } = url;
      const path = new URL(pageUrl).pathname.replace(/\/$/, '');
      const tags = updatedDetectedTags[path];
      if (tags) {
        result.audits[2].opportunities.push({
          ...tags,
        });
      }
    }
  }

  log.info('METATAGS CHECKS', JSON.stringify(result, null, 2));

  // body size
  result.audits.push({
    name: 'body-size',
    type: 'seo',
    opportunities: [],
  });

  // lorem ipsum
  result.audits.push({
    name: 'lorem-ipsum',
    type: 'seo',
    opportunities: [],
  });

  scrapedObjects.forEach(({ data }) => {
    const html = data.scrapeResult.rawBody || '';
    let dom;
    try {
      dom = new JSDOM(html);
    } catch {
      // skip malformed HTML
      return;
    }

    log.info('HTML:', html);

    const bodyEl = dom.window.document.querySelector('body');
    if (!bodyEl) return;

    const text = bodyEl.textContent.replace(/\n/g, '').trim();
    const { length } = text;

    // only check pages that actually have some visible text
    if (length > 0 && length <= 100) {
      result.audits[3].opportunities.push({
        url: data.scrapeResult.finalUrl,
        length,
        excerpt: text.slice(0, 100) + (length > 100 ? '…' : ''),
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
