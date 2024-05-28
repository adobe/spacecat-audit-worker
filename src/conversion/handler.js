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
import RUMAPIClient, { createConversionURL } from '@adobe/spacecat-shared-rum-api-client';

import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMUrl } from '../support/utils.js';

function processRUMResponse(rumSourcesData, rumDashboardData) {
  const conversionData = rumSourcesData.map((rumSourcesObj) => {
    // Find the matching object in the second array based on URL
    const matchingObj = rumDashboardData.find((rumDbObj) => rumDbObj.url === rumSourcesObj.url);
    // If a matching object is found, return a new object with pageviews property
    if (matchingObj) {
      // create a new object with pageviews property
      return { ...rumSourcesObj, pageviews: matchingObj.pageviews };
    }
    // If no matching object is found, return the original object
    return rumSourcesObj;
  });

  return conversionData;
}

async function processAudit(baseURL, context) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const finalUrl = await getRUMUrl(baseURL);
  const params = {
    url: finalUrl,
  };
  const rumSourcesData = await rumAPIClient.getConversionData(params);
  const rumDashboardData = await rumAPIClient.getRUMDashboard(params);
  return {
    auditResult: processRUMResponse(rumSourcesData, rumDashboardData),
    fullAuditRef: createConversionURL({ url: finalUrl }),
  };
}

/**
 * This function is responsible for running the conversion audit.
 * It logs the start and end of the audit, calculates the elapsed time, and returns the audit data.
 *
 * @param {string} baseURL - The base URL for the audit.
 * @param {object} context - The context object, which includes the log object for logging.
 * @returns {Promise<object>} - Returns a promise that resolves with the audit data.
 */
export async function conversionAuditRunner(baseURL, context) {
  const { log } = context;
  log.info(`Received Conversion audit request for ${baseURL}`);
  const startTime = process.hrtime();
  const auditData = await processAudit(
    baseURL,
    context,
  );
  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`Conversion Audit completed in ${formattedElapsed} seconds for ${baseURL}`);
  return auditData;
}

export default new AuditBuilder()
  .withRunner(conversionAuditRunner)
  .withUrlResolver((site) => site.getBaseURL())
  .build();
