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
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../utils/s3-utils.js';
import SeoChecks from '../metatags/seo-checks.js';

const auditType = Audit.AUDIT_TYPES.HEADINGS;

const H1_LENGTH_CHARS = 70;

export const HEADINGS_CHECKS = Object.freeze({
  HEADING_EMPTY: {
    check: 'heading-empty',
    title: 'Empty Heading',
    description: '{tagName} heading is empty.',
    explanation: 'Heading elements (H2–H6) should not be empty.',
    suggestion: 'Add descriptive text or remove the empty heading.',
  },
  HEADING_MISSING_H1: {
    check: 'heading-missing-h1',
    title: 'Missing H1 Heading',
    description: 'Page does not have an H1 element',
    explanation: 'Pages should have exactly one H1 element for SEO and accessibility.',
    suggestion: 'Add an H1 element describing the main content.',
  },
  HEADING_H1_LENGTH: {
    check: 'heading-h1-length',
    title: 'H1 Length',
    description: `H1 element is either empty or exceeds ${H1_LENGTH_CHARS} characters.`,
    explanation: `H1 elements should be less than ${H1_LENGTH_CHARS} characters.`,
    suggestion: `Update the H1 to be less than ${H1_LENGTH_CHARS} characters`,
  },
  HEADING_MULTIPLE_H1: {
    check: 'heading-multiple-h1',
    title: 'Multiple H1 Headings',
    description: 'Page has more than one H1 element.',
    explanation: 'Pages should have only one H1 element.',
    suggestion: 'Change additional H1 elements to H2 or appropriate levels.',
  },
  HEADING_ORDER_INVALID: {
    check: 'heading-order-invalid',
    title: 'Invalid Heading Order',
    description: 'Heading hierarchy skips levels.',
    explanation: 'Heading levels should increase by one (example: H1→H2), not jump levels (example: H1→H3).',
    suggestion: 'Adjust heading levels to maintain proper hierarchy.',
  },
  TOPPAGES: {
    check: 'top-pages',
    title: 'Top Pages',
    description: 'No top pages available for audit',
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

function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

/**
 * Generate a unique CSS selector for a heading element.
 * Uses a progressive specificity strategy:
 * 1. Start with tag name
 * 2. Add ID if available (most specific - stop here)
 * 3. Add classes if available
 * 4. Add :nth-of-type() if multiple siblings exist
 * 5. Walk up parent tree (max 3 levels) for context
 *
 * @param {Element} heading - The heading element to generate selector for
 * @returns {string} A CSS selector string that uniquely identifies the element
 */
export function getHeadingSelector(heading) {
  if (!heading || !heading.tagName) {
    return null;
  }

  const tag = heading.tagName.toLowerCase();
  let selectors = [tag];

  // 1. Check for ID (most specific - return immediately)
  if (heading.id) {
    return `${tag}#${heading.id}`;
  }

  // 2. Add classes if available
  if (heading.className && typeof heading.className === 'string') {
    const classes = heading.className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      // Limit to first 2 classes for readability
      const classSelector = classes.slice(0, 2).join('.');
      selectors = [`${tag}.${classSelector}`];
    }
  }

  // 3. Add nth-of-type if multiple siblings of same tag exist
  const parent = heading.parentElement;
  if (parent) {
    // Get all sibling elements of the same tag type (direct children only)
    const siblingsOfSameTag = Array.from(parent.children).filter(
      (child) => child.tagName === heading.tagName,
    );

    if (siblingsOfSameTag.length > 1) {
      const index = siblingsOfSameTag.indexOf(heading) + 1;
      selectors.push(`:nth-of-type(${index})`);
    }
  }

  const selector = selectors.join('');

  // 4. Build path with parent selectors for more specificity (max 3 levels)
  const pathParts = [selector];
  let current = parent;
  let levels = 0;

  while (current && current.tagName && current.tagName.toLowerCase() !== 'html' && levels < 3) {
    let parentSelector = current.tagName.toLowerCase();

    // If parent has ID, use it and stop (ID is unique enough)
    if (current.id) {
      pathParts.unshift(`#${current.id}`);
      break;
    }

    // Add parent classes (limit to first 2 for readability)
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        const classSelector = classes.slice(0, 2).join('.');
        parentSelector = `${parentSelector}.${classSelector}`;
      }
    }

    pathParts.unshift(parentSelector);
    current = current.parentElement;
    levels += 1;
  }

  // 5. Join with '>' (direct child combinator)
  return pathParts.join(' > ');
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
    log.debug(`[Headings AI Suggestions] AI suggestion for empty heading for ${url}: ${aiSuggestion}`);
    return aiSuggestion;
  } catch (error) {
    log.error(`[Headings AI Suggestions] Error for empty heading suggestion: ${error}`);
    return null;
  }
}

