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
import { sendReadabilityOpportunityToMystique } from './readability-auto-suggest.js';

export const PREFLIGHT_READABILITY = 'readability';

// Target Flesch Reading Ease score - scores below this will be flagged as poor readability
const TARGET_READABILITY_SCORE = 30;

// Minimum character length for text chunks to be considered for readability analysis
const MIN_TEXT_LENGTH = 100;

// Maximum characters to display in the audit report
const MAX_CHARACTERS_DISPLAY = 200;

export default async function readability(context, auditContext) {
  const {
    site, job, log,
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

      const doc = new JSDOM(rawBody).window.document;

      // Get all paragraph and div elements
      const textElements = Array.from(doc.querySelectorAll('p, div'));

      let processedElements = 0;
      let poorReadabilityCount = 0;

      // Helper function to detect if text is in English
      const isEnglishContent = (text) => {
        const detectedLanguage = franc(text);
        return detectedLanguage === 'eng';
      };

      // Helper function to calculate readability score and create audit opportunity
      const analyzeReadability = (text, element, elementIndex) => {
        try {
          // Check if text is in English before analyzing readability
          if (!isEnglishContent(text)) {
            return; // Skip non-English content
          }

          const readabilityScore = rs.fleschReadingEase(text.trim());

          if (readabilityScore < TARGET_READABILITY_SCORE) {
            poorReadabilityCount += 1;

            // Truncate text for display
            const displayText = text.length > MAX_CHARACTERS_DISPLAY
              ? `${text.substring(0, MAX_CHARACTERS_DISPLAY)}...`
              : text;

            const issueText = `Text element is difficult to read: "${displayText}"`;

            audit.opportunities.push({
              check: 'poor-readability',
              issue: issueText,
              seoImpact: 'Moderate',
              fleschReadingEase: readabilityScore,
              seoRecommendation: 'Improve readability by using shorter sentences, simpler words, and clearer structure',
            });
          }
        } catch (error) {
          const errorContext = `element with index ${elementIndex}`;
          log.error(`[preflight-audit] readability: Error calculating readability for ${errorContext} on ${normalizedFinalUrl}: ${error.message}`);
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
          // Split text by <br> tags and analyze each paragraph separately
          // Create a temporary clone to manipulate
          const tempElement = element.cloneNode(true);

          // Replace <br> tags with a unique delimiter
          const brRegex = /<br\s*\/?>/gi;
          tempElement.innerHTML = tempElement.innerHTML.replace(brRegex, '<!--BR_DELIMITER-->');

          // Split by the delimiter and extract text content
          const paragraphs = tempElement.innerHTML
            .split('<!--BR_DELIMITER-->')
            .map((p) => {
              // Create a temporary div to extract text content safely
              const tempDiv = doc.createElement('div');
              tempDiv.innerHTML = p;
              return tempDiv.textContent;
            })
            .map((p) => p.trim())
            .filter((p) => p.length >= MIN_TEXT_LENGTH);

          paragraphs.forEach((paragraph) => {
            analyzeReadability(paragraph, element, index);
          });

          processedElements += paragraphs.length;
        } else {
          // Analyze as a single text block
          processedElements += 1;
          analyzeReadability(textContent, element, index);
        }
      });

      log.info(`[preflight-audit] readability: Processed ${processedElements} text element(s) on ${normalizedFinalUrl}, found ${poorReadabilityCount} with poor readability`);
    });

    // Generate AI suggestions if this is the suggest step
    if (step === 'suggest') {
      const suggestStartTime = Date.now();
      const suggestStartTimestamp = new Date().toISOString();

      log.info(`[preflight-audit] readability: Starting Mystique suggestions generation for ${auditsResult.length} pages`);

      // Collect all readability issues across all pages
      const allReadabilityIssues = [];
      for (const pageResult of auditsResult) {
        const audit = pageResult.audits.find((a) => a.name === PREFLIGHT_READABILITY);
        if (audit && audit.opportunities.length > 0) {
          // Add page URL to each issue for context
          const issuesWithContext = audit.opportunities.map((issue) => ({
            ...issue,
            pageUrl: pageResult.pageUrl,
          }));
          allReadabilityIssues.push(...issuesWithContext);
        }
      }

      if (allReadabilityIssues.length > 0) {
        try {
          // Send readability opportunities to Mystique
          await sendReadabilityOpportunityToMystique(
            context.auditUrl || site.getBaseURL(),
            allReadabilityIssues,
            site.getId(),
            context.audit.getId(),
            context,
          );

          log.info(`[preflight-audit] readability: Sent ${allReadabilityIssues.length} readability issues to Mystique for improvement`);

          // Update the opportunities to indicate suggestions are being processed
          for (const pageResult of auditsResult) {
            const audit = pageResult.audits.find((a) => a.name === PREFLIGHT_READABILITY);
            if (audit && audit.opportunities.length > 0) {
              audit.opportunities = audit.opportunities.map((opportunity) => ({
                ...opportunity,
                seoRecommendation: 'AI suggestions are being generated for this readability issue. Check back later for improved text recommendations.',
                status: 'processing',
                suggestionCount: 0,
              }));
            }
          }
        } catch (error) {
          log.error('[preflight-audit] readability: Error sending readability issues to Mystique:', error);

          // Update opportunities to indicate error
          for (const pageResult of auditsResult) {
            const audit = pageResult.audits.find((a) => a.name === PREFLIGHT_READABILITY);
            if (audit && audit.opportunities.length > 0) {
              audit.opportunities = audit.opportunities.map((opportunity) => ({
                ...opportunity,
                seoRecommendation: 'Failed to generate AI suggestions. Please try again later.',
                status: 'error',
                error: error.message,
              }));
            }
          }
        }
      } else {
        log.info('[preflight-audit] readability: No readability issues found to send to Mystique');
      }

      const suggestEndTime = Date.now();
      const suggestEndTimestamp = new Date().toISOString();
      const suggestElapsed = ((suggestEndTime - suggestStartTime) / 1000).toFixed(2);
      log.info(`[preflight-audit] readability: Mystique suggestions generation completed in ${suggestElapsed} seconds`);

      timeExecutionBreakdown.push({
        name: 'readability-suggestions',
        duration: `${suggestElapsed} seconds`,
        startTime: suggestStartTimestamp,
        endTime: suggestEndTimestamp,
      });
    }

    const readabilityEndTime = Date.now();
    const readabilityEndTimestamp = new Date().toISOString();
    const readabilityElapsed = ((readabilityEndTime - readabilityStartTime) / 1000).toFixed(2);
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Readability audit completed in ${readabilityElapsed} seconds`);

    timeExecutionBreakdown.push({
      name: 'readability',
      duration: `${readabilityElapsed} seconds`,
      startTime: readabilityStartTimestamp,
      endTime: readabilityEndTimestamp,
    });

    await saveIntermediateResults(context, auditsResult, 'readability audit');
  }
}
