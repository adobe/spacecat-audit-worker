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

import { JSDOM } from 'jsdom';
import { stripTrailingSlash } from '@adobe/spacecat-shared-utils';
import { saveIntermediateResults } from './utils.js';
import { isAuditEnabledForSite } from '../common/index.js';
import { HEADINGS_CHECKS } from '../headings/handler.js';

export const PREFLIGHT_HEADINGS = 'headings';

const H1_LENGTH_CHARS = 70;

function getHeadingLevel(tagName) {
  return Number(tagName.charAt(1));
}

/**
 * Safely extract text content from an element
 * @param {Element} element - The DOM element
 * @returns {string} - The trimmed text content, or empty string if null/undefined
 */
function getTextContent(element) {
  return (element.textContent || '').trim();
}

/**
 * Check if there is meaningful content between two DOM elements
 * @param {Element} startElement - The starting element (heading)
 * @param {Element} endElement - The ending element (next heading)
 * @returns {boolean} - True if meaningful content exists between the elements
 */
function hasContentBetweenElements(startElement, endElement) {
  const contentTags = new Set([
    'P', 'DIV', 'SPAN', 'UL', 'OL', 'DL', 'LI', 'IMG', 'FIGURE', 'VIDEO', 'AUDIO',
    'TABLE', 'FORM', 'FIELDSET', 'SECTION', 'ARTICLE', 'ASIDE', 'NAV', 'MAIN',
    'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'BR', 'CANVAS', 'SVG', 'IFRAME',
  ]);

  let currentElement = startElement.nextSibling;

  while (currentElement && currentElement !== endElement) {
    if (currentElement.nodeType === 1) { // Element node
      const tagName = currentElement.tagName.toUpperCase();
      if (contentTags.has(tagName)) {
        const textContent = (currentElement.textContent || '').trim();
        if (textContent.length > 0 || ['IMG', 'HR', 'BR', 'CANVAS', 'SVG', 'IFRAME'].includes(tagName)) {
          return true;
        }
      }

      if (currentElement.children && currentElement.children.length > 0) {
        const hasChildContent = Array.from(currentElement.children).some((child) => {
          const childTextContent = getTextContent(child);
          const childTagName = child.tagName.toUpperCase();
          return childTextContent.length > 0
                 || ['IMG', 'HR', 'BR', 'CANVAS', 'SVG', 'IFRAME'].includes(childTagName);
        });
        if (hasChildContent) {
          return true;
        }
      }
    } else if (currentElement.nodeType === 3) { // Text node
      const textContent = getTextContent(currentElement);
      if (textContent.length > 0) {
        return true;
      }
    }

    currentElement = currentElement.nextSibling;
  }

  return false;
}

