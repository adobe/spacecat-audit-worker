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

import {
  hasText,
  prependSchema,
  resolveCustomerSecretsName,
  tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';
import URI from 'urijs';
import { JSDOM } from 'jsdom';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

URI.preventInvalidHostname = true;

// weekly pageview threshold to eliminate urls with lack of samples

export async function getRUMUrl(url) {
  const urlWithScheme = prependSchema(url);
  const resp = await fetch(urlWithScheme, {
    method: 'GET',
    headers: {
      'User-Agent': 'curl/7.88.1', // Set the same User-Agent
    },
  });
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
 * @param {String} payload - The sitemap contents.
 * @param {string} tagName - The name of the tag to extract URLs from.
 * @returns {Array<string>} An array of URLs extracted from the sitemap.
 */
export function extractUrlsFromSitemap(payload, tagName = 'url') {
  const dom = new JSDOM(payload, { contentType: 'text/xml' });
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
  if (!baseUrl?.length || !sitemapDetails?.sitemapContent?.payload?.length) {
    return [];
  }

  const baseUrlVariant = toggleWWW(baseUrl);

  const filterPages = (pages) => pages.filter(
    (url) => url && (url.startsWith(baseUrl) || url.startsWith(baseUrlVariant)),
  );

  if (sitemapDetails.isText) {
    const lines = sitemapDetails.sitemapContent.payload.split('\n').map((line) => line.trim());
    return filterPages(lines.filter((line) => line.length > 0));
  } else {
    const sitemapPages = extractUrlsFromSitemap(sitemapDetails.sitemapContent.payload);
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
  return extractUrlsFromSitemap(content.payload, 'sitemap');
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

const getFileContentFromS3 = async (s3Client, bucket, key) => {
  const getCommand = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  const data = await s3Client.send(getCommand);
  const content = await data.Body.transformToString();
  return JSON.parse(content);
};

const extractScrapedMetadataFromJson = (data, log) => {
  try {
    log.debug(`Extracting data from JSON (${data.finalUrl}:`, JSON.stringify(data.scrapeResult.tags));
    const finalUrl = data.finalUrl || '';
    const title = data.scrapeResult.tags?.title || '';
    const description = data.scrapeResult.tags?.description || '';
    const h1Tags = data.scrapeResult.tags?.h1 || [];
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

export const getScrapedDataForSiteId = async (site, context) => {
  const { s3Client, env, log } = context;
  const siteId = site.getId();

  let allFiles = [];
  let isTruncated = true;
  let continuationToken = null;

  async function fetchFiles() {
    const listCommand = new ListObjectsV2Command({
      Bucket: env.S3_SCRAPER_BUCKET_NAME,
      Prefix: `scrapes/${siteId}`,
      ContinuationToken: continuationToken,
    });

    const listResponse = await s3Client.send(listCommand);
    allFiles = allFiles.concat(
      listResponse.Contents.filter((file) => file.Key.endsWith('.json')),
    );
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

  const extractedData = await Promise.all(
    allFiles.map(async (file) => {
      const fileContent = await getFileContentFromS3(
        s3Client,
        env.S3_SCRAPER_BUCKET_NAME,
        file.Key,
      );
      const jsonData = extractScrapedMetadataFromJson(fileContent, log);

      return jsonData || null;
    }),
  );

  const indexFile = allFiles.find((file) => file.Key.endsWith(`${siteId}/scrape.json`));
  const indexFileContent = await getFileContentFromS3(
    s3Client,
    env.S3_SCRAPER_BUCKET_NAME,
    indexFile.Key,
  );
  const headerLinks = extractLinksFromHeader(indexFileContent, site.getBaseURL());

  log.info(`siteData: ${JSON.stringify(extractedData)}`);
  return {
    headerLinks,
    siteData: extractedData.filter(Boolean),
  };
};
