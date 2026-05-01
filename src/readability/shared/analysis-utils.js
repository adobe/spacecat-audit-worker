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
import { load as cheerioLoad } from 'cheerio';
import { franc } from 'franc-min';
import { getObjectFromKey } from '../../utils/s3-utils.js';
import {
  calculateReadabilityScore,
  isSupportedLanguage,
  getLanguageName,
} from './multilingual-readability.js';
import {
  TARGET_READABILITY_SCORE,
  MIN_TEXT_LENGTH,
  MAX_CHARACTERS_DISPLAY,
  MAX_LINK_DENSITY_RATIO,
} from './constants.js';
import { getElementSelector } from './selector-utils.js';
import {
  removeEmbeddedSocialElements,
  isEmbeddedSocialContentElement,
} from './embed-content-utils.js';

/**
 * Collapses runs of whitespace into single spaces.
 */
export function collapseWhitespace(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text.replace(/\s+/g, ' ');
}

/**
 * Normalizes text extracted from the DOM before length checks and scoring
 * (removes layout padding between inline nodes, etc.).
 */
export function normalizeReadabilityText(text) {
  return collapseWhitespace(text ?? '').trim();
}

const NAV_ANCESTOR_SELECTORS = 'nav, [role="navigation"], [role="menubar"], [role="menu"]';

const NAV_CLASS_OR_ID_RE = /\b(nav[Hh]dr|nav-hdr|navbar|main-nav|site-nav|primary-nav|global-nav|meta-nav|footer-nav|subnav|sub-nav|breadcrumb)\b/i;

/**
 * Heuristic: navigation / menu chrome should not be scored as body copy.
 */
export function isLikelyNavigationElement($, element) {
  const $el = $(element);
  if ($el.closest(NAV_ANCESTOR_SELECTORS).length > 0) {
    return true;
  }
  const role = ($el.attr('role') || '').toLowerCase();
  if (['menuitem', 'menuitemradio', 'menuitemcheckbox'].includes(role)) {
    return true;
  }
  const nodesToCheck = [element, ...$el.parents().toArray()].slice(0, 24);
  for (const node of nodesToCheck) {
    const $node = $(node);
    const cls = $node.attr('class') || '';
    const id = $node.attr('id') || '';
    if (NAV_CLASS_OR_ID_RE.test(cls) || NAV_CLASS_OR_ID_RE.test(id)) {
      return true;
    }
  }
  if ($el.find('p.navHdr, p[class*="navHdr"], p[class*="nav-hdr"]').length > 0) {
    return true;
  }
  return false;
}

/**
 * Categorizes readability issues by severity and traffic impact
 */
function categorizeReadabilityIssue(readabilityScore, traffic) {
  if (readabilityScore < 20 && traffic > 1000) {
    return 'Critical';
  } else if (readabilityScore < 25 && traffic > 500) {
    return 'Important';
  } else if (readabilityScore < 30) {
    return 'Moderate';
  }
  return 'Low';
}

/**
 * Calculates SEO impact based on readability and traffic
 */
function calculateSeoImpact(readabilityScore) {
  if (readabilityScore < 15) {
    return 'High';
  } else if (readabilityScore < 25) {
    return 'Moderate';
  }
  return 'Low';
}

/**
 * Extracts traffic information from S3 object key (if available)
 */
function extractTrafficFromKey() {
  // This would need to be implemented based on how traffic data is stored in the key
  // For now, return 0 as default
  return 0;
}

/**
 * Strips non-content structural elements from the document before text extraction.
 * Exported so both the opportunity and preflight paths share the same removal list.
 *
 * @param {Cheerio} $ - The Cheerio document object.
 */
export function stripNonContent($) {
  $('header, footer, style, script, noscript, figcaption').remove();
}

/**
 * Language-agnostic citation signals (DOI, journal line, URL + access verb).
 *
 * Pattern notes:
 * - "year; doi:" is always a citation signal.
 * - "year; https://..." is only a citation when the URL ends the text; body prose like
 *   "launched in 2022; https://example.com/ published results" must not be excluded.
 * - "accessed/retrieved Month D, YYYY" is only a citation when the date ends the text;
 *   body prose like "retrieved March 1, 2024 from our database" must not be excluded.
 */
const CITATION_EXCLUSION_PATTERNS = [
  /doi:\s*10\.\d{4,}/i,
  /\d{4};\s*doi:/i,
  /\d{4};\s*https?:\/\/\S+[.,]?\s*$/i,
  /\b(accessed|retrieved)\s+\w+ \d{1,2},\s*\d{4}[.,]?\s*$/i,
  /https?:\/\/\S+[\s,.]*\s*(accessed|retrieved)\b/i,
];

