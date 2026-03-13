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

import { hasText } from '@adobe/spacecat-shared-utils';
import { PAGES_PER_BATCH } from './crawl-detection.js';

const MAX_URLS_TO_PROCESS = 100;
const DEFAULT_LINKCHECKER_MIN_TIME_NEEDED_MS = 5 * 60 * 1000;
const MAX_BROKEN_LINKS = 100;
const MAX_BROKEN_LINKS_REPORTED = 500;
const BRIGHT_DATA_VALIDATE_URLS = 'BRIGHT_DATA_VALIDATE_URLS';
const BRIGHT_DATA_MAX_RESULTS = 'BRIGHT_DATA_MAX_RESULTS';
const BRIGHT_DATA_REQUEST_DELAY_MS = 'BRIGHT_DATA_REQUEST_DELAY_MS';
const DEFAULT_LINKCHECKER_LOOKBACK_MINUTES = 1440;
const DEFAULT_LINKCHECKER_MAX_JOB_DURATION_MINUTES = 60;
const allowedWaitUntilValues = ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'];

function getEnvBool(env, key, defaultValue) {
  if (env?.[key] === undefined) return defaultValue;
  return String(env[key]).toLowerCase() === 'true';
}

function getEnvInt(env, key, defaultValue) {
  const value = Number.parseInt(env?.[key], 10);
  return Number.isFinite(value) ? value : defaultValue;
}

function getPositiveIntConfig(value, fallback) {
  const numericValue = Number.parseInt(value, 10);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

function getBooleanConfig(value, fallback) {
  if (typeof value === 'boolean') return value;
  /* c8 ignore start - defensive support for string-based configs */
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  /* c8 ignore stop */
  return fallback;
}

function getEnumConfig(value, allowedValues, fallback) {
  return allowedValues.includes(value) ? value : fallback;
}

export class InternalLinksConfigResolver {
  constructor(site, env = {}) {
    this.site = site;
    this.env = env;
    this.handlerConfig = site?.getConfig?.()?.getHandlers?.()?.['broken-internal-links']?.config || {};
    this.deliveryConfig = site?.getDeliveryConfig?.() || {};
  }

  getHandlerConfig() {
    return this.handlerConfig;
  }

  getDeliveryConfig() {
    return this.deliveryConfig;
  }

  isLinkCheckerEnabled() {
    return this.handlerConfig.isLinkcheckerEnabled ?? false;
  }

  getLinkCheckerProgramId() {
    return this.deliveryConfig.programId || this.handlerConfig.aemProgramId;
  }

  getLinkCheckerEnvironmentId() {
    return this.deliveryConfig.environmentId || this.handlerConfig.aemEnvironmentId;
  }

  getLinkCheckerLookbackMinutes() {
    return this.handlerConfig.linkCheckerLookbackMinutes ?? DEFAULT_LINKCHECKER_LOOKBACK_MINUTES;
  }

  getLinkCheckerMaxJobDurationMinutes() {
    return this.handlerConfig.linkCheckerMaxJobDurationMinutes
      ?? DEFAULT_LINKCHECKER_MAX_JOB_DURATION_MINUTES;
  }

  getLinkCheckerPollingConfig() {
    const envConfig = {
      maxPollAttempts: getEnvInt(this.env, 'LINKCHECKER_MAX_POLL_ATTEMPTS', 10),
      pollIntervalMs: getEnvInt(this.env, 'LINKCHECKER_POLL_INTERVAL_MS', 60000),
    };

    return {
      maxPollAttempts: getPositiveIntConfig(
        this.handlerConfig.linkCheckerMaxPollAttempts,
        envConfig.maxPollAttempts,
      ),
      pollIntervalMs: getPositiveIntConfig(
        this.handlerConfig.linkCheckerPollIntervalMs,
        envConfig.pollIntervalMs,
      ),
    };
  }

  getMaxUrlsToProcess() {
    return getPositiveIntConfig(this.handlerConfig.maxUrlsToProcess, MAX_URLS_TO_PROCESS);
  }

  getBatchSize() {
    return getPositiveIntConfig(this.handlerConfig.batchSize, PAGES_PER_BATCH);
  }

  getLinkCheckerMinTimeNeededMs() {
    return getPositiveIntConfig(
      this.handlerConfig.linkCheckerMinTimeNeededMs,
      DEFAULT_LINKCHECKER_MIN_TIME_NEEDED_MS,
    );
  }

  getMaxBrokenLinksPerBatch() {
    return getPositiveIntConfig(
      this.handlerConfig.maxBrokenLinksPerSuggestionBatch,
      MAX_BROKEN_LINKS,
    );
  }

  getMaxBrokenLinksReported() {
    return getPositiveIntConfig(
      this.handlerConfig.maxBrokenLinksReported,
      MAX_BROKEN_LINKS_REPORTED,
    );
  }

  getBrightDataBatchSize() {
    return getPositiveIntConfig(this.handlerConfig.brightDataBatchSize, 10);
  }

  getMaxAlternativeUrlsToSend() {
    return getPositiveIntConfig(this.handlerConfig.maxAlternativeUrlsToSend, 200);
  }

  getBrightDataConfig() {
    return {
      validateUrls: this.handlerConfig.validateBrightDataUrls
        ?? getEnvBool(this.env, BRIGHT_DATA_VALIDATE_URLS, false),
      maxResults: getPositiveIntConfig(
        this.handlerConfig.brightDataMaxResults,
        getEnvInt(this.env, BRIGHT_DATA_MAX_RESULTS, 10),
      ),
      requestDelayMs: getPositiveIntConfig(
        this.handlerConfig.brightDataRequestDelayMs,
        getEnvInt(this.env, BRIGHT_DATA_REQUEST_DELAY_MS, 500),
      ),
    };
  }

  getScraperOptions() {
    const scrollDurationConfig = this.handlerConfig.maxScrollDurationMs
      ?? this.handlerConfig.scrollMaxDurationMs;

    return {
      enableJavascript: getBooleanConfig(this.handlerConfig.enableJavascript, true),
      pageLoadTimeout: getPositiveIntConfig(this.handlerConfig.pageLoadTimeout, 30000),
      evaluateTimeout: getPositiveIntConfig(this.handlerConfig.evaluateTimeout, 10000),
      waitUntil: getEnumConfig(this.handlerConfig.waitUntil, allowedWaitUntilValues, 'networkidle2'),
      networkIdleTimeout: getPositiveIntConfig(this.handlerConfig.networkIdleTimeout, 2000),
      waitForSelector: this.handlerConfig.waitForSelector || 'body',
      rejectRedirects: getBooleanConfig(this.handlerConfig.rejectRedirects, false),
      expandShadowDOM: getBooleanConfig(this.handlerConfig.expandShadowDOM, true),
      scrollToBottom: getBooleanConfig(this.handlerConfig.scrollToBottom, true),
      maxScrollDurationMs: getPositiveIntConfig(scrollDurationConfig, 30000),
      clickLoadMore: getBooleanConfig(this.handlerConfig.clickLoadMore, true),
      loadMoreSelector: hasText(this.handlerConfig.loadMoreSelector)
        ? this.handlerConfig.loadMoreSelector
        : undefined,
      screenshotTypes: Array.isArray(this.handlerConfig.screenshotTypes)
        ? this.handlerConfig.screenshotTypes.filter((type) => typeof type === 'string')
        : [],
      hideConsentBanners: getBooleanConfig(this.handlerConfig.hideConsentBanners, true),
    };
  }
}

export function createInternalLinksConfigResolver(site, env) {
  return new InternalLinksConfigResolver(site, env);
}
