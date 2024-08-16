/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { AuditBuilder } from '../common/audit-builder.js';

/**
 * Processes an audit of the top pages of a site using Google's URL inspection tool.
 *
 * @async
 * @function
 * @param {string} baseURL - The base URL for the audit.
 * @param {Object} context - The context object.
 * @param {Object} site - The site object for the site to be audited.
 *
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of objects,
 * each containing the inspection URL, filtered index status result, and filtered rich results.
 * If an error occurs during the inspection of a URL, the object will include an error message.
 *
 * @throws {Error} - Throws an error if the audit process fails.
 */
async function processAudit(baseURL, context, site) {
  const { dataAccess, log } = context;
  const siteId = site.getId();

  const topPages = await dataAccess.getTopPagesForSite(siteId, 'ahrefs', 'global');
  if (!topPages || topPages.length === 0) {
    log.warn(`No top pages found for site ID: ${siteId}`);
    return [];
  }

  const google = GoogleClient.createFrom(context, baseURL);

  const urlInspectionResult = topPages.map(async (page) => {
    try {
      const { inspectionResult } = await google.urlInspect(page.url);
      log.info(`Successfully inspected URL: ${page.url}`);

      const filteredIndexStatusResult = {
        verdict: inspectionResult.indexStatusResult.verdict,
        lastCrawlTime: inspectionResult.indexStatusResult.lastCrawlTime,
      };

      const filteredRichResults = inspectionResult.richResultsResult.detectedItems.map(
        (item) => {
          const filteredItems = item.items.filter(
            (issueItem) => issueItem.issues.some(
              (issue) => issue.severity === 'ERROR',
            ),
          ).map((issueItem) => ({
            name: issueItem.name,
            issues: issueItem.issues.filter((issue) => issue.severity === 'ERROR'),
          }));

          return {
            richResultType: item.richResultType,
            items: filteredItems,
          };
        },
      ).filter((item) => item.items.length > 0);

      if (filteredRichResults.length > 0) {
        filteredRichResults.verdict = inspectionResult.richResultsResult.verdict;
        log.info(`Found ${filteredRichResults.length} rich results issues for URL: ${page.url}`);
      } else {
        log.info(`No rich results issues found for URL: ${page.url}`);
      }

      return {
        inspectionUrl: page.url,
        indexStatusResult: filteredIndexStatusResult,
        richResults: filteredRichResults,
      };
    } catch (error) {
      log.error(`Failed to inspect URL: ${page.url}. Error: ${error.message}`);
      return {
        inspectionUrl: page.url,
        error: error.message,
      };
    }
  });

  return Promise.all(urlInspectionResult);
}

export async function urlInspectRunner(baseURL, context, site) {
  const { log } = context;
  log.info(`Received URL Inspect audit request for ${baseURL}`);
  const startTime = process.hrtime();

  const auditResult = await processAudit(baseURL, context, site);

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`URL Inspect Audit completed in ${formattedElapsed} seconds for ${baseURL}`);

  return {
    fullAuditRef: baseURL,
    auditResult,
  };
}

export default new AuditBuilder()
  .withRunner(urlInspectRunner)
  .withUrlResolver((site) => site.getBaseURL())
  .build();
