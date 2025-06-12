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

/* c8 ignore start */
import fastlyProvider from './fastly/index.js';
import akamaiProvider from './akamai/index.js';

// CDN provider mappings
const CDN_PROVIDER_MAP = {
  fastly: fastlyProvider,
  akamai: akamaiProvider,
};

/**
 * Determines the CDN type based on site configuration
 */
function determineCdnType(site, context) {
  const { log } = context;

  if (!site) {
    log.warn('No site provided, defaulting to fastly CDN');
    return 'fastly';
  }

  // Check for specific domains
  const baseURL = typeof site.getBaseURL === 'function' ? site.getBaseURL() : site.baseURL;
  if (baseURL) {
    const hostname = new URL(baseURL).hostname.toLowerCase();

    // Adobe domains use Akamai
    if (hostname.includes('adobe.com')) {
      log.info(`Detected Adobe domain (${hostname}), using Akamai CDN provider`);
      return 'akamai';
    }

    // Bulk domains use Fastly
    if (hostname.includes('bulk.com')) {
      log.info(`Detected Bulk domain (${hostname}), using Fastly CDN provider`);
      return 'fastly';
    }
  }

  // Default to Fastly
  log.info('No specific CDN type detected, defaulting to Fastly CDN provider');
  return 'fastly';
}

/**
 * Factory function to get the appropriate CDN provider
 */
export function getCdnProvider(site, context) {
  const { log } = context;

  const cdnType = determineCdnType(site, context);
  const provider = CDN_PROVIDER_MAP[cdnType];

  if (!provider) {
    log.error(`Unsupported CDN type: ${cdnType}. Falling back to Fastly.`);
    return CDN_PROVIDER_MAP.fastly;
  }

  log.info(`Using ${cdnType.toUpperCase()} CDN provider`);
  return provider;
}
/* c8 ignore stop */
