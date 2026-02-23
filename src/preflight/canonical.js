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
// TODO: Re-enable when preflight canonical is updated for new multi-step architecture

// for the duration of development
/* eslint-disable */

import { saveIntermediateResults } from './utils.js';
import { normalizeUrlExport as normalizeUrl, validateCanonicalFormat, validateCanonicalTag } from '../canonical/handler.js';

export const PREFLIGHT_CANONICAL = 'canonical';

export default async function canonical(context, auditContext) {
  const {
    site, job, log,
  } = context;
  const {
    previewUrls,
    step,
    audits,
    auditsResult,
    timeExecutionBreakdown,
    scrapedObjects,
    previewBaseURL,
  } = auditContext;

  const canonicalStartTime = Date.now();
  const canonicalStartTimestamp = new Date().toISOString();
  // Create canonical audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({
      name: PREFLIGHT_CANONICAL,
      type: 'seo',
      opportunities: [],
    });
  });

  const scrapedObjectsNormalized = scrapedObjects.map((scrapedObject) => ({
    normalizedUrl: normalizeUrl(scrapedObject.data.finalUrl),
    scrapedObject,
  }));

  const canonicalResults = await Promise.all(
    previewUrls.map(async (url) => {
      const scrapedObjectNormalized = scrapedObjectsNormalized.find((object) => object.normalizedUrl === normalizeUrl(url));
      if (!scrapedObjectNormalized) {
        return { url, checks: [] };
      }

      const {
        canonicalUrl,
        checks: tagChecks,
      } = await validateCanonicalTag(scrapedObjectNormalized.scrapedObject.data, context, scrapedObjectNormalized.normalizedUrl);

      const allChecks = [...tagChecks];
      if (canonicalUrl) {
        const siteId = site.getId();
        const jobId = job.getId();
        log.debug(
          `[preflight-audit] site: ${siteId}, job: ${jobId}, step: ${step}.`
          + ` Found Canonical URL: ${canonicalUrl}`
        );
        allChecks.push(
          ...validateCanonicalFormat(canonicalUrl, previewBaseURL, log, true)
        );
      }
      return { url, checks: allChecks.filter((c) => !c.success) };
    }),
  );

  const canonicalEndTime = Date.now();
  const canonicalEndTimestamp = new Date().toISOString();
  const canonicalElapsed = ((canonicalEndTime - canonicalStartTime) / 1000).toFixed(2);
  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Canonical audit completed in ${canonicalElapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'canonical',
    duration: `${canonicalElapsed} seconds`,
    startTime: canonicalStartTimestamp,
    endTime: canonicalEndTimestamp,
  });

  canonicalResults.forEach(({ url, checks: canonicalChecks }) => {
    const audit = audits.get(url).audits.find((a) => a.name === PREFLIGHT_CANONICAL);
    canonicalChecks.forEach((check) => audit.opportunities.push({
      check: check.check,
      issue: check.explanation,
      seoImpact: check.seoImpact || 'Moderate',
      seoRecommendation: check.explanation,
    }));
  });

  await saveIntermediateResults(context, auditsResult, 'canonical audit');
}
