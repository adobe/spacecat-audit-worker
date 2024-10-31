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

import { context as h2, h1 } from '@adobe/fetch';
import { hasText, prependSchema, resolveCustomerSecretsName } from '@adobe/spacecat-shared-utils';
import URI from 'urijs';
import { JSDOM } from 'jsdom';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { brokenBacklinksPrompt, backlinksSuggestionPrompt } from './prompts.js';

URI.preventInvalidHostname = true;

/* c8 ignore next 3 */
export const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  ? h1()
  : h2();

// weekly pageview threshold to eliminate urls with lack of samples

export async function getRUMUrl(url) {
  const urlWithScheme = prependSchema(url);
  const resp = await fetch(urlWithScheme);
  const finalUrl = resp.url.split('://')[1];
  return finalUrl.endsWith('/') ? finalUrl.slice(0, -1) : /* c8 ignore next */ finalUrl;
}

/**
 * Checks if a given URL contains a domain with a non-www subdomain.
 *
 * @param {string} baseUrl - The URL to check for the presence of a domain with a non-www subdomain.
 * @returns {boolean} - Returns true if the baseUrl param contains a domain with a non-www
 * subdomain, otherwise false
 */
export function hasNonWWWSubdomain(baseUrl) {
  try {
    const uri = new URI(baseUrl);
    return hasText(uri.domain()) && hasText(uri.subdomain()) && uri.subdomain() !== 'www';
  } catch {
    throw new Error(`Cannot parse baseURL: ${baseUrl}`);
  }
}

/**
 * Toggles the www subdomain in a given URL.
 * @param {string} baseUrl - The URL to toggle the www subdomain in.
 * @returns {string} - The URL with the www subdomain toggled.
 */
export function toggleWWW(baseUrl) {
  if (hasNonWWWSubdomain(baseUrl)) return baseUrl;
  return baseUrl.startsWith('https://www')
    ? baseUrl.replace('https://www.', 'https://')
    : baseUrl.replace('https://', 'https://www.');
}

/**
 * Extracts the domain and protocol from a given URL.
 *
 * @param {string} inputUrl - The URL to extract domain and protocol from.
 * @returns {{ domain: string, protocol: string }|null} - An object containing
 * the domain and protocol if successfully extracted,
 * or null if the URL is invalid.
 */
