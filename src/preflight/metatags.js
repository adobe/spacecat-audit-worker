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

import { stripTrailingSlash } from '@adobe/spacecat-shared-utils';
import { load as cheerioLoad } from 'cheerio';
import { saveIntermediateResults } from './utils.js';
import { metatagsAutoDetect } from '../metatags/handler.js';
import metatagsAutoSuggest from '../metatags/metatags-auto-suggest.js';
import { getDomElementSelector, toElementTargets } from '../utils/dom-selector.js';

export const PREFLIGHT_METATAGS = 'metatags';

/**
 * Extract selectors for metatag elements from the scraped HTML
 * @param {string} rawBody - The HTML content (must be truthy - caller should validate)
 * @param {string} tagName - The tag name (title, description, h1)
 * @returns {string|string[]|null} Selector(s) for the tag
 */
function generateSelectorsForTag(rawBody, tagName) {
  const $ = cheerioLoad(rawBody);

  if (tagName === 'title') {
    const titleElement = $('head > title').get(0);
    return titleElement ? getDomElementSelector(titleElement) : null;
  }

  if (tagName === 'description') {
    const descElement = $('head > meta[name="description"]').get(0);
    /* c8 ignore next - null branch for missing description element */
    return descElement ? getDomElementSelector(descElement) : null;
  }

  if (tagName === 'h1') {
    const h1Elements = $('h1').toArray();
    return h1Elements
      .map((h1) => getDomElementSelector(h1))
      .filter(Boolean);
  }
  /* c8 ignore next 2 - unreachable: only title/description/h1 tag names from metatags audit */
  return null;
}

export default async function metatags(context, auditContext) {
  const {
    site, job, log,
  } = context;
  const {
    previewUrls,
    step,
    audits,
    auditsResult,
    scrapedObjects,
    timeExecutionBreakdown,
  } = auditContext;

  const metatagsStartTime = Date.now();
  const metatagsStartTimestamp = new Date().toISOString();
  // Create metatags audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ name: PREFLIGHT_METATAGS, type: 'seo', opportunities: [] });
  });

  // Workaround for the updated meta-tags audit which requires a map of URL to S3 key
  // TODO: change as soon as preflight is migrated to the ScrapeClient
  const pageMap = new Map(previewUrls.map((url) => {
    const s3Key = `scrapes/${site.getId()}${new URL(url).pathname.replace(/\/$/, '')}/scrape.json`;
    return [url, s3Key];
  }));
  log.debug('[preflight-audit] Starting meta tags audit with new scraper data format');

  const {
    seoChecks,
    detectedTags,
    extractedTags,
  } = await metatagsAutoDetect(site, pageMap, context);

  // Build scrapeDataByPath from already-fetched scrapedObjects (avoids extra S3 calls)
  const scrapeDataByPath = new Map();
  scrapedObjects.forEach(({ data }) => {
    if (data?.scrapeResult?.rawBody) {
      /* c8 ignore next 3 - defensive: finalUrl should always exist if scrape succeeded */
      const pageUrl = data.finalUrl
        ? new URL(data.finalUrl).pathname
        : null;
      if (pageUrl) {
        const normalizedPath = stripTrailingSlash(pageUrl);
        scrapeDataByPath.set(normalizedPath, data.scrapeResult.rawBody);
      }
    }
  });

  try {
    const tagCollection = step === 'suggest'
      ? await metatagsAutoSuggest({
        detectedTags,
        healthyTags: seoChecks.getFewHealthyTags(),
        extractedTags,
      }, context, site, { forceAutoSuggest: true })
      : detectedTags;
    Object.entries(tagCollection).forEach(([path, tags]) => {
      const pageUrl = previewUrls.find((url) => {
        const u = new URL(url);
        const previewPath = stripTrailingSlash(u.pathname);
        const targetPath = stripTrailingSlash(path);
        return previewPath === targetPath;
      });
      const audit = audits.get(pageUrl)?.audits.find((a) => a.name === PREFLIGHT_METATAGS);

      // Get the scraped HTML for this path to generate selectors
      const normalizedPath = stripTrailingSlash(path);
      const rawBody = scrapeDataByPath.get(normalizedPath);

      return tags && Object.values(tags).forEach((data, tag) => {
        const tagName = Object.keys(tags)[tag];
        const opportunity = {
          ...data,
          tagName,
        };

        // Generate and add selectors for this tag
        if (rawBody) {
          const selectors = generateSelectorsForTag(rawBody, tagName);
          if (selectors) {
            const elementData = toElementTargets(selectors);
            if (elementData?.elements?.length > 0) {
              Object.assign(opportunity, elementData);
            }
          }
        }

        audit.opportunities.push(opportunity);
      });
    });
  } catch (error) {
    log.error(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Meta tags audit failed: ${error.message}`);
  }

  const metatagsEndTime = Date.now();
  const metatagsEndTimestamp = new Date().toISOString();
  const metatagsElapsed = ((metatagsEndTime - metatagsStartTime) / 1000).toFixed(2);
  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Meta tags audit completed in ${metatagsElapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'metatags',
    duration: `${metatagsElapsed} seconds`,
    startTime: metatagsStartTimestamp,
    endTime: metatagsEndTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'meta tags audit');
}
