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
import { saveIntermediateResults } from '../preflight/utils.js';

export const PREFLIGHT_READABILITY = 'readability';

const MIN_TEXT_LENGTH = 100;
const MAX_FLESCH_SCORE = 50; // Text with score below this is considered poor readability
const MAX_CHARACTERS_DISPLAY = 200; // Maximum characters to display in issue text

/**
 * Preflight readability audit - IDENTIFICATION ONLY
 * This function only identifies readability issues and stores them.
 * Mystique suggestions are handled by a separate 'readability-suggestions' audit.
 *
 * @param {Object} context - The audit context
 * @param {Object} auditContext - The audit-specific context
 * @returns {Promise<Object>} Result indicating if processing is needed
 */
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

  if (!checks || !checks.includes(PREFLIGHT_READABILITY)) {
    return { processing: false };
  }

  const readabilityStartTime = Date.now();
  const readabilityStartTimestamp = new Date().toISOString();

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Starting readability audit`);

  // Create readability audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    if (pageResult) {
      pageResult.audits.push({ name: PREFLIGHT_READABILITY, type: 'seo', opportunities: [] });
    }
  });

  // Process scraped content for readability analysis
  let totalElementsProcessed = 0;
  let totalIssuesFound = 0;

  for (const scrapedObject of scrapedObjects) {
    const { finalUrl, scrapeResult } = scrapedObject.data;

    // Find corresponding page result (handle trailing slashes)
    const normalizedUrl = finalUrl.replace(/\/$/, '');
    const pageResult = audits.get(finalUrl) || audits.get(normalizedUrl) || audits.get(`${normalizedUrl}/`);

    if (!pageResult) {
      log.warn(`[preflight-audit] readability: No page result found for ${finalUrl}`);
    } else {
      const audit = pageResult.audits.find((a) => a.name === PREFLIGHT_READABILITY);
      if (!audit) {
        log.warn(`[preflight-audit] readability: No readability audit found for ${finalUrl}`);
      } else if (!scrapeResult?.rawBody) {
        log.warn(`[preflight-audit] readability: No content found for ${finalUrl}`);
      } else {
        try {
          const dom = new JSDOM(scrapeResult.rawBody);
          const { document } = dom.window;

          // Get all text elements (paragraphs and divs)
          const textElements = document.querySelectorAll('p, div');

          for (const element of textElements) {
            // Skip elements that have block-level children to avoid duplicate analysis
            const blockChildren = element.querySelectorAll('p, div, section, article, header, footer, main, aside, nav, h1, h2, h3, h4, h5, h6');
            if (blockChildren.length === 0) {
              // Get the text content and split by <br> tags to handle multiple paragraphs
              const htmlContent = element.innerHTML;
              const paragraphs = htmlContent.split(/<br\s*\/?>/i).map((p) => {
                // Remove HTML tags and get clean text
                const tempDiv = dom.window.document.createElement('div');
                tempDiv.innerHTML = p;
                return tempDiv.textContent.trim();
              }).filter((p) => p.length >= MIN_TEXT_LENGTH);

              for (const paragraph of paragraphs) {
                totalElementsProcessed += 1;

                try {
                  // Check language - only process English content
                  const detectedLanguage = franc(paragraph);
                  if (detectedLanguage === 'eng') {
                    // Calculate Flesch Reading Ease score
                    const fleschScore = rs.fleschReadingEase(paragraph);

                    // Only flag text with poor readability
                    if (fleschScore < MAX_FLESCH_SCORE) {
                      totalIssuesFound += 1;

                      // Truncate text for display if needed
                      const displayText = paragraph.length > MAX_CHARACTERS_DISPLAY
                        ? `${paragraph.substring(0, MAX_CHARACTERS_DISPLAY)}...`
                        : paragraph;

                      const opportunity = {
                        check: 'poor-readability',
                        issue: `Text has poor readability (Flesch Score: ${Math.round(fleschScore)}). Consider simplifying: "${displayText}"`,
                        seoImpact: 'Poor readability can reduce user engagement and search engine rankings',
                        seoRecommendation: 'Rewrite the text using shorter sentences, simpler words, and clearer structure to improve readability',
                        fleschReadingEase: Math.round(fleschScore),
                        textContent: paragraph, // Store full text for potential Mystique processing
                        pageUrl: finalUrl,
                        selector: element.tagName.toLowerCase(),
                      };

                      audit.opportunities.push(opportunity);
                    }
                  }
                } catch (error) {
                  log.error(`[preflight-audit] readability: Error calculating readability for element: ${error.message}`);
                }
              }
            }
          }
        } catch (error) {
          log.error(`[preflight-audit] readability: Error processing ${finalUrl}: ${error.message}`);
        }
      }
    }
  }

  log.info(`[preflight-audit] readability: Processed ${totalElementsProcessed} text element(s), found ${totalIssuesFound} with poor readability`);

  // For suggest step, trigger the readability-suggestions audit to get AI improvements
  if (step === 'suggest' && totalIssuesFound > 0) {
    log.info(`[preflight-audit] readability: ${totalIssuesFound} readability issues found. Triggering AI-powered improvements.`);

    try {
      // Import and call the suggestions handler directly
      const { processReadabilitySuggestionsWithMystique } = await import('./suggestions-handler.js');

      // Create a mock audit object for the suggestions handler
      const mockAudit = {
        getId: () => job.getId(),
      };

      // Create context for suggestions handler
      const suggestionsContext = {
        ...context,
        audit: mockAudit,
      };

      // Call the suggestions handler to process with Mystique
      await processReadabilitySuggestionsWithMystique(suggestionsContext);

      log.info('[preflight-audit] readability: Successfully triggered readability suggestions processing');

      // Update opportunities to indicate AI processing is happening
      for (const pageResult of auditsResult) {
        const readabilityAudit = pageResult.audits.find((a) => a.name === PREFLIGHT_READABILITY);
        if (readabilityAudit && readabilityAudit.opportunities.length > 0) {
          readabilityAudit.opportunities.forEach((opportunity, index) => {
            readabilityAudit.opportunities[index] = {
              ...opportunity,
              aiSuggestionsStatus: 'processing',
              aiSuggestionsMessage: 'AI-powered readability improvements are being generated by Mystique. Enhanced text versions will be available in the readability-suggestions audit.',
              suggestionsTriggered: new Date().toISOString(),
            };
          });
        }
      }
    } catch (error) {
      log.error(`[preflight-audit] readability: Failed to trigger suggestions processing: ${error.message}`);

      // Add error information to opportunities
      for (const pageResult of auditsResult) {
        const readabilityAudit = pageResult.audits.find((a) => a.name === PREFLIGHT_READABILITY);
        if (readabilityAudit && readabilityAudit.opportunities.length > 0) {
          readabilityAudit.opportunities.forEach((opportunity, index) => {
            readabilityAudit.opportunities[index] = {
              ...opportunity,
              aiSuggestionsStatus: 'error',
              aiSuggestionsMessage: `Failed to trigger AI suggestions: ${error.message}`,
              suggestionsError: error.message,
            };
          });
        }
      }
    }
  } else if (step === 'suggest' && totalIssuesFound === 0) {
    log.info('[preflight-audit] readability: No readability issues found, no AI suggestions needed.');
  }

  const readabilityEndTime = Date.now();
  const readabilityEndTimestamp = new Date().toISOString();
  const readabilityElapsed = ((readabilityEndTime - readabilityStartTime) / 1000).toFixed(2);

  timeExecutionBreakdown.push({
    name: 'readability',
    duration: `${readabilityElapsed} seconds`,
    startTime: readabilityStartTimestamp,
    endTime: readabilityEndTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'readability audit');

  log.info(
    `[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. `
    + `Readability audit completed in ${readabilityElapsed} seconds`,
  );

  // Always return processing: false since preflight is synchronous
  // Mystique processing will be handled by separate readability-suggestions audit
  return { processing: false };
}
