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
import { getPrompt } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions, keepLatestMergeDataFunction } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData, createOpportunityDataForElmo } from './opportunity-data-mapper.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../utils/s3-utils.js';
import SeoChecks from '../metatags/seo-checks.js';

const auditType = Audit.AUDIT_TYPES.HEADINGS;

const H1_LENGTH_CHARS = 70;

export const HEADINGS_CHECKS = Object.freeze({
  HEADING_EMPTY: {
    check: 'heading-empty',
    title: 'Empty Heading',
    explanation: 'Heading elements (H2–H6) should not be empty.',
    suggestion: 'Add descriptive text or remove the empty heading.',
  },
  HEADING_MISSING_H1: {
    check: 'heading-missing-h1',
    title: 'Missing H1 Heading',
    explanation: 'Pages should have exactly one H1 element for SEO and accessibility.',
    suggestion: 'Add an H1 element describing the main content.',
  },
  HEADING_H1_LENGTH: {
    check: 'heading-h1-length',
    title: 'H1 Length',
    explanation: `H1 elements should be less than ${H1_LENGTH_CHARS} characters.`,
    suggestion: `Update the H1 to be less than ${H1_LENGTH_CHARS} characters`,
  },
  HEADING_MULTIPLE_H1: {
    check: 'heading-multiple-h1',
    title: 'Multiple H1 Headings',
    explanation: 'Pages should have only one H1 element.',
    suggestion: 'Change additional H1 elements to H2 or appropriate levels.',
  },
  HEADING_DUPLICATE_TEXT: {
    check: 'heading-duplicate-text',
    title: 'Duplicate Heading Text',
    explanation: 'Headings should have unique text content (WCAG 2.2 2.4.6).',
    suggestion: 'Ensure each heading has unique, descriptive text.',
  },
  HEADING_ORDER_INVALID: {
    check: 'heading-order-invalid',
    title: 'Invalid Heading Order',
    explanation: 'Heading levels should increase by one (H1→H2), not jump levels (H1→H3).',
    suggestion: 'Adjust heading levels to maintain proper hierarchy.',
  },
  HEADING_NO_CONTENT: {
    check: 'heading-no-content',
    title: 'Heading Without Content',
    explanation: 'Headings should be followed by content before the next heading.',
    suggestion: 'Add meaningful content after each heading.',
  },
  TOPPAGES: {
    check: 'top-pages',
    title: 'Top Pages',
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

function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

export async function getH1HeadingASuggestion(url, log, pageTags, context, brandGuidelines) {
  const azureOpenAIClient = AzureOpenAIClient.createFrom(context);
  const prompt = await getPrompt(
    {
      finalUrl: pageTags?.finalUrl || '',
      title: pageTags?.title || '',
      h1: pageTags?.h1 || '',
      description: pageTags?.description || '',
      lang: pageTags?.lang || 'en',
      brandGuidelines: brandGuidelines || '',
      max_char: H1_LENGTH_CHARS,
    },
    'heading-empty-suggestion',
    log,
  );
  try {
    const aiResponse = await azureOpenAIClient.fetchChatCompletion(prompt, {
      responseFormat: 'json_object',
    });
    const aiResponseContent = JSON.parse(aiResponse.choices[0].message.content);
    if (!aiResponseContent.h1 || !aiResponseContent.h1.aiSuggestion) {
      log.error(`[Headings AI Suggestions] Invalid response structure for ${url}. Expected h1.aiSuggestion`);
      return null;
    }
    const { aiSuggestion } = aiResponseContent.h1;
    log.info(`[Headings AI Suggestions] AI suggestion for empty heading for ${url}: ${aiSuggestion}`);
    return aiSuggestion;
  } catch (error) {
    log.error(`[Headings AI Suggestions] Error for empty heading suggestion: ${error}`);
    return null;
  }
}

async function getBrandGuidelines(healthyTagsObject, log, context) {
  const azureOpenAIClient = AzureOpenAIClient.createFrom(context);
  const prompt = await getPrompt(
    {
      titles: healthyTagsObject.title,
      descriptions: healthyTagsObject.description,
      h1s: healthyTagsObject.h1,
    },
    'generate-brand-guidelines',
    log,
  );
  const aiResponse = await azureOpenAIClient.fetchChatCompletion(prompt, {
    responseFormat: 'json_object',
  });
  const aiResponseContent = JSON.parse(aiResponse.choices[0].message.content);
  return aiResponseContent;
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
export async function validatePageHeadings(
  url,
  log,
  site,
  allKeys,
  s3Client,
  S3_SCRAPER_BUCKET_NAME,
  context,
  seoChecks,
) {
  if (!url) {
    log.error('URL is undefined or null, cannot validate headings');
    return {
      url,
      checks: [],
    };
  }

  try {
    const scrapeJsonPath = getScrapeJsonPath(url, site.getId());
    const s3Key = allKeys.find((key) => key.includes(scrapeJsonPath));
    let document = null;
    let scrapeJsonObject = null;
    if (!s3Key) {
      log.error(`Scrape JSON path not found for ${url}, skipping headings audit`);
      return null;
    } else {
      scrapeJsonObject = await getObjectFromKey(s3Client, S3_SCRAPER_BUCKET_NAME, s3Key, log);
      if (!scrapeJsonObject) {
        log.error(`Scrape JSON object not found for ${url}, skipping headings audit`);
        return null;
      } else {
        document = new JSDOM(scrapeJsonObject.scrapeResult.rawBody).window.document;
      }
    }

    const pageTags = {
      h1: scrapeJsonObject.scrapeResult.tags.h1 || [],
      title: scrapeJsonObject.scrapeResult.tags.title,
      description: scrapeJsonObject.scrapeResult.tags.description,
      lang: scrapeJsonObject.scrapeResult.tags.lang,
      finalUrl: scrapeJsonObject.finalUrl,
    };
    seoChecks.performChecks(url, pageTags);

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));

    const checks = [];

    const h1Elements = headings.filter((h) => h.tagName === 'H1');

    if (h1Elements.length === 0
      || (h1Elements.length === 1 && getTextContent(h1Elements[0]).length === 0)) {
      log.info(`Missing h1 element detected at ${url}`);
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MISSING_H1.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_MISSING_H1.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_MISSING_H1.suggestion,
        pageTags,
      });
    } else if (h1Elements.length > 1) {
      log.info(`Multiple h1 elements detected at ${url}: ${h1Elements.length} found`);
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.suggestion,
        count: h1Elements.length,
      });
    } else if (h1Elements[0].textContent.length > H1_LENGTH_CHARS) {
      log.info(`H1 length too long detected at ${url}: ${h1Elements[0].textContent.length} characters`);
      checks.push({
        check: HEADINGS_CHECKS.HEADING_H1_LENGTH.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_H1_LENGTH.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_H1_LENGTH.suggestion,
        pageTags,
      });
    }

    // Check for empty headings and collect text content for duplicate detection
    const headingTexts = new Map();
    const headingChecks = headings.map(async (heading) => {
      if (heading.tagName !== 'H1') {
        const text = getTextContent(heading);
        if (text.length === 0) {
          log.info(`Empty heading detected (${heading.tagName}) at ${url}`);
          return {
            check: HEADINGS_CHECKS.HEADING_EMPTY.check,
            success: false,
            explanation: HEADINGS_CHECKS.HEADING_EMPTY.explanation,
            suggestion: HEADINGS_CHECKS.HEADING_EMPTY.suggestion,
            tagName: heading.tagName,
            pageTags,
          };
        } else {
          // For tracking purposes
          const lowerText = text.toLowerCase();
          if (!headingTexts.has(lowerText)) {
            headingTexts.set(lowerText, []);
          }
          headingTexts.get(lowerText).push({
            text,
            tagName: heading.tagName,
            element: heading,
          });
          return null;
        }
      } else {
        return null;
      }
    });

    const headingChecksResults = await Promise.all(headingChecks);
    // Filter out nulls and add to checks array
    checks.push(...headingChecksResults.filter(Boolean));

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
  const { log, dataAccess, s3Client } = context;
  const { S3_SCRAPER_BUCKET_NAME } = context.env;

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
    const prefix = `scrapes/${site.getId()}/`;
    const allKeys = await getObjectKeysUsingPrefix(s3Client, S3_SCRAPER_BUCKET_NAME, prefix, log);
    const seoChecks = new SeoChecks(log);

    // Validate headings for each page
    const auditPromises = topPages.map(async (page) => validatePageHeadings(
      page.url,
      log,
      site,
      allKeys,
      s3Client,
      S3_SCRAPER_BUCKET_NAME,
      context,
      seoChecks,
    ));
    const auditResults = await Promise.allSettled(auditPromises);

    // Aggregate results by check type
    const aggregatedResults = {};
    let totalIssuesFound = 0;

    const healthyTags = seoChecks.getFewHealthyTags();

    // iterate over healthy tags and create object  titles , descriptions and h1s comma separated
    const healthyTagsObject = {
      title: healthyTags.title.join(', '),
      description: healthyTags.description.join(', '),
      h1: healthyTags.h1.join(', '),
    };
    log.info(`[Headings AI Suggestions] Healthy tags object: ${JSON.stringify(healthyTagsObject)}`);

    const brandGuidelines = await getBrandGuidelines(healthyTagsObject, log, context);
    const auditResultsPromises = auditResults.map(async (result) => {
      if (result.status === 'fulfilled' && result.value) {
        const { url, checks } = result.value;
        const checkPromises = checks.map(async (check) => {
          if (!check.success) {
            totalIssuesFound += 1;
            const checkType = check.check;
            let aiSuggestion = null;
            // if checktype is missing h1, h1 length or empty heading generate ai suggestion here
            if (checkType === HEADINGS_CHECKS.HEADING_MISSING_H1.check
              || checkType === HEADINGS_CHECKS.HEADING_H1_LENGTH.check
              || checkType === HEADINGS_CHECKS.HEADING_EMPTY.check) {
              try {
                aiSuggestion = await getH1HeadingASuggestion(
                  url,
                  log,
                  check.pageTags,
                  context,
                  brandGuidelines,
                );
              } catch (error) {
                log.error(`[Headings AI Suggestions] Error generating AI suggestion for ${url}: ${error.message}`);
                aiSuggestion = null;
              }
            }
            if (!aggregatedResults[checkType]) {
              aggregatedResults[checkType] = {
                success: false,
                explanation: check.explanation,
                suggestion: check.suggestion,
                urls: [],
              };
            }

            // Add URL if not already present
            if (!aggregatedResults[checkType].urls.includes(url)) {
              const urlObject = { url };
              if (check.suggestion) {
                urlObject.suggestion = aiSuggestion || check.suggestion;
              }
              if (check.tagName) {
                urlObject.tagName = check.tagName;
              }
              aggregatedResults[checkType].urls.push(urlObject);
            }
          }
        });
        await Promise.all(checkPromises);
      }
    });

    // wait for all promises to resolve
    await Promise.all(auditResultsPromises);

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

  // Get the order from HEADINGS_CHECKS object
  const auditTypeOrder = [
    ...Object.keys(HEADINGS_CHECKS),
  ];

  // Group suggestions by audit type
  const suggestionsByType = {};
  const allSuggestions = [];

  // Process all audit results and group by type
  Object.entries(auditData.auditResult).forEach(([checkType, checkResult]) => {
    if (checkResult.success === false && Array.isArray(checkResult.urls)) {
      if (!suggestionsByType[checkType]) {
        suggestionsByType[checkType] = [];
      }
      checkResult.urls.forEach((urlObj) => {
        const suggestion = {
          type: 'CODE_CHANGE',
          checkType,
          explanation: checkResult.explanation,
          url: urlObj.url,
          // eslint-disable-next-line no-use-before-define
          recommendedAction: generateRecommendedAction(checkType),
        };
        if (urlObj.tagName) {
          suggestion.tagName = urlObj.tagName;
        }
        if (urlObj.suggestion) {
          suggestion.recommendedAction = urlObj.suggestion;
        }
        suggestionsByType[checkType].push(suggestion);
        allSuggestions.push(suggestion);
      });
    }
  });

  let mdTable = '';
  auditTypeOrder.forEach((currentAuditType) => {
    const checkType = HEADINGS_CHECKS[currentAuditType].check;
    if (suggestionsByType[checkType] && suggestionsByType[checkType].length > 0) {
      mdTable += `## ${HEADINGS_CHECKS[currentAuditType].title}\n\n`;
      mdTable += '| Page Url | Explanation | Suggestion |\n';
      mdTable += '|-------|-------|-------|\n';
      suggestionsByType[checkType].forEach((suggestion) => {
        let suggestionExplanation = suggestion.explanation;
        if (suggestion.tagName) {
          suggestionExplanation += `for tag name: ${suggestion.tagName.toUpperCase()}`;
        }
        mdTable += `| ${suggestion.url} | ${suggestionExplanation} | ${suggestion.recommendedAction} |\n`;
      });
      mdTable += '\n';
    }
  });

  const elmoSuggestions = [];
  elmoSuggestions.push({
    type: 'CODE_CHANGE',
    recommendedAction: mdTable,
  });

  const suggestions = [...allSuggestions];

  log.info(`Generated ${suggestions.length} headings suggestions for ${auditUrl}`);
  return { ...auditData, suggestions, elmoSuggestions };
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

  log.info(`Headings opportunity created for Site Optimizer and ${auditData.suggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export async function opportunityAndSuggestionsForElmo(auditUrl, auditData, context) {
  const { log } = context;
  if (!auditData.elmoSuggestions?.length) {
    log.info('Headings audit has no issues, skipping opportunity creation');
    return { ...auditData };
  }
  const elmoOpportunityType = 'generic-opportunity';
  const comparisonFn = (oppty) => {
    const opptyData = oppty.getData();
    const opptyAdditionalMetrics = opptyData?.additionalMetrics;
    if (!opptyAdditionalMetrics || !Array.isArray(opptyAdditionalMetrics)) {
      return false;
    }
    const hasHeadingsSubtype = opptyAdditionalMetrics.some(
      (metric) => metric.key === 'subtype' && metric.value === 'headings',
    );
    return hasHeadingsSubtype;
  };

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityDataForElmo,
    elmoOpportunityType,
    {},
    comparisonFn,
  );

  log.info(`Headings opportunity created for Elmo with oppty id ${opportunity.getId()}`);

  const buildKey = (suggestion) => `${suggestion.type}`;
  await syncSuggestions({
    opportunity,
    newData: auditData.elmoSuggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: suggestion.type,
      rank: 0,
      data: {
        suggestionValue: suggestion.recommendedAction,
      },
    }),
    keepLatestMergeDataFunction,
    log,
  });

  log.info(`Headings opportunity created for Elmo and ${auditData.elmoSuggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(headingsAuditRunner)
  .withPostProcessors([
    generateSuggestions,
    opportunityAndSuggestions,
    opportunityAndSuggestionsForElmo,
  ])
  .build();
