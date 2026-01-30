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
import robotsParser from 'robots-parser';
import { countRedirects } from '../redirect-chains/handler.js';
import { validateCanonicalTag } from '../canonical/handler.js';
import { fetchWithHeadFallback } from '../sitemap/common.js';
import { limitConcurrencyAllSettled } from '../support/utils.js';

// Cache robots.txt by domain to avoid refetching for multiple URLs on same domain
const robotsTxtCache = new Map();
const ROBOTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Validates HTTP status (reuses sitemap logic)
 * Checks for 4xx and 5xx errors, and detects cached error responses with 200 status
 * @param {string} url - URL to validate
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Validation result
 */
export async function validateHttpStatus(url, log) {
  try {
    const headController = new AbortController();
    const headTimeoutId = setTimeout(() => headController.abort(), 10000);
    const headResponse = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: headController.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
    });

    clearTimeout(headTimeoutId);

    const is4xxOr5xx = headResponse.status >= 400;

    if (headResponse.status === 404 || headResponse.status === 403) {
      const serverHeader = headResponse.headers.get('server') || '';
      const cfRay = headResponse.headers.get('cf-ray'); // Cloudflare
      const akamaiHeaders = headResponse.headers.get('x-akamai-transformed')
        || headResponse.headers.get('x-akamai-session-info')
        || serverHeader.includes('AkamaiGHost');
      const impervaHeaders = headResponse.headers.get('x-iinfo') || headResponse.headers.get('x-cdn');

      const hasBotProtection = !!(cfRay || akamaiHeaders || impervaHeaders);

      if (hasBotProtection) {
        log.warn(`Bot protection detected on ${url}, Googlebot returned ${headResponse.status}. This is a critical SEO issue - Googlebot must be whitelisted.`);
        return {
          passed: false,
          statusCode: headResponse.status,
          blockerType: 'googlebot-blocked',
          warning: `Googlebot is blocked by bot protection (${headResponse.status}). Page must whitelist Googlebot for indexing.`,
        };
      }
    }

    // If not 200, no need to check body
    if (!headResponse.ok || headResponse.status !== 200) {
      return {
        passed: !is4xxOr5xx,
        statusCode: headResponse.status,
        blockerType: is4xxOr5xx ? 'http-error' : null,
      };
    }

    // Check for "false 200s" - only for 200 responses
    let isFalse200 = false;
    let false200Message = null;

    const contentType = headResponse.headers.get('content-type') || '';
    const contentLength = headResponse.headers.get('content-length');

    // LAYER 1: Check CDN/cache error headers (no body download needed)
    const xError = headResponse.headers.get('x-error') || headResponse.headers.get('x-amz-error-code') || '';
    if (xError) {
      return {
        passed: false,
        statusCode: 200,
        blockerType: 'http-error',
        false200: true,
        false200Message: `CDN Error: ${xError}`,
      };
    }

    const contentLengthNum = parseInt(contentLength, 10);
    if (!Number.isNaN(contentLengthNum) && contentLengthNum > 50000) {
      // Files > 50KB are unlikely to be cached errors
      return {
        passed: true,
        statusCode: 200,
        blockerType: null,
      };
    }

    // Skip body check for images, videos, PDFs, etc.
    if (!contentType.includes('json') && !contentType.includes('html') && !contentType.includes('text')) {
      return {
        passed: true,
        statusCode: 200,
        blockerType: null,
      };
    }

    // GET request with its own timeout for body content checks
    try {
      const getController = new AbortController();
      const getTimeoutId = setTimeout(() => getController.abort(), 10000);

      const getResponse = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: getController.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      });

      clearTimeout(getTimeoutId);

      const text = await getResponse.text();
      const textLength = text.length;

      // LAYER 2: Check JSON error responses
      if (contentType.includes('application/json') && textLength > 0 && textLength < 5000) {
        try {
          const json = JSON.parse(text);
          const hasErrorStatus = json.status === 'error' || json.status === 'fail';
          const hasErrorField = json.error && typeof json.error === 'string' && json.error.length > 0;
          const hasErrorCode = json.errorCode && typeof json.errorCode === 'string';

          const hasErrorCodePattern = json.code && typeof json.code === 'string' && (
            json.code.match(/^(General-[0-9]+|Error[-_][0-9]+|ERR[-_][A-Z]+|FAIL[-_]|E[45][0-9]{2})/i)
            || json.code.match(/^[A-Z]+[-_][45][0-9]{2}$/i)
            || json.code.match(/^(TIMEOUT|UNAVAILABLE|GATEWAY_ERROR)$/i)
          );

          const hasErrorMessage = json.userMessage || json.systemMessage || json.message;

          const hasAnyErrorIndicator = hasErrorStatus
            || hasErrorField
            || hasErrorCode
            || hasErrorCodePattern;

          if (hasAnyErrorIndicator && hasErrorMessage) {
            isFalse200 = true;
            false200Message = json.userMessage || json.systemMessage || json.message || json.error;
          }
        } catch (jsonError) {
          // Not valid JSON, skip
        }
      }

      // LAYER 3: Check HTML error pages
      if (!isFalse200 && contentType.includes('text/html') && textLength < 10000) {
        const lowerText = text.toLowerCase();

        const criticalErrorPatterns = [
          '502 bad gateway',
          '503 service unavailable',
          '504 gateway timeout',
        ];
        const first1k = lowerText.substring(0, 1000);

        for (const pattern of criticalErrorPatterns) {
          if (first1k.includes(pattern)) {
            if (lowerText.includes('<html') && lowerText.includes('error')) {
              isFalse200 = true;
              false200Message = `CDN/Gateway error page: ${pattern}`;
              break;
            }
          }
        }
      }
    } catch (parseError) {
      log.debug(`Could not parse response body for false 200 check: ${parseError.message}`);
    }

    const hasError = is4xxOr5xx || isFalse200;

    return {
      passed: !hasError,
      statusCode: 200,
      blockerType: hasError ? 'http-error' : null,
      ...(isFalse200 && { false200: true, false200Message }),
    };
  } catch (error) {
    log.error(`HTTP status check failed for ${url}: ${error.message}`);
    return {
      passed: false,
      statusCode: 0,
      blockerType: 'http-error',
      error: error.message,
    };
  }
}

