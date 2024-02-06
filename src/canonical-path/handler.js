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
import { internalServerError, noContent } from '@adobe/spacecat-shared-http-utils';
import { JSDOM } from 'jsdom';
import { fetch } from '../support/utils.js';

async function checkForCanonical(url, log) {
  try {
    const response = await fetch(url);
    const htmlContent = await response.text();

    const dom = new JSDOM(htmlContent);
    const { head } = dom.window.document;
    const canonicalLink = head.querySelector('link[rel="canonical"]');

    if (canonicalLink) {
      log.info(`Canonical link found for ${url}: ${canonicalLink.href}`);
    // TODO create message for SQS and return
    } else {
      log.info(`No canonical link found for ${url}`);
      // TODO create message for SQS and return
    }
  } catch (error) {
    log.error(`Error fetching HEAD for ${url}: ${error.message}`);
  }
}
async function fetchAndParseSitemap(sitemapPath) {
  const response = await fetch(sitemapPath);
  const sitemapContent = await response.text();
  const dom = new JSDOM(sitemapContent, { contentType: 'text/xml' });
  return dom.window.document;
}
async function* asyncGenerator(sitemapPaths) {
  for (const path of sitemapPaths) {
    yield fetchAndParseSitemap(path);
  }
}
async function retrieveUrls(sitemapPaths, log) {
  for await (const result of asyncGenerator(sitemapPaths)) {
    result.querySelectorAll('loc').forEach((urlElement) => {
      const url = urlElement.textContent;
      checkForCanonical(url, log);
    });
  }
}

export default async function auditCanonicalPaths(message, context) {
  const { type, url: siteId } = message;
  const { log } = context;

  log.info(`Received ${type} audit request for siteId: ${siteId}`);
  try {
    // should be defined in utils, returns an array possibly
    // const sitemapsPaths = retrieveSitemaps();
    const sitemapsPaths = ['sitemap.xml'];
    const urls = await retrieveUrls(sitemapsPaths, log);
    log.info(`Found ${urls.length} urls for siteId: ${siteId}`);
    // TODO send canonical url message to post processor

    log.info(`Successfully audited ${siteId} for ${type} type audit`);
    return noContent();
  } catch (e) {
    log.error(`Failed audit with type ${type} for ${siteId} with error: ${e.message}`);
    return internalServerError(`Failed audit with type ${type} for ${siteId} with error: ${e.message}`);
  }
}
