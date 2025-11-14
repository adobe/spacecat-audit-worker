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
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { Audit, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { getScrapedDataForSiteId } from '../support/utils.js';
import { syncSuggestions } from '../utils/data-access.js';
import { filterByAuditScope, extractPathPrefix } from './subpath-filter.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

export const generateSuggestionData = async (finalUrl, brokenInternalLinks, context, site) => {
  const { log } = context;

  const azureOpenAIClient = AzureOpenAIClient.createFrom(context);
  const azureOpenAIOptions = { responseFormat: 'json_object' };
  const BATCH_SIZE = 300;

  // Ensure brokenInternalLinks is an array
  if (!Array.isArray(brokenInternalLinks)) {
    log.warn(`[${AUDIT_TYPE}] [Site: ${site.getId()}] brokenInternalLinks is not an array, returning empty array`);
    return [];
  }

  const data = await getScrapedDataForSiteId(site, context);
  const { siteData, headerLinks } = data;

  // Filter siteData and headerLinks by audit scope (subpath/locale) if baseURL has a subpath
  // This ensures AI only sees URLs from the same locale as alternatives
  const baseURL = site.getBaseURL();
  const filteredSiteData = filterByAuditScope(siteData, baseURL, {}, log);
  const filteredHeaderLinks = filterByAuditScope(headerLinks, baseURL, {}, log);

  // Also filter per broken link by its locale for more precise suggestions
  const brokenLinksWithFilteredData = brokenInternalLinks.map((link) => {
    const linkPathPrefix = extractPathPrefix(link.urlTo) || extractPathPrefix(link.urlFrom);

    // If broken link has a path prefix, further filter alternatives to same prefix
    let linkFilteredSiteData;
    let linkFilteredHeaderLinks;

    if (linkPathPrefix) {
      if (filteredSiteData.length > 0) {
        const prefixFilteredSiteData = filteredSiteData.filter((item) => {
          // siteData items can be either strings (URLs) or objects with a 'url' property
          const url = typeof item === 'string' ? item : item?.url;
          const urlPathPrefix = extractPathPrefix(url);
          return urlPathPrefix === linkPathPrefix;
        });

        // Only use prefix-filtered data if it's not empty,
        // otherwise fall back to base-filtered data
        if (prefixFilteredSiteData.length > 0) {
          linkFilteredSiteData = prefixFilteredSiteData;
        }
      }

      if (filteredHeaderLinks.length > 0) {
        const prefixFilteredHeaderLinks = filteredHeaderLinks.filter((item) => {
          // headerLinks can be either strings (URLs) or objects with a 'url' property
          const url = typeof item === 'string' ? item : item?.url;
          const urlPathPrefix = extractPathPrefix(url);
          return urlPathPrefix === linkPathPrefix;
        });

        if (prefixFilteredHeaderLinks.length > 0) {
          linkFilteredHeaderLinks = prefixFilteredHeaderLinks;
        }
      }
    }

    return {
      ...link,
      filteredSiteData: linkFilteredSiteData,
      filteredHeaderLinks: linkFilteredHeaderLinks,
    };
  });

  const totalBatches = Math.ceil(filteredSiteData.length / BATCH_SIZE);
  const dataBatches = Array.from(
    { length: totalBatches },
    (_, i) => filteredSiteData.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  );

  // return early if site data is not found
  if (!isNonEmptyArray(filteredSiteData)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No site data found, skipping suggestions generation`);
    // Return broken links as-is (already validated as array above)
    return brokenInternalLinks;
  }

  const processBatch = async (batch, urlTo) => {
    const requestBody = await getPrompt({ alternative_urls: batch, broken_url: urlTo }, 'broken-backlinks', log);
    const response = await azureOpenAIClient.fetchChatCompletion(requestBody, azureOpenAIOptions);
    if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
      log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No suggestions found for ${urlTo}`);
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
        log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Batch processing error: ${error.message}`);
      }
    }
    return results;
  }

  /**
   * Process a broken internal link to generate URL suggestions
   * @param {Object} link - The broken internal link object containing urlTo,
   *   filteredSiteData, filteredHeaderLinks
   * @param {Object} headerSuggestions - Suggestions generated from header links
   * @returns {Promise<Object>} Updated link object with suggested URLs and AI rationale
   */
  const processLink = async (link, headerSuggestions) => {
    // Use link-specific filtered data for this broken link
    const linkBatches = link.filteredSiteData
      ? Array.from(
        { length: Math.ceil(link.filteredSiteData.length / BATCH_SIZE) },
        (_, i) => link.filteredSiteData.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
      )
      : dataBatches;

    const linkTotalBatches = linkBatches.length;
    const suggestions = await processBatches(linkBatches, link.urlTo);

    if (linkTotalBatches > 1) {
      try {
        const finalRequestBody = await getPrompt({ suggested_urls: suggestions, header_links: headerSuggestions, broken_url: link.urlTo }, 'broken-backlinks-followup', log);
        const finalResponse = await azureOpenAIClient
          .fetchChatCompletion(finalRequestBody, azureOpenAIOptions);

        if (finalResponse.choices?.length >= 1 && finalResponse.choices[0].finish_reason !== 'stop') {
          log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No final suggestions found for ${link.urlTo}`);
          return { ...link };
        }

        const answer = JSON.parse(finalResponse.choices[0].message.content);
        return {
          ...link,
          urlsSuggested: answer.suggested_urls?.length > 0 ? answer.suggested_urls : [finalUrl],
          aiRationale: answer.aiRationale?.length > 0 ? answer.aiRationale : 'No suitable suggestions found',
        };
      } catch (error) {
        log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Final suggestion error for ${link.urlTo}: ${error.message}`);
        return { ...link };
      }
    }

    return {
      ...link,
      urlsSuggested:
                suggestions[0]?.suggested_urls?.length > 0
                  ? suggestions[0]?.suggested_urls
                  : [finalUrl],
      aiRationale:
                suggestions[0]?.aiRationale?.length > 0 ? suggestions[0]?.aiRationale : 'No suitable suggestions found',
    };
  };

  const headerSuggestionsResults = [];
  for (const link of brokenLinksWithFilteredData) {
    try {
      // Use link-specific filtered header links
      const linkHeaderLinks = link.filteredHeaderLinks || filteredHeaderLinks;
      // eslint-disable-next-line no-await-in-loop
      const requestBody = await getPrompt({ alternative_urls: linkHeaderLinks, broken_url: link.urlTo }, 'broken-backlinks', log);
      // eslint-disable-next-line no-await-in-loop
      const response = await azureOpenAIClient.fetchChatCompletion(
        requestBody,
        azureOpenAIOptions,
      );
      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No header suggestions for ${link.urlTo}`);
        headerSuggestionsResults.push(null);
        // eslint-disable-next-line no-continue
        continue;
      }

      headerSuggestionsResults.push(JSON.parse(response.choices[0].message.content));
    } catch (error) {
      log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Header suggestion error: ${error.message}`);
      headerSuggestionsResults.push(null);
    }
  }

  const updatedInternalLinks = [];
  for (let index = 0; index < brokenLinksWithFilteredData.length; index += 1) {
    const link = brokenLinksWithFilteredData[index];
    const headerSuggestions = headerSuggestionsResults[index];
    // eslint-disable-next-line no-await-in-loop
    const updatedLink = await processLink(link, headerSuggestions);
    // Remove filtered data before returning (not needed in final result)
    const cleanLink = { ...updatedLink };
    delete cleanLink.filteredSiteData;
    delete cleanLink.filteredHeaderLinks;
    updatedInternalLinks.push(cleanLink);
  }
  return updatedInternalLinks;
};

export async function syncBrokenInternalLinksSuggestions({
  opportunity,
  brokenInternalLinks,
  context,
  opportunityId,
}) {
  const buildKey = (item) => `${item.urlFrom}-${item.urlTo}`;
  await syncSuggestions({
    opportunity,
    newData: brokenInternalLinks,
    context,
    buildKey,
    statusToSetForOutdated: SuggestionDataAccess.STATUSES.FIXED,
    mapNewSuggestion: (entry) => ({
      opportunityId,
      type: 'CONTENT_UPDATE',
      rank: entry.trafficDomain,
      data: {
        title: entry.title,
        urlFrom: entry.urlFrom,
        urlTo: entry.urlTo,
        urlsSuggested: entry.urlsSuggested || [],
        aiRationale: entry.aiRationale || '',
        trafficDomain: entry.trafficDomain,
      },
    }),
  });
}