/**
 * Validates redirects (reuses redirect-chains logic)
 * Checks for 3xx redirect chains
 * @param {string} url - URL to validate
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Validation result
 */
export async function validateRedirects(url, log) {
  try {
    const result = await countRedirects(url);
    const hasRedirects = result.redirectCount > 0;

    return {
      passed: !hasRedirects,
      redirectCount: result.redirectCount,
      redirectChain: result.redirectChain,
      finalUrl: result.redirectChain?.split(' -> ').pop(),
      blockerType: hasRedirects ? 'redirect-chain' : null,
    };
  } catch (error) {
    log.error(`Redirect check failed for ${url}: ${error.message}`);
    return {
      passed: false,
      redirectCount: 0,
      blockerType: 'redirect-chain',
      error: error.message,
    };
  }
}

/**
 * Validates canonical tag (reuses canonical audit logic)
 * Checks for canonical pointing elsewhere
 * @param {string} url - URL to validate
 * @param {Object} log - Logger instance
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} Validation result
 */
export async function validateCanonical(url, log, options = {}) {
  try {
    const result = await validateCanonicalTag(url, log, options);
    const isSelfReferencing = result.canonicalUrl === url || !result.canonicalUrl;

    return {
      passed: isSelfReferencing,
      canonicalUrl: result.canonicalUrl,
      isSelfReferencing,
      blockerType: !isSelfReferencing ? 'canonical-mismatch' : null,
    };
  } catch (error) {
    log.error(`Canonical check failed for ${url}: ${error.message}`);
    // Don't block on canonical check failures
    return {
      passed: true,
      canonicalUrl: null,
      isSelfReferencing: true,
      blockerType: null,
      error: error.message,
    };
  }
}

/**
 * Validates noindex tags (checks meta robots, X-Robots-Tag, and "none" directive)
 * @param {string} url - URL to validate
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Validation result
 */
export async function validateNoindex(url, log) {
  try {
    const response = await fetchWithHeadFallback(url, { redirect: 'follow' });

    // Check X-Robots-Tag header (including "none" directive)
    const robotsHeader = response.headers.get('x-robots-tag') || '';
    const hasNoindexHeader = robotsHeader.toLowerCase().includes('noindex')
                           || robotsHeader.toLowerCase().includes('none');

    // Check meta robots tag (need to fetch HTML)
    let hasNoindexMeta = false;
    if (response.ok) {
      const html = await response.text();
      const metaRobotsMatch = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
      if (metaRobotsMatch) {
        const content = metaRobotsMatch[1].toLowerCase();
        // Check for noindex or none (none = noindex + nofollow)
        hasNoindexMeta = content.includes('noindex') || content.includes('none');
      }
    }

    const hasNoindex = hasNoindexHeader || hasNoindexMeta;

    return {
      passed: !hasNoindex,
      hasNoindexHeader,
      hasNoindexMeta,
      blockerType: hasNoindex ? 'noindex' : null,
    };
  } catch (error) {
    log.error(`Noindex check failed for ${url}: ${error.message}`);
    // Don't block on noindex check failures
    return {
      passed: true,
      hasNoindexHeader: false,
      hasNoindexMeta: false,
      blockerType: null,
      error: error.message,
    };
  }
}

