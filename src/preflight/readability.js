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

import { sendToMystiqueAndWait } from './readability-sync-mystique.js';

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
              textContent: text, // Store full text for AI processing
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
        if (!textContent || textContent.length < MIN_TEXT_LENGTH) {
          return;
        }

        // Check if the element contains <br> tags (indicating multiple paragraphs)
        if (element.innerHTML.includes('<br')) {
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

    // Process suggestions if this is the suggest step
    if (step === 'suggest') {
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
          log.info(`[preflight-audit] readability: Sending ${allReadabilityIssues.length} readability issues to Mystique and waiting for responses...`);

          // Send to Mystique and wait for synchronous responses
          const mystiquesSuggestions = await sendToMystiqueAndWait(
            context.auditUrl || site.getBaseURL(),
            allReadabilityIssues,
            site.getId(),
            context.audit.getId(),
            context,
          );

          log.info(`[preflight-audit] readability: Received ${mystiquesSuggestions.length} suggestions from Mystique`);

          // Update the audit results with the received suggestions
          for (const pageResult of auditsResult) {
            const audit = pageResult.audits.find((a) => a.name === PREFLIGHT_READABILITY);
            if (audit && audit.opportunities.length > 0) {
              audit.opportunities.forEach((opportunity, index) => {
                // Find matching suggestion by original text
                const matchingSuggestion = mystiquesSuggestions.find(
                  (suggestion) => suggestion.originalText === opportunity.textContent,
                );

                if (matchingSuggestion) {
                  audit.opportunities[index] = {
                    ...opportunity,
                    suggestionStatus: 'completed',
                    suggestionMessage: 'AI-powered readability improvement generated successfully.',
                    originalText: matchingSuggestion.originalText,
                    improvedText: matchingSuggestion.improvedText,
                    originalFleschScore: matchingSuggestion.originalFleschScore,
                    improvedFleschScore: matchingSuggestion.improvedFleschScore,
                    readabilityImprovement: matchingSuggestion.improvement,
                    seoRecommendation: matchingSuggestion.seoRecommendation,
                    aiRationale: matchingSuggestion.aiRationale,
                    mystiqueProcessingCompleted: new Date().toISOString(),
                  };
                } else {
                  audit.opportunities[index] = {
                    ...opportunity,
                    suggestionStatus: 'no-suggestion',
                    suggestionMessage: 'No AI suggestion was generated for this text.',
                  };
                }
              });
            }
          }
        } catch (error) {
          log.error('[preflight-audit] readability: Error getting suggestions from Mystique:', {
            error: error.message,
            stack: error.stack,
            siteId: site.getId(),
            auditId: context.audit.getId(),
            issuesCount: allReadabilityIssues.length,
            auditUrl: context.auditUrl || site.getBaseURL(),
          });

          // Create detailed error message for debugging
          const detailedErrorMessage = `Mystique integration failed: ${error.message}. Details: siteId=${site.getId()}, auditId=${context.audit.getId()}, issuesCount=${allReadabilityIssues.length}, hasEnvQueue=${!!context.env.QUEUE_SPACECAT_TO_MYSTIQUE}, hasSqs=${!!context.sqs}`;

          // Update audit results to show error status with detailed debugging
          for (const pageResult of auditsResult) {
            const audit = pageResult.audits.find((a) => a.name === PREFLIGHT_READABILITY);
            if (audit && audit.opportunities.length > 0) {
              audit.opportunities.forEach((opportunity, index) => {
                audit.opportunities[index] = {
                  ...opportunity,
                  suggestionStatus: 'error',
                  suggestionMessage: detailedErrorMessage,
                  debugInfo: {
                    errorType: error.constructor.name,
                    errorMessage: error.message,
                    timestamp: new Date().toISOString(),
                    mystiqueQueueConfigured: !!context.env.QUEUE_SPACECAT_TO_MYSTIQUE,
                    sqsClientAvailable: !!context.sqs,
                  },
                };
              });
            }
          }
        }
      } else {
        log.info('[preflight-audit] readability: No readability issues found to send to Mystique');
      }
    }

    const readabilityEndTime = Date.now();
    const readabilityEndTimestamp = new Date().toISOString();
    const readabilityElapsed = ((readabilityEndTime - readabilityStartTime) / 1000).toFixed(2);
    const auditStepName = step === 'suggest' ? 'readability-suggestions' : 'readability';
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Readability audit completed in ${readabilityElapsed} seconds`);

    timeExecutionBreakdown.push({
      name: auditStepName,
      duration: `${readabilityElapsed} seconds`,
      startTime: readabilityStartTimestamp,
      endTime: readabilityEndTimestamp,
    });

    await saveIntermediateResults(context, auditsResult, `readability ${step}`);
  }
}
