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

import { getPrompt } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { load as cheerioLoad } from 'cheerio';

import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData, createOpportunityDataForTOC } from './opportunity-data-mapper.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../utils/s3-utils.js';
import SeoChecks from '../metatags/seo-checks.js';
import {
  getHeadingLevel,
  getTextContent,
  getHeadingContext,
  getScrapeJsonPath,
  extractTocData,
  tocArrayToHast,
  determineTocPlacement,
} from './utils.js';

const auditType = Audit.AUDIT_TYPES.HEADINGS;

const tocAuditType = Audit.AUDIT_TYPES.TOC;

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

export const TOC_CHECK = {
  check: 'toc',
  title: 'Table of Contents',
  description: 'Table of Contents is not present on the page',
  explanation: 'Table of Contents should be present on the page',
  suggestion: 'Add a Table of Contents to the page',
};

<<<<<<< HEAD
function getHeadingLevel(tagName) {
  return Number(tagName.charAt(1));
}

/**
 * Safely extract text content from an element
 * @param {Element} element - The DOM element
 * @param {CheerioAPI} $ - The cheerio instance
 * @returns {string} - The trimmed text content, or empty string if null/undefined
 */
export function getTextContent(element, $) {
  if (!element || !$) return '';
  return $(element).text().trim();
}

/**
 * Get surrounding text content before and after a heading
 * @param {Element} heading - The heading element
 * @param {number} charLimit - Maximum characters to extract in each direction
 * @returns {Object} Object with before and after text
 */
function getSurroundingText(heading, charLimit = 150) {
  // Text AFTER the heading
  let afterText = '';
  let nextSibling = heading.nextElementSibling;

  while (nextSibling && afterText.length < charLimit) {
    const text = getTextContent(nextSibling);
    if (text) {
      afterText += `${text} `;
      if (afterText.length >= charLimit) break;
    }
    nextSibling = nextSibling.nextElementSibling;
  }

  // Text BEFORE the heading
  let beforeText = '';
  let prevSibling = heading.previousElementSibling;

  while (prevSibling && beforeText.length < charLimit) {
    const text = getTextContent(prevSibling);
    if (text) {
      beforeText = `${text} ${beforeText}`;
      if (beforeText.length >= charLimit) break;
    }
    prevSibling = prevSibling.previousElementSibling;
  }

  return {
    before: beforeText.trim().slice(-charLimit), // Last N chars
    after: afterText.trim().slice(0, charLimit), // First N chars
  };
}

/**
 * Get information about the content structure that follows a heading
 * @param {Element} heading - The heading element
 * @returns {Object} Information about following content
 */
function getFollowingStructure(heading) {
  const nextElement = heading.nextElementSibling;

  if (!nextElement) {
    return {
      isEmpty: true,
      firstElement: null,
      firstText: '',
    };
  }

  const tagName = nextElement.tagName.toLowerCase();

  return {
    isEmpty: false,
    firstElement: tagName,
    hasImages: nextElement.querySelectorAll('img').length > 0,
    hasLinks: nextElement.querySelectorAll('a').length > 0,
    isList: ['ul', 'ol'].includes(tagName),
    firstText: getTextContent(nextElement).slice(0, 100),
  };
}

/**
 * Find the nearest semantic parent element and preceding heading for context
 * @param {Element} heading - The heading element
 * @param {Array<Element>} allHeadings - Array of all heading elements on the page
 * @param {number} currentIndex - Index of the current heading in allHeadings array
 * @returns {Object} Parent section context with semantic tag info and preceding heading
 */
function getParentSectionContext(heading, allHeadings, currentIndex) {
  const semanticTags = ['article', 'section', 'aside', 'nav', 'main', 'header', 'footer'];
  const currentLevel = getHeadingLevel(heading.tagName);
  let current = heading.parentElement;
  let parentContext = null;
  let precedingHeading = null;

  // Find nearest semantic parent
  while (current && current.tagName.toLowerCase() !== 'body') {
    const tagName = current.tagName.toLowerCase();

    if (semanticTags.includes(tagName) && !parentContext) {
      parentContext = {
        parentTag: tagName,
        parentClasses: current.className
          ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
          : [],
        parentId: current.id || null,
      };
    }

    current = current.parentElement;
  }

  // Find preceding higher-level heading (walk backwards using provided array)
  for (let i = currentIndex - 1; i >= 0; i -= 1) {
    const prevHeading = allHeadings[i];
    const level = getHeadingLevel(prevHeading.tagName);

    if (level < currentLevel) {
      const text = getTextContent(prevHeading);
      if (text) {
        precedingHeading = {
          level: prevHeading.tagName.toLowerCase(),
          text: text.slice(0, 100), // Limit to 100 chars
        };
        break;
      }
    }
  }

  // Fallback if no semantic parent found
  if (!parentContext && heading.parentElement) {
    parentContext = {
      parentTag: heading.parentElement.tagName.toLowerCase(),
      parentClasses: heading.parentElement.className
        ? heading.parentElement.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
        : [],
      parentId: heading.parentElement.id || null,
    };
  }

  return {
    ...parentContext,
    precedingHeading,
  };
}

