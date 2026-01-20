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
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { load as cheerioLoad } from 'cheerio';
import SeoChecks from '../metatags/seo-checks.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../utils/s3-utils.js';
import {
  getHeadingLevel,
  getHeadingContext,
  getScrapeJsonPath,
} from './utils.js';

/**
 * Safely extract text content from an element
 * @param {Element} element - The DOM element
 * @param {CheerioAPI} $ - The cheerio instance
 * @returns {string} - The trimmed text content, or empty string if null/undefined
 */
export function getTextContent(element, $) {
  if (!element || !$) return '';
  return $(element).text().trim();
}

/**
 * Generate a unique CSS selector for a heading element.
 * Uses a progressive specificity strategy:
 * 1. Start with tag name
 * 2. Add ID if available (most specific - stop here)
 * 3. Add classes if available
 * 4. Add :nth-of-type() if multiple siblings exist
 * 5. Walk up parent tree (max 3 levels) for context
 *
 * @param {Element} heading - The heading element to generate selector for
 * @returns {string} A CSS selector string that uniquely identifies the element
 */
export function getHeadingSelector(heading) {
  // Works with cheerio elements only
  if (!heading || !heading.name) {
    return null;
  }

  const { name, attribs, parent } = heading;
  const tag = name.toLowerCase();
  let selectors = [tag];

  // 1. Check for ID (most specific - return immediately)
  const id = attribs?.id;
  if (id) {
    return `${tag}#${id}`;
  }

  // 2. Add classes if available
  const className = attribs?.class;
  if (className && typeof className === 'string') {
    const classes = className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      const classSelector = classes.slice(0, 2).join('.');
      selectors = [`${tag}.${classSelector}`];
    }
  }

  // 3. Add nth-of-type if multiple siblings of same tag exist
  if (parent && parent.children) {
    const siblingsOfSameTag = parent.children.filter(
      (child) => child.type === 'tag' && child.name === name,
    );

    if (siblingsOfSameTag.length > 1) {
      const index = siblingsOfSameTag.indexOf(heading) + 1;
      selectors.push(`:nth-of-type(${index})`);
    }
  }

  const selector = selectors.join('');

  // 4. Build path with parent selectors for more specificity (max 3 levels)
  const pathParts = [selector];
  let current = parent;
  let levels = 0;

  while (current && current.name && current.name.toLowerCase() !== 'html' && levels < 3) {
    let parentSelector = current.name.toLowerCase();

    // If parent has ID, use it and stop (ID is unique enough)
    const parentId = current.attribs?.id;
    if (parentId) {
      pathParts.unshift(`#${parentId}`);
      break;
    }

    // Add parent classes (limit to first 2 for readability)
    const parentClassName = current.attribs?.class;
    if (parentClassName && typeof parentClassName === 'string') {
      const classes = parentClassName.trim().split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        const classSelector = classes.slice(0, 2).join('.');
        parentSelector = `${parentSelector}.${classSelector}`;
      }
    }

    pathParts.unshift(parentSelector);
    current = current.parent;
    levels += 1;
  }

  // 5. Join with '>' (direct child combinator)
  return pathParts.join(' > ');
}

/**
 * Load and parse scrape JSON from S3
 * @param {string} url - The page URL
 * @param {Object} site - Site object
 * @param {Array} allKeys - All S3 keys
 * @param {Object} s3Client - S3 client
 * @param {string} S3_SCRAPER_BUCKET_NAME - S3 bucket name
 * @param {Object} log - Logger instance
 * @returns {Promise<Object|null>} Scrape JSON object or null
 */
export async function loadScrapeJson(url, site, allKeys, s3Client, S3_SCRAPER_BUCKET_NAME, log) {
  const scrapeJsonPath = getScrapeJsonPath(url, site.getId());
  const s3Key = allKeys.find((key) => key.includes(scrapeJsonPath));

  if (!s3Key) {
    log.error(`Scrape JSON path not found for ${url}`);
    return null;
  }

  return getObjectFromKey(s3Client, S3_SCRAPER_BUCKET_NAME, s3Key, log);
}

/**
 * Extract brand guidelines from brand profile
 * @param {Object} brandProfile - Brand profile from site config
 * @returns {Object} Formatted brand guidelines
 */
