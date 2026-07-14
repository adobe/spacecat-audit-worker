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

import { load as cheerioLoad } from 'cheerio';
import { calculateStats } from '@adobe/spacecat-shared-html-analyzer';

const FONT_DETECTION_TEST_STRING = 'mmMwWLliI0fiflO';
const FONT_DETECTION_WORD_MIN_REPS = 10;

/**
 * Returns true if the text is entirely composed of font-detection noise injected by
 * FontFaceObserver / Next.js @next/font: either the font-metrics test string
 * (startsWith to cover &N suffix variants) or exclusively repeated "word" tokens.
 * Puppeteer captures these elements before the library removes them; direct-fetch HTML
 * is unaffected. Filtering them prevents inflated word counts that falsely signal
 * a prerender need.
 * @param {string} text
 * @returns {boolean}
 */
export function isFontDetectionLeaf(text) {
  if (!text) {
    return false;
  }
  if (text.startsWith(FONT_DETECTION_TEST_STRING)) {
    return true;
  }
  const tokens = text.trim().split(/\s+/);
  return tokens.length >= FONT_DETECTION_WORD_MIN_REPS && tokens.every((t) => t === 'word');
}

function removeFontDetectionNoise(html) {
  const $ = cheerioLoad(html);
  $('*').each((i, el) => {
    const $el = $(el);
    if ($el.children().length > 0) {
      return;
    }
    if (isFontDetectionLeaf($el.text().trim())) {
      $el.remove();
    }
  });
  return $.html();
}

/**
 * Analyzes HTML content to determine if prerendering is needed
 * @param {string} directHtml - Direct fetch HTML (server-side rendered)
 * @param {string} scrapedHtml - Scraped HTML (client-side rendered)
 * @param {number} threshold - Content increase threshold (default: 1.2)
 * @returns {Object} - Analysis result with needsPrerender, stats, and recommendation
 * @throws {Error} If HTML content is missing or analysis fails
 */
async function analyzeHtmlForPrerender(directHtml, scrapedHtml, threshold = 1.2) {
  if (!directHtml || !scrapedHtml) {
    throw new Error('Missing HTML content for comparison');
  }

  const stats = await calculateStats(directHtml, removeFontDetectionNoise(scrapedHtml), true);
  const needsPrerender = typeof stats.contentIncreaseRatio === 'number' && stats.contentIncreaseRatio >= threshold;

  return {
    needsPrerender,
    contentGainRatio: stats.contentIncreaseRatio,
    wordCountBefore: stats.wordCountBefore,
    wordCountAfter: stats.wordCountAfter,
    // Citability metrics from the same calculateStats call (avoids a second invocation)
    citabilityScore: stats.citationReadability,
    wordDifference: stats.wordDiff,
  };
}

export {
  analyzeHtmlForPrerender,
};
