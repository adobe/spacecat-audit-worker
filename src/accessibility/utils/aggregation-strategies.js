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
 * Accessibility suggestion aggregation strategies
 *
 * Defines how HTML elements with accessibility issues are grouped into database suggestions.
 * Each granularity level has a function that builds an aggregation key from suggestion data.
 */

/**
 * Granularity levels for suggestion aggregation
 * @enum {string}
 */
export const Granularity = {
  /** One suggestion per HTML element - url|type|selector (e.g., page1|color-contrast|div.header) */
  INDIVIDUAL: 'INDIVIDUAL',

  /**
   * One suggestion per issue type per page - url|type (e.g., page1|color-contrast)
   */
  PER_PAGE_PER_COMPONENT: 'PER_PAGE_PER_COMPONENT',

  /** One suggestion per page - url (e.g., page1) */
  PER_PAGE: 'PER_PAGE',

  /**
   * One suggestion per component type across all pages - type|selector
   */
  PER_COMPONENT: 'PER_COMPONENT',

  /** One suggestion per issue type globally - type (e.g., color-contrast) */
  PER_TYPE: 'PER_TYPE',
};

/**
 * Generic key builder that concatenates non-empty values with pipe separator
 * @param {...string} parts - Variable number of key parts to concatenate
 * @returns {string} Concatenated key
 */
function buildKey(...parts) {
  return parts.filter((part) => part != null && part !== '').join('|');
}

/**
 * Builds aggregation key for INDIVIDUAL granularity
 * Key format: url|type|selector|source
 */
function buildIndividualKey({
  url, issueType, targetSelector, source,
}) {
  return buildKey(url, issueType, targetSelector, source);
}

/**
 * Builds aggregation key for PER_PAGE_PER_COMPONENT granularity
 * Key format: url|type|source
 */
function buildPerPagePerComponentKey({ url, issueType, source }) {
  return buildKey(url, issueType, source);
}

/**
 * Builds aggregation key for PER_PAGE granularity
 * Key format: url|source
 */
function buildPerPageKey({ url, source }) {
  return buildKey(url, source);
}

/**
 * Builds aggregation key for COMPONENT granularity
 * Key format: type|selector
 */
function buildComponentKey({ issueType, targetSelector }) {
  return buildKey(issueType, targetSelector);
}

/**
 * Builds aggregation key for GLOBAL granularity
 * Key format: type
 */
function buildGlobalKey({ issueType }) {
  return buildKey(issueType);
}

/**
 * Registry of key-building functions by granularity level
 */
export const GRANULARITY_KEY_BUILDERS = {
  [Granularity.INDIVIDUAL]: buildIndividualKey,
  [Granularity.PER_PAGE_PER_COMPONENT]: buildPerPagePerComponentKey,
  [Granularity.PER_PAGE]: buildPerPageKey,
  [Granularity.PER_COMPONENT]: buildComponentKey,
  [Granularity.PER_TYPE]: buildGlobalKey,
};

/**
 * Maps issue types to their aggregation granularity
 * Based on the nature of each issue and how they should be grouped
 */
export const ISSUE_GRANULARITY_MAP = {
  'color-contrast': Granularity.INDIVIDUAL,
  list: Granularity.PER_COMPONENT,
  'aria-roles': Granularity.PER_PAGE_PER_COMPONENT,
  'image-alt': Granularity.PER_PAGE_PER_COMPONENT,
  'link-in-text-block': Granularity.PER_PAGE_PER_COMPONENT,
  'link-name': Granularity.PER_PAGE_PER_COMPONENT,
  'target-size': Granularity.PER_PAGE_PER_COMPONENT,
  listitem: Granularity.PER_COMPONENT,
  label: Granularity.PER_PAGE_PER_COMPONENT,
  'aria-prohibited-attr': Granularity.PER_TYPE,
  'button-name': Granularity.PER_PAGE_PER_COMPONENT,
  'frame-title': Granularity.PER_PAGE_PER_COMPONENT,
  'aria-valid-attr-value': Granularity.PER_PAGE_PER_COMPONENT,
  'aria-allowed-attr': Granularity.PER_TYPE,
  'aria-hidden-focus': Granularity.PER_PAGE_PER_COMPONENT,
  'nested-interactive': Granularity.PER_PAGE_PER_COMPONENT,
  'html-has-lang': Granularity.PER_PAGE,
  'meta-viewport': Granularity.PER_PAGE,
  'aria-required-children': Granularity.PER_PAGE_PER_COMPONENT,
  'aria-required-parent': Granularity.PER_PAGE_PER_COMPONENT,
  'meta-refresh': Granularity.PER_PAGE,
  'role-img-alt': Granularity.PER_PAGE_PER_COMPONENT,
  'aria-input-field-name': Granularity.PER_PAGE_PER_COMPONENT,
  'scrollable-region-focusable': Granularity.PER_PAGE_PER_COMPONENT,
  'select-name': Granularity.PER_PAGE_PER_COMPONENT,
};

/**
 * Gets the granularity level for a specific issue type
 *
 * @param {string} issueType - The issue type (e.g., "color-contrast")
 * @returns {string} The granularity level (defaults to PER_PAGE_PER_COMPONENT)
 */
export function getGranularityForIssueType(issueType) {
  return ISSUE_GRANULARITY_MAP[issueType] || Granularity.PER_PAGE_PER_COMPONENT;
}

/**
 * Builds an aggregation key for grouping HTML elements during processing
 *
 * @param {string} issueType - The issue type
 * @param {string} url - Page URL
 * @param {string} targetSelector - CSS selector for the element
 * @param {string} source - Optional source identifier
 * @returns {string} The aggregation key based on the issue type's granularity
 */
export function buildAggregationKey(issueType, url, targetSelector, source) {
  const granularity = getGranularityForIssueType(issueType);
  const keyBuilder = GRANULARITY_KEY_BUILDERS[granularity];

  if (!keyBuilder) {
    // Fallback to INDIVIDUAL if builder not found
    return buildIndividualKey({
      url, issueType, targetSelector, source,
    });
  }

  return keyBuilder({
    url, issueType, targetSelector, source,
  });
}

/**
 * Builds a database-level key for matching suggestions across audit runs.
 * Used by syncSuggestions to identify existing suggestions.
 *
 * This ALWAYS uses INDIVIDUAL granularity (url|type|selector|source) to ensure
 * each HTML element gets its own suggestion in the database. This prevents
 * incorrect merging of different HTML elements.
 *
 * IMPORTANT: This maintains backwards compatibility with the original buildKey logic
 * by including a trailing pipe when selector is empty (url|type|).
 *
 * @param {Object} suggestionData - The suggestion data object
 * @param {string} suggestionData.url - Page URL
 * @param {Array} suggestionData.issues - Array of issues
 * @param {string} suggestionData.source - Optional source
 * @returns {string} The key for suggestion matching
 */
export function buildSuggestionKey(suggestionData) {
  const { url, issues, source } = suggestionData;

  if (!issues || issues.length === 0) {
    return url;
  }

  const firstIssue = issues[0];
  const issueType = firstIssue.type;
  const targetSelector = firstIssue.htmlWithIssues?.[0]?.target_selector || '';

  // Always build INDIVIDUAL-level key for database uniqueness
  // Backwards compatible: url|type|selector|source or url|type| when selector is empty
  let key = `${url}|${issueType}|${targetSelector}`;
  if (source) {
    key += `|${source}`;
  }
  return key;
}
