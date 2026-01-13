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

import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { getTopAgenticUrlsFromAthena } from '../utils/agentic-urls.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

import {
  getTextContent,
  getHeadingSelector,
  getHeadingLevel,
  getHeadingContext,
  cheerioLoad,
  loadScrapeJson,
  getBrandGuidelines,
  getTopPages,
  initializeAuditContext,
} from './shared-utils.js';

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

/**
 * Get AI suggestion for H1 heading
 * @param {string} url - Page URL
 * @param {Object} log - Logger instance
 * @param {string} tagName - Tag name (h1, h2, etc.)
 * @param {Object} pageTags - Page tags
 * @param {Object} context - Audit context
 * @param {Object} brandGuidelines - Brand guidelines
 * @param {Object} headingContext - Heading context
 * @returns {Promise<string|null>} AI suggestion or null
 */
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
  log.info(`[Headings AI Suggestions] Prompt: ${JSON.stringify(prompt)}`);
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

/**
 * Validate heading semantics for a single page from a scrapeJsonObject.
 * @param {string} url - The URL being validated
 * @param {Object} scrapeJsonObject - The scraped page data from S3
 * @param {Object} log - Logger instance
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
    if (!scrapeJsonObject) {
      log.error(`Scrape JSON object not found for ${url}, skipping headings audit`);
      return null;
    }
    const $ = cheerioLoad(scrapeJsonObject.scrapeResult.rawBody);

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
      // For multiple H1s, provide transformRules for the first extra H1 (second H1 element)
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

    const headingChecks = headings.map(async (heading, index) => {
      const tagName = $(heading).prop('tagName');
      if (tagName !== 'H1') {
        const text = getTextContent(heading, $);
        if (text.length === 0) {
          log.info(`Empty heading detected (${tagName}) at ${url}`);
          const headingSelector = getHeadingSelector(heading);
          const headingContext = getHeadingContext(heading, $, headings, index);
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
              currValue: getTextContent(cur, $),
              scrapedAt: new Date(scrapeJsonObject.scrapedAt).toISOString(),
              valueFormat: 'hast',
              value: {
                type: 'root',
                children: [
                  {
                    type: 'element',
                    tagName: `h${prevLevel + 1}`,
                    properties: {},
                    children: [{ type: 'text', value: getTextContent(cur, $) }],
                  },
                ],
              },
            },
          });
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
 * Validate heading semantics for a single page.
 * @param {string} url - Page URL
 * @param {Object} log - Logger instance
 * @param {Object} site - Site object
 * @param {Array} allKeys - S3 keys
 * @param {Object} s3Client - S3 client
 * @param {string} S3_SCRAPER_BUCKET_NAME - S3 bucket name
 * @param {Object} seoChecks - SeoChecks instance
 * @returns {Promise<{url: string, checks: Array}>}
 */
export async function validatePageHeadings(
  url,
  log,
  site,
  allKeys,
  s3Client,
  S3_SCRAPER_BUCKET_NAME,
  seoChecks,
) {
  if (!url) {
    log.error('URL is undefined or null, cannot validate headings');
    return {
      url,
      checks: [],
    };
  }

  // Validate URL format
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch (urlError) {
    log.error(`Invalid URL format: ${url}`);
    return {
      url,
      checks: [],
    };
  }

  const scrapeJsonObject = await loadScrapeJson(
    url,
    site,
    allKeys,
    s3Client,
    S3_SCRAPER_BUCKET_NAME,
    log,
  );
  if (!scrapeJsonObject) {
    return null;
  }
  return validatePageHeadingFromScrapeJson(url, scrapeJsonObject, log, seoChecks);
}

/**
 * Main headings audit runner
 * @param {string} baseURL - Base URL
 * @param {Object} context - Audit context
 * @param {Object} site - Site object
 * @returns {Promise<Object>}
 */
export async function headingsAuditRunner(baseURL, context, site) {
  const siteId = site.getId();
  const { log, dataAccess, s3Client } = context;
  const { S3_SCRAPER_BUCKET_NAME } = context.env;

  try {
    // Get top 200 pages - try Athena first, fall back to Ahrefs
    log.debug(`[Headings Audit] Fetching top pages for site: ${siteId}`);

    let topPages = [];

    // Try to get top agentic URLs from Athena first
    const athenaUrls = await getTopAgenticUrlsFromAthena(site, context);
    if (athenaUrls && athenaUrls.length > 0) {
      topPages = athenaUrls.slice(0, 200).map((url) => ({ url }));
    } else {
      // Fallback to Ahrefs if Athena returns no data
      log.info('[Headings Audit] No agentic URLs from Athena, falling back to Ahrefs');
      topPages = await getTopPages(dataAccess, siteId, context, log, 200);
    }

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

    const { allKeys, seoChecks } = await initializeAuditContext(context, site);

    // Validate headings for each page
    const auditPromises = topPages.map(async (page) => validatePageHeadings(
      page.url,
      log,
      site,
      allKeys,
      s3Client,
      S3_SCRAPER_BUCKET_NAME,
      seoChecks,
    ));
    const auditResults = await Promise.allSettled(auditPromises);

    // Aggregate results by check type
    const aggregatedResults = {};
    let totalIssuesFound = 0;

    const healthyTags = seoChecks.getFewHealthyTags();

    // iterate over healthy tags and create object titles, descriptions and h1s comma separated
    const healthyTagsObject = {
      title: healthyTags.title.join(', '),
      description: healthyTags.description.join(', '),
      h1: healthyTags.h1.join(', '),
    };
    log.info(`[Headings AI Suggestions] Healthy tags object: ${JSON.stringify(healthyTagsObject)}`);

    const brandGuidelines = await getBrandGuidelines(healthyTagsObject, log, context, site);
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
              aiSuggestion = await getH1HeadingASuggestion(
                url,
                log,
                check.tagName,
                check.pageTags,
                context,
                brandGuidelines,
                check.headingContext || null,
              );
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
      auditResult: {
        headings: aggregatedResults,
      },
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
  const allSuggestions = [];

  // Process all audit results from the headings key
  const headingsResults = auditData.auditResult.headings || auditData.auditResult;
  Object.entries(headingsResults).forEach(([checkType, checkResult]) => {
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
          ...(urlObj.tagName && { tagName: urlObj.tagName }),
          ...(urlObj.transformRules && { transformRules: urlObj.transformRules }),
        };
        allSuggestions.push(suggestion);
      });
    }
  });

  const suggestions = { headings: [...allSuggestions] };

  log.debug(`Generated ${suggestions.headings.length} headings suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  const headingsSuggestions = auditData.suggestions?.headings || [];
  if (!headingsSuggestions.length) {
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
    newData: headingsSuggestions,
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

  log.info(`Headings opportunity created for Site Optimizer and ${headingsSuggestions.length} suggestions synced for ${auditUrl}`);
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
