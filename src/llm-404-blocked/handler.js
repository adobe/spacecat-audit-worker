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
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import {
  LLM_404_BLOCKED_AUDIT, REFERER_URL, REQUEST_TIMEOUT, MIN_404_COUNT_THRESHOLD, MAX_URLS_LIMIT,
} from './constants.js';
import { calculateCurrentWeek, buildApiUrl, convertPathsToFullUrls } from './utils.js';
import llm404PostProcessor from './opportunity-data-mapper.js';

async function fetchLLM404Data(apiUrl, log) {
  try {
    log.info(`[${LLM_404_BLOCKED_AUDIT}] Fetching data from: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Referer: REFERER_URL,
        Accept: 'application/json',
        'User-Agent': 'SpaceCat-Audit-Worker/1.0',
      },
      timeout: REQUEST_TIMEOUT,
    });

    if (!response.ok) {
      const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      log.error(`[${LLM_404_BLOCKED_AUDIT}] API request failed: ${errorMsg}`);
      return {
        success: false,
        error: `API request failed: ${errorMsg}`,
        statusCode: response.status,
      };
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      log.error(`[${LLM_404_BLOCKED_AUDIT}] Invalid content type: ${contentType}`);
      return {
        success: false,
        error: `Invalid content type: ${contentType}`,
      };
    }

    try {
      const data = await response.json();
      log.info(`[${LLM_404_BLOCKED_AUDIT}] Successfully fetched data from API`);

      return {
        success: true,
        data,
      };
    } catch (jsonError) {
      log.error(`[${LLM_404_BLOCKED_AUDIT}] Failed to parse JSON: ${jsonError.message}`);
      return {
        success: false,
        error: `Failed to parse JSON: ${jsonError.message}`,
      };
    }
  } catch (error) {
    const errorMsg = error.code === 'ETIMEOUT'
      ? `Request timeout after ${REQUEST_TIMEOUT}ms`
      : error.message;

    log.error(`[${LLM_404_BLOCKED_AUDIT}] Network error: ${errorMsg}`);
    return {
      success: false,
      error: `Network error: ${errorMsg}`,
    };
  }
}

function processApiData(data, siteBaseUrl, log) {
  try {
    const urlsContainer = data['404_all_urls'];

    if (!urlsContainer || typeof urlsContainer !== 'object') {
      log.warn(`[${LLM_404_BLOCKED_AUDIT}] 404_all_urls field missing or invalid`);
      return {
        blocked404Urls: [],
        fullUrls: [],
        totalCount: 0,
        dataQuality: 'missing_field',
      };
    }

    const urlsData = urlsContainer.data;
    if (!Array.isArray(urlsData)) {
      log.warn(`[${LLM_404_BLOCKED_AUDIT}] 404_all_urls.data is not an array, got: ${typeof urlsData}`);
      return {
        blocked404Urls: [],
        fullUrls: [],
        totalCount: 0,
        dataQuality: 'invalid_format',
      };
    }

    if (urlsData.length === 0) {
      log.info(`[${LLM_404_BLOCKED_AUDIT}] No 404 URLs found in data`);
      return {
        blocked404Urls: [],
        fullUrls: [],
        totalCount: 0,
        dataQuality: 'no_data',
      };
    }

    const parsedData = urlsData.map((item) => {
      const count = parseInt(item['Number of 404s'] || '0', 10);
      return {
        ...item,
        count_404s: Number.isNaN(count) ? 0 : count,
      };
    }).filter((item) => item.count_404s > 0) // Only include items with valid counts > 0
      .sort((a, b) => b.count_404s - a.count_404s);

    // Only apply threshold filtering if we have more than MAX_URLS_LIMIT URLs
    // Otherwise, return all URLs as-is (no capping)
    let selectedUrls;
    if (parsedData.length <= MAX_URLS_LIMIT) {
      // Few enough URLs - return all of them, no threshold filtering
      selectedUrls = parsedData;
    } else {
      // Too many URLs - apply threshold filter, return all that meet threshold
      const urlsWithThreshold = parsedData.filter(
        (item) => item.count_404s >= MIN_404_COUNT_THRESHOLD,
      );
      if (urlsWithThreshold.length > 0) {
        // Some URLs meet threshold - return all of them
        selectedUrls = urlsWithThreshold;
      } else {
        // No URLs meet threshold - fall back to top 200 by count
        selectedUrls = parsedData.slice(0, MAX_URLS_LIMIT);
      }
    }

    let filterType;
    if (parsedData.length <= MAX_URLS_LIMIT) {
      filterType = 'all_urls';
    } else {
      const urlsWithThreshold = parsedData.filter(
        (item) => item.count_404s >= MIN_404_COUNT_THRESHOLD,
      );
      filterType = urlsWithThreshold.length > 0 ? 'threshold_filtered' : 'top_200_fallback';
    }
    log.info(`[${LLM_404_BLOCKED_AUDIT}] Filtering results: ${parsedData.length} total URLs, selected ${selectedUrls.length} URLs (${filterType})`);

    const urlPaths = selectedUrls.map((item) => item.URL).filter(Boolean);

    const fullUrls = convertPathsToFullUrls(urlPaths, siteBaseUrl, log);

    log.info(`[${LLM_404_BLOCKED_AUDIT}] Found ${selectedUrls.length} filtered 404 URL entries, converted ${fullUrls.length} to valid full URLs`);

    return {
      blocked404Urls: selectedUrls, // Keep original filtered data for audit result
      fullUrls, // Full URLs for Mystique
      totalCount: selectedUrls.length,
      validUrlCount: fullUrls.length,
      originalTotalCount: urlsData.length,
      filterCriteria: (() => {
        if (filterType === 'all_urls') return `all_${parsedData.length}_urls`;
        if (filterType === 'threshold_filtered') return `threshold_${MIN_404_COUNT_THRESHOLD}_404s`;
        return `top_${MAX_URLS_LIMIT}_fallback`;
      })(),
      dataQuality: 'valid',
    };
  } catch (error) {
    log.error(`[${LLM_404_BLOCKED_AUDIT}] Error processing API data: ${error.message}`);
    return {
      blocked404Urls: [],
      fullUrls: [],
      totalCount: 0,
      dataQuality: 'processing_error',
      processingError: error.message,
    };
  }
}

export async function llm404BlockedAuditRunner(baseURL, context, site) {
  const { log } = context;
  const siteId = site.getId();
  const siteBaseUrl = site.getBaseURL();
  const currentWeek = calculateCurrentWeek();

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Starting audit for site: ${siteId}, base URL: ${siteBaseUrl}, week period: ${currentWeek}`);

  try {
    const cdnLogsConfig = site.getConfig()?.getCdnLogsConfig?.();
    const outputLocation = cdnLogsConfig?.outputLocation;

    if (!cdnLogsConfig) {
      const errorMsg = `CDN logs configuration not found for site: ${siteId}`;
      log.error(`[${LLM_404_BLOCKED_AUDIT}] ${errorMsg}`);
      return {
        auditResult: {
          finalUrl: baseURL,
          domain: 'unknown',
          currentWeek,
          apiUrl: 'unavailable',
          blocked404Urls: [],
          fullUrls: [],
          totalCount: 0,
          success: false,
          error: errorMsg,
          auditedAt: new Date().toISOString(),
        },
        fullAuditRef: baseURL,
      };
    }

    if (!outputLocation || typeof outputLocation !== 'string' || outputLocation.trim() === '') {
      const errorMsg = `Missing or invalid cdnLogsConfig.outputLocation. Site: ${siteId}, Config: ${JSON.stringify(cdnLogsConfig)}`;
      log.error(`[${LLM_404_BLOCKED_AUDIT}] ${errorMsg}`);
      return {
        auditResult: {
          finalUrl: baseURL,
          domain: 'unknown',
          currentWeek,
          apiUrl: 'unavailable',
          blocked404Urls: [],
          fullUrls: [],
          totalCount: 0,
          success: false,
          error: 'Configuration error: cdnLogsConfig.outputLocation is required but missing or invalid',
          auditedAt: new Date().toISOString(),
        },
        fullAuditRef: baseURL,
      };
    }

    const domain = outputLocation.trim();
    log.info(`[${LLM_404_BLOCKED_AUDIT}] Using outputLocation from cdnLogsConfig: ${domain} (Site: ${siteId})`);

    const apiUrl = buildApiUrl(domain, currentWeek);

    const apiResult = await fetchLLM404Data(apiUrl, log);

    if (!apiResult.success) {
      log.warn(`[${LLM_404_BLOCKED_AUDIT}] API call failed, returning empty result`);
      return {
        auditResult: {
          finalUrl: baseURL,
          domain,
          currentWeek,
          apiUrl,
          blocked404Urls: [],
          fullUrls: [],
          totalCount: 0,
          success: false,
          error: apiResult.error,
          ...(apiResult.statusCode && { statusCode: apiResult.statusCode }),
        },
        fullAuditRef: apiUrl,
      };
    }

    const processedData = processApiData(apiResult.data, siteBaseUrl, log);

    const auditResult = {
      finalUrl: baseURL,
      domain,
      currentWeek,
      apiUrl,
      ...processedData,
      success: true,
      auditedAt: new Date().toISOString(),
    };

    log.info(`[${LLM_404_BLOCKED_AUDIT}] Audit completed successfully for site: ${siteId}, found ${processedData.totalCount} blocked URLs`);

    return {
      auditResult,
      fullAuditRef: apiUrl,
    };
  } catch (error) {
    log.error(`[${LLM_404_BLOCKED_AUDIT}] Unexpected error during audit: ${error.message}`, error);

    return {
      auditResult: {
        finalUrl: baseURL,
        domain: 'unknown',
        currentWeek: calculateCurrentWeek(),
        blocked404Urls: [],
        fullUrls: [],
        totalCount: 0,
        success: false,
        error: `Unexpected error: ${error.message}`,
      },
      fullAuditRef: baseURL,
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(llm404BlockedAuditRunner)
  .withPostProcessors([llm404PostProcessor])
  .build();
