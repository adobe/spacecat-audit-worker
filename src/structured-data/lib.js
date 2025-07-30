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
  getPrompt, isNonEmptyArray, isNonEmptyObject, isObject,
} from '@adobe/spacecat-shared-utils';
import GoogleClient from '@adobe/spacecat-shared-google-client';
import StructuredDataValidator from '@adobe/structured-data-validator';
import { join } from 'path';
import { load as cheerioLoad } from 'cheerio';
import jsBeautify from 'js-beautify';
import { Site } from '@adobe/spacecat-shared-data-access';

import { generatePlainHtml, getScrapeForPath } from '../support/utils.js';

export function cleanupStructuredDataMarkup($) {
  const main = $('body');

  // Remove HTML comments
  main.find('*').contents().filter((i, el) => el.type === 'comment').remove();

  const allowedAttributes = ['itemtype', 'itemprop', 'typeof', 'property', 'about', 'href', 'resource', 'itemid', 'src', 'content'];

  // Remove all non-allowed attributes
  main.find('*').each((i, el) => {
    Object.keys(el.attribs).forEach((attr) => {
      if (!allowedAttributes.includes(attr)) {
        $(el).removeAttr(attr);
      }
    });
  });

  // Remove all tags without attributes
  main.find('*').each((i, el) => {
    // Skip if tag in essential list
    if (Object.keys(el.attribs).length > 0) {
      return;
    }
    $(el).replaceWith($(el).contents());
  });

  return main.html();
}

export async function getIssuesFromGSC(finalUrl, context, pages) {
  const { log } = context;

  let google;
  try {
    google = await GoogleClient.createFrom(context, finalUrl);
  } catch (error) {
    log.warn('SDA: Failed to create Google client. Site was probably not onboarded to GSC yet. Continue without data from GSC.', error);
    return [];
  }

  const issues = [];

  // Mapping between GSC rich result types and schema.org entities
  // List is incomplete, but we log missing types
  const entityMapping = {
    Breadcrumbs: 'BreadcrumbList',
    'Product snippets': 'Product',
    'Merchant listings': 'Product',
    'Review snippets': 'AggregateRating',
    Videos: 'VideoObject',
    Recipes: 'Recipe',
  };

  await Promise.all(pages.map(async ({ url: page }) => {
    try {
      const { inspectionResult } = await google.urlInspect(page);

      const richResults = inspectionResult?.richResultsResult;
      if (!richResults) {
        return;
      }

      richResults.detectedItems?.forEach((type) => {
        type?.items?.forEach((item) => {
          item?.issues?.forEach((issue) => {
            const rootType = entityMapping[type.richResultType];
            if (!rootType) {
              log.warn(`SDA: Skipping GSC issue, because cannot map GSC type "${type.richResultType}" to schema.org type.`);
              return;
            }

            // Only add if issueMessage is not already in issues, as GSC does not provide
            // information on where the issue is located within the structured data.
            const existingIssue = issues.find(
              (i) => i.issueMessage === issue.issueMessage
              && i.pageUrl === page
              && i.rootType === rootType
              && i.severity === issue.severity,
            );
            if (existingIssue) {
              return;
            }

            // For now, ignore issues with severity lower than ERROR
            if (issue.severity !== 'ERROR') {
              return;
            }

            issues.push({
              pageUrl: page,
              rootType,
              dataFormat: 'jsonld', // GSC does not specify where the data came from, so we assume it is LD-JSON
              issueMessage: issue.issueMessage,
              severity: issue.severity,
              errors: [],
            });
          });
        });
      });
    } catch (error) {
      log.error(`SDA: Failed to get inspection results from GSC for URL: ${page}.`, error);
    }
  }));

  return issues;
}

export function deduplicateIssues(context, gscIssues, scraperIssues) {
  const { log } = context;

  const issues = [];

  // Issues from scraper take precedence if available, as they are more detailed
  if (scraperIssues.length > 0) {
    issues.push(...scraperIssues);
  } else if (scraperIssues.length === 0 && gscIssues.length > 0) {
    issues.push(...gscIssues);
  }

  // If there are additionally any gscIssues, add them to the result
  if (scraperIssues.length > 0 && gscIssues.length > 0) {
    // Get all types from scraper issues
    const scraperTypes = scraperIssues.map((issue) => issue.rootType);

    // Go through all gscIssues and check if they are in scraperTypes, if not add them and log them
    for (const issue of gscIssues) {
      if (!scraperTypes.includes(issue.rootType)) {
        issues.push(issue);
        log.warn(`SDA: GSC issue for type ${issue.rootType} was not found by structured data parser.`, JSON.stringify(issue, null, 4));
      }
    }
  }

  return issues;
}