/**
 * "Last accessed" / retrieval lines in locales aligned with SUPPORTED_LANGUAGES
 * (multilingual-readability.js): de, es, fr, it, nl, plus English patterns above.
 */
const MULTILINGUAL_RETRIEVAL_PATTERNS = [
  // German — DD.MM.YYYY (dot) and DD/MM/YYYY (slash), plus written-out month
  /\b(abgerufen|aufgerufen)\s+am\s+\d{1,2}\.\d{1,2}\.20\d{2}/i,
  /\b(abgerufen|aufgerufen)\s+am\s+\d{1,2}\/\d{1,2}\/20\d{2}/i,
  /\b(abgerufen|aufgerufen)\s+am\s+\d{1,2}\.\s*\w+\s+20\d{2}/i,
  // French — written-out month and all-numeric DD/MM/YYYY or DD.MM.YYYY
  /\b(consulté|consultée|accédé|accédée)\s+le\s+\d{1,2}\s+[^.]{2,50}20\d{2}/i,
  /\b(consulté|consultée|accédé|accédée)\s+le\s+\d{1,2}[/.]\d{1,2}[/.]20\d{2}/i,
  // Spanish — written-out month and all-numeric
  /\b(consultado|consultada)\s+el\s+\d{1,2}\s+[^.]{2,50}20\d{2}/i,
  /\b(consultado|consultada)\s+el\s+\d{1,2}[/.]\d{1,2}[/.]20\d{2}/i,
  // Italian — both masculine (consultato) and feminine (consultata), written-out and numeric
  /\b(consultato|consultata)\s+il\s+\d{1,2}\s+[^.]{2,50}20\d{2}/i,
  /\b(consultato|consultata)\s+il\s+\d{1,2}[/.]\d{1,2}[/.]20\d{2}/i,
  // Dutch — already covers [-./] separators
  /\b(geraadpleegd|bekeken)\s+op\s+\d{1,2}[-./]\d{1,2}[-./]20\d{2}/i,
  /\b(geraadpleegd|bekeken)\s+op\s+\d{1,2}\s+\w+\s+20\d{2}/i,
  // URL then non-English access verb (same line as bibliography)
  /https?:\/\/\S+[\s,.]*\s*(abgerufen|aufgerufen|consulté|consultée|consultado|consultata|consultato|geraadpleegd|bekeken)\b/i,
];

/**
 * Removes http(s) URLs so slash counts reflect caption-style "Name / Role" lines,
 * not path segments inside links.
 * @param {string} text
 * @returns {string}
 */
function textWithoutUrls(text) {
  return text.replace(/https?:\/\/\S+/gi, '');
}

/**
 * Image and wire-service attribution lines (often a plain &lt;p&gt; under a photo).
 * Uses composite signals only — not standalone "et al." or single slashes.
 * Note: contributor is intentionally in the agency token list; it only fires when
 * combined with via + 2+ slashes, so the false-positive risk on normal prose is low.
 *
 * @param {string} text - Trimmed text
 * @returns {boolean}
 */