function extractBrandGuidelinesFromProfile(brandProfile) {
  const mainProfile = brandProfile.main_profile || {};
  // Extract brand persona (short description)
  const brandPersona = mainProfile.brand_personality?.description || '';

  // Extract tone
  const toneAttributes = mainProfile.tone_attributes || {};
  const primaryTones = toneAttributes.primary || [];
  const tone = primaryTones.join(', ');

  // Extract editorial guidelines
  const editorialGuidelines = mainProfile.editorial_guidelines || {};
  const dos = editorialGuidelines.dos || [];
  const donts = editorialGuidelines.donts || [];

  // Extract forbidden items
  const languagePatterns = mainProfile.language_patterns || {};
  const avoidPatterns = languagePatterns.avoid || [];
  const avoidTones = toneAttributes.avoid || [];
  const forbidden = [...avoidPatterns, ...avoidTones];

  return {
    brand_persona: brandPersona,
    tone,
    editorial_guidelines: {
      do: dos,
      dont: donts,
    },
    forbidden,
  };
}

/**
 * Get brand guidelines from site config or generate from healthy tags using AI
 * @param {Object} healthyTagsObject - Object with healthy title, description, h1
 * @param {Object} log - Logger instance
 * @param {Object} context - Audit context
 * @param {Object} site - Site object (optional, for accessing brand profile)
 * @returns {Promise<Object>} Brand guidelines
 */
export async function getBrandGuidelines(healthyTagsObject, log, context, site = null) {
  // First, try to get brand profile from site config
  if (site) {
    try {
      const config = site.getConfig();
      const brandProfile = config?.getBrandProfile?.();
      if (brandProfile && typeof brandProfile === 'object' && Object.keys(brandProfile).length > 0) {
        log.info('[Brand Guidelines] Using brand profile from site config');
        const guidelines = extractBrandGuidelinesFromProfile(brandProfile);
        log.debug(`[Brand Guidelines] Extracted guidelines: ${JSON.stringify(guidelines)}`);
        return guidelines;
      }
    } catch (error) {
      log.warn(`[Brand Guidelines] Error accessing brand profile from site config: ${error.message}`);
    }
  }

  // Fall back to AI-generated guidelines
  log.info('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
  const azureOpenAIClient = AzureOpenAIClient.createFrom(context);
  const prompt = await getPrompt(
    {
      titles: healthyTagsObject.title,
      descriptions: healthyTagsObject.description,
      h1s: healthyTagsObject.h1,
    },
    'generate-brand-guidelines',
    log,
  );
  const aiResponse = await azureOpenAIClient.fetchChatCompletion(prompt, {
    responseFormat: 'json_object',
  });
  const aiResponseContent = JSON.parse(aiResponse.choices[0].message.content);
  return aiResponseContent;
}

/**
 * Get top pages for a site with validation
 * @param {Object} dataAccess - Data access object
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context
 * @param {Object} log - Logger instance
 * @param {number} limit - Maximum number of pages to return
 * @returns {Promise<Array>} Array of top pages
 */
export async function getTopPages(dataAccess, siteId, context, log, limit = 200) {
  log.debug(`Fetching top pages for site: ${siteId}`);
  const allTopPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
  const topPages = allTopPages.slice(0, limit);

  log.debug(`Processing ${topPages.length} top pages (limited to ${limit})`);
  if (topPages.length > 0) {
    log.debug(`Top pages sample: ${topPages.slice(0, 3).map((p) => p.url).join(', ')}`);
  }

  return topPages;
}

/**
 * Initialize context for headings/TOC audit
 * @param {Object} context - Audit context
 * @param {Object} site - Site object
 * @returns {Promise<Object>} Initialized context with s3Keys and seoChecks
 */
export async function initializeAuditContext(context, site) {
  const { log, s3Client } = context;
  const { S3_SCRAPER_BUCKET_NAME } = context.env;
  const siteId = site.getId();

  const prefix = `scrapes/${siteId}/`;
  const allKeys = await getObjectKeysUsingPrefix(s3Client, S3_SCRAPER_BUCKET_NAME, prefix, log);
  const seoChecks = new SeoChecks(log);

  return { allKeys, seoChecks };
}

export {
  getHeadingLevel,
  getHeadingContext,
  cheerioLoad,
};
