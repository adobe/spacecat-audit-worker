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
import { createOpportunityDataForTOC } from './opportunity-data-mapper.js';
import {
  extractTocData,
  tocArrayToHast,
  determineTocPlacement,
} from './utils.js';
import {
  getHeadingSelector,
  cheerioLoad,
  loadScrapeJson,
  getTopPages,
  initializeAuditContext,
} from './shared-utils.js';

const auditType = Audit.AUDIT_TYPES.TOC;

export const TOC_CHECK = {
  check: 'toc',
  title: 'Table of Contents',
  description: 'Table of Contents is not present on the page',
  explanation: 'Table of Contents should be present on the page',
  suggestion: 'Add a Table of Contents to the page',
};

export const TOPPAGES_CHECK = {
  check: 'top-pages',
  title: 'Top Pages',
  description: 'No top pages available for audit',
  explanation: 'No top pages found',
};

/**
 * Detect if a Table of Contents (TOC) is present in the document using LLM analysis
 * @param {CheerioAPI} $ - The Cheerio instance
 * @param {string} url - The page URL
 * @param {Object} pageTags - Page metadata (title, lang, etc.)
 * @param {Object} log - Logger instance
 * @param {Object} context - Audit context containing environment and clients
 * @param {string} scrapedAt - Timestamp when the page was scraped
 * @returns {Promise<Object>} Object with tocPresent, TOCCSSSelector, confidence, reasoning
 */