export function extractDomainAndProtocol(inputUrl) {
  try {
    const parsedUrl = new URL(inputUrl);
    return {
      protocol: parsedUrl.protocol.slice(0, -1),
      domain: parsedUrl.hostname,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts URLs from a sitemap XML content based on a specified tag name.
 *
 * @param {Object} content - The content of the sitemap.
 * @param {string} tagName - The name of the tag to extract URLs from.
 * @returns {Array<string>} An array of URLs extracted from the sitemap.
 */
export function extractUrlsFromSitemap(content, tagName = 'url') {
  const dom = new JSDOM(content.payload, { contentType: 'text/xml' });
  const { document } = dom.window;

  const elements = document.getElementsByTagName(tagName);
  // Filter out any nulls if 'loc' element is missing
  return Array.from(elements).map((element) => {
    const loc = element.getElementsByTagName('loc')[0];
    return loc ? loc.textContent : null;
  }).filter((url) => url !== null);
}

/**
 * Filters pages from a sitemap that start with the given base URL or its www variant.
 *
 * @param {string} baseUrl - The base URL to match against the URLs in the sitemap.
 * @param {Object} sitemapDetails - An object containing details about the sitemap.
 * @param {boolean} sitemapDetails.isText - A flag indicating if the sitemap content is plain text.
 * @param {Object} sitemapDetails.sitemapContent - The sitemap content object.
 * @param {string} sitemapDetails.sitemapContent.payload - The actual content of the sitemap.
 *
 * @returns {string[]} URLs from the sitemap that start with the base URL or its www variant.
 */
export function getBaseUrlPagesFromSitemapContents(baseUrl, sitemapDetails) {
  const baseUrlVariant = toggleWWW(baseUrl);

  const filterPages = (pages) => pages.filter(
    (url) => url.startsWith(baseUrl) || url.startsWith(baseUrlVariant),
  );

  if (sitemapDetails.isText) {
    const lines = sitemapDetails.sitemapContent.payload.split('\n').map((line) => line.trim());

    return filterPages(lines.filter((line) => line.length > 0));
  } else {
    const sitemapPages = extractUrlsFromSitemap(sitemapDetails.sitemapContent);

    return filterPages(sitemapPages);
  }
}

/**
 * Extracts sitemap URLs from a sitemap index XML content.
 *
 * @param {Object} content - The content of the sitemap index.
 * @param {string} content.payload - The XML content of the sitemap index as a string.
 * @returns {Array<string>} An array of sitemap URLs extracted from the sitemap index.
 */
export function getSitemapUrlsFromSitemapIndex(content) {
  return extractUrlsFromSitemap(content, 'sitemap');
}

export function getUrlWithoutPath(url) {
  const urlObj = new URL(url);
  return `${urlObj.protocol}//${urlObj.host}`;
}

/**
 * Retrieves the RUM domain key for the specified base URL from the customer secrets.
 *
 * @param {string} baseURL - The base URL for which the RUM domain key is to be retrieved.
 * @param {UniversalContext} context - Helix Universal Context. See https://github.com/adobe/helix-universal/blob/main/src/adapter.d.ts#L120
 * @returns {Promise<string>} - A promise that resolves to the RUM domain key.
 * @throws {Error} Throws an error if no domain key is found for the specified base URL.
 */
export async function getRUMDomainkey(baseURL, context) {
  const customerSecretName = resolveCustomerSecretsName(baseURL, context);
  const { runtime } = context;

  try {
    const client = new SecretsManagerClient({ region: runtime.region });
    const command = new GetSecretValueCommand({
      SecretId: customerSecretName,
    });
    const response = await client.send(command);
    return JSON.parse(response.SecretString)?.RUM_DOMAIN_KEY;
  } catch (error) {
    throw new Error(`Error retrieving the domain key for ${baseURL}. Error: ${error.message}`);
  }
}

/**
 * Extracts keywords from a given URL's path segments.
 *
 * This function takes a URL as input and processes its pathname to extract
 * keywords. Each segment of the path is treated as a keyword, and segments
 * are ranked based on their position in the path. The keyword closer to the
 * end of the path has a higher rank. File extensions, if present, are removed
 * from the last segment.
 *
 * @param {string} url - The URL from which to extract keywords.
 * @param {Object} log - The logger object for logging messages.
 * @returns {Array<{keyword: string, rank: number}>} An array of objects, each containing
 * the keyword and its rank. The rank is determined by the position of the segment
 * in the URL path, with higher ranks for segments closer to the end.
 *
 * @example
 * // Returns [{ keyword: 'foo', rank: 2 }, { keyword: 'bar', rank: 1 }]
 * extractKeywordsFromUrl('http://www.example.com/foo/bar');
 *
 * @example
 * // Returns [{ keyword: 'foo bar', rank: 2 }, { keyword: 'baz', rank: 1 }]
 * extractKeywordsFromUrl('http://www.example.com/foo-bar/baz.html');
 */
export const extractKeywordsFromUrl = (url, log) => {
  try {
    const urlObjc = new URL(url);
    const path = urlObjc.pathname;

    const segments = path.split('/').filter((segment) => segment.length > 0);

    // Remove file extensions from the last segment if present
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      segments[segments.length - 1] = lastSegment.replace(/\.[^/.]+$/, '');
    }

    // Map segments to an array of objects with segment and rank
    return segments.map((segment, index) => ({
      keyword: segment.replace(/-/g, ' '),
      rank: segments.length - index, // Rank: higher for segments closer to the end
    }));
  } catch (error) {
    log.error('Invalid URL:', error);
    return [];
  }
};

const extractDataFromJson = (data, log) => {
  try {
    log.info(`Extracting data from JSON (${data.finalUrl}:`, typeof data.scrapeResult);
    const parsedScrapeResult = JSON.parse(data.scrapeResult);
    const finalUrl = data.finalUrl || '';
    const title = parsedScrapeResult.tags?.title || '';
    const description = parsedScrapeResult.tags?.description || '';
    const h1Tags = parsedScrapeResult.tags?.h1 || [];
    const h1Tag = h1Tags.length > 0 ? h1Tags[0] : '';

    return {
      url: finalUrl,
      title,
      description,
      h1: h1Tag,
    };
  } catch (error) {
    log.error('Error extracting data:', error);
    return null;
  }
};

const extractLinksFromHeader = (rawHtml, baseUrl) => {
  const dom = new JSDOM(rawHtml);
  const { document } = dom.window;

  const header = document.querySelector('header');
  if (!header) {
    return [];
  }

  const links = [];
  header.querySelectorAll('a[href]').forEach((aTag) => {
    const href = aTag.getAttribute('href');
    const fullUrl = new URL(href, baseUrl).href;
    links.push(fullUrl);
  });

  return links;
};

const getFileContentFromS3 = async (s3, key) => {
  const getParams = { Bucket: s3.s3Bucket, Key: key };
  const data = await s3.s3Client.send(new GetObjectCommand(getParams));
  const content = await data.Body.transformToString();
  return JSON.parse(content);
};

/**
 * Retrieves scraped data from the specified S3 bucket.
 * @param s3 - The S3 wrapper object.
 * @param s3.s3Client - The S3 client object.
 * @param s3.s3Bucket - The S3 bucket name.
 * @param site - The site object.
 * @param log - The logger object for logging messages.
 * @returns {Promise<{
 * headerLinks: Array<string>,
 * siteData: Array<Object>
 *   }>} - A promise that resolves to an object containing the header links and site data.
 */
const getScrapedData = async (s3, site, log) => {
  let allFiles = [];
  let isTruncated = true;
  let continuationToken = null;

  // Step 1: List all objects with pagination
  async function fetchFiles() {
    const listParams = {
      Bucket: s3.s3Bucket,
      Prefix: `scrapes/${site.getId()}`,
      ContinuationToken: continuationToken,
    };

    const listResponse = await s3.s3Client.send(new ListObjectsV2Command(listParams));
    allFiles = allFiles.concat(listResponse.Contents);
    isTruncated = listResponse.IsTruncated;
    continuationToken = listResponse.NextContinuationToken;

    if (isTruncated) {
      await fetchFiles();
    }
  }

  await fetchFiles();

  if (allFiles.length === 0) {
    return {
      headerLinks: [],
      siteData: [],
    };
  }

  // Step 2: Extract data from each JSON file
  const extractedData = await Promise.all(
    allFiles.map(async (file) => {
      const fileContent = await getFileContentFromS3(s3, file.Key);
      const jsonData = extractDataFromJson(fileContent, log);

      return jsonData || null;
    }),
  );
  const indexFile = allFiles.find((file) => file.Key.endsWith(`${site.getId()}/scrape.json`));
  const indexFileContent = await getFileContentFromS3(s3, indexFile.Key);
  const headerLinks = extractLinksFromHeader(indexFileContent, site.getBaseURL());

  return {
    headerLinks,
    siteData: extractedData.filter(Boolean),
  };
};

/**
 * Enhances the broken backlinks with suggested fixes, based on LLM decisions.
 * @param brokenBacklinks - The broken backlinks to enhance.
 * @param config - The configuration object.
 * @param config.site - The site object.
 * @param config.s3 - The S3 wrapper object.
 * @param config.firefallClient - The Firefall client object.
 * @param config.log - The logger object for logging messages.
 * @returns {Promise<Awaited<Array>[]>}
 */
export const enhanceBacklinksWithFixes = async (brokenBacklinks, config) => {
  const {
    site, s3, firefallClient, log,
  } = config;
  const BATCH_SIZE = 300;
  const data = await getScrapedData(s3, site, log);
  const totalBatches = Math.ceil(data.siteData.length / BATCH_SIZE);
  log.info(`Processing ${data.siteData.length} alternative URLs in ${totalBatches} batches of ${BATCH_SIZE}...`);

  const dataBatches = [];
  for (let i = 0; i < data.siteData.length; i += BATCH_SIZE) {
    dataBatches.push(data.siteData.slice(i, i + BATCH_SIZE));
  }

  const headerSuggestionsResults = await Promise.all(
    brokenBacklinks.map(async (backlink) => {
      const requestBody = brokenBacklinksPrompt(data.headerLinks, backlink.url_to);
      const response = await firefallClient.fetch(requestBody);
      return JSON.parse(response);
    }),
  );

  return Promise.all(
    brokenBacklinks.map(async (backlink, index) => {
      log.info(`Trying to find redirect for: ${backlink.url_to}`);
      const suggestions = [];

      const batchResults = await Promise.all(
        dataBatches.map(async (batch, batchIndex) => {
          log.info(`Processing batch ${batchIndex + 1}/${totalBatches}...`);
          const requestBody = brokenBacklinksPrompt(batch, backlink.url_to);
          const response = await firefallClient.fetch(requestBody);
          return JSON.parse(response);
        }),
      );
      suggestions.push(...batchResults);

      log.info(`Evaluating final suggestions for: ${backlink.url_to}`);
      const finalRequestBody = backlinksSuggestionPrompt(
        backlink.url_to,
        suggestions,
        headerSuggestionsResults[index],
      );
      const finalResponse = await firefallClient.fetch(finalRequestBody);
      const finalSuggestion = JSON.parse(finalResponse);

      const newBacklink = { ...backlink };
      newBacklink.url_suggested = finalSuggestion.suggested_urls[0] || '';
      return newBacklink;
    }),
  );
};
