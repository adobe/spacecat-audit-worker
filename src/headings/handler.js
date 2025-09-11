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
import { tracingFetch as fetch, getPrompt } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../utils/s3-utils.js';

const auditType = Audit.AUDIT_TYPES.HEADINGS;

export const HEADINGS_CHECKS = Object.freeze({
  HEADING_ORDER_INVALID: {
    check: 'heading-order-invalid',
    explanation: 'Heading levels should increase by one (h1→h2), not jump levels (h1→h3).',
    suggestion: 'Adjust heading levels to maintain proper hierarchy.',
  },
  HEADING_EMPTY: {
    check: 'heading-empty',
    explanation: 'Heading elements should not be empty.',
    suggestion: 'Add descriptive text or remove the empty heading.',
  },
  HEADING_MISSING_H1: {
    check: 'heading-missing-h1',
    explanation: 'Pages should have exactly one h1 element for SEO and accessibility.',
    suggestion: 'Add an h1 element describing the main content.',
  },
  HEADING_MULTIPLE_H1: {
    check: 'heading-multiple-h1',
    explanation: 'Pages should have only one h1 element.',
    suggestion: 'Change additional h1 elements to h2 or appropriate levels.',
  },
  HEADING_DUPLICATE_TEXT: {
    check: 'heading-duplicate-text',
    explanation: 'Headings should have unique text content (WCAG 2.2 2.4.6).',
    suggestion: 'Ensure each heading has unique, descriptive text.',
  },
  HEADING_NO_CONTENT: {
    check: 'heading-no-content',
    explanation: 'Headings should be followed by content before the next heading.',
    suggestion: 'Add meaningful content after each heading.',
  },
  TOPPAGES: {
    check: 'top-pages',
    explanation: 'No top pages found',
  },
});

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
    // Check if it's an element node
    if (currentElement.nodeType === 1) { // Element node
      const tagName = currentElement.tagName.toUpperCase();

      // If it's a content tag, check if it has meaningful content
      if (contentTags.has(tagName)) {
        const textContent = (currentElement.textContent || '').trim();
        // Consider it meaningful if it has text content or is a self-closing content element
        if (textContent.length > 0 || ['IMG', 'HR', 'BR', 'CANVAS', 'SVG', 'IFRAME'].includes(tagName)) {
          return true;
        }
      }

      // Recursively check child elements for content
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

/**
 * Validate heading semantics for a single page.
 * - Ensure heading level increases by at most 1 when going deeper (no jumps, e.g., h1 → h3)
 * - Ensure headings are not empty
 *
 * @param {string} url
 * @param {Object} log
 * @returns {Promise<{url: string, checks: Array}>}
 */
export async function validatePageHeadings(url, log) {
  if (!url) {
    log.error('URL is undefined or null, cannot validate headings');
    return {
      url,
      checks: [],
    };
  }

  try {
    log.info(`Checking headings for URL: ${url}`);
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const { document } = dom.window;

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const checks = [];

    const h1Elements = headings.filter((h) => h.tagName === 'H1');

    if (h1Elements.length === 0) {
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MISSING_H1.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_MISSING_H1.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_MISSING_H1.suggestion,
      });
      log.info(`Missing h1 element detected at ${url}`);
    } else if (h1Elements.length > 1) {
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.suggestion,
        count: h1Elements.length,
      });
      log.info(`Multiple h1 elements detected at ${url}: ${h1Elements.length} found`);
    }

    // Check for empty headings and collect text content for duplicate detection
    const headingTexts = new Map();
    for (const heading of headings) {
      const text = getTextContent(heading);
      if (text.length === 0) {
        checks.push({
          check: HEADINGS_CHECKS.HEADING_EMPTY.check,
          success: false,
          explanation: HEADINGS_CHECKS.HEADING_EMPTY.explanation,
          suggestion: HEADINGS_CHECKS.HEADING_EMPTY.suggestion,
          tagName: heading.tagName,
        });
        log.info(`Empty heading detected (${heading.tagName}) at ${url}`);
      } else {
        // Track heading text content for duplicate detection
        const lowerText = text.toLowerCase();
        if (!headingTexts.has(lowerText)) {
          headingTexts.set(lowerText, []);
        }
        headingTexts.get(lowerText).push({
          text,
          tagName: heading.tagName,
          element: heading,
        });
      }
    }

    // Check for duplicate heading text content
    // eslint-disable-next-line no-unused-vars
    for (const [lowerText, headingsWithSameText] of headingTexts) {
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
        log.info(`Duplicate heading text detected at ${url}: "${headingsWithSameText[0].text}" found in ${headingsWithSameText.map((h) => h.tagName).join(', ')}`);
      }
    }

    // Check for headings without content before the next heading
    for (let i = 0; i < headings.length - 1; i += 1) {
      const currentHeading = headings[i];
      const nextHeading = headings[i + 1];

      if (!hasContentBetweenElements(currentHeading, nextHeading)) {
        checks.push({
          check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
          success: false,
          explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
          suggestion: HEADINGS_CHECKS.HEADING_NO_CONTENT.suggestion,
          heading: currentHeading.tagName,
          nextHeading: nextHeading.tagName,
        });
        log.info(`Heading without content detected at ${url}: ${currentHeading.tagName} has no content before ${nextHeading.tagName}`);
      }
    }

    if (headings.length > 1) {
      for (let i = 1; i < headings.length; i += 1) {
        const prev = headings[i - 1];
        const cur = headings[i];
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
          log.info(`Heading level jump detected at ${url}: h${prevLevel} → h${curLevel}`);
        }
      }
    }

    return { url, checks };
  } catch (error) {
    log.error(`Error validating headings for ${url}: ${error.message}`);
    return {
      url,
      checks: [],
    };
  }
}

