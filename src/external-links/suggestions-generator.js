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

import { getPrompt, isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { getScrapedDataForSiteId } from '../support/utils.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS;

export const generateSuggestionData = async (finalUrl, audit, context, site) => {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const { FIREFALL_MODEL } = context.env;
  const { brokenExternalLinks } = audit.getAuditResult();

  if (audit.getAuditResult().success === false) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping suggestions generation`);
    return brokenExternalLinks;
  }

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('broken-external-links-auto-suggest', site)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Auto-suggest is disabled for site`);
    return brokenExternalLinks;
  }

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Generating suggestions for site ${finalUrl}`);

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
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No site data found, skipping suggestions generation`);
    return brokenExternalLinks;
  }

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Processing ${siteData.length} alternative URLs in ${totalBatches} batches of ${BATCH_SIZE}...`);

  const processBatches = async (batches, brokenUrl) => {
    const batchResults = await Promise.all(
      batches.map(async (batch) => {
        try {
          const requestBody = await getPrompt(
            {
              alternative_urls: batch,
              broken_url: brokenUrl,
            },
            'broken-external-links',
            log,
          );
          const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);
          if (!response.choices || response.choices[0].finish_reason !== 'stop') {
            log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No suggestions found for ${brokenUrl}`);
            return null;
          }
          return JSON.parse(response.choices[0].message.content);
        } catch (error) {
          log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Batch processing error: ${error.message}`);
          return null;
        }
      }),
    );
    return batchResults.filter(Boolean);
  };

  /**
   * Process a broken external link to generate URL suggestions
   * @param {Object} link - The broken external link object containing urlTo and other properties
   * @param {Object} headerSuggestions - Suggestions generated from header links
   * @returns {Promise<Object>} Updated link object with suggested URLs and AI rationale
   */
  const processLink = async (link, headerSuggestions) => {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Processing link: ${link.urlTo}`);
    const suggestions = await processBatches(dataBatches, link.urlTo);

    if (totalBatches > 1) {
      log.info(
        `[${AUDIT_TYPE}] [Site: ${site.getId()}] Compiling final suggestions for: ${link.urlTo}`,
      );
      try {
        const finalRequestBody = await getPrompt(
          {
            suggested_urls: suggestions,
            header_links: headerSuggestions,
            broken_url: link.urlTo,
          },
          'broken-external-links-followup',
          log,
        );
        const finalResponse = await firefallClient
          .fetchChatCompletion(finalRequestBody, firefallOptions);

        if (!finalResponse.choices || finalResponse.choices[0].finish_reason !== 'stop') {
          log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No final suggestions found for ${link.urlTo}`);
          return { ...link };
        }

        const answer = JSON.parse(finalResponse.choices[0].message.content);

        log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Final suggestion for ${link.urlTo}:, ${JSON.stringify(answer)}`, answer);
        const urlsSuggested = Array.isArray(answer.suggested_urls)
          && answer.suggested_urls.length > 0
          ? answer.suggested_urls
          : [finalUrl];

        const aiRationale = typeof answer.aiRationale === 'string'
          && answer.aiRationale.trim().length > 0
          ? answer.aiRationale
          : 'No suitable suggestions found';

        return {
          ...link,
          urlsSuggested,
          aiRationale,
        };
      } catch (error) {
        log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Final suggestion error for ${link.urlTo}: ${error.message}`);
        return { ...link };
      }
    }

    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Suggestions for ${link.urlTo}: ${JSON.stringify(suggestions[0]?.suggested_urls)}`);
    return {
      ...link,
      urlsSuggested:
        suggestions[0]?.suggested_urls?.length > 0 ? suggestions[0]?.suggested_urls : [finalUrl],
      aiRationale:
        suggestions[0]?.aiRationale?.length > 0 ? suggestions[0]?.aiRationale : 'No suitable suggestions found',
    };
  };

  // Process all header suggestions in parallel
  const headerSuggestionsPromises = brokenExternalLinks.map(async (link) => {
    try {
      const requestBody = await getPrompt(
        { alternative_urls: headerLinks, broken_url: link.urlTo },
        'broken-external-links',
        log,
      );
      const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);
      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No header suggestions for ${link.urlTo}`);
        return null;
      }
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Header suggestion error: ${error.message}`);
      return null;
    }
  });

  const headerSuggestions = await Promise.all(headerSuggestionsPromises);

  // Process all links in parallel
  const updatedExternalLinks = await Promise.all(
    brokenExternalLinks.map(async (link, index) => {
      const headerSuggestion = headerSuggestions[index];
      return processLink(link, headerSuggestion);
    }),
  );

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Suggestions generation complete.`);

  return updatedExternalLinks;
};