export function includeIssue(context, issue) {
  const { log } = context;
  const isError = issue.severity === 'ERROR';
  const isImageObject = issue.rootType === 'ImageObject';
  const customerTypes = [Site.DELIVERY_TYPES.AEM_CS, Site.DELIVERY_TYPES.AEM_AMS];
  const isAffectedCustomer = customerTypes.includes(context.site.getDeliveryType());

  if (!isError) return false;
  if (!isImageObject) return true;

  if (isImageObject && isAffectedCustomer) {
    const messageToSuppress = 'One of the following conditions needs to be met: Required attribute "creator" is missing or Required attribute "creditText" is missing or Required attribute "copyrightNotice" is missing or Required attribute "license" is missing';
    if (issue.issueMessage.includes(messageToSuppress)) {
      log.warn('SDA: Suppressing issue', issue.issueMessage);
      return false;
    }
  }
  return true;
}

export async function getIssuesFromScraper(context, pages, scrapeCache) {
  const { log, site } = context;

  const issues = [];

  await Promise.all(pages.map(async ({ url: page }) => {
    let scrapeResult;
    let { pathname } = new URL(page);
    // If pathname ends with a slash, remove it
    if (pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    try {
      if (!scrapeCache.has(pathname)) {
        scrapeCache.set(pathname, getScrapeForPath(pathname, context, site));
      }
      scrapeResult = await scrapeCache.get(pathname);
    } catch (e) {
      log.error(`SDA: Could not find scrape for ${pathname}. Make sure that scrape-top-pages did run.`, e);
      return;
    }

    const waeResult = scrapeResult?.scrapeResult?.structuredData;

    // If scrape contains old format of structured data, skip
    if (isNonEmptyArray(waeResult)) {
      return;
    }

    const schemaOrgPath = join(
      process.cwd(),
      'static',
      'schemaorg-current-https.jsonld',
    );

    const validator = new StructuredDataValidator(schemaOrgPath);
    let validatorIssues = [];
    try {
      validatorIssues = (await validator.validate(waeResult))
        // For now, ignore issues with severity lower than ERROR
        //          and suppress unnecessary issues for AEM customers
        .filter((issue) => includeIssue(context, issue));
    } catch (e) {
      log.error(`SDA: Failed to validate structured data for ${page}.`, e);
    }
    for (const issue of validatorIssues) {
      // Only add if same issue for the same source does not exist already.
      // This can happen e.g. if a field is missing for every item in a list.
      const existingIssue = issues.find(
        (i) => i.issueMessage === issue.issueMessage
        && i.rootType === issue.rootType
        && i.pageUrl === page
        && i.dataFormat === issue.dataFormat
        && i.location === issue.location
        && i.severity === issue.severity,
      );
      if (!existingIssue) {
        issues.push({
          pageUrl: page,
          ...issue,
          errors: [],
        });
      }
    }
  }));

  return issues;
}

export function getWrongMarkup(context, issue, scrapeResult) {
  const { log } = context;

  // Get extracted LD-JSON from scrape
  const structuredData = scrapeResult?.scrapeResult?.structuredData;

  // structuredData is either an array (old format) or an object (new format)
  if (!isNonEmptyArray(structuredData) && !isNonEmptyObject(structuredData)) {
    // If structured data is loaded late on the page, e.g. in delayed phase,
    // the scraper might not pick it up. You would need to fine tune wait for
    // check of the scraper for this site.
    log.error(`SDA: No structured data found in scrape result for URL ${issue.pageUrl}`);
    return null;
  }

  // Get wrong markup either from @source attribute or from scrape
  if (issue.source) {
    return issue.source;
  }

  // DEPRECATED: This case is to support the old scraper format, should be removed soon
  if (isNonEmptyArray(structuredData)) {
    let wrongMarkup = structuredData.find((data) => issue.rootType === data['@type']);

    // If not found in the first level objects, try second level objects.
    // This typically happens for reviews within the Product entity.
    if (!wrongMarkup) {
      const children = structuredData
        .flatMap((parent) => Object.keys(parent).map((key) => parent[key]))
        .filter((data) => isObject(data) && data['@type'] === issue.rootType);
      if (children.length >= 1) {
        [wrongMarkup] = children;
      }
    }
    return wrongMarkup;
  }

  if (isNonEmptyObject(structuredData) && structuredData[issue.dataFormat]) {
    // This case happens if structured data issue is from GSC
    // which limited information on where the issue is located
    return structuredData[issue.dataFormat]?.[issue.rootType]?.[0];
  }

  return null;
}

export function generateErrorMarkupForIssue(issue) {
  if (issue.suggestion && issue.suggestion.aiRationale) {
    const {
      errorDescription,
      correctedMarkup,
      aiRationale,
      confidenceScore,
    } = issue.suggestion;

    const score = `${parseFloat(confidenceScore) * 100}%`;

    let markup = '';
    if (issue.dataFormat === 'jsonld') {
      markup = [
        '```json',
        JSON.stringify(correctedMarkup, null, 4),
        '```',
      ].join('\n');
    } else {
      const cleanup = jsBeautify.html(correctedMarkup, {
        indent_size: 2,
      });
      markup = [
        '```html',
        cleanup,
        '```',
      ].join('\n');
    }

    return [
      '## Affected page',
      ` * ${issue.pageUrl}`,
      '',
      '## Issue Explanation',
      errorDescription,
      '',
      '## Corrected Structured Data',
      markup,
      '',
      '## Rationale',
      aiRationale,
      '',
      `_Confidence score: ${score}_`,
    ].join('\n');
  }

  const fix = [
    '## Affected page',
    ` * ${issue.pageUrl}`,
    '',
    `## Issue Detected for ${issue.rootType}`,
    issue.issueMessage,
  ];

  if (issue.source) {
    let markup;
    if (issue.dataFormat === 'jsonld') {
      try {
        markup = [
          '```json',
          JSON.stringify(JSON.parse(issue.source), null, 4),
          '```',
        ].join('\n');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        markup = [
          '```json',
          issue.source,
          '```',
        ].join('\n');
      }
    } else {
      try {
        let cleanup = cheerioLoad(issue.source);
        cleanup = cleanupStructuredDataMarkup(cleanup);
        cleanup = jsBeautify.html(cleanup, {
          indent_size: 2,
        });

        markup = [
          '```html',
          cleanup,
          '```',
        ].join('\n');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        markup = [
          '```html',
          issue.source,
          '```',
        ].join('\n');
      }
    }

    fix.push(
      '## Problematic Structured Data',
      markup,
    );
  }

  return fix.join('\n');
}

export async function generateFirefallSuggestion(
  context,
  firefallClient,
  firefallOptions,
  issue,
  wrongMarkup,
  scrapeResult,
) {
  const { log } = context;

  // Use cheerio to generate a plain version of the scraped HTML
  const parsed = cheerioLoad(scrapeResult?.scrapeResult?.rawBody);
  const plainPage = generatePlainHtml(parsed);

  const firefallInputs = {
    entity: issue.rootType,
    error: issue.issueMessage,
    data_format: issue.dataFormat,
    website_url: issue.pageUrl,
    wrong_markup: wrongMarkup,
    website_markup: plainPage,
  };
  if (issue.path) {
    firefallInputs.path = JSON.stringify(issue.path);
  }
  log.debug('SDA: Firefall inputs', JSON.stringify(firefallInputs));

  const requestBody = await getPrompt(firefallInputs, 'structured-data-suggest', log);
  const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);

  if (!response.choices || response.choices?.length === 0 || response.choices[0].finish_reason !== 'stop') {
    throw new Error('Firefall did not return any suggestions');
  }

  let suggestion;
  try {
    suggestion = JSON.parse(response.choices[0].message.content);
  } catch (e) {
    throw new Error('Could not parse Firefall response for issue', e);
  }

  if (!isNonEmptyObject(suggestion)) {
    throw new Error('Received empty suggestion from Firefall');
  }

  // Reject suggestion if confidence score is too low
  if (suggestion?.confidenceScore < 0.6) {
    throw new Error('Confidence score too low, skip suggestion');
  }

  return suggestion;
}
