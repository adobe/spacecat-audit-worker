/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { JSDOM } from 'jsdom';
import { fetch } from '../support/utils.js';
import { getBaseUrlPagesFromSitemaps } from '../sitemap/handler.js';

// Enums for checks and errors
const Check = Object.freeze({
  CANONICAL_TAG_EXISTS: 'canonical-tag-exists',
  CANONICAL_TAG_ONCE: 'canonical-tag-once',
  CANONICAL_TAG_NONEMPTY: 'canonical-tag-nonempty',
  CANONICAL_TAG_IN_HEAD: 'canonical-tag-in-head',
  CANONICAL_URL_IN_SITEMAP: 'canonical-url-in-sitemap',
  CANONICAL_URL_PAGE_EXISTS: 'canonical-url-page-exists',
  CANONICAL_URL_NO_REDIRECT: 'canonical-url-no-redirect',
  CANONICAL_URL_ABSOLUTE: 'canonical-url-absolute',
  CANONICAL_URL_SAME_DOMAIN: 'canonical-url-same-domain',
  CANONICAL_URL_SAME_PROTOCOL: 'canonical-url-same-protocol',
  CANONICAL_URL_LOWERCASED: 'canonical-url-lowercased',
});

const ErrorCode = Object.freeze({
  CANONICAL_TAG_NOT_FOUND: 'canonical-tag-not-found',
  MULTIPLE_CANONICAL_TAGS: 'multiple-canonical-tags',
  CANONICAL_TAG_EMPTY: 'canonical-tag-empty',
  CANONICAL_TAG_NOT_IN_HEAD: 'canonical-tag-not-in-head',
  CANONICAL_URL_NOT_IN_SITEMAP: 'canonical-url-not-in-sitemap',
  CANONICAL_URL_NOT_FOUND: 'canonical-url-not-found',
  CANONICAL_URL_REDIRECT: 'canonical-url-redirect',
  CANONICAL_URL_NOT_ABSOLUTE: 'canonical-url-not-absolute',
  CANONICAL_URL_DIFFERENT_DOMAIN: 'canonical-url-different-domain',
  CANONICAL_URL_DIFFERENT_PROTOCOL: 'canonical-url-different-protocol',
  CANONICAL_URL_NOT_LOWERCASED: 'canonical-url-not-lowercased',
});

// Function to get the top 200 pages
async function getTopPagesForSite(siteId, context, log) {
  const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);
  const topPages = await ahrefsAPIClient.getTopPages(siteId, 200);
  if (!topPages || topPages.length === 0) {
    log.info('No top pages found');
    return [];
  }
  return topPages;
}

// Function to validate canonical tag
async function validateCanonicalTag(url, log) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const { head } = dom.window.document;
    const canonicalLinks = head.querySelectorAll('link[rel="canonical"]');
    const checks = [];

    if (canonicalLinks.length === 0) {
      checks.push({ check: Check.CANONICAL_TAG_EXISTS, error: ErrorCode.CANONICAL_TAG_NOT_FOUND });
      return checks;
    }

    if (canonicalLinks.length > 1) {
      checks.push({ check: Check.CANONICAL_TAG_ONCE, error: ErrorCode.MULTIPLE_CANONICAL_TAGS });
    }

    canonicalLinks.forEach((canonicalLink) => {
      if (!canonicalLink.href) {
        checks.push({ check: Check.CANONICAL_TAG_NONEMPTY, error: ErrorCode.CANONICAL_TAG_EMPTY });
      }

      if (canonicalLink.closest('head') === null) {
        checks.push({
          check: Check.CANONICAL_TAG_IN_HEAD,
          error: ErrorCode.CANONICAL_TAG_NOT_IN_HEAD,
        });
      }
    });

    return checks;
  } catch (error) {
    log.error(`Error validating canonical tag for ${url}: ${error.message}`);
    return [{ check: Check.CANONICAL_TAG_EXISTS, error: error.message }];
  }
}

// Function to validate canonical URL in sitemap
function validateCanonicalInSitemap(pageLinks, canonicalUrl) {
  if (pageLinks.includes(canonicalUrl)) {
    return { check: Check.CANONICAL_URL_IN_SITEMAP, success: true };
  }
  return { check: Check.CANONICAL_URL_IN_SITEMAP, error: ErrorCode.CANONICAL_URL_NOT_IN_SITEMAP };
}

// Function to validate canonical URL contents
async function validateCanonicalUrlContents(canonicalUrl, log) {
  try {
    const response = await fetch(canonicalUrl);
    if (response.status === 200) {
      return { check: Check.CANONICAL_URL_PAGE_EXISTS, success: true };
    }
    return { check: Check.CANONICAL_URL_PAGE_EXISTS, error: ErrorCode.CANONICAL_URL_NOT_FOUND };
  } catch (error) {
    log.error(`Error fetching canonical URL ${canonicalUrl}: ${error.message}`);
    return { check: Check.CANONICAL_URL_PAGE_EXISTS, error: ErrorCode.CANONICAL_URL_NOT_FOUND };
  }
}

// Function to validate canonical URL format
function validateCanonicalUrlFormat(canonicalUrl, baseUrl) {
  const url = new URL(canonicalUrl);
  const base = new URL(baseUrl);
  const checks = [];

  if (!url.href.startsWith(base.protocol)) {
    checks.push({
      check: Check.CANONICAL_URL_SAME_PROTOCOL,
      error: ErrorCode.CANONICAL_URL_DIFFERENT_PROTOCOL,
    });
  }

  if (url.hostname !== base.hostname) {
    checks.push({
      check: Check.CANONICAL_URL_SAME_DOMAIN,
      error: ErrorCode.CANONICAL_URL_DIFFERENT_DOMAIN,
    });
  }

  if (url.href !== url.href.toLowerCase()) {
    checks.push({
      check: Check.CANONICAL_URL_LOWERCASED,
      error: ErrorCode.CANONICAL_URL_NOT_LOWERCASED,
    });
  }

  if (!url.href.startsWith('http://') && !url.href.startsWith('https://')) {
    checks.push({
      check: Check.CANONICAL_URL_ABSOLUTE,
      error: ErrorCode.CANONICAL_URL_NOT_ABSOLUTE,
    });
  }

  return checks;
}

// Main function to perform the audit
export default async function auditCanonicalTags(siteId, context) {
  const { log } = context;
  const topPages = await getTopPagesForSite(siteId, context, log);

  if (topPages.length === 0) {
    return {};
  }

  const aggregatedPageLinks = await getBaseUrlPagesFromSitemaps(
    context.baseUrl,
    topPages.map((page) => page.url),
  );
  const auditPromises = topPages.map(async (page) => {
    const { url } = page;
    const checks = [];

    const canonicalTagChecks = await validateCanonicalTag(url, log);
    checks.push(...canonicalTagChecks);

    if (!canonicalTagChecks.some((check) => check.error)) {
      const { canonicalUrl } = canonicalTagChecks.find(
        (check) => check.check === Check.CANONICAL_TAG_EXISTS,
      );
      const sitemapCheck = validateCanonicalInSitemap(aggregatedPageLinks, canonicalUrl);
      checks.push(sitemapCheck);

      const urlContentCheck = await validateCanonicalUrlContents(canonicalUrl, log);
      checks.push(urlContentCheck);

      const urlFormatChecks = validateCanonicalUrlFormat(canonicalUrl, context.baseUrl);
      checks.push(...urlFormatChecks);
    }

    return { [url]: checks };
  });

  const auditResultsArray = await Promise.all(auditPromises);
  return Object.assign({}, ...auditResultsArray);
}