/**
 * Main headings audit runner
 * @param {string} baseURL
 * @param {Object} context
 * @param {Object} site
 * @returns {Promise<Object>}
 */
export async function headingsAuditRunner(baseURL, context, site) {
  const siteId = site.getId();
  const { log, dataAccess } = context;
  log.info(`[Headings Audit] AZURE_OPENAI_ENDPOINT: ${JSON.stringify(context.env.AZURE_OPENAI_ENDPOINT)}`);
  log.info(`[Headings Audit] Starting Headings Audit with siteId: ${siteId}`);
  log.info(`[Headings Audit] Base URL: ${baseURL}`);
  log.info(`[Headings Audit] Site delivery type: ${site.getDeliveryType() || 'Unknown'}`);

  try {
    // Get top 200 pages
    log.info(`[Headings Audit] Fetching top pages for site: ${siteId}`);
    const allTopPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
    const topPages = allTopPages.slice(0, 200);

    log.info(`[Headings Audit] Processing ${topPages.length} top pages for headings audit (limited to 200)`);
    log.debug(`[Headings Audit] Top pages sample: ${topPages.slice(0, 3).map((p) => p.url).join(', ')}`);

    if (topPages.length === 0) {
      log.warn('[Headings Audit] No top pages found, ending audit.');
      return {
        fullAuditRef: baseURL,
        auditResult: {
          check: HEADINGS_CHECKS.TOPPAGES.check,
          success: false,
          explanation: HEADINGS_CHECKS.TOPPAGES.explanation,
        },
      };
    }

    // Validate headings for each page
    const auditPromises = topPages
      .map(async (page) => validatePageHeadings(page.url, log));
    const auditResults = await Promise.allSettled(auditPromises);

    // Aggregate results by check type
    const aggregatedResults = {};
    let totalIssuesFound = 0;

    auditResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        const { url, checks } = result.value;

        checks.forEach((check) => {
          if (!check.success) {
            totalIssuesFound += 1;
            const checkType = check.check;

            if (!aggregatedResults[checkType]) {
              aggregatedResults[checkType] = {
                success: false,
                explanation: check.explanation,
                suggestion: check.suggestion,
                urls: [],
                aiSuggestions: [],
              };
            }

            // Add URL if not already present
            if (!aggregatedResults[checkType].urls.includes(url)) {
              aggregatedResults[checkType].urls.push(url);
            }
          }
        });
      }
    });

    log.info(`Successfully completed Headings Audit for site: ${baseURL}. Found ${totalIssuesFound} issues across ${Object.keys(aggregatedResults).length} check types.`);

    // Return success if no issues found, otherwise return the aggregated results
    if (totalIssuesFound === 0) {
      return {
        fullAuditRef: baseURL,
        auditResult: { status: 'success', message: 'No heading issues detected' },
      };
    }

    return {
      fullAuditRef: baseURL,
      auditResult: aggregatedResults,
    };
  } catch (error) {
    log.error(`Headings audit failed: ${error.message}`);
    return {
      fullAuditRef: baseURL,
      auditResult: { error: `Audit failed with error: ${error.message}`, success: false },
    };
  }
}

