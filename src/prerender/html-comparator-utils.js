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

// TEMPORARY: Use the shared package's selectors
const NAVIGATION_FOOTER_SELECTOR = [
  // Core semantic elements (fastest, most reliable)
  'nav', 'header', 'footer',
  // Common navigation/menu classes
  '.nav', '.navigation', '.navbar', '.nav-bar', '.menu', '.main-menu',
  '.navigation-wrapper', '.nav-wrapper', '.site-navigation',
  '.primary-navigation', '.secondary-navigation', '.top-nav', '.bottom-nav', '.sidebar-nav',
  // Header/footer classes
  '.header', '.site-header', '.page-header', '.top-header', '.header-wrapper',
  '.footer', '.site-footer', '.page-footer', '.bottom-footer', '.footer-wrapper',
  // Breadcrumb navigation
  '.breadcrumb', '.breadcrumbs',
  // Common ID selectors
  '#nav', '#navigation', '#navbar', '#header', '#footer', '#menu', '#main-menu',
  '#site-header', '#site-footer', '#page-header', '#page-footer',
  // ARIA roles (W3C semantic roles)
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
].join(', ');

// Optimized cookie detection keywords - ordered by frequency for early exit
const COOKIE_KEYWORDS = new Set([
  // Most common (90%+ coverage)
  'cookie', 'cookies', 'privacy', 'consent',
  // High frequency (80%+ coverage)
  'accept', 'reject', 'tracking', 'analytics',
  // Medium frequency (60%+ coverage)
  'marketing', 'advertising', 'personalization',
  // Less common but specific
  'data protection', 'privacy policy', 'cookie settings',
  'accept all', 'reject all', 'manage preferences',
]);

const COOKIE_BANNER_CLASS_SELECTORS = [
  '.cc-banner', '.cc-grower', '.consent-banner', '.cookie-banner',
  '.privacy-banner', '.gdpr-banner', '.cookie-consent', '.privacy-consent',
  '.cookie-notice', '.privacy-notice', '.cookie-policy', '.privacy-policy',
  '.cookie-bar', '.privacy-bar', '.consent-bar', '.gdpr-bar',
  '.cookie-popup', '.privacy-popup', '.consent-popup', '.gdpr-popup',
  '.cookie-modal', '.privacy-modal', '.consent-modal', '.gdpr-modal',
  '.cookie-overlay', '.privacy-overlay', '.consent-overlay', '.gdpr-overlay',
  '[class*="syrenis-cookie"]',
];

const COOKIE_BANNER_ID_SELECTORS = [
  '#cookie-banner', '#privacy-banner', '#consent-banner', '#gdpr-banner',
  '#cookie-notice', '#privacy-notice', '#cookie-consent', '#privacy-consent',
  '#cookie-bar', '#privacy-bar', '#consent-bar', '#gdpr-bar', '#cookiemgmt',
  '#cookie-popup', '#privacy-popup', '#consent-popup', '#gdpr-popup',
  '#onetrust-consent-sdk', '#onetrust-banner-sdk',
];

const COOKIE_BANNER_ARIA_SELECTORS = [
  '[role="dialog"][aria-label="Consent Banner"]',
  '[role="dialog"][aria-label*="cookie" i]',
  '[role="dialog"][aria-label*="privacy" i]',
  '[role="dialog"][aria-label*="consent" i]',
  '[role="alertdialog"][aria-label*="cookie" i]',
  '[role="alertdialog"][aria-label*="privacy" i]',
  '[aria-describedby*="cookie" i]',
  '[aria-describedby*="privacy" i]',
];

// TEMPORARY: Use the shared package's selectors
function getHtmlFilterSelectors() {
  return {
    selectors: [
      ...NAVIGATION_FOOTER_SELECTOR,
      ...COOKIE_BANNER_CLASS_SELECTORS,
      ...COOKIE_BANNER_ID_SELECTORS,
      ...COOKIE_BANNER_ARIA_SELECTORS,
    ],
    cookieKeywords: Array.from(COOKIE_KEYWORDS),
  };
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

  const stats = await calculateStats(directHtml, scrapedHtml, true);
  const needsPrerender = typeof stats.contentIncreaseRatio === 'number' && stats.contentIncreaseRatio >= threshold;

  return {
    needsPrerender,
    contentGainRatio: stats.contentIncreaseRatio,
    wordCountBefore: stats.wordCountBefore,
    wordCountAfter: stats.wordCountAfter,
  };
}

export {
  analyzeHtmlForPrerender,
  // TEMPORARY: Use the shared package's selectors
  getHtmlFilterSelectors,
};
