/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { load as cheerioLoad } from 'cheerio';
import { saveIntermediateResults } from './utils.js';
import { getDomElementSelector, toElementTargets } from './utils/dom-selector.js';
import { AUDIT_BODY_SIZE, PREFLIGHT_AUDIT_TYPE_SEO } from './audit-constants.js';

/**
 * Preflight audit handler for detecting thin body content.
 *
 * Flags pages whose visible body text is between 1 and 100 characters — a
 * strong signal that the page is a stub, a template placeholder, or has not
 * yet been populated with real content.
 *
 * @param {Object} context - Audit context from the preflight system
 * @param {Object} auditContext - Preflight audit context
 * @returns {Promise<{processing: boolean}>}
 */
export default async function bodySize(context, auditContext) {
  const { site, job, log } = context;
  const {
    previewUrls,
    step,
    audits,
    auditsResult,
    scrapedObjects,
    timeExecutionBreakdown,
  } = auditContext;

  const startTime = Date.now();
  const startTimestamp = new Date().toISOString();

  previewUrls.forEach((url) => {
    audits.get(url).audits.push({
      name: AUDIT_BODY_SIZE,
      type: PREFLIGHT_AUDIT_TYPE_SEO,
      opportunities: [],
    });
  });

  const auditMap = new Map();
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    if (pageResult) {
      const audit = pageResult.audits.find((a) => a.name === AUDIT_BODY_SIZE);
      if (audit) {
        auditMap.set(url, audit);
      }
    }
  });

  scrapedObjects.forEach(({ data }) => {
    const { finalUrl, scrapeResult: { rawBody } } = data;
    const pageUrl = finalUrl.replace(/\/$/, '');
    const audit = auditMap.get(pageUrl);

    if (!audit) {
      log.warn(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}. No audit entry for URL: ${pageUrl}`);
      return;
    }

    const $ = cheerioLoad(rawBody);
    const textContent = $('body').text().replace(/\n/g, '').trim();

    if (textContent.length > 0 && textContent.length <= 100) {
      audit.opportunities.push({
        check: 'content-length',
        issue: 'Body content length is below 100 characters',
        seoImpact: 'Moderate',
        seoRecommendation: 'Add more meaningful content to the page',
        ...toElementTargets(getDomElementSelector($('body').get(0))),
      });
    }
  });

  const endTime = Date.now();
  const endTimestamp = new Date().toISOString();
  const elapsed = ((endTime - startTime) / 1000).toFixed(2);

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. ${AUDIT_BODY_SIZE} audit completed in ${elapsed} seconds`);

  timeExecutionBreakdown.push({
    name: AUDIT_BODY_SIZE,
    duration: `${elapsed} seconds`,
    startTime: startTimestamp,
    endTime: endTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'body-size audit');

  return { processing: false };
}
