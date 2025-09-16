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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { JSDOM } from 'jsdom';
import { AuditBuilder } from '../common/audit-builder.js';

/**
 * Extracts data from HTML meta tags
 * @param {string} html - HTML content
 * @returns {Object} Extracted data
 */
function extractFromMetaTags(html) {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  let sku = null;
  let thumbnailUrl = null;

  // Extract SKU from meta tag
  const skuMeta = document.querySelector('meta[name="sku"]');
  if (skuMeta) {
    sku = skuMeta.getAttribute('content');
  }

  // Extract thumbnail from various meta tags (in order of preference)
  const imageSelectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="product:image"]',
    'meta[name="thumbnail"]',
    'meta[property="image"]',
  ];

  for (const selector of imageSelectors) {
    const imageMeta = document.querySelector(selector);
    if (imageMeta) {
      const content = imageMeta.getAttribute('content');
      if (content && content.startsWith('http')) {
        thumbnailUrl = content;
        break;
      }
    }
  }

  return {
    sku,
    thumbnailUrl,
    found: sku !== null || thumbnailUrl !== null,
  };
}

/**
 * Main audit runner function
 * @param {string} baseURL - The URL to audit
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @returns {Object} - { auditResult, fullAuditRef }
 */
export async function productMetatagsAuditRunner(baseURL, context) {
  const { log } = context;

  log.info(`Starting product-metatags audit for ${baseURL}`);

  try {
    // Fetch the page content
    const response = await fetch(baseURL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SpaceCat-Audit-Worker/1.0)',
      },
    });

    if (!response.ok) {
      log.warn(`Failed to fetch ${baseURL}: ${response.status} ${response.statusText}`);
      return {
        auditResult: {
          success: true,
          sku: null,
          thumbnailUrl: null,
          extractionMethod: null,
          error: `HTTP ${response.status}: ${response.statusText}`,
        },
        fullAuditRef: baseURL,
      };
    }

    const html = await response.text();
    log.info(`Successfully fetched content from ${baseURL} (${html.length} characters)`);

    // Extract data from meta tags
    const metaTagsResult = extractFromMetaTags(html);

    log.info(`Meta tags extraction completed: SKU=${metaTagsResult.sku}, thumbnail=${metaTagsResult.thumbnailUrl ? 'found' : 'not found'}`);

    return {
      auditResult: {
        success: true,
        sku: metaTagsResult.sku,
        thumbnailUrl: metaTagsResult.thumbnailUrl,
        extractionMethod: metaTagsResult.found ? 'meta-tags' : 'none',
      },
      fullAuditRef: baseURL,
    };
  } catch (error) {
    log.error(`Product metatags audit failed for ${baseURL}: ${error.message}`);
    return {
      auditResult: {
        success: true,
        sku: null,
        thumbnailUrl: null,
        extractionMethod: null,
        error: error.message,
      },
      fullAuditRef: baseURL,
    };
  }
}

export default new AuditBuilder()
  .withRunner(productMetatagsAuditRunner)
  .build();
