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
 * Maps detector CDN display names to `deliveryConfig.cdn` strings: lowercase ASCII,
 * multi-word values as kebab-case (e.g. `clever-cloud`), single-word providers unchanged.
 */
export const DELIVERY_CONFIG_CDN_NONE = 'none';

/** @type {Readonly<Record<string, string>>} */
const DETECTED_LABEL_TO_TOKEN = Object.freeze({
  Akamai: 'akamai',
  Airee: 'airee',
  'Alibaba Cloud CDN': 'alibaba-cloud-cdn',
  'Azure CDN': 'azure-cdn',
  'Azure Front Door': 'azure-front-door',
  'Azure Front Door / Azure CDN': 'azure-edge',
  'Bunny CDN': 'bunny-cdn',
  BelugaCDN: 'beluga-cdn',
  CDNetworks: 'cdnetworks',
  CacheFly: 'cachefly',
  'Clever Cloud': 'clever-cloud',
  Cloudflare: 'cloudflare',
  CloudFront: 'cloudfront',
  EdgeCast: 'edgecast',
  Fastly: 'fastly',
  'Google Cloud CDN': 'google-cloud-cdn',
  Imperva: 'imperva',
  KeyCDN: 'keycdn',
  Limelight: 'limelight',
  Myra: 'myra',
  Netlify: 'netlify',
  StackPath: 'stackpath',
  Sucuri: 'sucuri',
  Vercel: 'vercel',
});

/** All allowed `deliveryConfig.cdn` values (including {@link DELIVERY_CONFIG_CDN_NONE}). */
export const DELIVERY_CONFIG_CDN_TOKENS = Object.freeze(
  [...new Set([DELIVERY_CONFIG_CDN_NONE, ...Object.values(DETECTED_LABEL_TO_TOKEN)])].sort(),
);

/**
 * Maps detector label + error state to the value persisted on `deliveryConfig.cdn`.
 *
 * @param {string} detectedCdn - Value from `detectCdnFromUrl` (`cdn` field).
 * @param {string|undefined|null} fetchError - Non-empty when HEAD/GET failed.
 * @param {{ warn?: function }} [log] - Optional logger for unmapped labels.
 * @returns {string} Lowercase token (kebab-case when multi-word) or
 *   {@link DELIVERY_CONFIG_CDN_NONE}.
 */
export function toDeliveryConfigCdnToken(detectedCdn, fetchError, log) {
  if (fetchError) {
    return DELIVERY_CONFIG_CDN_NONE;
  }
  if (typeof detectedCdn !== 'string' || detectedCdn.trim() === '' || detectedCdn === 'unknown') {
    return DELIVERY_CONFIG_CDN_NONE;
  }
  const token = DETECTED_LABEL_TO_TOKEN[detectedCdn];
  if (!token) {
    log?.warn?.('[detect-cdn] Unmapped CDN label for deliveryConfig; using none', { detectedCdn });
    return DELIVERY_CONFIG_CDN_NONE;
  }
  return token;
}
