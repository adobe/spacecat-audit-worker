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
import { isNonEmptyArray, stripTrailingSlash } from '@adobe/spacecat-shared-utils';
import { load as cheerioLoad } from 'cheerio';
import { saveIntermediateResults } from './utils.js';
import { runLinksChecks } from './links-checks.js';
import { generateSuggestionData } from '../internal-links/suggestions-generator.js';
import { getDomElementSelector, toElementTargets } from '../utils/dom-selector.js';

export const PREFLIGHT_LINKS = 'links';

/**
 * Create an issue object for a broken internal link with AI suggestions
 * @param {string} urlTo - The URL that is broken
 * @param {number} status - HTTP status code
 * @param {string} baseURLOrigin - Base URL origin to replace preview origin
 * @param {Array} urlsSuggested - Optional array of suggested alternative URLs from AI
 * @param {string} aiRationale - Optional AI rationale for suggestions
 * @returns {Object} Issue object with all fields including aiSuggestion
 */
export function createBrokenLinkIssue(
  urlTo,
  status,
  baseURLOrigin,
  urlsSuggested,
  aiRationale,
  elements = [],
) {
  const aiUrls = (urlsSuggested && urlsSuggested.length > 0)
    ? urlsSuggested.map((url) => stripTrailingSlash(
      url.replace(new URL(url).origin, baseURLOrigin),
    )) : [];

  return {
    url: stripTrailingSlash(urlTo.replace(new URL(urlTo).origin, baseURLOrigin)),
    issue: `Status ${status}`,
    seoImpact: 'High',
    seoRecommendation: 'Fix or remove broken links to improve user experience and SEO',
    aiSuggestion: aiUrls.length > 0 ? aiUrls[0] : undefined,
    aiRationale,
    ...(elements && elements.length ? { elements } : {}),
  };
}

