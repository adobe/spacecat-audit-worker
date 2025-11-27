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

import {
  badRequest, notFound, ok, noContent,
} from '@adobe/spacecat-shared-http-utils';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { load as cheerioLoad } from 'cheerio';

import { syncSuggestions } from '../utils/data-access.js';
import { getJsonFaqSuggestion } from './utils.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../utils/s3-utils.js';

/**
 * Gets the S3 path for a scrape JSON file
 * @param {string} url - The page URL
 * @param {string} siteId - The site ID
 * @returns {string} The S3 path
 */
function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

/**
 * Checks if a heading contains FAQ-related text
 * @param {string} text - The heading text
 * @returns {boolean} True if the heading contains FAQ-related text
 */
function isFaqHeading(text) {
  const faqPatterns = [
    /\bfaq\b/i,
    /frequently\s+asked\s+questions?/i,
    /common\s+questions?/i,
    /questions?\s+and\s+answers?/i,
    /q\s*&\s*a/i,
  ];
  return faqPatterns.some((pattern) => pattern.test(text));
}

/**
 * Analyzes scrape data to check for FAQ headings and determine selector
 * @param {string} url - The page URL
 * @param {string} siteId - The site ID
 * @param {Array} allKeys - All S3 keys
 * @param {Object} s3Client - S3 client
 * @param {string} bucketName - S3 bucket name
 * @param {Object} log - Logger
 * @returns {Promise<Object>} Analysis result with shouldOptimize flag and selector
 */
async function analyzeScrapeData(url, siteId, allKeys, s3Client, bucketName, log) {
  const defaultResult = {
    shouldOptimize: true, // Default: should optimize
    selector: 'body', // Default fallback
  };

  try {
    const scrapeJsonPath = getScrapeJsonPath(url, siteId);
    const s3Key = allKeys.find((key) => key.includes(scrapeJsonPath));

    if (!s3Key) {
      log.warn(`[FAQ] Scrape JSON path not found for ${url}, using defaults`);
      return defaultResult;
    }

    const scrapeJsonObject = await getObjectFromKey(s3Client, bucketName, s3Key, log);
    if (!scrapeJsonObject) {
      log.warn(`[FAQ] Scrape JSON object not found for ${url}, using defaults`);
      return defaultResult;
    }

    const $ = cheerioLoad(scrapeJsonObject.scrapeResult.rawBody);

    // Check if main element exists
    const hasMain = $('main').length > 0;
    const selector = hasMain ? 'main' : 'body';

    // Check all heading tags for FAQ-related content
    const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    let hasFaqHeading = false;

    for (const tag of headingTags) {
      const headings = $(tag);
      let foundInThisTag = false;
      headings.each((i, heading) => {
        const text = ($(heading).text() || '').trim();
        if (isFaqHeading(text)) {
          foundInThisTag = true;
          log.info(`[FAQ] Found FAQ heading in ${tag}: "${text}" on ${url}`);
          return false; // Break out of .each()
        }
        return true;
      });
      if (foundInThisTag) {
        hasFaqHeading = true;
        break;
      }
    }

    return {
      shouldOptimize: !hasFaqHeading, // Don't optimize if FAQ heading already exists
      selector,
    };
  } catch (error) {
    log.error(`[FAQ] Error analyzing scrape data for ${url}: ${error.message}`);
    return defaultResult;
  }
}

async function createOpportunity(siteId, auditId, baseUrl, guidance, context) {
  const opportunity = await convertToOpportunity(
    baseUrl,
    {
      siteId,
      auditId,
      id: auditId,
    },
    context,
    createOpportunityData,
    'faq',
    { guidance },
  );
  return opportunity;
}

