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

import { createUrl } from '@adobe/fetch';
import { fetch } from './utils.js';

/**
 * Creates a new PSI client. The client is used to run PSI audits. It can be configured
 * with an API key and a PSI API Base URL.
 *
 * @param {Object} config - The configuration object.
 * @param {string} config.apiKey - The PSI API key.
 * @param {string} config.baseUrl - The PSI API Base URL.
 * @param {Object} log - The logger.
 * @return {Object} - The PSI client.
 *
 * @constructor
 */
function PSIClient(config, log = console) {
  const STRATEGY_MOBILE = 'mobile';
  const STRATEGY_DESKTOP = 'desktop';
  const PSI_STRATEGIES = [STRATEGY_MOBILE, STRATEGY_DESKTOP];

  const { apiKey, baseUrl } = config;

  const formatURL = (input) => {
    const urlPattern = /^https?:\/\//i;
    return urlPattern.test(input) ? input.replace(/^http:/i, 'https:') : `https://${input}`;
  };

  const getPSIApiUrl = (siteUrl, strategyHint) => {
    const strategy = PSI_STRATEGIES.includes(strategyHint) ? strategyHint : STRATEGY_MOBILE;

    const params = { url: formatURL(siteUrl), strategy };
    if (apiKey) {
      params.key = apiKey;
    }

    /* ['performance', 'accessibility', 'best-practices', 'seo'].forEach((category) => {
      params.append('category', category);
    }); */

    return createUrl(baseUrl, params);
  };

  /**
   * Performs a PSI check.
   *
   * @param {string} baseURL - The base URL to check.
   * @param {string} strategy - The strategy to use.
   *
   * @return {Promise<{lighthouseResult: *, fullAuditRef: string}>}
   */
  const performPSICheck = async (baseURL, strategy) => {
    try {
      const apiURL = getPSIApiUrl(baseURL, strategy);
      const response = await fetch(apiURL);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const { lighthouseResult } = await response.json();

      return { lighthouseResult, fullAuditRef: response.url };
    } catch (e) {
      log.error(`Error happened during PSI check: ${e}`);
      throw e;
    }
  };

  /**
   * Runs a PSI audit.
   *
   * @param {string} baseURL - The base URL to check.
   * @param {string} strategy - The strategy to use.
   *
   * @return {Promise<{lighthouseResult: *, fullAuditRef: string}>}
   */
  const runAudit = async (baseURL, strategy) => {
    const strategyStartTime = process.hrtime();

    const psiResult = await performPSICheck(baseURL, strategy);

    const strategyEndTime = process.hrtime(strategyStartTime);
    const strategyElapsedTime = (strategyEndTime[0] + strategyEndTime[1] / 1e9).toFixed(2);

    log.info(`Audited ${baseURL} for ${strategy} strategy in ${strategyElapsedTime} seconds`);

    return psiResult;
  };

  return {
    STRATEGY_MOBILE,
    STRATEGY_DESKTOP,
    formatURL,
    getPSIApiUrl,
    performPSICheck,
    runAudit,
  };
}

export default PSIClient;
