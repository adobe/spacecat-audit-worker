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
import {
  validateCanonicalFormat,
  isSelfReferencing,
} from '../canonical/handler.js';
import { CANONICAL_CHECKS } from '../canonical/constants.js';

export const PREFLIGHT_CANONICAL = 'canonical';

/**
 * Extracts canonical metadata from raw HTML as a fallback when scraper metadata is absent.
 * @param {string} rawBody - Raw HTML string.
 * @returns {{ exists: boolean, href: string|null, inHead: boolean, count: number }}
 */
function extractCanonicalMetadataFromHtml(rawBody) {
  const $ = cheerioLoad(rawBody);
  const headCanonicals = $('head link[rel="canonical"]');
  const allCanonicals = $('link[rel="canonical"]');
  const count = allCanonicals.length;

  if (count === 0) {
    return {
      exists: false, href: null, inHead: false, count: 0,
    };
  }

  const inHead = headCanonicals.length > 0;
  const href = (inHead ? headCanonicals : allCanonicals).first().attr('href') || null;
  return {
    exists: true, href, inHead, count,
  };
}

/**
 * Runs canonical checks against scraped metadata for a single page and returns
 * an array of failed check descriptors.
 *
 * HTTP reachability checks are intentionally skipped here: preview pages are not
 * yet publicly accessible, so network fetches would produce misleading results.
 *
 * @param {string} url - Normalized page URL.
 * @param {{ exists: boolean, href: string|null, inHead: boolean, count: number }} meta
 * @param {string} previewBaseURL - Origin of the preview site (for format validation).
 * @param {object} log - Logger instance.
 * @returns {Array<{ check: string, explanation: string, suggestion: string }>}
 */
function runCanonicalChecks(url, meta, previewBaseURL, log) {
  const checks = [];

  if (!meta.exists) {
    checks.push(CANONICAL_CHECKS.CANONICAL_TAG_MISSING);
    return checks;
  }

  const { href: canonicalUrl } = meta;

  if (!canonicalUrl) {
    checks.push(CANONICAL_CHECKS.CANONICAL_TAG_NO_HREF);
    return checks;
  }

  if (!meta.inHead) {
    checks.push(CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD);
  }

  if (meta.count > 1) {
    checks.push(CANONICAL_CHECKS.CANONICAL_TAG_MULTIPLE);
  }

  if (!canonicalUrl.trim()) {
    checks.push(CANONICAL_CHECKS.CANONICAL_TAG_EMPTY);
    return checks;
  }

  if (!isSelfReferencing(canonicalUrl, url)) {
    checks.push(CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED);
  }

  // Format validation (absolute URL, same protocol, lowercased).
  // isPreview=true skips the same-domain check which does not apply to preview URLs.
  const formatChecks = validateCanonicalFormat(canonicalUrl, previewBaseURL, log, true);
  formatChecks
    .filter((c) => !c.success)
    .forEach((c) => {
      const checkConfig = Object.values(CANONICAL_CHECKS).find((cfg) => cfg.check === c.check);
      if (checkConfig) {
        checks.push(checkConfig);
      }
    });

  return checks;
}

export default async function canonical(context, auditContext) {
  const { site, job, log } = context;
  const {
    previewUrls,
    step,
    audits,
    auditsResult,
    previewBaseURL,
    scrapedObjects,
    timeExecutionBreakdown,
  } = auditContext;

  const startTime = Date.now();
  const startTimestamp = new Date().toISOString();

  previewUrls.forEach((url) => {
    audits.get(url).audits.push({
      name: PREFLIGHT_CANONICAL,
      type: 'seo',
      opportunities: [],
    });
  });

  // Build URL → scraped data map
  const scrapedByUrl = new Map();
  scrapedObjects.forEach(({ data }) => {
    if (data?.finalUrl) {
      scrapedByUrl.set(stripTrailingSlash(data.finalUrl), data);
    }
  });

  previewUrls.forEach((url) => {
    const pageAudit = audits.get(url).audits.find((a) => a.name === PREFLIGHT_CANONICAL);
    const scrapedData = scrapedByUrl.get(url);

    if (!scrapedData) {
      log.warn(`[preflight-canonical] No scraped data found for ${url}`);
      return;
    }

    const { scrapeResult } = scrapedData;

    // Prefer metadata injected by the scraper; fall back to HTML parsing when absent
    const meta = scrapeResult?.canonical
      ?? (scrapeResult?.rawBody ? extractCanonicalMetadataFromHtml(scrapeResult.rawBody) : null);

    if (!meta) {
      log.warn(`[preflight-canonical] No canonical metadata available for ${url}`);
      pageAudit.opportunities.push({
        check: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.check,
        issue: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.explanation,
        seoImpact: 'Moderate',
        seoRecommendation: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.suggestion,
      });
      return;
    }

    const failedChecks = runCanonicalChecks(url, meta, previewBaseURL, log);
    failedChecks.forEach((checkConfig) => {
      pageAudit.opportunities.push({
        check: checkConfig.check,
        issue: checkConfig.explanation,
        seoImpact: 'Moderate',
        seoRecommendation: checkConfig.suggestion,
      });
    });
  });

  const endTime = Date.now();
  const endTimestamp = new Date().toISOString();
  const elapsed = ((endTime - startTime) / 1000).toFixed(2);

  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Canonical audit completed in ${elapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'canonical',
    duration: `${elapsed} seconds`,
    startTime: startTimestamp,
    endTime: endTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'canonical audit');
}