/**
 * Get comprehensive context for a heading element to enable better AI suggestions
 * Includes surrounding text, following structure, and parent section context
 * @param {Element} heading - The heading element
 * @param {Document} document - The JSDOM document
 * @param {Array<Element>} allHeadings - Array of all heading elements on the page
 * @param {number} currentIndex - Index of the current heading in allHeadings array
 * @returns {Object} Complete heading context
 */
function getHeadingContext(heading, document, allHeadings, currentIndex) {
  return {
    // Tier 1: Essential context
    surroundingText: getSurroundingText(heading, 150),
    followingStructure: getFollowingStructure(heading),

    // Tier 2: Valuable context
    parentSection: getParentSectionContext(heading, allHeadings, currentIndex),
  };
}

function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

=======
>>>>>>> 3ecf6874 (fix: test cases)
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
  // Works with cheerio elements only
  if (!heading || !heading.name) {
    return null;
  }

  const { name, attribs, parent } = heading;
  const tag = name.toLowerCase();
  let selectors = [tag];

  // 1. Check for ID (most specific - return immediately)
  const id = attribs?.id;
  if (id) {
    return `${tag}#${id}`;
  }

  // 2. Add classes if available
  const className = attribs?.class;
  if (className && typeof className === 'string') {
    const classes = className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      const classSelector = classes.slice(0, 2).join('.');
      selectors = [`${tag}.${classSelector}`];
    }
  }

  // 3. Add nth-of-type if multiple siblings of same tag exist
  if (parent && parent.children) {
    const siblingsOfSameTag = parent.children.filter(
      (child) => child.type === 'tag' && child.name === name,
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

  while (current && current.name && current.name.toLowerCase() !== 'html' && levels < 3) {
    let parentSelector = current.name.toLowerCase();

    // If parent has ID, use it and stop (ID is unique enough)
    const parentId = current.attribs?.id;
    if (parentId) {
      pathParts.unshift(`#${parentId}`);
      break;
    }

    // Add parent classes (limit to first 2 for readability)
    const parentClassName = current.attribs?.class;
    if (parentClassName && typeof parentClassName === 'string') {
      const classes = parentClassName.trim().split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        const classSelector = classes.slice(0, 2).join('.');
        parentSelector = `${parentSelector}.${classSelector}`;
      }
    }

    pathParts.unshift(parentSelector);
    current = current.parent;
    levels += 1;
  }

  // 5. Join with '>' (direct child combinator)
  return pathParts.join(' > ');
}

