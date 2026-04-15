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

/**
 * Subtrees that are typically third-party social feeds or embeds (not site-authored body
 * copy). Matched nodes are removed from the Cheerio document before readability extraction.
 */
const EMBEDDED_SOCIAL_REMOVE_SELECTORS = [
  '.cards-carousel-rrss',
  '[data-social-media-size]',
  'blockquote.instagram-media',
  'blockquote.twitter-tweet',
  'blockquote.tiktok-embed',
  '[class*="wp-block-embed-instagram"]',
  '[class*="wp-block-embed-twitter"]',
  '[class*="jetpack-instagram"]',
  'iframe[src*="instagram.com"]',
  'iframe[src*="facebook.com/plugins"]',
  'iframe[src*="platform.twitter.com"]',
  'iframe[src*="twitter.com/i/web"]',
  'iframe[src*="tiktok.com/embed"]',
  'iframe[src*="linkedin.com/embed"]',
  '[class*="elfsight"]',
  '[id*="elfsight"]',
  '[class*="sb_instagram"]',
  '[id*="sb_instagram"]',
  '[class*="sbi_item"]',
  '[class*="cff-wrapper"]',
  '[class*="smashballoon"]',
].join(', ');

/**
 * Ancestor roots used to skip elements when removal did not run or markup is fragmented.
 */
const EMBEDDED_SOCIAL_ANCESTOR_SELECTORS = [
  '.cards-carousel-rrss',
  'blockquote.instagram-media',
  'blockquote.twitter-tweet',
  'blockquote.tiktok-embed',
  '[class*="wp-block-embed-instagram"]',
  '[class*="wp-block-embed-twitter"]',
  '[class*="elfsight"]',
  '[id*="elfsight"]',
  '[class*="sb_instagram"]',
  '[id*="sb_instagram"]',
  '[class*="sbi_item"]',
  '[class*="cff-wrapper"]',
  '[class*="smashballoon"]',
].join(', ');

const VIEW_ON_PLATFORM_SUBSTRINGS = [
  'view on instagram',
  'view post on instagram',
  'ver en instagram',
  'voir sur instagram',
  'view on facebook',
  'ver en facebook',
  'voir sur facebook',
  'view on tiktok',
  'view on threads',
  'view on linkedin',
  'view on twitter',
  'view post on twitter',
  'view on x',
];

const SOCIAL_OUTBOUND_LINK_SELECTOR = [
  'a[href*="instagram.com"]',
  'a[href*="facebook.com"]',
  'a[href*="fb.com"]',
  'a[href*="twitter.com"]',
  'a[href*="tiktok.com"]',
  'a[href*="threads.net"]',
  'a[href*="linkedin.com/posts"]',
  'a[href*="linkedin.com/feed"]',
].join(',');

/**
 * Removes known embedded social / feed regions from a Cheerio document (mutates the tree).
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio root
 */
export function removeEmbeddedSocialHosts($) {
  $(EMBEDDED_SOCIAL_REMOVE_SELECTORS).remove();
}

/**
 * True when the element lives inside a known embed subtree, or matches the common
 * "View on …" social CTA pattern next to outbound platform links.
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio root
 * @param {import('cheerio').Element} element - DOM element candidate
 * @returns {boolean}
 */
export function isEmbeddedSocialContentElement($, element) {
  const $el = $(element);
  if ($el.closest(EMBEDDED_SOCIAL_ANCESTOR_SELECTORS).length > 0) {
    return true;
  }
  const text = $el.text().toLowerCase();
  const matchesViewCta = VIEW_ON_PLATFORM_SUBSTRINGS.some((s) => text.includes(s));
  if (!matchesViewCta) {
    return false;
  }
  return $el.find(SOCIAL_OUTBOUND_LINK_SELECTOR).length > 0;
}
