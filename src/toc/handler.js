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

const auditType = Audit.AUDIT_TYPES.TOC;
const { AUDIT_STEP_DESTINATIONS } = Audit;

// TODO(LLMO-4880): remove before full rollout — hardcoded test URLs for prerender validation
const TOC_TEST_URLS = [
  'https://careinsurance.com/health-insurance/ultcr/ultimate-care-health-insurance.html',
  'https://careinsurance.com/health-insurance/health-insurance-in-solapur',
  'https://careinsurance.com/health-insurance/health-insurance-in-vijayawada',
];

/**
 * Returns hardcoded test URLs for prerender scraper validation (LLMO-4880).
 * TODO(LLMO-4880): replace with getMergedAuditInputUrls before full rollout.
 * @param {Object} context - Audit context
 * @param {Object} site - Site object
 * @returns {Promise<Object>} { urls: string[] }
 */
async function getTocInputUrls(context, site) {
  const { log } = context;
  log.info(`[TOC] Using ${TOC_TEST_URLS.length} hardcoded test URLs (prerender validation) for site=${site.getBaseURL()}`);
  TOC_TEST_URLS.forEach((url, i) => log.info(`[TOC]   url[${i}]: ${url}`));
  return { urls: TOC_TEST_URLS };
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
  // Signal 1: list (ul/ol) with 2+ internal anchor links (href="#section-id").
  // Exclude bare href="#" (JavaScript tab/nav placeholders) — only count links
  // with a non-empty fragment so search menus and tab widgets don't false-positive.
  let anchorListFound = false;
  $('ul, ol').each((_, listEl) => {
    if ($(listEl).find('a[href^="#"]:not([href="#"])').length >= 2) {
      anchorListFound = true;
      return false; // break the each loop
    }
    return true; // continue
  });
  if (anchorListFound) {
    return true;
  }

  // Signal 2: elements with TOC-related class or id names.
  // Use a regex with hyphen/underscore word boundaries for the short "toc" token to avoid
  // false positives from substrings like "autocomplete" (au-toc-omplete has letters, not
  // separators, around "toc"). Longer compound patterns are safe with CSS *=.
  const TOC_WORD_RE = /(?:^|[-_\s])toc(?:[-_\s]|$)/i;
  const tocWordMatch = $('[class], [id]').toArray().some((el) => {
    const cls = $(el).attr('class') || '';
    const id = $(el).attr('id') || '';
    return TOC_WORD_RE.test(cls) || TOC_WORD_RE.test(id);
  });
  if (tocWordMatch) {
    return true;
  }

  const substringPatterns = [
    'table-of-contents',
    'tableofcontents',
    'anchor-list',
    'anchor__list',
    'cmp-toc__content',
  ];
  return substringPatterns.some(
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

      if (headingsData.length <= 1) {
        log.debug(`[TOC Detection] ${headingsData.length === 0 ? 'No headings' : 'Only one heading'} found for TOC suggestion for ${url}, skipping`);
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
  log.info(`[TOC] Started Testing3 importTopPages: siteId=${site.getId()}, baseURL=${site.getBaseURL()}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// LLMO-4880 Puppeteer probe — identifies which specific browser flags cause
// 403 on careinsurance.com when running from Lambda IPs.
// Runs 6 progressive modes (DefaultHandler → PrerenderHandler) and logs results
// so we can see in Coralogix exactly which change fixes the issue.
// Remove runPuppeteerProbe() and its call in submitForScraping once flags identified.
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable no-await-in-loop */

// Each mode adds exactly one PrerenderHandler feature on top of the previous.
// Mode-0 is the exact DefaultHandler baseline; Mode-5 is the exact PrerenderHandler.
const PROBE_MODES = [
  {
    name: 'Mode-0-DefaultHandler',
    desc: '--disable-web-security + headless:true + waitUntil:networkidle2 (DefaultHandler baseline)',
    headless: true,
    extraArgs: ['--disable-web-security'],
    waitUntil: 'networkidle2',
    addAcceptLanguage: false,
    doOverridePermissions: false,
    doCdpCors: false,
  },
  {
    name: 'Mode-1-no-disable-web-security',
    desc: 'Remove --disable-web-security only (single change vs Mode-0)',
    headless: true,
    extraArgs: [],
    waitUntil: 'networkidle2',
    addAcceptLanguage: false,
    doOverridePermissions: false,
    doCdpCors: false,
  },
  {
    name: 'Mode-2-headless-shell',
    desc: 'Mode-1 + headless:shell (new headless API vs deprecated headless:true)',
    headless: 'shell',
    extraArgs: [],
    waitUntil: 'networkidle2',
    addAcceptLanguage: false,
    doOverridePermissions: false,
    doCdpCors: false,
  },
  {
    name: 'Mode-3-domcontentloaded',
    desc: 'Mode-2 + waitUntil:domcontentloaded',
    headless: 'shell',
    extraArgs: [],
    waitUntil: 'domcontentloaded',
    addAcceptLanguage: false,
    doOverridePermissions: false,
    doCdpCors: false,
  },
  {
    name: 'Mode-4-lang-permissions',
    desc: 'Mode-3 + Accept-Language + overridePermissions + --deny-permission-prompts',
    headless: 'shell',
    extraArgs: ['--deny-permission-prompts'],
    waitUntil: 'domcontentloaded',
    addAcceptLanguage: true,
    doOverridePermissions: true,
    doCdpCors: false,
  },
  {
    name: 'Mode-5-full-PrerenderHandler',
    desc: 'Mode-4 + CDP Fetch CORS interception (exact PrerenderHandler — known to work)',
    headless: 'shell',
    extraArgs: ['--deny-permission-prompts'],
    waitUntil: 'domcontentloaded',
    addAcceptLanguage: true,
    doOverridePermissions: true,
    doCdpCors: true,
  },
];

async function runOneProbeMode(puppeteer, chromium, mode, probeUrl, log) {
  log.info(`[TOC][PROBE] ── ${mode.name}`);
  log.info(`[TOC][PROBE]    ${mode.desc}`);

  let browser;
  try {
    // eslint-disable-next-line import/no-unresolved
    const executablePath = await chromium.executablePath();
    const launchArgs = [...chromium.args, ...mode.extraArgs];
    log.info(`[TOC][PROBE]    executablePath=${executablePath}`);
    log.info(`[TOC][PROBE]    headless=${JSON.stringify(mode.headless)}  waitUntil=${mode.waitUntil}`);
    log.info(`[TOC][PROBE]    --disable-web-security=${launchArgs.includes('--disable-web-security')}`);
    log.info(`[TOC][PROBE]    extraArgs=${JSON.stringify(mode.extraArgs)}`);
    log.info(`[TOC][PROBE]    lang=${mode.addAcceptLanguage}  permissions=${mode.doOverridePermissions}  cdpCors=${mode.doCdpCors}`);

    browser = await puppeteer.launch({
      args: launchArgs,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: mode.headless,
    });
    log.info('[TOC][PROBE]    browser launched');

    const page = await browser.newPage();

    if (mode.addAcceptLanguage) {
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
      log.info('[TOC][PROBE]    set Accept-Language: en-US,en;q=0.9');
    }

    if (mode.doOverridePermissions) {
      // eslint-disable-next-line no-await-in-loop
      await browser.defaultBrowserContext().overridePermissions(probeUrl, ['geolocation', 'notifications']);
      log.info('[TOC][PROBE]    overridePermissions done');
    }

    if (mode.doCdpCors) {
      const cdpClient = await page.createCDPSession();
      await cdpClient.send('Fetch.enable', { patterns: [{ requestStage: 'Response' }] });
      cdpClient.on('Fetch.requestPaused', async ({
        requestId, responseHeaders = [], responseStatusCode = 200,
      }) => {
        try {
          const modified = responseHeaders.filter(
            (h) => !h.name.toLowerCase().startsWith('access-control'),
          );
          modified.push({ name: 'Access-Control-Allow-Origin', value: '*' });
          await cdpClient.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: responseStatusCode,
            responseHeaders: modified,
          });
        } catch (cdpErr) {
          log.warn(`[TOC][PROBE]    CDP fulfillRequest error: ${cdpErr.message}`);
        }
      });
      log.info('[TOC][PROBE]    CDP CORS interception enabled');
    }

    let httpStatus = null;
    let httpStatusText = null;
    page.on('response', (resp) => {
      const respUrl = resp.url();
      if (respUrl === probeUrl || respUrl.split('?')[0] === probeUrl.split('?')[0]) {
        httpStatus = resp.status();
        httpStatusText = resp.statusText();
      }
    });

    const t0 = Date.now();
    let navError = null;
    try {
      await page.goto(probeUrl, { waitUntil: mode.waitUntil, timeout: 30000 });
    } catch (navErr) {
      navError = navErr.message;
      log.warn(`[TOC][PROBE]    navigation error: ${navError}`);
    }
    const elapsedMs = Date.now() - t0;

    const title = await page.title().catch(() => '(title error)');
    /* eslint-disable no-undef */
    const bodyHtmlLen = await page
      .evaluate(() => document.body?.innerHTML?.length ?? 0)
      .catch(() => 0);
    const bodySnippet = await page
      .evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().substring(0, 200))
      .catch(() => '');
    /* eslint-enable no-undef */

    const botSignals = [
      'access denied', 'just a moment', 'enable javascript',
      'checking your browser', 'cloudflare', 'please wait', 'ddos-guard',
    ];
    const snippetLower = bodySnippet.toLowerCase();
    const botBlocked = (httpStatus != null && httpStatus >= 400)
      || botSignals.some((s) => snippetLower.includes(s));
    const success = !navError && httpStatus === 200 && bodyHtmlLen > 2000 && !botBlocked;

    let verdict;
    if (success) {
      verdict = 'SUCCESS';
    } else if (botBlocked) {
      verdict = 'BOT-BLOCKED';
    } else {
      verdict = 'FAILED';
    }
    log.info(`[TOC][PROBE]    ${verdict}  HTTP=${httpStatus ?? 'n/a'}(${httpStatusText ?? ''})  bodyHtmlLen=${bodyHtmlLen}  elapsed=${elapsedMs}ms`);
    log.info(`[TOC][PROBE]    title="${title}"`);
    log.info(`[TOC][PROBE]    body="${bodySnippet.replace(/\n/g, ' ')}"`);

    return {
      mode: mode.name, httpStatus, navError, bodyHtmlLen, elapsedMs, success, botBlocked,
    };
  } catch (modeErr) {
    log.warn(`[TOC][PROBE]    LAUNCH/RUN ERROR: ${modeErr.message}`);
    return {
      mode: mode.name, error: modeErr.message, success: false, botBlocked: false,
    };
  } finally {
    if (browser) {
      await browser.close().catch((e) => log.warn(`[TOC][PROBE]    browser.close error: ${e.message}`));
    }
  }
}

/**
 * LLMO-4880 diagnostic: launch Chromium in 6 progressive modes against the first probe URL.
 * Each mode adds one PrerenderHandler feature on top of the previous mode so we can pinpoint
 * the minimum flags needed to pass bot detection on careinsurance.com from Lambda IPs.
 * All output uses the [TOC][PROBE] prefix for easy Coralogix filtering.
 * @param {string[]} urls - URLs list (only first URL is used)
 * @param {Object} log - Logger
 */
async function runPuppeteerProbe(urls, log) {
  let puppeteer;
  let chromium;
  try {
    // Dynamic import so missing packages don't break startup in other envs
    /* eslint-disable import/no-unresolved */
    ({ default: puppeteer } = await import('puppeteer-core'));
    ({ default: chromium } = await import('@sparticuz/chromium'));
    /* eslint-enable import/no-unresolved */
  } catch (importErr) {
    log.warn(`[TOC][PROBE] puppeteer-core/@sparticuz/chromium unavailable — skipping probe: ${importErr.message}`);
    return;
  }

  const probeUrl = urls[0];
  log.info('[TOC][PROBE] ════════════════════════════════════════════');
  log.info(`[TOC][PROBE] Starting probe against: ${probeUrl}`);
  log.info(`[TOC][PROBE] ${PROBE_MODES.length} modes — Mode-0=DefaultHandler, Mode-5=PrerenderHandler`);
  log.info('[TOC][PROBE] ════════════════════════════════════════════');

  const probeResults = [];
  for (const mode of PROBE_MODES) {
    const result = await runOneProbeMode(puppeteer, chromium, mode, probeUrl, log);
    probeResults.push(result);
  }

  log.info('[TOC][PROBE] ═══════════════ SUMMARY ═══════════════════');
  probeResults.forEach((r) => {
    let icon;
    if (r.success) {
      icon = 'OK ';
    } else if (r.botBlocked) {
      icon = 'BOT';
    } else {
      icon = 'ERR';
    }
    log.info(`[TOC][PROBE]   [${icon}]  ${r.mode}  HTTP=${r.httpStatus ?? 'n/a'}  bodyLen=${r.bodyHtmlLen ?? 0}  ${r.error ?? ''}`);
  });
  const firstSuccess = probeResults.find((r) => r.success);
  if (firstSuccess) {
    log.info(`[TOC][PROBE] CONCLUSION: minimum working mode is ${firstSuccess.mode}`);
    log.info('[TOC][PROBE] Apply only the changes up to that mode to DefaultHandler.');
  } else {
    log.info('[TOC][PROBE] CONCLUSION: all modes failed — IP not whitelisted or new protection rule.');
  }
  log.info('[TOC][PROBE] ════════════════════════════════════════════');
}

/* eslint-enable no-await-in-loop */

/**
 * Step 2: Submit TOC URLs for scraping via ScrapeClient.
 * Reads topPages from the stored audit result (set by importTopPages in step 1).
 * Returns empty urls array when step 1 failed or found no pages — the framework
 * will bypass the scrape client and route directly to process-toc-results.
 * @param {Object} context - Audit context
 * @returns {Promise<Object>}
 */
export async function submitForScraping(context) {
  const { site, log } = context;
  // TODO(LLMO-4880): remove hardcoded URLs and restore import-top-pages step before full rollout
  log.info(`[TOC] submitForScraping (step 1): siteId=${site.getId()}, baseURL=${site.getBaseURL()}`);
  log.info(`[TOC] Using ${TOC_TEST_URLS.length} hardcoded test URLs (processingType=prerender)`);
  TOC_TEST_URLS.forEach((url, i) => log.info(`[TOC]   scrape[${i}]: ${url}`));

  // TODO(LLMO-4880): remove probe once minimum flags are identified
  log.info('[TOC] Running Puppeteer flag probe from Lambda IPs — see [TOC][PROBE] logs for results');
  try {
    await runPuppeteerProbe(TOC_TEST_URLS, log);
  } catch (probeErr) {
    log.warn(`[TOC] Puppeteer probe threw unexpectedly: ${probeErr.message} — continuing with scrape`);
  }

  return {
    auditResult: { success: true, topPages: TOC_TEST_URLS },
    fullAuditRef: site.getBaseURL(),
    urls: TOC_TEST_URLS.map((url) => ({ url })),
    siteId: site.getId(),
    processingType: 'prerender',
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
    // Do not overwrite data for suggestions already deployed to the edge CDN
    if (existingSuggestion.edgeDeployed) {
      return { ...existingSuggestion };
    }
    const converted = { ...newSuggestion };
    if (converted.transformRules && Array.isArray(converted.transformRules.value)) {
      converted.transformRules = {
        ...converted.transformRules,
        value: tocArrayToHast(converted.transformRules.value),
        valueFormat: 'hast',
      };
    }
    const mergedSuggestion = {
      ...existingSuggestion,
      ...converted,
    };
    if (existingSuggestion.isEdited && existingSuggestion.transformRules?.value !== undefined) {
      const existingValue = existingSuggestion.transformRules.value;
      mergedSuggestion.transformRules.value = Array.isArray(existingValue)
        ? tocArrayToHast(existingValue)
        : existingValue;
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
    log.info(`[TOC] processTocResults: auditId=${audit?.getId()}, siteId=${site.getId()}, baseURL=${baseURL}, scrapeResultPaths.size=${scrapeResultPaths?.size ?? 0}`);

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

    Array.from(scrapeResultPaths.entries()).forEach(([url, s3Path], i) => {
      log.info(`[TOC]   result[${i}]: url=${url} s3Path=${s3Path}`);
    });

    const auditPromises = Array.from(scrapeResultPaths.entries()).map(async ([url, s3Path]) => {
      log.info(`[TOC] Fetching S3 scrape object: url=${url} s3Path=${s3Path}`);
      const scrapeJsonObject = await getObjectFromKey(
        s3Client,
        S3_SCRAPER_BUCKET_NAME,
        s3Path,
        log,
      );
      log.info(`[TOC] S3 object fetched for ${url}: found=${!!scrapeJsonObject}, statusCode=${scrapeJsonObject?.scrapeResult?.statusCode ?? 'n/a'}, bodyLen=${scrapeJsonObject?.scrapeResult?.rawBody?.length ?? 0}`);
      return validatePageTocFromScrapeJson(url, scrapeJsonObject, log, context);
    });
    const auditResults = await Promise.allSettled(auditPromises);
    log.info(`[TOC] allSettled: ${auditResults.length} results — fulfilled=${auditResults.filter((r) => r.status === 'fulfilled').length}, rejected=${auditResults.filter((r) => r.status === 'rejected').length}`);
    auditResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        log.info(`[TOC]   result[${i}] REJECTED: ${r.reason?.message}`);
      } else {
        log.info(`[TOC]   result[${i}] OK: url=${r.value?.url}, tocPresent=${r.value?.tocDetails?.tocPresent}`);
      }
    });

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
  // TODO(LLMO-4880): restore import-top-pages step before full rollout
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('process-toc-results', processTocResults)
  .build();