/**
 * Validates robots.txt blocking (reuses pattern from llm-blocked/handler.js)
 * Checks if Googlebot and general crawlers are allowed to access the URL
 * @param {string} url - URL to validate
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Validation result
 */
export async function validateRobotsTxt(url, log) {
  try {
    const urlObj = new URL(url);
    const domain = `${urlObj.protocol}//${urlObj.host}`;
    const robotsUrl = `${domain}/robots.txt`;

    // Check cache first to avoid refetching robots.txt for same domain
    const cached = robotsTxtCache.get(domain);
    if (cached && Date.now() - cached.timestamp < ROBOTS_CACHE_TTL) {
      const { robots } = cached;
      const isAllowedForGooglebot = robots.isAllowed(url, 'Googlebot');
      const isAllowedGenerally = robots.isAllowed(url);

      return {
        passed: isAllowedForGooglebot && isAllowedGenerally,
        blockerType: (!isAllowedForGooglebot || !isAllowedGenerally) ? 'robots-txt-blocked' : null,
        details: {
          googlebot: isAllowedForGooglebot,
          general: isAllowedGenerally,
          cached: true,
        },
      };
    }

    // Fetch and parse robots.txt (same pattern as llm-blocked/handler.js)
    log.debug(`Fetching ${robotsUrl}`);
    const response = await fetch(robotsUrl);
    const robotsTxtContent = await response.text();
    const robots = robotsParser(robotsUrl, robotsTxtContent);

    // Cache the parsed robots.txt
    robotsTxtCache.set(domain, { robots, timestamp: Date.now() });

    const isAllowedForGooglebot = robots.isAllowed(url, 'Googlebot');
    const isAllowedGenerally = robots.isAllowed(url);

    return {
      passed: isAllowedForGooglebot && isAllowedGenerally,
      blockerType: (!isAllowedForGooglebot || !isAllowedGenerally) ? 'robots-txt-blocked' : null,
      details: {
        googlebot: isAllowedForGooglebot,
        general: isAllowedGenerally,
        cached: false,
      },
    };
  } catch (error) {
    log.warn(`robots.txt check failed for ${url}: ${error.message}`);
    // Don't block on robots.txt fetch errors (file might not exist, which is valid)
    return {
      passed: true,
      blockerType: null,
      error: error.message,
    };
  }
}

/**
 * Validates all checks for a single URL
 * @param {string} url - URL to validate
 * @param {Object} context - Audit context containing log
 * @returns {Promise<Object>} Complete validation result
 */
export async function validateUrl(url, context) {
  const { log } = context;

  // Run all checks in parallel
  const [httpStatus, redirects, canonical, noindex, robotsTxt] = await Promise.all([
    validateHttpStatus(url, log),
    validateRedirects(url, log),
    validateCanonical(url, log, {}),
    validateNoindex(url, log),
    validateRobotsTxt(url, log),
  ]);

  const checks = {
    httpStatus,
    redirects,
    canonical,
    noindex,
    robotsTxt,
  };

  const allPassed = Object.values(checks).every((check) => check.passed);
  const blockers = Object.values(checks)
    .filter((check) => !check.passed && check.blockerType)
    .map((check) => check.blockerType);

  return {
    url,
    indexable: allPassed,
    checks,
    blockers,
  };
}

/**
 * Validates multiple URLs with concurrency control
 * @param {Array} urls - Array of URL objects with keyword data (or strings)
 * @param {Object} context - Audit context
 * @returns {Promise<Array>} Array of validation results
 */
export async function validateUrls(urls, context) {
  const { log } = context;

  log.info(`Validating ${urls.length} URLs for indexability`);

  const tasks = urls.map((urlData) => async () => {
    const url = typeof urlData === 'string' ? urlData : urlData.url;
    const result = await validateUrl(url, context);
    return {
      ...(typeof urlData === 'object' ? urlData : {}),
      ...result,
    };
  });

  const results = await limitConcurrencyAllSettled(tasks, 10);

  const cleanCount = results.filter((r) => r.indexable).length;
  const blockedCount = results.filter((r) => !r.indexable).length;

  log.info(`Validation complete: ${cleanCount} clean, ${blockedCount} blocked`);

  return results;
}
