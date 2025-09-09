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

export const CANONICAL_CHECKS = Object.freeze({
  CANONICAL_TAG_MISSING: {
    check: 'canonical-tag-missing',
    explanation: 'The canonical tag is missing, which can lead to duplicate content issues and negatively affect SEO rankings.',
    suggestion: (url) => `Add a canonical tag to the head section: <link rel="canonical" href="${url}" />`,
  },
  CANONICAL_TAG_MULTIPLE: {
    check: 'canonical-tag-multiple',
    explanation: 'Multiple canonical tags detected, which confuses search engines and can dilute page authority.',
    suggestion: () => 'Remove duplicate canonical tags and keep only one canonical tag in the head section.',
  },
  CANONICAL_TAG_EMPTY: {
    check: 'canonical-tag-empty',
    explanation: 'The canonical tag is empty. It should point to the preferred version of the page to avoid content duplication.',
    suggestion: (url) => `Set the canonical URL in the href attribute: <link rel="canonical" href="${url}" />`,
  },
  CANONICAL_TAG_OUTSIDE_HEAD: {
    check: 'canonical-tag-outside-head',
    explanation: 'The canonical tag must be placed in the head section of the HTML document to ensure it is recognized by search engines.',
    suggestion: () => 'Move the canonical tag to the <head> section of the HTML document.',
  },
  CANONICAL_URL_STATUS_OK: {
    check: 'canonical-url-status-ok',
    explanation: 'The canonical URL should return a 200 status code to ensure it is accessible and indexable by search engines.',
    suggestion: () => 'Ensure the canonical URL returns a 200 status code and is accessible.',
  },
  CANONICAL_URL_NO_REDIRECT: {
    check: 'canonical-url-no-redirect',
    explanation: 'The canonical URL should be a direct link without redirects to ensure search engines recognize the intended page.',
    suggestion: () => 'Update the canonical URL to point directly to the final destination without redirects.',
  },
  CANONICAL_URL_4XX: {
    check: 'canonical-url-4xx',
    explanation: 'The canonical URL returns a 4xx error, indicating it is inaccessible, which can harm SEO visibility.',
    suggestion: () => 'Update the canonical tag to reference a valid, accessible URL.',
  },
  CANONICAL_URL_5XX: {
    check: 'canonical-url-5xx',
    explanation: 'The canonical URL returns a 5xx server error, indicating it is temporarily or permanently unavailable, affecting SEO performance.',
    suggestion: () => 'Update the canonical tag to reference a valid, accessible URL.',
  },
  CANONICAL_SELF_REFERENCED: {
    check: 'canonical-self-referenced',
    explanation: 'The canonical URL should point to itself to indicate that it is the preferred version of the content.',
    suggestion: (url) => `Update the canonical URL to point to itself: <link rel="canonical" href="${url}" />`,
  },
  CANONICAL_URL_ABSOLUTE: {
    check: 'canonical-url-absolute',
    explanation: 'Canonical URLs must be absolute to avoid ambiguity in URL resolution and ensure proper indexing by search engines.',
    suggestion: (url) => `Use an absolute URL for the canonical tag: <link rel="canonical" href="${url}" />`,
  },
  CANONICAL_URL_SAME_DOMAIN: {
    check: 'canonical-url-same-domain',
    explanation: 'The canonical URL should match the domain of the page to avoid signaling to search engines that the content is duplicated elsewhere.',
    suggestion: (url) => `Update the canonical URL to use the same domain as the page: <link rel="canonical" href="${url}" />`,
  },
  CANONICAL_URL_SAME_PROTOCOL: {
    check: 'canonical-url-same-protocol',
    explanation: 'The canonical URL must use the same protocol (HTTP or HTTPS) as the page to maintain consistency and avoid indexing issues.',
    suggestion: (url) => `Update the canonical URL to use the same protocol: <link rel="canonical" href="${url}" />`,
  },
  CANONICAL_URL_LOWERCASED: {
    check: 'canonical-url-lowercased',
    explanation: 'Canonical URLs should be in lowercase to prevent duplicate content issues since URLs are case-sensitive.',
    suggestion: (url) => `Update canonical URL to use lowercase: <link rel="canonical" href="${url.toLowerCase()}" />`,
  },
  CANONICAL_URL_FETCH_ERROR: {
    check: 'canonical-url-fetch-error',
    explanation: 'There was an error fetching the canonical URL, which prevents validation of the canonical tag.',
    suggestion: () => 'Check if the canonical URL is accessible and fix any connectivity issues.',
  },
  CANONICAL_URL_INVALID: {
    check: 'canonical-url-invalid',
    explanation: 'The canonical URL is malformed or invalid.',
    suggestion: (url) => `Fix the malformed canonical URL and ensure it follows proper URL format: <link rel="canonical" href="${url}" />`,
  },
  TOPPAGES: {
    check: 'top-pages',
    explanation: 'No top pages found',
  },
  UNEXPECTED_STATUS_CODE: {
    check: 'unexpected-status-code',
    explanation: 'The response returned an unexpected status code, indicating an unforeseen issue with the canonical URL.',
  },
});
