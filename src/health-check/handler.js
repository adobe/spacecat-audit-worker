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

import { tracingFetch as fetch, isValidUrl } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

export const SPACECAT_USER_AGENT = 'Spacecat/1.0';

// Common blocking indicators in response content
const BLOCKING_CONTENT_INDICATORS = [
  'access denied',
  'access is denied',
  'forbidden',
  'blocked',
  'captcha',
  'security check',
  'please verify',
  'are you a robot',
  'bot detected',
  'automated access',
  'cloudflare',
  'ddos protection',
  'rate limit',
  'too many requests',
];

// HTTP status codes that typically indicate blocking
const BLOCKING_STATUS_CODES = [401, 403, 406, 429, 503];

/**
 * Analyzes the HTTP response to determine if the request was blocked
 *
 * @param {Response} response - The fetch response object
 * @param {string} responseText - The response body text
 * @returns {Object} Analysis result with blocking status and indicators
 */
export function analyzeBlockingResponse(response, responseText) {
  const statusCode = response.status;
  const indicators = [];

  // Check for blocking status codes
  const isBlockedByStatusCode = BLOCKING_STATUS_CODES.includes(statusCode);
  if (isBlockedByStatusCode) {
    indicators.push(`HTTP status code ${statusCode}`);
  }

  // Check response content for blocking indicators
  const lowerCaseContent = responseText.toLowerCase();
  const foundContentIndicators = BLOCKING_CONTENT_INDICATORS.filter(
    (indicator) => lowerCaseContent.includes(indicator),
  );

  if (foundContentIndicators.length > 0) {
    indicators.push(...foundContentIndicators.map((i) => `Content contains: "${i}"`));
  }

  // Consider it blocked if status code indicates blocking OR if there are multiple
  // content indicators (single indicator might be false positive)
  const isBlocked = isBlockedByStatusCode || foundContentIndicators.length >= 2;

  return {
    isBlocked,
    statusCode,
    indicators,
  };
}

/**
 * Performs a health check by making a request with the SpaceCat user agent.
 * This check verifies whether SpaceCat can access the site. Customers may
 * configure their WAF/firewall to allow SpaceCat access by whitelisting
 * either the user agent string or an IP range (configured per-site).
 *
 * @param {string} url - The URL to check
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Health check result
 */
export async function checkSpacecatUserAgentAccess(url, log) {
  const timestamp = new Date().toISOString();
  const urlWithScheme = url.startsWith('https://') ? url : `https://${url}`;

  try {
    const response = await fetch(urlWithScheme, {
      method: 'GET',
      headers: {
        'User-Agent': SPACECAT_USER_AGENT,
      },
      redirect: 'follow',
    });

    const responseText = await response.text();
    const analysis = analyzeBlockingResponse(response, responseText);

    return {
      success: true,
      timestamp,
      url: urlWithScheme,
      userAgent: SPACECAT_USER_AGENT,
      ...analysis,
    };
  } catch (error) {
    log.error(`Health check request to ${urlWithScheme} failed: ${error.message}`, error);

    return {
      success: false,
      timestamp,
      url: urlWithScheme,
      userAgent: SPACECAT_USER_AGENT,
      isBlocked: false,
      statusCode: null,
      error: error.message,
      indicators: ['Request failed'],
    };
  }
}

/**
 * Main health check audit runner. Performs various health checks for a site,
 * starting with verifying that SpaceCat can access the site.
 *
 * @param {string} baseURL - The base URL to audit
 * @param {Object} context - The context object
 * @param {Object} site - The site object
 * @returns {Promise<Object>} Audit result
 */
export async function healthCheckAuditRunner(baseURL, context, site) {
  const { log } = context;

  // Use overrideBaseURL from site config if available, otherwise use baseURL
  const overrideBaseURL = site?.getConfig?.()?.getFetchConfig?.()?.overrideBaseURL;
  const urlToCheck = isValidUrl(overrideBaseURL)
    ? overrideBaseURL.replace(/^https?:\/\//, '')
    : baseURL;

  log.info(`Running health-check audit for ${urlToCheck}`);

  const spacecatUserAgentAccess = await checkSpacecatUserAgentAccess(urlToCheck, log);

  const auditResult = {
    spacecatUserAgentAccess,
    timestamp: new Date().toISOString(),
  };

  log.info(`Health-check audit completed for ${urlToCheck}. Blocked: ${spacecatUserAgentAccess.isBlocked}`);

  return {
    auditResult,
    fullAuditRef: urlToCheck,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(healthCheckAuditRunner)
  .build();
