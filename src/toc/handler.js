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
} from '../headings/utils.js';
import {
  getHeadingSelector,
  cheerioLoad,
} from '../headings/shared-utils.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { getMergedAuditInputUrls, sortTopPagesByTraffic } from '../utils/audit-input-urls.js';
import { getTopAgenticUrlsFromAthena } from '../utils/agentic-urls.js';

const auditType = Audit.AUDIT_TYPES.TOC;
const { AUDIT_STEP_DESTINATIONS } = Audit;
const MAX_TOP_PAGES = 200;

/**
 * Fetches and merges TOC audit input URLs from three sources in priority order:
 * 1. Customer desired URLs (from site config)
 * 2. Agentic traffic (Athena CDN logs)
 * 3. Organic SEO top pages (DB)
 * @param {Object} context - Audit context
 * @param {Object} site - Site object
 * @returns {Promise<Object>} Merged URL result from getMergedAuditInputUrls
 */
async function getTocInputUrls(context, site) {
  const { dataAccess, log } = context;
  const result = await getMergedAuditInputUrls({
    site,
    dataAccess,
    auditType,
    getAgenticUrls: () => getTopAgenticUrlsFromAthena(site, context, MAX_TOP_PAGES),
    getTopPages: async () => {
      const topPages = await dataAccess?.SiteTopPage?.allBySiteIdAndSourceAndGeo?.(
        site.getId(),
        'seo',
        'global',
      );
      return sortTopPagesByTraffic(topPages || []);
    },
    topOrganicLimit: MAX_TOP_PAGES,
  });

  log.info(
    `[TOC] URL inputs: topPages=${result.topPagesUrls.length}, `
    + `agentic=${result.agenticUrls.length}, includedURLs=${result.includedURLs.length}, `
    + `filteredOutUrls=${result.filteredCount}, finalUrls=${result.urls.length}`,
  );

  return result;
}

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
  description: 'No URLs available for audit',
  explanation: 'No URLs found for audit',
};

/**
 * Detect TOC presence in DOM using heuristic signals, without AI.
 * Checks for:
 * 1. A list (ul/ol) containing 2+ internal anchor links (href="#...")
 * 2. Elements with TOC-related class or id names
 * @param {CheerioAPI} $ - The Cheerio instance
 * @returns {boolean} True if a TOC is detected in the DOM
 */
