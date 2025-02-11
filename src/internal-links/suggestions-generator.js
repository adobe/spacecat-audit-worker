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

import { getPrompt } from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { getScrapedDataForSiteId } from '../support/utils.js';

export const generateSuggestionData = async (finalUrl, auditData, context, site) => {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;

  if (auditData.auditResult.success === false) {
    log.info('Audit failed, skipping suggestions generation');
    return { ...auditData };
  }

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('broken-internal-links-auto-suggest', site)) {
    log.info('Auto-suggest is disabled for site');
    return { ...auditData };
  }

  log.info(`Generating suggestions for site ${finalUrl}`);

  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = { responseFormat: 'json_object' };
  const BATCH_SIZE = 300;

  const data = await getScrapedDataForSiteId(site, context);
  const { siteData, headerLinks } = data;
  const totalBatches = Math.ceil(siteData.length / BATCH_SIZE);
  const dataBatches = Array.from(
    { length: totalBatches },
    (_, i) => siteData.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  );

  log.info(`Processing ${siteData.length} alternative URLs in ${totalBatches} batches of ${BATCH_SIZE}...`);

  const processBatch = async (batch, urlTo) => {
    const requestBody = await getPrompt({ alternative_urls: batch, broken_url: urlTo }, 'broken-backlinks', log);
    log.info(`Request body: 50 ${JSON.stringify(requestBody)}`);
    const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);
    log.info(`Response: 52 ${JSON.stringify(response)}`);
    if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
      log.error(`No suggestions found for ${urlTo}`);
      return null;
    }

    return JSON.parse(response.choices[0].message.content);
  };

  async function processBatches(batches, urlTo) {
    const results = [];
    for (const batch of batches) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await processBatch(batch, urlTo);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        log.error(`Batch processing error: ${error.message}`);
      }
    }
    return results;
  }

  /**
   * Process a broken internal link to generate URL suggestions
   * @param {Object} link - The broken internal link object containing url_to and other properties
   * @param {Object} headerSuggestions - Suggestions generated from header links
   * @returns {Promise<Object>} Updated link object with suggested URLs and AI rationale
   */
  const processLink = async (link, headerSuggestions) => {
    log.info(`Processing link: ${link.url_to}`);
    const suggestions = await processBatches(dataBatches, link.url_to);

    if (totalBatches > 1) {
      log.info(`Compiling final suggestions for: ${link.url_to}`);
      try {
        const finalRequestBody = await getPrompt({ suggested_urls: suggestions, header_links: headerSuggestions, broken_url: link.url_to }, 'broken-backlinks-followup', log);
        log.info(`Final request body: 91 ${JSON.stringify(finalRequestBody)}`);
        const finalResponse = await firefallClient
          .fetchChatCompletion(finalRequestBody, firefallOptions);

        if (finalResponse.choices?.length >= 1 && finalResponse.choices[0].finish_reason !== 'stop') {
          log.error(`No final suggestions found for ${link.url_to}`);
          return { ...link };
        }

        const answer = JSON.parse(finalResponse.choices[0].message.content);
        log.info(`Final suggestion for ${link.url_to}:, ${JSON.stringify(answer)}`, answer);
        return {
          ...link,
          urls_suggested: answer.suggested_urls?.length > 0 ? answer.suggested_urls : [finalUrl],
          ai_rationale: answer.ai_rationale?.length > 0 ? answer.ai_rationale : 'No suitable suggestions found',
        };
      } catch (error) {
        log.error(`Final suggestion error for ${link.url_to}: ${error.message}`);
        return { ...link };
      }
    }

    log.info(`Suggestions for ${link.url_to}: ${JSON.stringify(suggestions[0]?.suggested_urls)}`);
    return {
      ...link,
      urls_suggested:
        suggestions[0]?.suggested_urls?.length > 0 ? suggestions[0]?.suggested_urls : [finalUrl],
      ai_rationale:
        suggestions[0]?.ai_rationale?.length > 0 ? suggestions[0]?.ai_rationale : 'No suitable suggestions found',
    };
  };

  const headerSuggestionsResults = [];
  for (const link of auditData.auditResult.brokenInternalLinks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const requestBody = await getPrompt({ alternative_urls: headerLinks, broken_url: link.url_to }, 'broken-backlinks', log);
      log.info(`Final request body: 128 ${JSON.stringify(requestBody)}`);
      // eslint-disable-next-line no-await-in-loop
      const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);
      log.info(`Response: 131 ${JSON.stringify(response)}`);
      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error(`No header suggestions for ${link.url_to}`);
        headerSuggestionsResults.push(null);
        // eslint-disable-next-line no-continue
        continue;
      }

      headerSuggestionsResults.push(JSON.parse(response.choices[0].message.content));
    } catch (error) {
      log.error(`Header suggestion error: ${error.message}`);
      headerSuggestionsResults.push(null);
    }
  }

  const updatedInternalLinks = [];
  for (let index = 0; index < auditData.auditResult.brokenInternalLinks.length; index += 1) {
    const link = auditData.auditResult.brokenInternalLinks[index];
    const headerSuggestions = headerSuggestionsResults[index];
    // eslint-disable-next-line no-await-in-loop
    const updatedLink = await processLink(link, headerSuggestions);
    updatedInternalLinks.push(updatedLink);
  }

  log.info('Suggestions generation complete.');
  return {
    ...auditData,
    auditResult: {
      brokenInternalLinks: updatedInternalLinks,
    },
  };
};
