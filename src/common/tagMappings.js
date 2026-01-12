/*
 * Copyright 2026 Adobe. All rights reserved.
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
 * Opportunity tag mappings for different opportunity types
 * These tags are standardized and will override any tags set in opportunity-data-mapper files
 * (except for 'isElmo' and 'isASO' tags which are preserved)
 */
export const OPPORTUNITY_TAG_MAPPINGS = {
  // Web Performance
  cwv: ['Core Web Vitals', 'Web Performance'],

  // Traffic Acquisition - SEO
  'meta-tags': ['Meta Tags', 'SEO'],
  'product-metatags': ['Product Meta Tags', 'SEO'],
  'broken-backlinks': ['Backlinks', 'SEO'],
  'broken-internal-links': ['Broken Internal Links', 'SEO'],
  sitemap: ['Sitemap', 'SEO'],
  canonical: ['Canonical URLs', 'SEO'],
  hreflang: ['Hreflang', 'SEO'],
  'structured-data': ['Structured Data', 'SEO'],
  'missing-structured-data': ['Missing Structured Data', 'SEO'],
  'redirect-chains': ['Redirect Chains', 'SEO'],
  headings: ['Headings', 'SEO', 'Engagement'],
  prerender: ['Prerender', 'SEO'],

  // Traffic Acquisition - Paid Media
  'consent-banner': ['Consent Banner', 'Engagement'],
  'paid-traffic': ['Paid Traffic', 'Engagement'],

  // Compliance & Accessibility
  'a11y-assistive': ['ARIA Labels', 'Accessibility'],
  'a11y-color-contrast': ['Color Contrast', 'Accessibility', 'Engagement'],
  readability: ['Readability', 'Accessibility', 'Engagement'],
  'alt-text': ['Alt-Text', 'Accessibility', 'SEO'],
  'form-accessibility': ['Form Accessibility', 'Accessibility', 'Engagement'],

  // Engagement & Conversion
  'high-organic-low-ctr': ['Low CTR', 'Engagement'],
  'high-page-views-low-form-views': ['Form Visibility', 'Engagement'],
  'high-page-views-low-form-nav': ['Form Placement', 'Engagement'],
  'high-form-views-low-conversions': ['Form Conversion', 'Conversion'],

  // Security
  'security-vulnerabilities': ['Security Vulnerabilities', 'Security'],
  'security-permissions': ['Permission Settings', 'Security'],
  'security-permissions-redundant': ['Permission Settings', 'Security'],
  'security-xss': ['Cross Site Scripting', 'Security'],
  'security-csp': ['Content Security Policy', 'Security'],

  // AI & Content
  'llm-blocked': ['LLM Blocked', 'AI'],
  summarization: ['Summarization', 'AI', 'Content'],
  faq: ['FAQ', 'AI', 'Content'],
  toc: ['Table of Contents', 'Content', 'Engagement'],

  // Generic
  'generic-opportunity': ['Generic', 'Opportunity'],
  'generic-autofix-edge': ['Generic Autofix', 'Automation'],
};

/**
 * Gets the hardcoded tags for a specific opportunity type
 * @param {string} opportunityType - The type of opportunity
 * @returns {string[]} Array of tags for the opportunity type
 */
export const getTagsForOpportunityType = (opportunityType) => (
  OPPORTUNITY_TAG_MAPPINGS[opportunityType] || []
);

/**
 * Applies hardcoded tags for an opportunity type, preserving only 'isElmo' and 'isASO' tags.
 * @param {string} opportunityType - The type of opportunity
 * @param {string[]} currentTags - Current tags from the opportunity
 * @returns {string[]} Array with hardcoded tags plus preserved 'isElmo'/'isASO' tags
 */
export const mergeTagsWithHardcodedTags = (opportunityType, currentTags = []) => {
  // Normalize currentTags to handle null/undefined
  const normalizedTags = currentTags || [];

  // Skip Generic Opportunity - tags come from API
  if (opportunityType === 'generic-opportunity') {
    return normalizedTags;
  }

  const hardcodedTags = getTagsForOpportunityType(opportunityType);
  if (hardcodedTags.length === 0) {
    return normalizedTags;
  }

  // Preserve 'isElmo' and 'isASO' tags from existing tags, ignore all others
  const preservedTags = normalizedTags.filter((tag) => tag === 'isElmo' || tag === 'isASO');

  // Start with hardcoded tags, then add preserved tags if not already present
  const mergedTags = [...hardcodedTags];
  preservedTags.forEach((tag) => {
    if (!mergedTags.includes(tag)) {
      mergedTags.push(tag);
    }
  });

  return mergedTags;
};
