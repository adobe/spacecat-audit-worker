/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {
  hasText, isObject, isValidUrl, tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';

import { createUrl } from '@adobe/fetch';

/**
 * The PSI strategies.
 * @type {string}
 */
export const PSI_STRATEGY_MOBILE = 'mobile';
export const PSI_STRATEGY_DESKTOP = 'desktop';
export const PSI_STRATEGIES = [PSI_STRATEGY_MOBILE, PSI_STRATEGY_DESKTOP];

/**
 * Creates a new PSI client. The client is used to run PSI audits. It can be configured
 * with an API key and a PSI API Base URL.
 *
 * @param {Object} config - The configuration object.
 * @param {string} config.apiKey - The PSI API key.
 * @param {string} config.apiBaseUrl - The PSI API Base URL.
 * @param {Object} log - The logger.
 *
 *  @return {PSIClient} - The PSI client.
 */
function PSIClient(config, log = console) {
  const { apiKey, apiBaseUrl, environment } = config;

  if (!isValidUrl(apiBaseUrl)) {
    throw new Error(`Invalid PSI API Base URL: ${apiBaseUrl}`);
  }

  const formatURL = (input) => {
    const urlPattern = /^https?:\/\//i;
    return urlPattern.test(input) ? input.replace(/^http:/i, 'https:') : `https://${input}`;
  };

  const getPSIApiUrl = (siteUrl, strategyHint, serviceId) => {
    const strategy = PSI_STRATEGIES.includes(strategyHint) ? strategyHint : PSI_STRATEGY_MOBILE;

    const serviceIdParam = {};
    if (hasText(serviceId)) {
      serviceIdParam.serviceId = serviceId;
    }

    const params = { url: formatURL(siteUrl), strategy, ...serviceIdParam };
    if (apiKey) {
      params.key = apiKey;
    }

    /* ['performance', 'accessibility', 'best-practices', 'seo'].forEach((category) => {
      params.append('category', category);
    }); */

    return createUrl(apiBaseUrl, params);
  };

  /**
   * Performs a PSI check.
   *
   * @param {string} baseURL - The base URL to check.
   * @param {string} strategy - The strategy to use.
   * @param {string} serviceId - The service ID.
   * @return {Promise<{lighthouseResult: *, fullAuditRef: string}>}
   */
  const performPSICheck = async (baseURL, strategy, serviceId) => {
    try {
      const apiURL = getPSIApiUrl(baseURL, strategy, serviceId);
      const xSource = `spacecat-${environment}`;
      const response = await fetch(apiURL, { headers: { 'x-source': xSource } });
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const { lighthouseResult } = await response.json();

      if (!isObject(lighthouseResult)) {
        throw new Error('Invalid PSI data');
      }

      return { lighthouseResult, fullAuditRef: response.url };
    } catch (e) {
      log.error(`Error happened during PSI check: ${e}`);
      throw e;
    }
  };

  /**
   * Follows redirects for a given URL. If no redirect is detected, the original URL is returned.
   * Otherwise, the final URL is returned. If an error happens, the original URL is returned.
   * @param {string} url - The URL to check.
   * @return {Promise<string>} - The final URL.
   */
  const followRedirects = async (url) => {
    try {
      const formattedURL = formatURL(url);

      const response = await fetch(formattedURL, { redirect: 'follow' });
      const finalUrl = response.url;

      /* c8 ignore next 3 */
      if (!isValidUrl(finalUrl) || formattedURL === finalUrl) {
        return formattedURL;
      }

      log.info(`Redirect detected from '${formattedURL}' to '${finalUrl}'`);
      return finalUrl;
    } catch (error) {
      log.error(`Error happened while following redirects: ${error}. Falling back to original url: ${url}`);
      return url;
    }
  };

  /**
   * Runs a PSI audit.
   *
   * @param {string} baseURL - The base URL to check.
   * @param {string} strategy - The strategy to use.
   * @param {string} [serviceId] - Optional service ID.
   * If provided, it will be included in the audit URL and be recorded by the PSI
   * service as its service ID. This can be leveraged to retrieve reports by service ID on
   * the external PSI service. In the context of SpaceCat, this is used to correlate the
   * site id with the PSI audit.
   * @return {Promise<{lighthouseResult: object, fullAuditRef: string}>}
   */
  const runAudit = async (baseURL, strategy, serviceId) => {
    const strategyStartTime = process.hrtime();
    const finalUrl = await followRedirects(baseURL);

    const psiResult = await performPSICheck(finalUrl, strategy, serviceId);

    const strategyEndTime = process.hrtime(strategyStartTime);
    const strategyElapsedTime = (strategyEndTime[0] + strategyEndTime[1] / 1e9).toFixed(2);

    log.info(`Audited ${finalUrl} for ${strategy} strategy in ${strategyElapsedTime} seconds`);

    psiResult.finalUrl = finalUrl;

    return psiResult;
  };

  return {
    followRedirects,
    formatURL,
    getPSIApiUrl,
    performPSICheck,
    runAudit,
  };
}

export default PSIClient;
