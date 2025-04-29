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

import { getPrompt, isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { getScrapedDataForSiteId } from '../support/utils.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

export const generateSuggestionData = async (finalUrl, audit, context, site) => {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const { FIREFALL_MODEL } = context.env;
  const { brokenInternalLinks } = audit.getAuditResult();

  if (audit.getAuditResult().success === false) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Audit failed, skipping suggestions generation`);
    return brokenInternalLinks;
  }

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('broken-internal-links-auto-suggest', site)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Auto-suggest is disabled for site`);
    return brokenInternalLinks;
  }

  log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Generating suggestions for site ${finalUrl}`);

  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = { responseFormat: 'json_object', model: FIREFALL_MODEL };
  const BATCH_SIZE = 300;

  const data = await getScrapedDataForSiteId(site, context);
  const { siteData, headerLinks } = data;
  const totalBatches = Math.ceil(siteData.length / BATCH_SIZE);
  const dataBatches = Array.from(
    { length: totalBatches },
    (_, i) => siteData.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  );

  // return early if site data is not found
  if (!isNonEmptyArray(siteData)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] No site data found, skipping suggestions generation`);
    return brokenInternalLinks;
  }

  log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Processing ${siteData.length} alternative URLs in ${totalBatches} batches of ${BATCH_SIZE}...`);

  const processBatch = async (batch, urlTo) => {
    const requestBody = await getPrompt({ alternative_urls: batch, broken_url: urlTo }, 'broken-backlinks', log);
    const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);
    if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
      log.error(`[${AUDIT_TYPE}] [Site: ${site.siteId}] No suggestions found for ${urlTo}`);
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
        log.error(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Batch processing error: ${error.message}`);
      }
    }
    return results;
  }

  /**
   * Process a broken internal link to generate URL suggestions
   * @param {Object} link - The broken internal link object containing urlTo and other properties
   * @param {Object} headerSuggestions - Suggestions generated from header links
   * @returns {Promise<Object>} Updated link object with suggested URLs and AI rationale
   */
  const processLink = async (link, headerSuggestions) => {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Processing link: ${link.urlTo}`);
    const suggestions = await processBatches(dataBatches, link.urlTo);

    if (totalBatches > 1) {
      log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Compiling final suggestions for: ${link.urlTo}`);
      try {
        const finalRequestBody = await getPrompt({ suggested_urls: suggestions, header_links: headerSuggestions, broken_url: link.urlTo }, 'broken-backlinks-followup', log);
        const finalResponse = await firefallClient
          .fetchChatCompletion(finalRequestBody, firefallOptions);

        if (finalResponse.choices?.length >= 1 && finalResponse.choices[0].finish_reason !== 'stop') {
          log.error(`[${AUDIT_TYPE}] [Site: ${site.siteId}] No final suggestions found for ${link.urlTo}`);
          return { ...link };
        }

        const answer = JSON.parse(finalResponse.choices[0].message.content);
        log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Final suggestion for ${link.urlTo}:, ${JSON.stringify(answer)}`, answer);
        return {
          ...link,
          urlsSuggested: answer.suggested_urls?.length > 0 ? answer.suggested_urls : [finalUrl],
          aiRationale: answer.aiRationale?.length > 0 ? answer.aiRationale : 'No suitable suggestions found',
        };
      } catch (error) {
        log.error(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Final suggestion error for ${link.urlTo}: ${error.message}`);
        return { ...link };
      }
    }

    log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Suggestions for ${link.urlTo}: ${JSON.stringify(suggestions[0]?.suggested_urls)}`);
    return {
      ...link,
      urlsSuggested:
        suggestions[0]?.suggested_urls?.length > 0 ? suggestions[0]?.suggested_urls : [finalUrl],
      aiRationale:
        suggestions[0]?.aiRationale?.length > 0 ? suggestions[0]?.aiRationale : 'No suitable suggestions found',
    };
  };

  const headerSuggestionsResults = [];
  for (const link of brokenInternalLinks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const requestBody = await getPrompt({ alternative_urls: headerLinks, broken_url: link.urlTo }, 'broken-backlinks', log);
      // eslint-disable-next-line no-await-in-loop
      const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);
      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error(`[${AUDIT_TYPE}] [Site: ${site.siteId}] No header suggestions for ${link.urlTo}`);
        headerSuggestionsResults.push(null);
        // eslint-disable-next-line no-continue
        continue;
      }

      headerSuggestionsResults.push(JSON.parse(response.choices[0].message.content));
    } catch (error) {
      log.error(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Header suggestion error: ${error.message}`);
      headerSuggestionsResults.push(null);
    }
  }

  const updatedInternalLinks = [];
  for (let index = 0; index < brokenInternalLinks.length; index += 1) {
    const link = brokenInternalLinks[index];
    const headerSuggestions = headerSuggestionsResults[index];
    // eslint-disable-next-line no-await-in-loop
    const updatedLink = await processLink(link, headerSuggestions);
    updatedInternalLinks.push(updatedLink);
  }

  log.info(`[${AUDIT_TYPE}] [Site: ${site.siteId}] Suggestions generation complete.`);

  return updatedInternalLinks;
};