async function getTocDetails($, url, pageTags, log, context, scrapedAt) {
  try {
    // Extract first 3000 characters from body
    const bodyElement = $('body')[0];
    const bodyHTML = $(bodyElement).html() || '';
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

    const result = {
      tocPresent: aiResponseContent.tocPresent,
      TOCCSSSelector: aiResponseContent.TOCCSSSelector || null,
      confidence: confidenceScore,
      reasoning: aiResponseContent.reasoning || '',
    };

    // If TOC is not present, determine where it should be placed
    if (!aiResponseContent.tocPresent) {
      const placement = determineTocPlacement($, getHeadingSelector);
      const headingsData = extractTocData($, getHeadingSelector);

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
 * Validate TOC presence for a single page from scrapeJsonObject
 * @param {string} url - The URL being validated
 * @param {Object} scrapeJsonObject - The scraped page data from S3
 * @param {Object} log - Logger instance
 * @param {Object} context - Audit context
 * @returns {Promise<{url: string, tocDetails: Object}>}
 */
export async function validatePageTocFromScrapeJson(
  url,
  scrapeJsonObject,
  log,
  context,
) {
  try {
    if (!scrapeJsonObject) {
      log.error(`Scrape JSON object not found for ${url}, skipping TOC audit`);
      return null;
    }

    const $ = cheerioLoad(scrapeJsonObject.scrapeResult.rawBody);

    const pageTags = {
      title: scrapeJsonObject.scrapeResult.tags.title,
      lang: scrapeJsonObject.scrapeResult.tags.lang,
      finalUrl: scrapeJsonObject.finalUrl,
    };

    const tocDetails = await getTocDetails(
      $,
      url,
      pageTags,
      log,
      context,
      scrapeJsonObject.scrapedAt,
    );

    return { url, tocDetails };
  } catch (error) {
    log.error(`Error validating TOC for ${url}: ${error.message}`);
    return {
      url,
      tocDetails: null,
    };
  }
}

/**
 * Validate TOC presence for a single page
 * @param {string} url - Page URL
 * @param {Object} log - Logger instance
 * @param {Object} site - Site object
 * @param {Array} allKeys - S3 keys
 * @param {Object} s3Client - S3 client
 * @param {string} S3_SCRAPER_BUCKET_NAME - S3 bucket name
 * @param {Object} context - Audit context
 * @returns {Promise<{url: string, tocDetails: Object}>}
 */
export async function validatePageToc(
  url,
  log,
  site,
  allKeys,
  s3Client,
  S3_SCRAPER_BUCKET_NAME,
  context,
) {
  if (!url) {
    log.error('URL is undefined or null, cannot validate TOC');
    return {
      url,
      tocDetails: null,
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
  return validatePageTocFromScrapeJson(url, scrapeJsonObject, log, context);
}

/**
 * Main TOC audit runner
 * @param {string} baseURL - Base URL
 * @param {Object} context - Audit context
 * @param {Object} site - Site object
 * @returns {Promise<Object>}
 */
export async function tocAuditRunner(baseURL, context, site) {
  const siteId = site.getId();
  const { log, dataAccess, s3Client } = context;
  const { S3_SCRAPER_BUCKET_NAME } = context.env;

  try {
    // Get top 200 pages
    const topPages = await getTopPages(dataAccess, siteId, context, log, 200);

    if (topPages.length === 0) {
      log.warn('[TOC Audit] No top pages found, ending audit.');
      return {
        fullAuditRef: baseURL,
        auditResult: {
          check: TOPPAGES_CHECK.check,
          success: false,
          explanation: TOPPAGES_CHECK.explanation,
        },
      };
    }

    const { allKeys } = await initializeAuditContext(context, site);

    // Validate TOC for each page
    const auditPromises = topPages.map(async (page) => validatePageToc(
      page.url,
      log,
      site,
      allKeys,
      s3Client,
      S3_SCRAPER_BUCKET_NAME,
      context,
    ));
    const auditResults = await Promise.allSettled(auditPromises);

    // Aggregate results
    const aggregatedResults = {};
    let totalIssuesFound = 0;

    auditResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        const { url, tocDetails } = result.value;

        // Handle TOC detection - only add to results if TOC is missing
        if (tocDetails && !tocDetails.tocPresent && tocDetails.transformRules) {
          if (!aggregatedResults[TOC_CHECK.check]) {
            totalIssuesFound += 1;
            aggregatedResults[TOC_CHECK.check] = {
              success: false,
              explanation: TOC_CHECK.explanation,
              suggestion: TOC_CHECK.suggestion,
              urls: [],
            };
          }

          if (!aggregatedResults[TOC_CHECK.check].urls.find((urlObj) => urlObj.url === url)) {
            aggregatedResults[TOC_CHECK.check].urls.push({
              url,
              explanation: TOC_CHECK.explanation,
              suggestion: TOC_CHECK.suggestion,
              isAISuggested: false,
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

    log.debug(`Successfully completed TOC Audit for site: ${baseURL}. Found ${totalIssuesFound} issues.`);

    // Return success if no issues found, otherwise return the aggregated results
    if (totalIssuesFound === 0) {
      return {
        fullAuditRef: baseURL,
        auditResult: {
          toc: {},
        },
      };
    }
    return {
      fullAuditRef: baseURL,
      auditResult: {
        toc: aggregatedResults,
      },
    };
  } catch (error) {
    log.error(`TOC audit failed: ${error.message}`);
    return {
      fullAuditRef: baseURL,
      auditResult: { error: `Audit failed with error: ${error.message}`, success: false },
    };
  }
}

/**
 * Generate recommended action based on check type
 * @param {string} _checkType - The type of check (unused for now)
 * @returns {string} Recommended action message
 */
function generateRecommendedAction(_) {
  // For now, return the default message for all check types
  return 'Review heading structure and content to follow heading best practices.';
}

export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  const tocData = auditData.auditResult?.toc;

  if (!tocData || Object.keys(tocData).length === 0
      || tocData.status === 'success'
      || tocData.error
      || tocData.check === TOPPAGES_CHECK.check) {
    log.info(`TOC audit for ${auditUrl} has no issues or failed, skipping suggestions generation`);
    return { ...auditData };
  }

  const allTocSuggestions = [];
  Object.entries(tocData).forEach(([checkType, checkResult]) => {
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

  const suggestions = { toc: [...allTocSuggestions] };

  log.debug(`Generated ${suggestions.toc.length} TOC suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  const tocSuggestions = auditData.suggestions?.toc || [];

  if (!tocSuggestions.length) {
    log.info('TOC audit has no issues, skipping opportunity creation');
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityDataForTOC,
    auditType,
  );

  const mergeDataFunction = (existingSuggestion, newSuggestion) => {
    const mergedSuggestion = {
      ...existingSuggestion,
      ...newSuggestion,
    };
    if (existingSuggestion.isEdited && existingSuggestion.transformRules?.value !== undefined) {
      mergedSuggestion.transformRules.value = existingSuggestion.transformRules.value;
    }
    return mergedSuggestion;
  };

  const buildKey = (suggestion) => `${suggestion.checkType}|${suggestion.url}`;

  await syncSuggestions({
    opportunity,
    newData: tocSuggestions,
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
    mergeDataFunction,
    log,
  });

  log.info(`TOC opportunity created for Site Optimizer and ${tocSuggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(tocAuditRunner)
  .withPostProcessors([
    generateSuggestions,
    opportunityAndSuggestions,
  ])
  .build();