async function addSuggestions(
  opportunity,
  suggestions,
  context,
  site,
) {
  const { log, s3Client, env } = context;
  const { S3_SCRAPER_BUCKET_NAME } = env;
  const siteId = site.getId();

  // Get all S3 keys for scrape data
  let allKeys = [];
  try {
    const prefix = `scrapes/${siteId}/`;
    allKeys = await getObjectKeysUsingPrefix(s3Client, S3_SCRAPER_BUCKET_NAME, prefix, log);
    log.info(`[FAQ] Found ${allKeys.length} scrape files for site ${siteId}`);
  } catch (error) {
    log.error(`[FAQ] Error fetching S3 keys: ${error.message}`);
  }

  // Get base JSON suggestions
  const suggestionValues = getJsonFaqSuggestion(suggestions);

  // Enhance each suggestion with scrape data analysis
  const enhancedSuggestions = await Promise.all(suggestionValues.map(async (suggestion) => {
    // If no URL (topic only), should not optimize
    if (!suggestion.url) {
      return {
        ...suggestion,
        shouldOptimize: false,
      };
    }

    // Check if URL is in the sources
    const sources = suggestion.item?.sources || [];
    const urlInSources = sources.some((source) => source === suggestion.url);

    // If URL is not in sources, should not optimize
    if (!urlInSources) {
      log.info(`[FAQ] URL ${suggestion.url} not found in sources, will not optimize`);
      return {
        ...suggestion,
        shouldOptimize: false,
      };
    }

    // URL is in sources, proceed with scrape data analysis
    const analysis = await analyzeScrapeData(
      suggestion.url,
      siteId,
      allKeys,
      s3Client,
      S3_SCRAPER_BUCKET_NAME,
      log,
    );

    // Update transform rules with analyzed selector
    return {
      ...suggestion,
      shouldOptimize: analysis.shouldOptimize,
      transformRules: {
        ...suggestion.transformRules,
        selector: analysis.selector,
      },
    };
  }));

  await syncSuggestions({
    context,
    opportunity,
    newData: enhancedSuggestions,
    buildKey: (suggestion) => `${suggestion.url}::${suggestion.topic}::${suggestion.item.question}`,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: 10,
      data: suggestion,
    }),
  });
}

/**
 * Handles Mystique response for FAQ suggestions
 * @param {Object} message - Message from Mystique with presigned URL
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site } = dataAccess;
  const { siteId, auditId, data } = message;
  const { presignedUrl } = data;

  log.info(`[FAQ] Message received in FAQ guidance handler: ${JSON.stringify(message, null, 2)}`);

  // Validate presigned URL
  if (!presignedUrl) {
    log.error('[FAQ] No presigned URL provided in message data');
    return badRequest('Presigned URL is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[FAQ] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const baseUrl = site.getBaseURL();

  try {
    // Fetch FAQ data from presigned URL
    log.info(`[FAQ] Fetching FAQ data from presigned URL: ${presignedUrl}`);
    const response = await fetch(presignedUrl);

    if (!response.ok) {
      log.error(`[FAQ] Failed to fetch FAQ data: ${response.status} ${response.statusText}`);
      return badRequest(`Failed to fetch FAQ data: ${response.statusText}`);
    }

    const faqData = await response.json();
    const { suggestions } = faqData;

    // Validate the fetched data
    if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
      log.info('[FAQ] No suggestions found in the response');
      return noContent();
    }
    log.info(`[FAQ] Received ${suggestions.length} FAQ suggestion groups`);

    // Count total suitable FAQs across all suggestions
    const totalSuitableFaqs = suggestions.reduce((count, suggestion) => {
      const suitableFaqs = (suggestion.faqs || []).filter(
        (faq) => faq.isAnswerSuitable && faq.isQuestionRelevant,
      );
      return count + suitableFaqs.length;
    }, 0);

    if (totalSuitableFaqs === 0) {
      log.info('[FAQ] No suitable FAQ suggestions found after filtering');
      return noContent();
    }

    // Create guidance object
    const guidance = [{
      insight: `${totalSuitableFaqs} relevant FAQs identified based on top user prompts in your brand presence analysis`,
      rationale: 'When your content aligns with the user intent recognized by large language models (LLMs), it becomes easier for these models to reference or mention your page in their responses',
      recommendation: 'Add the relevant FAQs listed below to the corresponding pages',
      type: 'CONTENT_UPDATE',
    }];

    // Create opportunity
    const opportunity = await createOpportunity(
      siteId,
      auditId,
      baseUrl,
      guidance,
      context,
    );

    try {
      await addSuggestions(opportunity, suggestions, context, site);
    } catch (e) {
      log.error(`[FAQ] Failed to save FAQ opportunity on Mystique callback: ${e.message}`);
      return badRequest('Failed to persist FAQ opportunity');
    }

    log.info(`[FAQ] Successfully processed FAQ guidance for site: ${siteId}, ${totalSuitableFaqs} suitable FAQs`);
    return ok();
  } catch (error) {
    log.error(`[FAQ] Error processing FAQ guidance: ${error.message}`, error);
    return badRequest(`Error processing FAQ guidance: ${error.message}`);
  }
}