export async function getH1HeadingASuggestion(
  url,
  log,
  tagName,
  pageTags,
  context,
  brandGuidelines,
  headingContext = null,
) {
  const azureOpenAIClient = AzureOpenAIClient.createFrom(context);
  const promptData = {
    finalUrl: pageTags?.finalUrl || '',
    title: pageTags?.title || '',
    h1: pageTags?.h1 || '',
    description: pageTags?.description || '',
    lang: pageTags?.lang || 'en',
    brandGuidelines: brandGuidelines || '',
    max_char: H1_LENGTH_CHARS,
    tagName: tagName || 'h1',
    surroundingText: headingContext?.surroundingText || { before: '', after: '' },
    followingStructure: headingContext?.followingStructure || {},
    parentSection: headingContext?.parentSection || {},
  };

  const prompt = await getPrompt(
    promptData,
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
 * Detect if a Table of Contents (TOC) is present in the document using LLM analysis
 * @param {Document} document - The JSDOM document
 * @param {string} url - The page URL
 * @param {Object} pageTags - Page metadata (title, lang, etc.)
 * @param {Object} log - Logger instance
 * @param {Object} context - Audit context containing environment and clients
 * @returns {Promise<Object>} Object with tocPresent, TOCCSSSelector, confidence, reasoning
 */
async function getTocDetails(document, url, pageTags, log, context, scrapedAt) {
  try {
    // Extract first 3000 characters from body
    const bodyElement = document.querySelector('body');
    const bodyHTML = bodyElement.innerHTML || '';
    const bodyContent = bodyHTML.substring(0, 3000);

    // Prepare prompt data
    const azureOpenAIClient = AzureOpenAIClient.createFrom(context);
    const promptData = {
      finalUrl: url,
      title: pageTags?.title || '',
      lang: pageTags?.lang || 'en',
      bodyContent,
    };

    // Load and execute prompt
    const prompt = await getPrompt(
      promptData,
      'toc-detection',
      log,
    );

    const aiResponse = await azureOpenAIClient.fetchChatCompletion(prompt, {
      responseFormat: 'json_object',
    });

    const aiResponseContent = JSON.parse(aiResponse.choices[0].message.content);

    // Validate response structure
    if (typeof aiResponseContent.tocPresent !== 'boolean') {
      log.error(`[TOC Detection] Invalid response structure for ${url}. Expected tocPresent as boolean`);
      return {
        tocPresent: false,
        TOCCSSSelector: null,
        confidence: 1,
        reasoning: 'Invalid AI response structure',
      };
    }

    // Validate and normalize confidence score (should be 1-10)
    let confidenceScore = aiResponseContent.confidence || 5;
    if (typeof confidenceScore !== 'number' || confidenceScore < 1 || confidenceScore > 10) {
      log.warn(`[TOC Detection] Invalid confidence score ${confidenceScore} for ${url}, defaulting to 5`);
      confidenceScore = 5;
    }

    log.debug(`[TOC Detection] TOC ${aiResponseContent.tocPresent ? 'found' : 'not found'} for ${url}. Selector: ${aiResponseContent.TOCCSSSelector || 'N/A'}, Confidence: ${confidenceScore}/10`);

    const result = {
      tocPresent: aiResponseContent.tocPresent,
      TOCCSSSelector: aiResponseContent.TOCCSSSelector || null,
      confidence: confidenceScore,
      reasoning: aiResponseContent.reasoning || '',
    };

    // If TOC is not present, determine where it should be placed
    if (!aiResponseContent.tocPresent) {
      const placement = determineTocPlacement(document, getHeadingSelector);
      // const tocHtml = generateTocHtml(document);
      const headingsData = extractTocData(document, getHeadingSelector);

      result.suggestedPlacement = placement;
      result.transformRules = {
        action: placement.action,
        selector: placement.selector,
        value: headingsData,
        valueFormat: 'html',
        scrapedAt: new Date(scrapedAt).toISOString(),
      };
      log.debug(`[TOC Detection] Suggested TOC placement for ${url}: ${placement.reasoning}`);
    }

    return result;
  } catch (error) {
    log.error(`[TOC Detection] Error detecting TOC for ${url}: ${error.message}`);
    return {
      tocPresent: false,
      TOCCSSSelector: null,
      confidence: 1,
      reasoning: `Error during detection: ${error.message}`,
    };
  }
}

/**
 * Validate heading semantics for a single page from a scrapeJsonObject.
 * - Ensure heading level increases by at most 1 when going deeper (no jumps, e.g., h1 → h3)
 * - Ensure headings are not empty
 *
 * @param {string} url - The URL being validated
 * @param {Object} scrapeJsonObject - The scraped page data from S3
 * @param {Object} log - Logger instance
 * @param {Object} seoChecks - SeoChecks instance for tracking healthy tags
 * @param {Object} context - Audit context
 * @returns {Promise<{url: string, checks: Array, tocDetails: Object}>}
 */
export async function validatePageHeadingFromScrapeJson(
  url,
  scrapeJsonObject,
  log,
  seoChecks,
  context,
) {
  try {
    let $;
    if (!scrapeJsonObject) {
      log.error(`Scrape JSON object not found for ${url}, skipping headings audit`);
      return null;
    } else {
      $ = cheerioLoad(scrapeJsonObject.scrapeResult.rawBody);
    }

    const pageTags = {
      h1: scrapeJsonObject.scrapeResult.tags.h1 || [],
      title: scrapeJsonObject.scrapeResult.tags.title,
      description: scrapeJsonObject.scrapeResult.tags.description,
      lang: scrapeJsonObject.scrapeResult.tags.lang,
      finalUrl: scrapeJsonObject.finalUrl,
    };
    seoChecks.performChecks(url, pageTags);

    const headings = $('h1, h2, h3, h4, h5, h6').toArray();

    const checks = [];

    const h1Elements = headings.filter((h) => $(h).prop('tagName') === 'H1');

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
          selector: $('body > main').length > 0 ? 'body > main > :first-child' : 'body > :first-child',
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
    } else if (getTextContent(h1Elements[0], $).length === 0
      || getTextContent(h1Elements[0], $).length > H1_LENGTH_CHARS) {
      const h1Selector = getHeadingSelector(h1Elements[0]);
      const h1Length = $(h1Elements[0]).text().length;
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
          currValue: $(h1Elements[0]).text(),
          scrapedAt: new Date(scrapeJsonObject.scrapedAt).toISOString(),
        },
        pageTags,
      });
    }

