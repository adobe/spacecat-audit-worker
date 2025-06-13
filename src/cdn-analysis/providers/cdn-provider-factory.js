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
import { FastlyProvider } from './fastly-provider.js';
import { AkamaiProvider } from './akamai-provider.js';

const CDN_PROVIDER_MAP = {
  fastly: FastlyProvider,
  akamai: AkamaiProvider,
};

function determineCdnType(site, context) {
  const { log } = context;
  if (!site) {
    log.warn('No site provided, defaulting to Fastly CDN');
    return 'fastly';
  }
  const baseURL = typeof site.getBaseURL === 'function'
    ? site.getBaseURL()
    : site.baseURL;
  if (baseURL) {
    const host = new URL(baseURL).hostname.toLowerCase();
    if (host.includes('adobe.com')) {
      log.info(`Detected Adobe domain (${host}), using Akamai CDN`);
      return 'akamai';
    }
    if (host.includes('bulk.com')) {
      log.info(`Detected Bulk domain (${host}), using Fastly CDN`);
      return 'fastly';
    }
  }
  log.info('No specific CDN type detected, defaulting to Fastly CDN');
  return 'fastly';
}

export function getCdnProvider(site, context) {
  const { log } = context;
  const cdnType = determineCdnType(site, context);
  const CDNProvider = CDN_PROVIDER_MAP[cdnType] || FastlyProvider;
  log.info(`Using ${cdnType.toUpperCase()} CDN provider`);
  return new CDNProvider(context, site);
}

/* c8 ignore stop */