export async function getBrandGuidelines(healthyTagsObject, log, context) {
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
 * Validate heading semantics for a single page from a scrapeJsonObject.
 * - Ensure heading level increases by at most 1 when going deeper (no jumps, e.g., h1 → h3)
 * - Ensure headings are not empty
 *
 * @param {string} url - The URL being validated
 * @param {Object} scrapeJsonObject - The scraped page data from S3
 * @param {Object} log - Logger instance
 * @param {Object} context - Audit context
 * @param {Object} seoChecks - SeoChecks instance for tracking healthy tags
 * @returns {Promise<{url: string, checks: Array}>}
 */
export async function validatePageHeadingFromScrapeJson(
  url,
  scrapeJsonObject,
  log,
  seoChecks,
) {
  try {
    let document = null;
    if (!scrapeJsonObject) {
      log.error(`Scrape JSON object not found for ${url}, skipping headings audit`);
      return null;
    } else {
      document = new JSDOM(scrapeJsonObject.scrapeResult.rawBody).window.document;
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

    if (h1Elements.length === 0) {
      log.debug(`Missing h1 element detected at ${url}`);
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MISSING_H1.check,
        checkTitle: HEADINGS_CHECKS.HEADING_MISSING_H1.title,
        description: HEADINGS_CHECKS.HEADING_MISSING_H1.description,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_MISSING_H1.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_MISSING_H1.suggestion,
        transformRules: {
          action: 'insertBefore',
          selector: document.querySelector('body > main') ? 'body > main > :first-child' : 'body > :first-child',
          tag: 'h1',
          scrapedAt: new Date(scrapeJsonObject.scrapedAt).toISOString(),
        },
        pageTags,
      });
    } else if (h1Elements.length > 1) {
      log.debug(`Multiple h1 elements detected at ${url}: ${h1Elements.length} found`);
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check,
        checkTitle: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.title,
        description: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.description,
        success: false,
        explanation: `Found ${h1Elements.length} h1 elements: ${HEADINGS_CHECKS.HEADING_MULTIPLE_H1.explanation}`,
        suggestion: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.suggestion,
        count: h1Elements.length,
      });
    } else if (getTextContent(h1Elements[0]).length === 0
      || getTextContent(h1Elements[0]).length > H1_LENGTH_CHARS) {
      const h1Selector = getHeadingSelector(h1Elements[0]);
      const h1Length = h1Elements[0].textContent.length;
      const lengthIssue = h1Length === 0 ? 'empty' : 'too long';
      log.info(`H1 length ${lengthIssue} detected at ${url}: ${h1Length} characters using selector: ${h1Selector}`);
      checks.push({
        check: HEADINGS_CHECKS.HEADING_H1_LENGTH.check,
        checkTitle: HEADINGS_CHECKS.HEADING_H1_LENGTH.title,
        description: HEADINGS_CHECKS.HEADING_H1_LENGTH.description,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_H1_LENGTH.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_H1_LENGTH.suggestion,
        transformRules: {
          action: 'replace',
          selector: h1Selector,
          currValue: h1Elements[0].textContent,
          scrapedAt: new Date(scrapeJsonObject.scrapedAt).toISOString(),
        },
        pageTags,
      });
    }

    const headingChecks = headings.map(async (heading) => {
      if (heading.tagName !== 'H1') {
        const text = getTextContent(heading);
        if (text.length === 0) {
          log.info(`Empty heading detected (${heading.tagName}) at ${url}`);
          const headingSelector = getHeadingSelector(heading);
          return {
            check: HEADINGS_CHECKS.HEADING_EMPTY.check,
            checkTitle: HEADINGS_CHECKS.HEADING_EMPTY.title,
            description: HEADINGS_CHECKS.HEADING_EMPTY.description.replace('{tagName}', heading.tagName),
            success: false,
            explanation: `Found empty text for ${heading.tagName}: ${HEADINGS_CHECKS.HEADING_EMPTY.explanation}`,
            suggestion: HEADINGS_CHECKS.HEADING_EMPTY.suggestion,
            transformRules: {
              action: 'replace',
              selector: headingSelector,
              currValue: text,
              scrapedAt: new Date(scrapeJsonObject.scrapedAt).toISOString(),
            },
            tagName: heading.tagName,
            pageTags,
          };
        }
      }
      return null;
    });

    const headingChecksResults = await Promise.all(headingChecks);
    // Filter out nulls and add to checks array
    checks.push(...headingChecksResults.filter(Boolean));

    if (headings.length > 1) {
      const invalidJumps = [];
      for (let i = 1; i < headings.length; i += 1) {
        const prev = headings[i - 1];
        const cur = headings[i];
        const prevLevel = getHeadingLevel(prev.tagName);
        const curLevel = getHeadingLevel(cur.tagName);
        if (curLevel - prevLevel > 1) {
          invalidJumps.push({ previous: `h${prevLevel}`, current: `h${curLevel}` });
          log.debug(`Heading level jump detected at ${url}: h${prevLevel} → h${curLevel}`);
        }
      }
      // Create a single check with all invalid jumps in the explanation
      if (invalidJumps.length > 0) {
        const jumpDetails = invalidJumps.map((jump) => `${jump.previous} → ${jump.current}`).join(', ');
        checks.push({
          check: HEADINGS_CHECKS.HEADING_ORDER_INVALID.check,
          checkTitle: HEADINGS_CHECKS.HEADING_ORDER_INVALID.title,
          description: HEADINGS_CHECKS.HEADING_ORDER_INVALID.description,
          success: false,
          explanation: `${HEADINGS_CHECKS.HEADING_ORDER_INVALID.explanation} Invalid jumps found: ${jumpDetails}`,
          suggestion: HEADINGS_CHECKS.HEADING_ORDER_INVALID.suggestion,
        });
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
    let scrapeJsonObject = null;
    if (!s3Key) {
      log.error(`Scrape JSON path not found for ${url}, skipping headings audit`);
      return null;
    } else {
      scrapeJsonObject = await getObjectFromKey(s3Client, S3_SCRAPER_BUCKET_NAME, s3Key, log);
      return validatePageHeadingFromScrapeJson(url, scrapeJsonObject, log, seoChecks);
    }
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
    log.debug(`[Headings Audit] Fetching top pages for site: ${siteId}`);
    const allTopPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
    const topPages = allTopPages.slice(0, 200);

    log.debug(`[Headings Audit] Processing ${topPages.length} top pages for headings audit (limited to 200)`);
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
              urlObject.explanation = check.explanation;
              urlObject.suggestion = aiSuggestion || check.suggestion;
              urlObject.isAISuggested = !!aiSuggestion;
              urlObject.checkTitle = check.checkTitle;
              if (check.tagName) {
                urlObject.tagName = check.tagName;
              }
              if (check.transformRules) {
                urlObject.transformRules = check.transformRules;
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

    log.debug(`Successfully completed Headings Audit for site: ${baseURL}. Found ${totalIssuesFound} issues across ${Object.keys(aggregatedResults).length} check types.`);

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

function generateRecommendedAction(checkType) {
  switch (checkType) {
    case HEADINGS_CHECKS.HEADING_ORDER_INVALID.check:
      return 'Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).';
    case HEADINGS_CHECKS.HEADING_EMPTY.check:
      return 'Provide meaningful text content for the empty heading or remove the element.';
    default:
      return 'Review heading structure and content to follow heading best practices.';
  }
}

export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  if (auditData.auditResult?.status === 'success'
      || auditData.auditResult?.error
      || auditData.auditResult?.check === HEADINGS_CHECKS.TOPPAGES.check) {
    log.info(`Headings audit for ${auditUrl} has no issues or failed, skipping suggestions generation`);
    return { ...auditData };
  }
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
          url: urlObj.url,
          explanation: urlObj.explanation ?? checkResult.explanation,
          recommendedAction: urlObj.suggestion ?? generateRecommendedAction(checkType),
          checkTitle: urlObj.checkTitle,
          isAISuggested: urlObj.isAISuggested,
          ...(urlObj.tagName && { tagName: urlObj.tagName }),
          ...(urlObj.transformRules && { transformRules: urlObj.transformRules }),
        };
        suggestionsByType[checkType].push(suggestion);
        allSuggestions.push(suggestion);
      });
    }
  });

  const suggestions = [...allSuggestions];

  log.debug(`Generated ${suggestions.length} headings suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
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

  const mergeDataFunction = (existingSuggestion, newSuggestion) => {
    const mergedSuggestion = {
      ...existingSuggestion,
      ...newSuggestion,
    };
    // Preserve recommendedAction from existingSuggestion if isEdited is true
    if (existingSuggestion.isEdited && existingSuggestion.recommendedAction !== undefined) {
      mergedSuggestion.recommendedAction = existingSuggestion.recommendedAction;
    }
    return mergedSuggestion;
  };

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
        checkTitle: suggestion.checkTitle,
        isAISuggested: suggestion.isAISuggested,
        ...(suggestion.transformRules && {
          transformRules: { ...suggestion.transformRules },
        }),
      },
    }),
    mergeDataFunction,
    log,
  });

  log.info(`Headings opportunity created for Site Optimizer and ${auditData.suggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(headingsAuditRunner)
  .withPostProcessors([
    generateSuggestions,
    opportunityAndSuggestions,
  ])
  .build();
