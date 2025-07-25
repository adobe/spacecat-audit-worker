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
import { saveIntermediateResults } from './utils.js';

export const PREFLIGHT_READABILITY = 'readability';

// Target Flesch Reading Ease score - scores below this will be flagged as poor readability
const TARGET_READABILITY_SCORE = 30;

// Minimum character length for text chunks to be considered for readability analysis
const MIN_TEXT_LENGTH = 100;

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

        textElements.forEach((element, index) => {
          const textContent = element.textContent?.trim();
          
          // Skip elements with insufficient text content
          if (!textContent || textContent.length < MIN_TEXT_LENGTH) {
            return;
          }

          processedElements += 1;

          try {
            // Calculate Flesch Reading Ease score
            const readabilityScore = rs.fleschReadingEase(textContent);
            
            // If score is below target, flag as poor readability
            if (readabilityScore < TARGET_READABILITY_SCORE) {
              poorReadabilityCount += 1;
              
              // Get element selector for identification
              const elementTag = element.tagName.toLowerCase();
              const elementId = element.id ? `#${element.id}` : '';
              const elementClass = element.className ? `.${element.className.split(' ').join('.')}` : '';
              const selector = `${elementTag}${elementId}${elementClass}`;
              
              // Truncate text for display (first 150 characters)
              const displayText = textContent.length > 150 
                ? `${textContent.substring(0, 150)}...` 
                : textContent;

              audit.opportunities.push({
                check: 'poor-readability',
                issue: `Text content has poor readability (Flesch score: ${readabilityScore.toFixed(1)}) in element ${selector}. Text preview: "${displayText}"`,
                seoImpact: 'Moderate',
                seoRecommendation: 'Improve readability by using shorter sentences, simpler words, and clearer structure',
              });
            }
          } catch (error) {
            log.warn(`[preflight-audit] readability: Error calculating readability for element ${index} on ${normalizedFinalUrl}: ${error.message}`);
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