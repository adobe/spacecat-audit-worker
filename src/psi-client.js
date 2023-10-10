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
const axios = require('axios');
const { log } = require('./util.js');

function PSIClient(config) {
  const AUDIT_TYPE = 'PSI';
  const FORM_FACTOR_MOBILE = 'mobile';
  const FORM_FACTOR_DESKTOP = 'desktop';
  const PSI_STRATEGIES = [FORM_FACTOR_MOBILE, FORM_FACTOR_DESKTOP];

  const { apiKey, baseUrl } = config;

  /**
   * Formats an input URL to be HTTPS.
   *
   * @param {string} input - The input URL.
   * @returns {string} The formatted URL with HTTPS.
   */
  const formatURL = (input) => {
    const urlPattern = /^https?:\/\//i;

    if (urlPattern.test(input)) {
      return input.replace(/^http:/i, 'https:');
    } else {
      return `https://${input}`;
    }
  };

  /**
   * Builds a PageSpeed Insights API URL with the necessary parameters.
   *
   * @param {string} siteUrl - The URL of the site to analyze.
   * @param {string} strategy - The strategy to use for the PSI check.
   * @returns {string} The full API URL with parameters.
   */
  const getPSIApiUrl = (siteUrl, strategy) => {
    const validStrategies = [FORM_FACTOR_MOBILE, FORM_FACTOR_DESKTOP];

    const params = new URLSearchParams({
      url: formatURL(siteUrl),
      key: apiKey,
      strategy: !validStrategies.includes(strategy) ? FORM_FACTOR_MOBILE : strategy,
    });

    ['performance', 'accessibility', 'best-practices', 'seo'].forEach((category) => {
      params.append('category', category);
    });

    return `${[baseUrl]}?${params.toString()}`;
  };

  /**
   * Processes audit data by replacing keys with dots with underscore.
   *
   * @param {object} data - The audit data object.
   * @returns {object} The processed audit data.
   */
  const processAuditData = (data) => {
    if (!data) {
      return null;
    }

    const newData = { ...data };

    // eslint-disable-next-line guard-for-in,no-restricted-syntax
    for (const key in newData) {
      if (typeof newData[key] === 'object' && newData[key] !== null) {
        newData[key] = processAuditData(newData[key]);
      }

      if (key.includes('.')) {
        const newKey = key.replace(/\./g, '_');
        newData[newKey] = newData[key];
        delete newData[key];
      }
    }

    return newData;
  };

  /**
   * Processes the Lighthouse audit result. Only certain properties are saved.
   * @param {object} result - The Lighthouse audit result.
   * @returns {object} The processed Lighthouse audit result.
   */
  function processLighthouseResult({
    categories,
    requestedUrl,
    fetchTime,
    finalUrl,
    mainDocumentUrl,
    finalDisplayedUrl,
    lighthouseVersion,
    userAgent,
    environment,
    runWarnings,
    configSettings,
    timing,
    audits = {},
  } = {}) {
    return {
      categories,
      requestedUrl,
      fetchTime,
      finalUrl,
      mainDocumentUrl,
      finalDisplayedUrl,
      lighthouseVersion,
      userAgent,
      environment,
      runWarnings,
      configSettings,
      timing,
      audits: {
        'third-party-summary': audits['third-party-summary'],
        'total-blocking-time': audits['total-blocking-time'],
      },
    };
  }

  /**
   * Performs a PageSpeed Insights check on the specified domain.
   *
   * @param {string} domain - The domain to perform the PSI check on.
   * @param {string} strategy - The strategy to use for the PSI check.
   * @returns {Promise<object>} The processed PageSpeed Insights audit data.
   */
  const performPSICheck = async (domain, strategy) => {
    try {
      const apiURL = getPSIApiUrl(domain, strategy);
      const { data: lhs } = await axios.get(apiURL);

      const { lighthouseResult } = processAuditData(lhs);

      return processLighthouseResult(lighthouseResult);
    } catch (e) {
      log('error', `Error happened during PSI check: ${e}`);
      throw e;
    }
  };

  const runAudit = async (domain) => {
    const auditResults = {};

    for (const strategy of PSI_STRATEGIES) {
      const strategyStartTime = process.hrtime();
      // eslint-disable-next-line no-await-in-loop
      const psiResult = await performPSICheck(domain, strategy);
      const strategyEndTime = process.hrtime(strategyStartTime);
      const strategyElapsedTime = (strategyEndTime[0] + strategyEndTime[1] / 1e9).toFixed(2);
      log('info', `Audited ${domain} for ${strategy} strategy in ${strategyElapsedTime} seconds`);

      auditResults[strategy] = psiResult;
    }

    return {
      type: AUDIT_TYPE,
      finalUrl: auditResults[FORM_FACTOR_MOBILE]?.finalUrl,
      time: auditResults[FORM_FACTOR_MOBILE]?.fetchTime,
      result: auditResults,
    };
  };

  return {
    FORM_FACTOR_MOBILE,
    FORM_FACTOR_DESKTOP,
    formatURL,
    getPSIApiUrl,
    performPSICheck,
    processAuditData,
    runAudit,
  };
}

module.exports = PSIClient;
