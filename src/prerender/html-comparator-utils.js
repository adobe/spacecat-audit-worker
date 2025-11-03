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

import { calculateStats } from '@adobe/spacecat-shared-html-analyzer';

/**
 * Analyzes HTML content to determine if prerendering is needed
 * @param {string} directHtml - Direct fetch HTML (server-side rendered)
 * @param {string} scrapedHtml - Scraped HTML (client-side rendered)
 * @param {number} threshold - Content increase threshold (default: 1.2)
 * @returns {Object} - Analysis result with needsPrerender, stats, and recommendation
 */
async function analyzeHtmlForPrerender(directHtml, scrapedHtml, threshold = 1.2) {
  if (!directHtml || !scrapedHtml) {
    return {
      error: 'Missing HTML content for comparison',
      needsPrerender: false,
    };
  }

  try {
    const stats = await calculateStats(directHtml, scrapedHtml, true);
    const needsPrerender = typeof stats.contentIncreaseRatio === 'number' && stats.contentIncreaseRatio >= threshold;

    return {
      needsPrerender,
      contentGainRatio: stats.contentIncreaseRatio,
      wordCountBefore: stats.wordCountBefore,
      wordCountAfter: stats.wordCountAfter,
    };
  } catch (error) {
    return {
      error: `HTML analysis failed: ${error.message}`,
      needsPrerender: false,
    };
  }
}

export {
  analyzeHtmlForPrerender,
};