export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  if (auditData.auditResult?.status === 'success' || auditData.auditResult?.error) {
    log.info(`Headings audit for ${auditUrl} has no issues or failed, skipping suggestions generation`);
    return { ...auditData };
  }

  const suggestions = [];

  Object.entries(auditData.auditResult).forEach(([checkType, checkResult]) => {
    if (checkResult.success === false && Array.isArray(checkResult.urls)) {
      checkResult.urls.forEach((url) => {
        suggestions.push({
          type: 'CODE_CHANGE',
          checkType,
          explanation: checkResult.explanation,
          url,
          // eslint-disable-next-line no-use-before-define
          recommendedAction: generateRecommendedAction(checkType),
        });
      });
    }
  });

  log.info(`Generated ${suggestions.length} headings suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

export async function generateAISuggestions(auditUrl, auditData, context, site) {
  const { log, s3Client } = context;
  const { S3_SCRAPER_BUCKET_NAME, AZURE_OPENAI_ENDPOINT } = context.env;
  const prefix = `scrapes/${site.getId()}/`;
  if (!s3Client) {
    log.error('[Headings AI Suggestions] Missing required parameters s3Client, skipping AI suggestions generation');
    return { ...auditData };
  }
  if (!S3_SCRAPER_BUCKET_NAME) {
    log.error('[Headings AI Suggestions] Missing required parameters S3_SCRAPER_BUCKET_NAME, skipping AI suggestions generation');
    return { ...auditData };
  }
  if (!AZURE_OPENAI_ENDPOINT) {
    log.error('[Headings AI Suggestions] Missing required parameters AZURE_OPENAI_ENDPOINT, skipping AI suggestions generation');
    return { ...auditData };
  }
  if (!prefix) {
    log.error('[Headings AI Suggestions] Missing required parameters prefix, skipping AI suggestions generation');
    return { ...auditData };
  }
  const allKeys = await getObjectKeysUsingPrefix(s3Client, S3_SCRAPER_BUCKET_NAME, prefix, log);
  log.info(`[Headings AI Suggestions] All keys: ${allKeys}`);
  log.info(`[Headings AI Suggestions] Starting AI suggestions generation for audit: ${auditUrl}`);
  log.info(`[Headings AI Suggestions] Site ID: ${site.getId()}, Base URL: ${site.getBaseURL()}`);
  log.info(`[Headings AI Suggestions] Audit data: ${JSON.stringify(auditData)}`);
  const updatedAuditData = { ...auditData };
  updatedAuditData.auditResult = { ...auditData.auditResult };
  const tasks = [];

  for (const [checkType, checkResult] of Object.entries(auditData.auditResult)) {
    if (checkResult.success === false && Array.isArray(checkResult.urls)) {
      for (const url of checkResult.urls) {
        if (checkType === HEADINGS_CHECKS.HEADING_EMPTY.check
          || checkType === HEADINGS_CHECKS.HEADING_MISSING_H1.check) {
          tasks.push(
            (async () => {
              log.info(`[Headings AI Suggestions] Generating AI suggestions for ${url} with check type: ${checkType}`);
              const scrapeJsonPath = getScrapeJsonPath(url, site.getId());

              if (allKeys.includes(scrapeJsonPath)) {
                log.info(`[Headings AI Suggestions] Scrape JSON path: ${scrapeJsonPath} found in allKeys`);

                try {
                  const scrapeJsonObject = await getObjectFromKey(
                    s3Client,
                    S3_SCRAPER_BUCKET_NAME,
                    scrapeJsonPath,
                    log,
                  );

                  log.info(`[Headings AI Suggestions] Scrape JSON object received for ${scrapeJsonObject.finalUrl}`);
                  log.info(`[Headings AI Suggestions] Scrape JSON object: ${JSON.stringify(scrapeJsonObject.scrapeResult.tags)}`);

                  const azureOpenAIClient = AzureOpenAIClient.createFrom(context);
                  const prompt = await getPrompt(
                    {
                      finalUrl: scrapeJsonObject.finalUrl,
                      title: scrapeJsonObject.scrapeResult.tags.title,
                      h1: scrapeJsonObject.scrapeResult.tags.h1,
                      description: scrapeJsonObject.scrapeResult.tags.description,
                      lang: scrapeJsonObject.scrapeResult.tags.lang,
                    },
                    'heading-empty-suggestion',
                    log,
                  );
                  log.info(`[Headings AI Suggestions] Prompt: ${prompt}`);

                  const aiResponse = await azureOpenAIClient.fetchChatCompletion(prompt, {
                    responseFormat: 'json_object',
                  });

                  const aiResponseContent = JSON.parse(aiResponse.choices[0].message.content);
                  const { aiSuggestion } = aiResponseContent.h1;

                  log.info(`[Headings AI Suggestions] AI suggestion for empty h1 for ${url}: ${aiSuggestion}`);

                  if (!updatedAuditData.auditResult[checkType].aiSuggestions) {
                    updatedAuditData.auditResult[checkType].aiSuggestions = [];
                  }

                  updatedAuditData.auditResult[checkType].aiSuggestions.push({
                    url,
                    aiSuggestion,
                  });
                } catch (error) {
                  log.error(`[Headings AI Suggestions] Error processing ${url}: ${error.message}`);
                }
              } else {
                log.info(`[Headings AI Suggestions] Scrape JSON path: ${scrapeJsonPath} not found in allKeys`);
              }
            })(),
          );
        }
      }
    }
  }

  await Promise.all(tasks);
  // log.info(`[Headings AI Suggestions] Context: ${JSON.stringify(context)}`);
  // log.info(`[Headings AI Suggestions] Site: ${JSON.stringify(site)}`);
  // log.info('[Headings AI Suggestions] Ending AI suggestions generation');
  log.info(`[Headings AI Suggestions] completed Audit data: ${JSON.stringify(updatedAuditData)}`);
  return { ...updatedAuditData };
}

function generateRecommendedAction(checkType) {
  switch (checkType) {
    case HEADINGS_CHECKS.HEADING_ORDER_INVALID.check:
      return 'Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).';
    case HEADINGS_CHECKS.HEADING_EMPTY.check:
      return 'Provide meaningful text content for the empty heading or remove the element.';
    case HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check:
      return 'Ensure each heading has unique, descriptive text content that clearly identifies its section.';
    case HEADINGS_CHECKS.HEADING_NO_CONTENT.check:
      return 'Add meaningful content (paragraphs, lists, images, etc.) after the heading before the next heading.';
    default:
      return 'Review heading structure and content to follow heading best practices.';
  }
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  log.info(`[Headings Opportunity and Suggestions] Audit data: ${JSON.stringify(auditData)}`);
  if (!auditData.suggestions?.length) {
    log.info('Headings audit has no issues, skipping opportunity creation');
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );

  const buildKey = (suggestion) => `${suggestion.checkType}|${suggestion.url}`;

  await syncSuggestions({
    opportunity,
    newData: auditData.suggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: suggestion.type,
      rank: 0,
      data: {
        type: 'url',
        url: suggestion.url,
        checkType: suggestion.checkType,
        explanation: suggestion.explanation,
        recommendedAction: suggestion.recommendedAction,
      },
    }),
    log,
  });

  log.info(`Headings opportunity created and ${auditData.suggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(headingsAuditRunner)
  .withPostProcessors([generateSuggestions, generateAISuggestions, opportunityAndSuggestions])
  .build();
