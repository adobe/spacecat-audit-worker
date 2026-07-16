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
import { AUDIT_LOREM_IPSUM, PREFLIGHT_AUDIT_TYPE_SEO } from './audit-constants.js';

const LOREM_IPSUM_PATTERN = /lorem ipsum/i;
const LOREM_IPSUM_TAGS = 'p, div, span, li, section, article, h1, h2, h3, h4, h5, h6';
const MAX_LOREM_SELECTORS = 10;

/**
 * Returns true if `other` is a DOM ancestor of `el`.
 */
function isAncestorOf(el, other) {
  let cursor = other.parent;
  while (cursor) {
    if (cursor === el) {
      return true;
    }
    cursor = cursor.parent;
  }
  return false;
}

/**
 * Preflight audit handler for detecting Lorem ipsum placeholder text.
 *
 * Scans the page for "Lorem ipsum" text and reports the innermost elements
 * containing it, up to a maximum of 10 selectors. This catches pages where
 * authors have not replaced template placeholder content before publishing.
 *
 * @param {Object} context - Audit context from the preflight system
 * @param {Object} auditContext - Preflight audit context
 * @returns {Promise<{processing: boolean}>}
 */
export default async function loremIpsum(context, auditContext) {
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
      name: AUDIT_LOREM_IPSUM,
      type: PREFLIGHT_AUDIT_TYPE_SEO,
      opportunities: [],
    });
  });

  const auditMap = new Map();
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    if (pageResult) {
      const audit = pageResult.audits.find((a) => a.name === AUDIT_LOREM_IPSUM);
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

    if (!LOREM_IPSUM_PATTERN.test(textContent)) {
      return;
    }

    const allLoremElements = $(LOREM_IPSUM_TAGS)
      .toArray()
      .filter((el) => LOREM_IPSUM_PATTERN.test($(el).text()));

    // Keep only innermost matches — discard ancestors whose text matched
    // solely because a descendant contains "Lorem ipsum".
    const loremElements = allLoremElements.filter(
      (el) => !allLoremElements.some((other) => other !== el && isAncestorOf(el, other)),
    );

    const loremSelectors = loremElements
      .map((el) => getDomElementSelector(el))
      .filter(Boolean);

    const fallbackSelector = loremSelectors.length === 0
      ? getDomElementSelector($('body').get(0))
      : null;

    audit.opportunities.push({
      check: 'placeholder-text',
      issue: 'Found Lorem ipsum placeholder text in the page content',
      seoImpact: 'High',
      seoRecommendation: 'Replace placeholder text with meaningful content',
      ...toElementTargets(
        loremSelectors.length > 0 ? loremSelectors : fallbackSelector,
        MAX_LOREM_SELECTORS,
      ),
    });
  });

  const endTime = Date.now();
  const endTimestamp = new Date().toISOString();
  const elapsed = ((endTime - startTime) / 1000).toFixed(2);

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. ${AUDIT_LOREM_IPSUM} audit completed in ${elapsed} seconds`);

  timeExecutionBreakdown.push({
    name: AUDIT_LOREM_IPSUM,
    duration: `${elapsed} seconds`,
    startTime: startTimestamp,
    endTime: endTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'lorem-ipsum audit');

  return { processing: false };
}