<<<<<<< HEAD
    const headingChecks = headings.map(async (heading) => {
      const tagName = $(heading).prop('tagName');
      if (tagName !== 'H1') {
        const text = getTextContent(heading, $);
=======
    const headingChecks = headings.map(async (heading, index) => {
      if (heading.tagName !== 'H1') {
        const text = getTextContent(heading);
>>>>>>> d8ab8b8c (fix: adding empty headings)
        if (text.length === 0) {
          log.info(`Empty heading detected (${tagName}) at ${url}`);
          const headingSelector = getHeadingSelector(heading);
          const headingContext = getHeadingContext(heading, document, headings, index);
          return {
            check: HEADINGS_CHECKS.HEADING_EMPTY.check,
            checkTitle: HEADINGS_CHECKS.HEADING_EMPTY.title,
            description: HEADINGS_CHECKS.HEADING_EMPTY.description.replace('{tagName}', tagName),
            success: false,
            explanation: `Found empty text for ${tagName}: ${HEADINGS_CHECKS.HEADING_EMPTY.explanation}`,
            suggestion: HEADINGS_CHECKS.HEADING_EMPTY.suggestion,
            transformRules: {
              action: 'replace',
              selector: headingSelector,
              currValue: text,
              scrapedAt: new Date(scrapeJsonObject.scrapedAt).toISOString(),
            },
            tagName,
            pageTags,
            headingContext,
          };
        }
      }
      return null;
    });

    const headingChecksResults = await Promise.all(headingChecks);
    // Filter out nulls and add to checks array
    checks.push(...headingChecksResults.filter(Boolean));

    if (headings.length > 1) {
      for (let i = 1; i < headings.length; i += 1) {
        const prev = headings[i - 1];
        const cur = headings[i];
        const prevLevel = getHeadingLevel(prev.tagName);
        const curLevel = getHeadingLevel(cur.tagName);
        if (curLevel - prevLevel > 1) {
          log.debug(`Heading level jump detected at ${url}: h${prevLevel} → h${curLevel}`);
          const curSelector = getHeadingSelector(cur);
          // Create a separate check for each invalid jump
          checks.push({
            check: HEADINGS_CHECKS.HEADING_ORDER_INVALID.check,
            checkTitle: HEADINGS_CHECKS.HEADING_ORDER_INVALID.title,
            description: HEADINGS_CHECKS.HEADING_ORDER_INVALID.description,
            success: false,
            explanation: `${HEADINGS_CHECKS.HEADING_ORDER_INVALID.explanation} Invalid jump: h${prevLevel} → h${curLevel}`,
            suggestion: HEADINGS_CHECKS.HEADING_ORDER_INVALID.suggestion,
            transformRules: {
              action: 'replaceWith',
              selector: curSelector,
              currValue: getTextContent(cur),
              scrapedAt: new Date(scrapeJsonObject.scrapedAt).toISOString(),
              valueFormat: 'hast',
              value: {
                type: 'root',
                children: [
                  {
                    type: 'element',
                    tagName: `h${prevLevel + 1}`,
                    properties: {},
                    children: [{ type: 'text', value: getTextContent(cur) }],
                  },
                ],
              },
            },
          });
        }
      }
    }

    const tocDetails = await getTocDetails(
      document,
      url,
      pageTags,
      log,
      context,
      scrapeJsonObject.scrapedAt,
    );

    return { url, checks, tocDetails };
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
      return validatePageHeadingFromScrapeJson(url, scrapeJsonObject, log, seoChecks, context);
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
    const aggregatedResults = {
      headings: {},
      toc: {},
    };
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
        const { url, checks, tocDetails } = result.value;
        const aggregatedResultsHeadings = aggregatedResults.headings;
        const aggregatedResultsToc = aggregatedResults.toc;
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
                  check.tagName,
                  check.pageTags,
                  context,
                  brandGuidelines,
                  check.headingContext || null,
                );
              } catch (error) {
                log.error(`[Headings AI Suggestions] Error generating AI suggestion for ${url}: ${error.message}`);
                aiSuggestion = null;
              }
            }
            if (!aggregatedResultsHeadings[checkType]) {
              aggregatedResultsHeadings[checkType] = {
                success: false,
                explanation: check.explanation,
                suggestion: check.suggestion,
                urls: [],
              };
            }

            // Add URL if not already present
            if (!aggregatedResultsHeadings[checkType].urls.includes(url)) {
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
              aggregatedResultsHeadings[checkType].urls.push(urlObject);
            }
          }
        });
        await Promise.all(checkPromises);
        // Handle TOC detection - only add to results if TOC is missing
        if (tocDetails && !tocDetails.tocPresent && tocDetails.transformRules) {
          if (!aggregatedResultsToc[TOC_CHECK.check]) {
            totalIssuesFound += 1;
            aggregatedResultsToc[TOC_CHECK.check] = {
              success: false,
              explanation: TOC_CHECK.explanation,
              suggestion: TOC_CHECK.suggestion,
              urls: [],
            };
          }
          if (!aggregatedResultsToc[TOC_CHECK.check].urls.find((urlObj) => urlObj.url === url)) {
            aggregatedResultsToc[TOC_CHECK.check].urls.push({
              url,
              explanation: `${TOC_CHECK.explanation} (Confidence: ${tocDetails.confidence}/10)`,
              suggestion: TOC_CHECK.suggestion,
              isAISuggested: true,
              checkTitle: TOC_CHECK.title,
              tagName: 'nav',
              transformRules: tocDetails.transformRules,
              tocConfidence: tocDetails.confidence,
              tocReasoning: tocDetails.reasoning,
            });
          }
        }
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
  Object.entries(auditData.auditResult.headings).forEach(([checkType, checkResult]) => {
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
  const allTocSuggestions = [];
  Object.entries(auditData.auditResult.toc).forEach(([checkType, checkResult]) => {
    if (checkResult.success === false && Array.isArray(checkResult.urls)) {
      checkResult.urls.forEach((urlObj) => {
        const suggestion = {
          type: 'CODE_CHANGE',
          checkType,
          url: urlObj.url,
          explanation: urlObj.explanation ?? checkResult.explanation,
          recommendedAction: urlObj.suggestion ?? generateRecommendedAction(checkType),
          checkTitle: urlObj.checkTitle,
          isAISuggested: urlObj.isAISuggested,
          ...(urlObj.transformRules && { transformRules: urlObj.transformRules }),
        };
        allTocSuggestions.push(suggestion);
      });
    }
  });

  const suggestions = {
    headings: {},
    toc: {},
  };
  suggestions.headings = [...allSuggestions];
  suggestions.toc = [...allTocSuggestions];

  log.debug(`Generated ${suggestions.headings.length} headings suggestions and ${suggestions.toc.length} TOC suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  if (!auditData.suggestions?.headings?.length) {
    log.info('Headings audit has no headings issues, skipping opportunity creation');
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    { ...auditData, suggestions: auditData.suggestions.headings },
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
    newData: auditData.suggestions.headings,
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

  log.info(`Headings opportunity created for Site Optimizer and ${auditData.suggestions.headings.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export async function opportunityAndSuggestionsForToc(auditUrl, auditData, context) {
  const { log } = context;
  if (!auditData.suggestions?.toc?.length) {
    log.info('Headings audit has no toc issues, skipping opportunity creation');
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    { ...auditData, suggestions: auditData.suggestions.toc },
    context,
    createOpportunityDataForTOC,
    tocAuditType,
  );

  const buildKey = (suggestion) => `${suggestion.checkType}|${suggestion.url}`;

  await syncSuggestions({
    opportunity,
    newData: auditData.suggestions.toc,
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
          transformRules: {
            ...suggestion.transformRules,
            value: tocArrayToHast(suggestion.transformRules.value),
            valueFormat: 'hast',
          },
        }),
      },
    }),
  });

  log.info(`TOC opportunity created for Site Optimizer and ${auditData.suggestions.toc.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(headingsAuditRunner)
  .withPostProcessors([
    generateSuggestions,
    opportunityAndSuggestions,
    opportunityAndSuggestionsForToc,
  ])
  .build();