function isImageAttributionCreditLine(text) {
  const normalized = collapseWhitespace(text).trim();
  if (normalized.length < 45 || normalized.length > 520) {
    return false;
  }
  const withoutUrls = textWithoutUrls(normalized);
  const slashCount = (withoutUrls.match(/\//g) || []).length;
  const hasVia = /\bvia\b/i.test(normalized);
  const hasAgencyToken = /getty|reuters|afp|shutterstock|alamy|contributor|staff\s+via|photo\s*©|©\s*\w/i.test(normalized);
  const hasCreditIntro = /\b(photo\s*credit|image\s*credit|crédit\s*photo|photo\s*:|foto\s*:|bildnachweis|imagen\s*:)\b/i.test(normalized);

  // Slash is required only when no agency token is present; "Photo credit: Jane Smith at Reuters"
  // has no slash but is unambiguously a credit line.
  if (hasCreditIntro && normalized.length < 220 && (slashCount >= 1 || hasAgencyToken)) {
    return true;
  }
  if (slashCount >= 2 && hasVia && hasAgencyToken) {
    return true;
  }
  return false;
}

/**
 * Returns true if the text looks like a bibliographic citation, retrieval line,
 * or image/agency credit rather than body prose — exclude from readability scoring.
 *
 * @param {string} text - Text content of an element or <br> segment.
 * @returns {boolean}
 */
export function isExcludedReadabilityText(text) {
  if (text == null || typeof text !== 'string') {
    return false;
  }
  const t = text.trim();
  if (t.length === 0) {
    return false;
  }
  if (CITATION_EXCLUSION_PATTERNS.some((re) => re.test(t))) {
    return true;
  }
  if (MULTILINGUAL_RETRIEVAL_PATTERNS.some((re) => re.test(t))) {
    return true;
  }
  if (isImageAttributionCreditLine(t)) {
    return true;
  }
  return false;
}

/**
 * Returns true if a Cheerio element wrapper should be processed for readability scoring.
 * Shared between the opportunity path (analyzePageContent) and the preflight path so that
 * adding a new exclusion signal only requires a change in one place.
 *
 * @param {CheerioElement} $el - Cheerio wrapper for the element.
 * @returns {boolean}
 */
export function isEligibleTextElement($el) {
  const textContent = $el.text()?.trim();
  if (!textContent
    || collapseWhitespace(textContent).length < MIN_TEXT_LENGTH
    || !/\s/.test(textContent)) {
    return false;
  }
  // <br>-split blocks: exclusion is applied per segment below.
  if ($el.html().includes('<br')) {
    return true;
  }
  return !isExcludedReadabilityText(textContent);
}

/**
 * Returns true if a plain-text paragraph (from a <br>-split block) should be scored.
 * Shared between the opportunity path and the preflight path.
 *
 * @param {string} text - Trimmed paragraph text.
 * @returns {boolean}
 */
export function isEligibleParagraphText(text) {
  return collapseWhitespace(text).length >= MIN_TEXT_LENGTH
    && /\s/.test(text)
    && !isExcludedReadabilityText(text);
}

/**
 * Analyzes readability for a single text block.
 * Exported for unit tests (defense-in-depth exclusion branch coverage).
 */
export async function analyzeTextReadability(
  text,
  selector,
  pageUrl,
  traffic,
  detectedLanguages,
  getSupportedLanguage,
  log,
  scrapedAt,
) {
  try {
    // Defense in depth: filters above also exclude; callers may change over time.
    if (isExcludedReadabilityText(text)) {
      return null;
    }

    // Check if text is in a supported language
    const detectedLanguage = getSupportedLanguage(text);
    if (!detectedLanguage) {
      return null; // Skip unsupported languages
    }

    // Track detected language
    detectedLanguages.add(detectedLanguage);

    // Calculate readability score
    let readabilityScore;
    if (detectedLanguage === 'english') {
      readabilityScore = rs.fleschReadingEase(text);
    } else {
      readabilityScore = await calculateReadabilityScore(text, detectedLanguage);
    }

    // Check if readability is poor
    if (readabilityScore < TARGET_READABILITY_SCORE) {
      // Truncate text for display
      const displayText = text.length > MAX_CHARACTERS_DISPLAY
        ? `${text.substring(0, MAX_CHARACTERS_DISPLAY)}...`
        : text;

      // Calculate priority rank
      const trafficWeight = traffic || 0;
      const readabilityWeight = TARGET_READABILITY_SCORE - readabilityScore;
      const contentLengthWeight = Math.min(text.length, 1000) / 1000;
      const rank = (readabilityWeight * 0.5) + (trafficWeight * 0.0001)
        + (contentLengthWeight * 0.1);

      return {
        pageUrl,
        scrapedAt,
        selector,
        textContent: text,
        displayText,
        fleschReadingEase: Math.round(readabilityScore * 100) / 100,
        language: detectedLanguage,
        traffic,
        rank: Math.round(rank),
        category: categorizeReadabilityIssue(readabilityScore, traffic),
        seoImpact: calculateSeoImpact(readabilityScore, traffic),
        seoRecommendation:
          'Improve readability by using shorter sentences, simpler words, and clearer structure',
      };
    }

    return null;
  } catch (error) {
    log.error(`[ReadabilityAnalysis] Error analyzing text readability: ${error.message}`);
    return null;
  }
}

/**
 * Returns an array of meaningful text elements from the provided document.
 * Selects <p>, <blockquote>, <div> and <li> elements, but excludes elements
 * that are descendants of <header> or <footer>.
 * Also filters out elements with insufficient text content length.
 *
 * @param {Cheerio} $ - The Cheerio object to search for text elements.
 * @returns {Element[]} Array of meaningful text elements for readability analysis and enhancement.
 */
const NAV_CLASS_PATTERNS = ['nav', 'menu', 'breadcrumb', 'filter', 'pagination', 'sidebar', 'promo', 'banner', 'cookie'];

const getMeaningfulElementsForReadability = ($) => {
  stripNonContent($);
  $('nav, aside, [role="navigation"], [role="complementary"]').remove();
  removeEmbeddedSocialElements($);
  return $('p, blockquote, li, div').toArray().filter((el) => {
    const normalized = normalizeReadabilityText($(el).text());
    if (normalized.length < MIN_TEXT_LENGTH) {
      return false;
    }
    if (isLikelyNavigationElement($, el)) {
      return false;
    }
    const cls = (el.attribs?.class || '').toLowerCase();
    const id = (el.attribs?.id || '').toLowerCase();
    if (NAV_CLASS_PATTERNS.some((p) => cls.includes(p) || id.includes(p))) {
      return false;
    }
    const $el = $(el);
    const linkTextLength = normalizeReadabilityText($el.find('a').text()).length;
    const totalLength = normalized.length;
    if (totalLength > 0 && linkTextLength / totalLength > MAX_LINK_DENSITY_RATIO) {
      return false;
    }
    return true;
  });
};

/**
 * Analyzes the readability of HTML page content and returns an array of readability issue objects
 * for text elements with poor readability.
 *
 * - Extracts meaningful text elements from the HTML.
 * - Detects each element's language and filters for supported languages.
 * - Handles elements containing <br> tags as multiple paragraphs.
 * - Uses `analyzeTextReadability` to evaluate readability and collect issues.
 * - Logs summary information about the analysis.
 *
 * @param {string} rawBody - Raw HTML content of the page.
 * @param {string} pageUrl - The URL of the analyzed page.
 * @param {number} traffic - Estimated traffic or popularity metric for the page.
 * @param {object} log - Logger utility (must support .debug and .error).
 * @returns {Promise<Array>} Array of readability issue objects for text elements
 *  with poor readability.
 */
export async function analyzePageContent(rawBody, pageUrl, traffic, log, scrapedAt) {
  const readabilityIssues = [];

  try {
    const $ = cheerioLoad(rawBody);

    // Get all paragraph, div, and list item element selectors (same as preflight)
    const textElements = getMeaningfulElementsForReadability($);

    const detectedLanguages = new Set();

    // Helper function to detect if text is in a supported language
    const getSupportedLanguage = (text) => {
      const detectedLanguageCode = franc(text);
      if (isSupportedLanguage(detectedLanguageCode)) {
        return getLanguageName(detectedLanguageCode);
      }
      return null;
    };

    // Filter and process elements
    const elementsToProcess = textElements
      .map((element) => ({ element }))
      .filter(({ element }) => {
        // Check if element has child elements (avoid duplicate analysis)
        const $el = $(element);
        const children = $el.children().toArray();
        const hasBlockChildren = children.length > 0
          && !children.every((child) => {
            const inlineTags = [
              'strong', 'b', 'em', 'i', 'span', 'a', 'mark',
              'small', 'sub', 'sup', 'u', 'code', 'br',
            ];
            return inlineTags.includes($(child).prop('tagName').toLowerCase());
          });

        return !hasBlockChildren;
      })
      // Exclude citation / attribution chunks before scoring; analyzeTextReadability
      // repeats isExcludedReadabilityText for defense in depth.
      .filter(({ element }) => isEligibleTextElement($(element)))
      .filter(({ element }) => !isEmbeddedSocialContentElement($, element));

    // Process each element and collect analysis promises
    const analysisPromises = [];

    elementsToProcess.forEach(({ element }) => {
      const $el = $(element);
      const textContent = normalizeReadabilityText($el.text());
      const selector = getElementSelector(element);

      // Handle elements with <br> tags (multiple paragraphs)
      if ($el.html().includes('<br')) {
        const paragraphs = $el.html()
          .split(/<br\s*\/?>/gi)
          .map((p) => {
            const tempDiv = cheerioLoad(`<div>${p}</div>`)('div');
            return tempDiv.text();
          })
          .map((p) => normalizeReadabilityText(p))
          .filter(isEligibleParagraphText);

        paragraphs.forEach((paragraph) => {
          const analysisPromise = analyzeTextReadability(
            paragraph,
            selector,
            pageUrl,
            traffic,
            detectedLanguages,
            getSupportedLanguage,
            log,
            scrapedAt,
          );
          analysisPromises.push(analysisPromise);
        });
      } else {
        const analysisPromise = analyzeTextReadability(
          textContent,
          selector,
          pageUrl,
          traffic,
          detectedLanguages,
          getSupportedLanguage,
          log,
          scrapedAt,
        );
        analysisPromises.push(analysisPromise);
      }
    });

    // Execute all analyses in parallel
    const analysisResults = await Promise.all(analysisPromises);

    // Filter out null results and add to issues
    analysisResults.forEach((result) => {
      if (result) {
        readabilityIssues.push(result);
      }
    });

    const detectedLanguagesList = detectedLanguages.size > 0
      ? Array.from(detectedLanguages).join(', ')
      : 'none detected';

    log.debug(
      `[ReadabilityAnalysis] Processed ${elementsToProcess.length} text elements on ${pageUrl}, `
      + `found ${readabilityIssues.length} with poor readability (detected languages: ${detectedLanguagesList})`,
    );
  } catch (error) {
    log.error(`[ReadabilityAnalysis] Error analyzing page content for ${pageUrl}: ${error.message}`);
  }

  return readabilityIssues;
}

/**
 * Analyzes readability for all scraped pages from S3.
 *
 * Uses scrapeResultPaths (Map of URL -> S3 path) from the scrape step context
 * to directly fetch scraped content without traversing the bucket.
 *
 * @param {AWS.S3} s3Client - The AWS S3 client instance.
 * @param {string} bucketName - The name of the S3 bucket containing scraped pages.
 * @param {Map<string, string>} scrapeResultPaths - Map of URL to S3 path from scrape step.
 * @param {Object} log - Logger instance for info, warn, and error messages.
 * @returns {Promise<Object>} The analysis result.
 */
export async function analyzePageReadability(s3Client, bucketName, scrapeResultPaths, log) {
  try {
    if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
      return {
        success: false,
        message: 'No scraped content found for readability analysis',
        readabilityIssues: [],
        urlsProcessed: 0,
      };
    }

    log.info(`[ReadabilityAnalysis] Found ${scrapeResultPaths.size} scraped objects for analysis`);

    // Process each scraped page using the paths from context
    const pageAnalysisPromises = Array.from(scrapeResultPaths.entries()).map(
      async ([url, s3Path]) => {
        try {
          const scrapedData = await getObjectFromKey(s3Client, bucketName, s3Path, log);

          if (!scrapedData?.scrapeResult?.rawBody) {
            log.warn(`[ReadabilityAnalysis] No rawBody found in scraped data for URL: ${url}`);
            return { issues: [], processed: false };
          }

          const { finalUrl, scrapeResult: { rawBody }, scrapedAt } = scrapedData;

          // Extract page traffic data if available
          const traffic = extractTrafficFromKey() || 0;

          const pageIssues = await analyzePageContent(
            rawBody,
            finalUrl || url,
            traffic,
            log,
            scrapedAt,
          );

          return {
            issues: pageIssues,
            processed: pageIssues.length > 0,
          };
        } catch (error) {
          log.error(`[ReadabilityAnalysis] Error processing scraped data for URL ${url}: ${error.message}`);
          return { issues: [], processed: false };
        }
      },
    );

    // Execute all page analyses in parallel
    const pageResults = await Promise.all(pageAnalysisPromises);

    // Collect all issues and count processed URLs
    const allReadabilityIssues = [];
    let urlsProcessed = 0;

    pageResults.forEach((result) => {
      allReadabilityIssues.push(...result.issues);
      if (result.processed) {
        urlsProcessed += 1;
      }
    });

    // Sort issues by priority (rank descending)
    allReadabilityIssues.sort((a, b) => b.rank - a.rank);

    // Limit to top 50 issues to avoid overwhelming users
    const limitedIssues = allReadabilityIssues.slice(0, 50);

    log.info(`[ReadabilityAnalysis] Found ${limitedIssues.length} readability issues across ${urlsProcessed} pages`);

    return {
      success: limitedIssues.length > 0,
      message: limitedIssues.length > 0
        ? `Found ${limitedIssues.length} readability issues`
        : 'No readability issues found',
      readabilityIssues: limitedIssues,
      urlsProcessed,
    };
  } catch (error) {
    log.error(`[ReadabilityAnalysis] Error analyzing readability: ${error.message}`, error);
    return {
      success: false,
      message: `Analysis failed: ${error.message}`,
      readabilityIssues: [],
      urlsProcessed: 0,
    };
  }
}

// Re-export the async-mystique function for consistency
export { sendReadabilityToMystique } from './async-mystique.js';
