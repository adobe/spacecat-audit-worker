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
import { saveIntermediateResults } from './utils.js';
import { metatagsAutoDetect } from '../metatags/handler.js';
import metatagsAutoSuggest from '../metatags/metatags-auto-suggest.js';

export const PREFLIGHT_METATAGS = 'metatags';

export default async function metatags(context, auditContext) {
  const {
    site, job, log,
  } = context;
  const {
    checks,
    previewUrls,
    step,
    audits,
    auditsResult,
    timeExecutionBreakdown,
  } = auditContext;
  if (!checks || checks.includes(PREFLIGHT_METATAGS)) {
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
    log.info('[preflight-audit] Starting meta tags audit with new scraper data format');

    const {
      seoChecks,
      detectedTags,
      extractedTags,
    } = await metatagsAutoDetect(site, pageMap, context);
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
        return tags && Object.values(tags).forEach((data, tag) => audit.opportunities.push({
          ...data,
          tagName: Object.keys(tags)[tag],
        }));
      });
    } catch (error) {
      log.error(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Meta tags audit failed: ${error.message}`);
    }

    const metatagsEndTime = Date.now();
    const metatagsEndTimestamp = new Date().toISOString();
    const metatagsElapsed = ((metatagsEndTime - metatagsStartTime) / 1000).toFixed(2);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Meta tags audit completed in ${metatagsElapsed} seconds`);

    timeExecutionBreakdown.push({
      name: 'metatags',
      duration: `${metatagsElapsed} seconds`,
      startTime: metatagsStartTimestamp,
      endTime: metatagsEndTimestamp,
    });

    await saveIntermediateResults(context, auditsResult, 'meta tags audit');
  }
}
