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
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { JSDOM } from 'jsdom';
import { saveIntermediateResults } from './utils.js';
import { runLinksChecks } from './links-checks.js';
import { generateSuggestionData } from '../internal-links/suggestions-generator.js';

export const PREFLIGHT_LINKS = 'links';

export default async function links(context, auditContext) {
  const {
    site, jobId, log,
  } = context;
  const {
    checks,
    baseURL,
    normalizedUrls,
    normalizedStep,
    audits,
    auditsResult,
    scrapedObjects,
    urls,
    pageAuthToken,
    timeExecutionBreakdown,
  } = auditContext;
  if (!checks || checks.includes(PREFLIGHT_LINKS)) {
    // Create links audit entries for all pages
    normalizedUrls.forEach((url) => {
      const pageResult = audits.get(url);
      pageResult.audits.push({ name: PREFLIGHT_LINKS, type: 'seo', opportunities: [] });
    });

    // Pre-index PREFLIGHT_LINKS audits for O(1) lookups
    const linksAuditMap = new Map();
    normalizedUrls.forEach((url) => {
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

    const { auditResult } = await runLinksChecks(urls, scrapedObjects, context, {
      pageAuthToken,
    });

    // Process internal links
    if (isNonEmptyArray(auditResult.brokenInternalLinks)) {
      if (normalizedStep === 'suggest') {
        const brokenLinks = auditResult.brokenInternalLinks.map((link) => ({
          urlTo: new URL(site.getBaseURL()).origin + new URL(link.urlTo).pathname.replace(/\/$/, ''),
          href: link.href,
          status: link.status,
        }));
        log.debug(`[preflight-audit] Found ${JSON.stringify(brokenLinks)} broken internal links`);
        const brokenInternalLinks = await
        generateSuggestionData(baseURL, brokenLinks, context, site);
        log.debug(`[preflight-audit] Generated suggestions for broken internal links: ${JSON.stringify(brokenInternalLinks)}`);
        const baseURLOrigin = new URL(baseURL).origin;
        brokenInternalLinks.forEach(({
          urlTo, href, status, urlsSuggested, aiRationale,
        }) => {
          const audit = linksAuditMap.get(href);
          const aiUrls = urlsSuggested?.map((url) => (baseURLOrigin + new URL(url).pathname.replace(/\/$/, '')));
          audit.opportunities.push({
            check: 'broken-internal-links',
            issue: {
              url: urlTo,
              issue: `Status ${status}`,
              seoImpact: 'High',
              seoRecommendation: 'Fix or remove broken links to improve user experience and SEO',
              urlsSuggested: aiUrls,
              aiRationale,
            },
          });
        });
      } else {
        auditResult.brokenInternalLinks.forEach(({ urlTo, href, status }) => {
          const audit = linksAuditMap.get(href);
          audit.opportunities.push({
            check: 'broken-internal-links',
            issue: {
              url: urlTo,
              issue: `Status ${status}`,
              seoImpact: 'High',
              seoRecommendation: 'Fix or remove broken links to improve user experience and SEO',
            },
          });
        });
      }
    }

    // Process external links from the same audit auditsResult
    if (isNonEmptyArray(auditResult.brokenExternalLinks)) {
      auditResult.brokenExternalLinks.forEach(({ urlTo, href, status }) => {
        const audit = linksAuditMap.get(href);
        audit.opportunities.push({
          check: 'broken-external-links',
          issue: {
            url: urlTo,
            issue: `Status ${status}`,
            seoImpact: 'High',
            seoRecommendation: 'Fix or remove broken links to improve user experience',
          },
        });
      });
    }

    const linksEndTime = Date.now();
    const linksEndTimestamp = new Date().toISOString();
    const linksElapsed = ((linksEndTime - linksStartTime) / 1000).toFixed(2);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${normalizedStep}. Links audit completed in ${linksElapsed} seconds`);

    timeExecutionBreakdown.push({
      name: 'links',
      duration: `${linksElapsed} seconds`,
      startTime: linksStartTimestamp,
      endTime: linksEndTimestamp,
    });

    // Check for insecure links in each scraped page
    scrapedObjects.forEach(({ data }) => {
      const { finalUrl, scrapeResult: { rawBody } } = data;
      const doc = new JSDOM(rawBody).window.document;
      const audit = linksAuditMap.get(finalUrl);
      const insecureLinks = Array.from(doc.querySelectorAll('a'))
        .filter((anchor) => anchor.href.startsWith('http://'))
        .map((anchor) => ({
          url: anchor.href,
          issue: 'Link using HTTP instead of HTTPS',
          seoImpact: 'High',
          seoRecommendation: 'Update all links to use HTTPS protocol',
        }));

      if (insecureLinks.length > 0) {
        audit.opportunities.push({ check: 'bad-links', issue: insecureLinks });
      }
    });

    await saveIntermediateResults(context, auditsResult, 'links audit');
  }
}