export default async function links(context, auditContext) {
  const {
    site, job, log,
  } = context;
  const {
    previewBaseURL,
    previewUrls,
    step,
    audits,
    auditsResult,
    scrapedObjects,
    urls,
    pageAuthToken,
    timeExecutionBreakdown,
  } = auditContext;

  // Create links audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ name: PREFLIGHT_LINKS, type: 'seo', opportunities: [] });
  });

  // Pre-index PREFLIGHT_LINKS audits for O(1) lookups
  const linksAuditMap = new Map();
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    if (pageResult) {
      const linksAudit = pageResult.audits.find((a) => a.name === PREFLIGHT_LINKS);
      if (linksAudit) {
        linksAuditMap.set(url, linksAudit);
      }
    }
  });

  // Link checks (both internal and external)
  const linksStartTime = Date.now();
  const linksStartTimestamp = new Date().toISOString();
  const auditUrls = urls.map((url) => stripTrailingSlash(url));
  const { auditResult } = await runLinksChecks(auditUrls, scrapedObjects, context, {
    pageAuthToken,
  });

  const brokenInternalLinksByPage = new Map();
  const brokenExternalLinksByPage = new Map();

  // Process internal links
  if (isNonEmptyArray(auditResult.brokenInternalLinks)) {
    const baseURLOrigin = new URL(previewBaseURL).origin;
    if (step === 'suggest') {
      const normalizeHref = (value) => stripTrailingSlash(value);
      const normalizeUrlTo = (value) => stripTrailingSlash(
        value.replace(new URL(value).origin, site.getBaseURL()),
      );
      const selectorKey = (hrefValue, urlValue) => `${normalizeHref(hrefValue)}|${normalizeUrlTo(urlValue)}`;
      const selectorsByLink = new Map();
      auditResult.brokenInternalLinks.forEach((link) => {
        selectorsByLink.set(selectorKey(link.href, link.urlTo), link.elements);
      });
      const brokenLinks = auditResult.brokenInternalLinks.map((link) => ({
        urlTo: normalizeUrlTo(link.urlTo),
        href: normalizeHref(link.href),
        status: link.status,
      }));
      log.debug(`[preflight-audit] Found ${JSON.stringify(brokenLinks)} broken internal links`);
      const brokenInternalLinks = await
      generateSuggestionData(previewBaseURL, brokenLinks, context, site);
      log.debug(`[preflight-audit] Generated suggestions for broken internal links: ${JSON.stringify(brokenInternalLinks)}`);
      brokenInternalLinks.forEach(({
        urlTo, href, status, urlsSuggested, aiRationale,
      }) => {
        if (!brokenInternalLinksByPage.has(href)) {
          brokenInternalLinksByPage.set(href, []);
        }
        const issue = createBrokenLinkIssue(
          urlTo,
          status,
          baseURLOrigin,
          urlsSuggested,
          aiRationale,
          selectorsByLink.get(selectorKey(href, urlTo)),
        );
        brokenInternalLinksByPage.get(href).push(issue);
      });
    } else {
      auditResult.brokenInternalLinks.forEach(({
        urlTo, href, status, elements,
      }) => {
        if (!brokenInternalLinksByPage.has(href)) {
          brokenInternalLinksByPage.set(href, []);
        }
        brokenInternalLinksByPage.get(href).push({
          url: urlTo.replace(new URL(urlTo).origin, baseURLOrigin),
          issue: `Status ${status}`,
          seoImpact: 'High',
          seoRecommendation: 'Fix or remove broken links to improve user experience and SEO',
          elements,
        });
      });
    }
  }

  // Process external links from the same audit auditsResult
  if (isNonEmptyArray(auditResult.brokenExternalLinks)) {
    auditResult.brokenExternalLinks.forEach(({
      urlTo, href, status, elements,
    }) => {
      if (!brokenExternalLinksByPage.has(href)) {
        brokenExternalLinksByPage.set(href, []);
      }
      brokenExternalLinksByPage.get(href).push({
        url: urlTo,
        issue: `Status ${status}`,
        seoImpact: 'High',
        seoRecommendation: 'Fix or remove broken links to improve user experience',
        elements,
      });
    });
  }

  brokenInternalLinksByPage.forEach((issues, href) => {
    const audit = linksAuditMap.get(stripTrailingSlash(href));
    if (audit && issues.length > 0) {
      audit.opportunities.push({
        check: 'broken-internal-links',
        issue: issues,
      });
    }
  });

  brokenExternalLinksByPage.forEach((issues, href) => {
    const audit = linksAuditMap.get(stripTrailingSlash(href));
    if (audit && issues.length > 0) {
      audit.opportunities.push({
        check: 'broken-external-links',
        issue: issues,
      });
    }
  });

  const linksEndTime = Date.now();
  const linksEndTimestamp = new Date().toISOString();
  const linksElapsed = ((linksEndTime - linksStartTime) / 1000).toFixed(2);
  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Links audit completed in ${linksElapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'links',
    duration: `${linksElapsed} seconds`,
    startTime: linksStartTimestamp,
    endTime: linksEndTimestamp,
  });

  scrapedObjects.forEach(({ data }) => {
    const { finalUrl, scrapeResult: { rawBody } } = data;
    const $ = cheerioLoad(rawBody);
    const auditUrl = stripTrailingSlash(finalUrl);
    const audit = linksAuditMap.get(auditUrl);
    const insecureLinks = $('a').map((i, anchor) => {
      const href = $(anchor).attr('href');
      if (href && href.startsWith('http://')) {
        // Normalize URL using URL class to match jsdom behavior
        let normalizedUrl;
        try {
          normalizedUrl = new URL(href).href;
        } catch {
          normalizedUrl = href;
        }
        const selector = getDomElementSelector(anchor);
        return {
          url: normalizedUrl,
          issue: 'Link using HTTP instead of HTTPS',
          seoImpact: 'High',
          seoRecommendation: 'Update all links to use HTTPS protocol',
          ...toElementTargets(selector),
        };
      }
      return null;
    }).get().filter((link) => link !== null);

    if (audit && insecureLinks.length > 0) {
      audit.opportunities.push({ check: 'bad-links', issue: insecureLinks });
    }
  });
  // Check for insecure links in each scraped page

  await saveIntermediateResults(context, auditsResult, 'links audit');
}