export function hasTocInDom($) {
  // Signal 1: list (ul/ol) with 2+ internal anchor links (href="#...")
  let anchorListFound = false;
  $('ul, ol').each((_, listEl) => {
    if ($(listEl).find('a[href^="#"]').length >= 2) {
      anchorListFound = true;
      return false; // break the each loop
    }
    return true; // continue
  });
  if (anchorListFound) {
    return true;
  }

  // Signal 2: elements with TOC-related class or id names
  const tocPatterns = [
    'toc',
    'table-of-contents',
    'tableofcontents',
    'anchor-list',
    'anchor__list',
    'cmp-toc__content',
  ];
  return tocPatterns.some(
    (pattern) => $(`[class*="${pattern}"], [id*="${pattern}"]`).length > 0,
  );
}

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
    // Phase 1: DOM-based heuristic — fast, deterministic, no AI needed
    if (hasTocInDom($)) {
      log.debug(`[TOC Detection] TOC detected via DOM heuristic for ${url}`);
      return {
        tocPresent: true,
        TOCCSSSelector: null,
        confidence: 10,
        reasoning: 'TOC detected via DOM heuristic (anchor link list or TOC class/id found)',
      };
    }

    // Phase 2: AI-based detection using <main> content (or body fallback)
    const mainEl = $('body > main');
    const htmlToAnalyze = mainEl.length > 0
      ? mainEl.html() || ''
      : $('body').html() || '';
    const bodyContent = htmlToAnalyze.substring(0, 8000);

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

      if (headingsData.length === 0) {
        log.debug(`[TOC Detection] No headings found for TOC suggestion for ${url}, skipping`);
      } else {
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
 * Step 1: Import top pages for the TOC audit.
 * @param {Object} context - Audit context
 * @returns {Promise<Object>}
 */
export async function importTopPages(context) {
  const { site, log } = context;
  try {
    const { urls } = await getTocInputUrls(context, site);
    log.info(`[TOC] Found ${urls.length} URLs for audit`);
    return {
      type: 'top-pages',
      siteId: site.getId(),
      auditResult: { success: true, topPages: urls },
      fullAuditRef: site.getBaseURL(),
    };
  } catch (error) {
    log.error(`[TOC] Failed to import top pages: ${error.message}`, error);
    return {
      type: 'top-pages',
      siteId: site.getId(),
      auditResult: { success: false, error: error.message, topPages: [] },
      fullAuditRef: site.getBaseURL(),
    };
  }
}

/**
 * Step 2: Submit TOC URLs for scraping via ScrapeClient.
 * Reads topPages from the stored audit result (set by importTopPages in step 1).
 * Returns empty urls array when step 1 failed or found no pages — the framework
 * will bypass the scrape client and route directly to process-toc-results.
 * @param {Object} context - Audit context
 * @returns {Promise<Object>}
 */
export async function submitForScraping(context) {
  const { site, audit, log } = context;
  const { Audit: AuditModel } = context.dataAccess;
  const auditResult = audit.getAuditResult();
  const topPages = auditResult?.topPages ?? [];

  if (auditResult?.success === false) {
    log.warn('[TOC] Audit failed in previous step, skipping scraping');
    const terminalResult = {
      check: TOPPAGES_CHECK.check, success: false, explanation: TOPPAGES_CHECK.explanation,
    };
    await AuditModel.updateByKeys({ auditId: audit.getId() }, { auditResult: terminalResult });
    return { auditResult: terminalResult, fullAuditRef: site.getBaseURL() };
  }

  if (topPages.length === 0) {
    log.warn('[TOC] No top pages found, ending audit');
    const terminalResult = {
      check: TOPPAGES_CHECK.check, success: false, explanation: TOPPAGES_CHECK.explanation,
    };
    await AuditModel.updateByKeys({ auditId: audit.getId() }, { auditResult: terminalResult });
    return { auditResult: terminalResult, fullAuditRef: site.getBaseURL() };
  }

  log.info(`[TOC] Submitting ${topPages.length} URLs for scraping`);
  return {
    urls: topPages.map((url) => ({ url })),
    siteId: site.getId(),
    processingType: auditType,
    options: { storagePrefix: auditType },
    maxScrapeAge: 24,
  };
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

export function slimTocAuditResult(auditResult) {
  if (!auditResult || typeof auditResult !== 'object') {
    return auditResult;
  }
  const isEmptyToc = auditResult.toc && Object.keys(auditResult.toc).length === 0;
  if (auditResult.error || auditResult.check || isEmptyToc) {
    return { ...auditResult };
  }
  if (!auditResult.toc) {
    return { ...auditResult };
  }
  const slimToc = {};
  for (const [checkKey, checkResult] of Object.entries(auditResult.toc)) {
    if (!checkResult || !Array.isArray(checkResult.urls)) {
      slimToc[checkKey] = checkResult;
    } else {
      slimToc[checkKey] = {
        ...checkResult,
        urls: checkResult.urls.map((urlObj) => {
          const { transformRules: _, ...rest } = urlObj;
          return rest;
        }),
      };
    }
  }
  return {
    ...auditResult,
    toc: slimToc,
  };
}

/**
 * Step 3: Process scraped content and generate TOC opportunities.
 * Inlines suggestion generation, DB update, and result slimming so that
 * transformRules are used to build suggestions before being stripped from the
 * audit DB record (which has a size limit).
 * @param {Object} context - Audit context
 * @returns {Promise<Object>}
 */
export async function processTocResults(context) {
  const {
    site, log, s3Client, scrapeResultPaths, audit,
  } = context;
  const { S3_SCRAPER_BUCKET_NAME } = context.env;
  const { Audit: AuditModel } = context.dataAccess;
  const baseURL = site.getBaseURL();

  let auditResult;

  try {
    if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
      log.warn('[TOC Audit] No scrape results available, ending audit.');
      auditResult = {
        check: TOPPAGES_CHECK.check,
        success: false,
        explanation: TOPPAGES_CHECK.explanation,
      };
      await AuditModel.updateByKeys(
        { auditId: audit.getId() },
        { auditResult },
      );
      return { fullAuditRef: baseURL, auditResult };
    }
    const auditPromises = Array.from(scrapeResultPaths.entries()).map(async ([url, s3Path]) => {
      const scrapeJsonObject = await getObjectFromKey(
        s3Client,
        S3_SCRAPER_BUCKET_NAME,
        s3Path,
        log,
      );
      return validatePageTocFromScrapeJson(url, scrapeJsonObject, log, context);
    });
    const auditResults = await Promise.allSettled(auditPromises);

    const aggregatedResults = {};
    let totalIssuesFound = 0;

    auditResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        const { url, tocDetails } = result.value;

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

    auditResult = totalIssuesFound === 0 ? { toc: {} } : { toc: aggregatedResults };

    // Build suggestions from FULL result (transformRules present) before slimming
    const auditData = {
      id: audit.getId(),
      siteId: site.getId(),
      auditType,
      auditResult,
      fullAuditRef: baseURL,
    };
    const withSuggestions = generateSuggestions(baseURL, auditData, context);
    await opportunityAndSuggestions(baseURL, withSuggestions, context);

    // Slim AFTER suggestions are persisted — strips transformRules from the audit DB record
    const slimmedAuditResult = slimTocAuditResult(auditResult);

    await AuditModel.updateByKeys(
      { auditId: audit.getId() },
      { auditResult: slimmedAuditResult },
    );

    return { fullAuditRef: baseURL, auditResult: slimmedAuditResult };
  } catch (error) {
    log.error(`TOC audit failed: ${error.message}`);
    const errorResult = { error: `Audit failed with error: ${error.message}`, success: false };
    await AuditModel.updateByKeys({ auditId: audit.getId() }, { auditResult: errorResult });
    throw error;
  }
}

export async function tocPersister(auditData, context) {
  const { dataAccess, log } = context;
  const { Audit: AuditCreate } = dataAccess;
  const slimmedAuditData = {
    ...auditData,
    auditResult: slimTocAuditResult(auditData.auditResult),
  };
  if (log && typeof log.debug === 'function') {
    const urlCount = slimmedAuditData.auditResult?.toc?.toc?.urls?.length ?? 0;
    log.debug(`[TOC Persister] Persisting slimmed audit (transformRules stripped from ${urlCount} URLs)`);
  }
  return AuditCreate.create(slimmedAuditData);
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('process-toc-results', processTocResults)
  .build();
