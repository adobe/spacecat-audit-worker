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

import rs from 'text-readability';
import { JSDOM } from 'jsdom';
import { franc } from 'franc-min';
import { saveIntermediateResults } from './utils.js';

export const PREFLIGHT_READABILITY = 'readability';

// Target Flesch Reading Ease score - scores below this will be flagged as poor readability
const TARGET_READABILITY_SCORE = 30;

// Minimum character length for text chunks to be considered for readability analysis
const MIN_TEXT_LENGTH = 100;

// Maximum characters to display in the audit report
const MAX_CHARACTERS_DISPLAY = 200;

export default async function readability(context, auditContext) {
  const {
    site, jobId, log,
  } = context;
  const {
    checks,
    previewUrls,
    step,
    audits,
    auditsResult,
    scrapedObjects,
    timeExecutionBreakdown,
  } = auditContext;

  if (!checks || checks.includes(PREFLIGHT_READABILITY)) {
    const readabilityStartTime = Date.now();
    const readabilityStartTimestamp = new Date().toISOString();

    // Create readability audit entries for all pages
    previewUrls.forEach((url) => {
      const pageResult = audits.get(url);
      pageResult.audits.push({ name: PREFLIGHT_READABILITY, type: 'seo', opportunities: [] });
    });

    // Process each scraped page
    scrapedObjects.forEach(({ data }) => {
      const { finalUrl, scrapeResult: { rawBody } } = data;
      const normalizedFinalUrl = new URL(finalUrl).origin + new URL(finalUrl).pathname.replace(/\/$/, '');
      const pageResult = audits.get(normalizedFinalUrl);

      if (!pageResult) {
        log.warn(`[preflight-audit] readability: No page result found for ${normalizedFinalUrl}`);
        return;
      }

      const audit = pageResult.audits.find((a) => a.name === PREFLIGHT_READABILITY);
      if (!audit) {
        log.warn(`[preflight-audit] readability: No readability audit found for ${normalizedFinalUrl}`);
        return;
      }

      try {
        const doc = new JSDOM(rawBody).window.document;

        // Get all paragraph and div elements
        const textElements = Array.from(doc.querySelectorAll('p, div'));

        let processedElements = 0;
        let poorReadabilityCount = 0;

        // Helper function to detect if text is in English
        const isEnglishContent = (text) => {
          try {
            const detectedLanguage = franc(text);
            return detectedLanguage === 'eng';
          } catch (error) {
            log.warn(`[preflight-audit] readability: Error detecting language: ${error.message}`);
            // Default to true if language detection fails
            return true;
          }
        };

        // Helper function to calculate readability score and create audit opportunity
        const analyzeReadability = (text, element, elementIndex, paragraphIndex = null) => {
          try {
            // Check if text is in English before analyzing readability
            if (!isEnglishContent(text)) {
              return; // Skip non-English content
            }

            const readabilityScore = rs.fleschReadingEase(text.trim());

            if (readabilityScore < TARGET_READABILITY_SCORE) {
              poorReadabilityCount += 1;

              // Get element selector for identification
              const elementTag = element.tagName.toLowerCase();
              const elementId = element.id ? `#${element.id}` : '';
              const elementClass = element.className ? `.${element.className.split(' ').join('.')}` : '';
              const selector = `${elementTag}${elementId}${elementClass}`;

              // Truncate text for display
              const displayText = text.length > MAX_CHARACTERS_DISPLAY
                ? `${text.substring(0, MAX_CHARACTERS_DISPLAY)}...`
                : text;

              const issueText = paragraphIndex !== null
                ? `Text content has poor readability (Flesch score: ${readabilityScore.toFixed(1)}) in paragraph ${paragraphIndex + 1} of element ${selector}. Text preview: "${displayText}"`
                : `Text content has poor readability (Flesch score: ${readabilityScore.toFixed(1)}) in element ${selector}. Text preview: "${displayText}"`;

              audit.opportunities.push({
                check: 'poor-readability',
                issue: issueText,
                seoImpact: 'Moderate',
                seoRecommendation: 'Improve readability by using shorter sentences, simpler words, and clearer structure',
              });
            }
          } catch (error) {
            const errorContext = paragraphIndex !== null
              ? `paragraph ${paragraphIndex + 1} in element ${elementIndex}`
              : `element ${elementIndex}`;
            log.warn(`[preflight-audit] readability: Error calculating readability for ${errorContext} on ${normalizedFinalUrl}: ${error.message}`);
          }
        };

        textElements.forEach((element, index) => {
          // Check if element has child elements
          if (element.children.length > 0) {
            // If it has children, check if they are only inline formatting elements
            const hasOnlyInlineChildren = Array.from(element.children).every((child) => {
              const inlineTags = ['strong', 'b', 'em', 'i', 'span', 'a', 'mark', 'small', 'sub', 'sup', 'u', 'code', 'br'];
              return inlineTags.includes(child.tagName.toLowerCase());
            });

            // Skip if it has block-level children (to avoid duplicate analysis)
            if (!hasOnlyInlineChildren) {
              return;
            }
          }

          const textContent = element.textContent?.trim();

          // Skip elements with insufficient text content
          if (!textContent || textContent.length < MIN_TEXT_LENGTH) {
            return;
          }

          // Check if element contains <br> or <br /> tags
          const hasLineBreaks = element.innerHTML.includes('<br');

          if (hasLineBreaks) {
            // Split text by line breaks and analyze each paragraph separately
            const paragraphs = textContent.split(/\s*\n\s*/).filter((p) => p.trim().length >= MIN_TEXT_LENGTH);

            paragraphs.forEach((paragraph, paragraphIndex) => {
              analyzeReadability(paragraph, element, index, paragraphIndex);
            });

            processedElements += paragraphs.length;
          } else {
            // Analyze as a single text block
            processedElements += 1;
            analyzeReadability(textContent, element, index);
          }
        });

        log.info(`[preflight-audit] readability: Processed ${processedElements} text elements on ${normalizedFinalUrl}, found ${poorReadabilityCount} with poor readability`);
      } catch (error) {
        log.error(`[preflight-audit] readability: Error processing ${normalizedFinalUrl}: ${error.message}`);
        audit.opportunities.push({
          check: 'readability-analysis-error',
          issue: `Failed to analyze page readability: ${error.message}`,
          seoImpact: 'Low',
          seoRecommendation: 'Review page content manually for readability issues',
        });
      }
    });

    const readabilityEndTime = Date.now();
    const readabilityEndTimestamp = new Date().toISOString();
    const readabilityElapsed = ((readabilityEndTime - readabilityStartTime) / 1000).toFixed(2);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Readability audit completed in ${readabilityElapsed} seconds`);

    timeExecutionBreakdown.push({
      name: 'readability',
      duration: `${readabilityElapsed} seconds`,
      startTime: readabilityStartTimestamp,
      endTime: readabilityEndTimestamp,
    });

    await saveIntermediateResults(context, auditsResult, 'readability audit');
  }
}