export default async function headings(context, auditContext) {
  const {
    site, job, log,
  } = context;
  const {
    previewUrls,
    audits,
    auditsResult,
    scrapedObjects,
    timeExecutionBreakdown,
  } = auditContext;

  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${auditContext.step}. Headings audit started`);
  log.debug(`[preflight-audit] Preview URLs: ${JSON.stringify(previewUrls)}`);
  log.debug(`[preflight-audit] Scraped objects: ${JSON.stringify(scrapedObjects)}`);
  log.debug(`[preflight-audit] Audits: ${JSON.stringify(Array.from(audits.entries()))}`);
  log.debug(`[preflight-audit] Audits result: ${JSON.stringify(auditsResult)}`);
  log.debug(`[preflight-audit] Time execution breakdown: ${JSON.stringify(timeExecutionBreakdown)}`);

  const isHeadingsEnabled = await isAuditEnabledForSite(`${PREFLIGHT_HEADINGS}-preflight`, site, context);
  if (!isHeadingsEnabled) {
    return;
  }

  const headingsStartTime = Date.now();
  const headingsStartTimestamp = new Date().toISOString();

  // Create headings audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ name: PREFLIGHT_HEADINGS, type: 'seo', opportunities: [] });
  });

  // Pre-index PREFLIGHT_HEADINGS audits for O(1) lookups
  const headingsAuditMap = new Map();
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    if (pageResult) {
      const headingsAudit = pageResult.audits.find((a) => a.name === PREFLIGHT_HEADINGS);
      if (headingsAudit) {
        headingsAuditMap.set(url, headingsAudit);
      }
    }
  });

  // Build a quick lookup for scraped content by final URL
  const scrapedByUrl = new Map();
  scrapedObjects.forEach(({ data }) => {
    scrapedByUrl.set(stripTrailingSlash(data.finalUrl), data);
  });

  // Run checks per page
  previewUrls.forEach((url) => {
    const audit = headingsAuditMap.get(url);
    const scraped = scrapedByUrl.get(url);
    if (!scraped) {
      log.warn(`[preflight-audit] No scraped data found for ${url}, skipping headings checks`);
      return;
    }

    const { scrapeResult: { rawBody } } = scraped;
    const doc = new JSDOM(rawBody).window.document;
    const headingElements = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'));

    const checks = [];

    // H1 validations
    const h1Elements = headingElements.filter((h) => h.tagName === 'H1');

    if (h1Elements.length === 0) {
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MISSING_H1.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_MISSING_H1.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_MISSING_H1.suggestion,
      });
    } else if (h1Elements.length > 1) {
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.suggestion,
        count: h1Elements.length,
      });
    } else if (getTextContent(h1Elements[0]).length === 0
      || getTextContent(h1Elements[0]).length > H1_LENGTH_CHARS) {
      checks.push({
        check: HEADINGS_CHECKS.HEADING_H1_LENGTH.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_H1_LENGTH.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_H1_LENGTH.suggestion,
      });
    }

    // Empty non-H1 headings and duplicate text collection
    const headingTexts = new Map();
    headingElements.forEach((heading) => {
      if (heading.tagName !== 'H1') {
        const text = getTextContent(heading);
        if (text.length === 0) {
          log.debug(`[preflight-audit] Empty heading detected (${heading.tagName}) at ${url}`);
          checks.push({
            check: HEADINGS_CHECKS.HEADING_EMPTY.check,
            success: false,
            explanation: HEADINGS_CHECKS.HEADING_EMPTY.explanation,
            suggestion: HEADINGS_CHECKS.HEADING_EMPTY.suggestion,
            tagName: heading.tagName,
          });
        } else {
          const lowerText = text.toLowerCase();
          if (!headingTexts.has(lowerText)) {
            headingTexts.set(lowerText, []);
          }
          headingTexts.get(lowerText).push({ text, tagName: heading.tagName, element: heading });
        }
      }
    });

    // Duplicate headings
    for (const [_, headingsWithSameText] of headingTexts) {
      if (headingsWithSameText.length > 1) {
        checks.push({
          check: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check,
          success: false,
          explanation: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.explanation,
          suggestion: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.suggestion,
          text: headingsWithSameText[0].text,
          duplicates: headingsWithSameText.map((h) => h.tagName),
          count: headingsWithSameText.length,
        });
        log.debug(`[preflight-audit] Duplicate heading text detected at ${url}: "${headingsWithSameText[0].text}" found in ${headingsWithSameText.map((h) => h.tagName).join(', ')}`);
      }
    }

    // Heading with no content between it and the next heading
    for (let i = 0; i < headingElements.length - 1; i += 1) {
      const currentHeading = headingElements[i];
      const nextHeading = headingElements[i + 1];
      if (!hasContentBetweenElements(currentHeading, nextHeading)) {
        checks.push({
          check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
          success: false,
          explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
          suggestion: HEADINGS_CHECKS.HEADING_NO_CONTENT.suggestion,
          heading: currentHeading.tagName,
          nextHeading: nextHeading.tagName,
        });
        log.debug(`[preflight-audit] Heading without content detected at ${url}: ${currentHeading.tagName} has no content before ${nextHeading.tagName}`);
      }
    }

    // Heading level order validation
    if (headingElements.length > 1) {
      for (let i = 1; i < headingElements.length; i += 1) {
        const prev = headingElements[i - 1];
        const cur = headingElements[i];
        const prevLevel = getHeadingLevel(prev.tagName);
        const curLevel = getHeadingLevel(cur.tagName);
        if (curLevel - prevLevel > 1) {
          checks.push({
            check: HEADINGS_CHECKS.HEADING_ORDER_INVALID.check,
            success: false,
            explanation: HEADINGS_CHECKS.HEADING_ORDER_INVALID.explanation,
            suggestion: HEADINGS_CHECKS.HEADING_ORDER_INVALID.suggestion,
            previous: `h${prevLevel}`,
            current: `h${curLevel}`,
          });
          log.debug(`[preflight-audit] Heading level jump detected at ${url}: h${prevLevel} → h${curLevel}`);
        }
      }
    }

    // Map checks to preflight opportunities
    checks
      .filter((c) => c && c.success === false)
      .forEach((check) => {
        const opportunity = {
          check: check.check,
          issue: check.explanation,
          seoImpact: 'Moderate',
          seoRecommendation: check.suggestion,
        };
        if (check.tagName) opportunity.tagName = check.tagName;
        if (typeof check.count !== 'undefined') opportunity.count = check.count;
        if (check.text) opportunity.text = check.text;
        if (check.duplicates) opportunity.duplicates = check.duplicates;
        if (check.heading) opportunity.heading = check.heading;
        if (check.nextHeading) opportunity.nextHeading = check.nextHeading;
        if (check.previous) opportunity.previous = check.previous;
        if (check.current) opportunity.current = check.current;

        audit.opportunities.push(opportunity);
      });
  });

  const headingsEndTime = Date.now();
  const headingsEndTimestamp = new Date().toISOString();
  const headingsElapsed = ((headingsEndTime - headingsStartTime) / 1000).toFixed(2);
  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${auditContext.step}. Headings audit completed in ${headingsElapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'headings',
    duration: `${headingsElapsed} seconds`,
    startTime: headingsStartTimestamp,
    endTime: headingsEndTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'headings audit');
}
