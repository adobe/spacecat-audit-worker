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
import { validatePageHeadingFromScrapeJson } from '../headings/handler.js';
import { saveIntermediateResults } from './utils.js';
import SeoChecks from '../metatags/seo-checks.js';

export const PREFLIGHT_HEADINGS = 'headings';

export default async function headings(context, auditContext) {
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

  const headingsStartTime = Date.now();
  const headingsStartTimestamp = new Date().toISOString();

  // Create headings audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ name: PREFLIGHT_HEADINGS, type: 'seo', opportunities: [] });
  });

  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Starting headings audit`);

  try {
    const seoChecks = new SeoChecks(log);

    // Validate headings for each scraped page
    const headingsResults = await Promise.all(
      scrapedObjects.map(async ({ data }) => {
        const scrapeJsonObject = data;
        const url = stripTrailingSlash(scrapeJsonObject.finalUrl);

        if (!scrapeJsonObject) {
          log.error(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. No scraped data found for ${url}`);
          return { url, checks: [] };
        }

        const result = await validatePageHeadingFromScrapeJson(
          url,
          scrapeJsonObject,
          log,
          context,
          seoChecks,
        );

        return result || { url, checks: [] };
      }),
    );

    // Process results and add to audit opportunities
    headingsResults.forEach(({ url, checks }) => {
      const audit = audits.get(url)?.audits.find((a) => a.name === PREFLIGHT_HEADINGS);
      if (!audit) {
        log.warn(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. No audit entry found for ${url}`);
        return;
      }

      // Add each check as an opportunity
      checks.forEach((check) => {
        if (!check.success) {
          audit.opportunities.push({
            check: check.check,
            checkTitle: check.checkTitle,
            issue: check.explanation,
            seoImpact: 'Moderate',
            seoRecommendation: check.suggestion,
            ...(check.tagName && { tagName: check.tagName }),
            ...(check.count && { count: check.count }),
            ...(check.previous && { previous: check.previous }),
            ...(check.current && { current: check.current }),
            ...(check.transformRules && { transformRules: check.transformRules }),
          });
        }
      });
    });
  } catch (error) {
    log.error(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Headings audit failed: ${error.message}`);
  }

  const headingsEndTime = Date.now();
  const headingsEndTimestamp = new Date().toISOString();
  const headingsElapsed = ((headingsEndTime - headingsStartTime) / 1000).toFixed(2);
  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Headings audit completed in ${headingsElapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'headings',
    duration: `${headingsElapsed} seconds`,
    startTime: headingsStartTimestamp,
    endTime: headingsEndTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'headings audit');
}
