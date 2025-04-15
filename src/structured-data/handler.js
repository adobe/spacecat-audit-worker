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
/* eslint-disable no-continue, no-await-in-loop */
import GoogleClient from '@adobe/spacecat-shared-google-client';
import {
  getPrompt, isNonEmptyArray, isNonEmptyObject, isObject, deepEqual,
} from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { load as cheerioLoad } from 'cheerio';

import { AuditBuilder } from '../common/audit-builder.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { generatePlainHtml, getScrapeForPath } from '../support/utils.js';

const auditType = Audit.AUDIT_TYPES.STRUCTURED_DATA;
const auditAutoSuggestType = Audit.AUDIT_TYPES.STRUCTURED_DATA_AUTO_SUGGEST;

/**
 * Processes an audit of a set of pages from a site using Google's URL inspection tool.
 *
 * @async
 * @function
 * @param {string} baseURL - The base URL for the audit.
 * @param {Object} context - The context object.
 * @param {Array} pages - An array of page URLs to be audited.
 *
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of objects,
 * each containing the inspection URL, filtered index status result, and filtered rich results.
 * If an error occurs during the inspection of a URL, the object will include an error message.
 *
 * @throws {Error} - Throws an error if the audit process fails.
 */
export async function processStructuredData(baseURL, context, pages) {
  const { log } = context;

  let google;
  try {
    google = await GoogleClient.createFrom(context, baseURL);
  } catch (error) {
    log.error(`Failed to create Google client. Site was probably not onboarded to GSC yet. Error: ${error.message}`);
    throw new Error(`Failed to create Google client. Site was probably not onboarded to GSC yet. Error: ${error.message}`);
  }

  const urlInspectionResult = pages.map(async ({ url: page }) => {
    try {
      const { inspectionResult } = await google.urlInspect(page);
      log.info(`Successfully inspected URL: ${page}`);
      log.debug(`Inspection result: ${JSON.stringify(inspectionResult)}`);

      const filteredIndexStatusResult = {
        verdict: inspectionResult?.indexStatusResult?.verdict, // PASS if indexed
        lastCrawlTime: inspectionResult?.indexStatusResult?.lastCrawlTime,
      };

      const detectedItemTypes = [];
      const filteredRichResults = inspectionResult?.richResultsResult?.detectedItems
        ?.map(
          (item) => {
            detectedItemTypes.push(item?.richResultType);
            const filteredItems = item?.items?.filter(
              (issueItem) => issueItem?.issues?.some(
                (issue) => issue?.severity === 'ERROR', // Only show issues with severity ERROR, lower issues can be enabled later
              ),
            )?.map((issueItem) => ({
              name: issueItem?.name,
              issues: issueItem?.issues?.filter((issue) => issue?.severity === 'ERROR'),
            }));

            return {
              richResultType: item?.richResultType,
              items: filteredItems,
            };
          },
        )
        // All pages which have a rich result on them. But only show issues with severity ERROR
        ?.filter((item) => item.items.length > 0) ?? [];

      if (filteredRichResults?.length > 0) {
        filteredRichResults.verdict = inspectionResult?.richResultsResult?.verdict;
        log.info(`Found ${filteredRichResults.length} rich results issues for URL: ${page}`);
      } else {
        log.info(`No rich results issues found for URL: ${page}`);
      }
      return {
        inspectionUrl: page,
        indexStatusResult: filteredIndexStatusResult,
        richResults: inspectionResult?.richResultsResult
          ? {
            verdict: inspectionResult.richResultsResult.verdict,
            detectedItemTypes,
            detectedIssues: filteredRichResults,
          }
          : {},
      };
    } catch (error) {
      log.error(`Failed to inspect URL: ${page}. Error: ${error.message}`);
      return {
        inspectionUrl: page,
        error: error.message,
      };
    }
  });

  const results = await Promise.allSettled(urlInspectionResult);

  const filteredResults = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    // Filter out the results where GSC inspection failed
    .filter((result) => !result.error);

  // Deduplicate items for in detectedIssues
  filteredResults.forEach((result) => {
    result.richResults?.detectedIssues?.forEach((detectedIssue) => {
      // eslint-disable-next-line no-param-reassign
      detectedIssue.items = detectedIssue.items.reduce((acc, item) => {
        const existingItem = acc.find((accItem) => accItem.name === item.name);
        if (!existingItem) {
          acc.push(item);
        } else {
          item.issues.forEach((issue) => {
            // If issue doesn't already exist, add it
            const exists = existingItem.issues
              .find((existingIssue) => existingIssue.issueMessage === issue.issueMessage);
            if (!exists) {
              existingItem.issues.push(issue);
            }
          });
        }
        return acc;
      }, []);
    });
  });

  return filteredResults;
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  // Check if audit was successful
  if (auditData.auditResult.success === false) {
    log.info('Audit failed, skipping opportunity generation');
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );

  const buildKey = (data) => `${data.inspectionUrl}`;

  const filteredAuditResult = auditData.auditResult
    .filter((result) => result.richResults?.detectedIssues?.length > 0);

  await syncSuggestions({
    opportunity,
    newData: filteredAuditResult,
    buildKey,
    context,
    mapNewSuggestion: (data) => {
      const errors = data.richResults.detectedIssues.sort();
      return {
        opportunityId: opportunity.getId(),
        type: 'CODE_CHANGE',
        rank: errors.length,
        data: {
          type: 'url',
          url: data.inspectionUrl,
          errors: errors.map((error) => {
            let fix = '';
            if (error.suggestion && error.suggestion.correctedLdjson) {
              const {
                errorDescription,
                correctedLdjson,
                aiRationale,
                confidenceScore,
              } = error.suggestion;

              const score = `${parseFloat(confidenceScore) * 100}%`;

              fix = `
## Issue Explanation
${errorDescription}
## Corrected Structured Data
\`\`\`json
${JSON.stringify(correctedLdjson, null, 4)}
\`\`\`

## Rationale
${aiRationale}

_Confidence score: ${score}_`;
            } else {
              // Surface errors even without suggestion
              fix = `
## Issues Detected for ${error.richResultType}
${error.items.map((item) => `
* ${item.name}
${item.issues.map((issue) => `    * ${issue.issueMessage}`).join('\n')}
`).join('\n')}
`;
            }

            return {
              id: error.richResultType.replaceAll(/["\s]/g, '').toLowerCase(),
              errorTitle: error.richResultType,
              fix,
            };
          }),
        },
      };
    },
    log,
  });

  return { ...auditData };
}

export async function structuredDataHandler(baseURL, context, site) {
  const { log, dataAccess } = context;
  const startTime = process.hrtime();

  const siteId = site.getId();

  try {
    const topPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
    if (!isNonEmptyArray(topPages)) {
      log.error(`No top pages for site ID ${siteId} found. Ensure that top pages were imported.`);
      throw new Error(`No top pages for site ID ${siteId} found.`);
    }

    const auditResult = await processStructuredData(baseURL, context, topPages);

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
    const formattedElapsed = elapsedSeconds.toFixed(2);

    log.info(`Structured data audit completed in ${formattedElapsed} seconds for ${baseURL}`);

    return {
      fullAuditRef: baseURL,
      auditResult,
    };
  } catch (e) {
    log.error(`Structured data audit failed for ${baseURL}`, e);
    return {
      fullAuditRef: baseURL,
      auditResult: {
        error: e.message,
        success: false,
      },
    };
  }
}

export async function generateSuggestionsData(auditUrl, auditData, context, site) {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const {
    AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT = 50,
  } = context.env;

  // Check if audit was successful
  if (auditData.auditResult.success === false) {
    log.info('Audit failed, skipping suggestions data generation');
    return { ...auditData };
  }

  // Check if auto suggest was enabled
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite(auditAutoSuggestType, site)) {
    log.info('Auto-suggest is disabled for site');
    return { ...auditData };
  }

  // Initialize Firefall client
  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = {
    model: 'gpt-4o-mini',
    responseFormat: 'json_object',
  };

  let firefallRequests = 0;

  // Cache suggestions so that we only generate one suggestion for each issue
  const existingSuggestions = new Map();

  // Only take results which have actual issues
  const results = auditData.auditResult
    .filter((result) => result.richResults?.detectedIssues?.length > 0);

  // Go through audit results, one for each URL
  for (const auditResult of results) {
    // Limit to avoid excessive Firefall requests. Can be increased if needed.
    if (firefallRequests >= parseInt(AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT, 10)) {
      log.error(`Aborting suggestion generation as more than ${AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT} Firefall requests have been used.`);
      break;
    }

    log.info(`Create suggestion for URL ${auditResult.inspectionUrl}`);
    // Cache scrape of page, if needed
    let scrapeResult;
    let structuredData;
    let structuredDataNewFormat = false;
    let plainPage;

    // Mapping between GSC rich result types and schema.org entities
    const entityMapping = {
      Breadcrumbs: 'BreadcrumbList',
      'Product snippets': 'Product',
      'Merchant listings': 'Product',
      'Review snippets': 'AggregateRating',
      Videos: 'VideoObject',
      Recipes: 'Recipe',
    };

    // Go through every issue on page
    for (const issue of auditResult.richResults.detectedIssues) {
      log.debug(`Handle rich result issue of type ${issue.richResultType} for URL ${auditResult.inspectionUrl}`);

      const entity = entityMapping[issue.richResultType];
      if (!entity) {
        log.error(`Could not find entity mapping for issue of type ${issue.richResultType} for URL ${auditResult.inspectionUrl}`);
        continue;
      }

      // Check if a suggestion for the error is already in the suggestion Map
      const existingSuggestionKey = existingSuggestions.keys().find((key) => deepEqual(issue, key));
      if (existingSuggestionKey) {
        log.info(`Re-use existing suggestion for type ${issue.richResultType} and URL ${auditResult.inspectionUrl}`);
        issue.suggestion = existingSuggestions.get(existingSuggestionKey);
        continue;
      }

      // Once sure we need it, load scraped version of page from S3
      if (!structuredData) {
        const { pathname } = new URL(auditResult.inspectionUrl);
        try {
          scrapeResult = await getScrapeForPath(pathname, context, site);
        } catch (e) {
          log.error(`Could not find scrape for ${pathname}. Make sure that scrape-top-pages did run.`, e);
          break;
        }

        // Get extracted LD-JSON from scrape
        structuredData = scrapeResult?.scrapeResult?.structuredData;

        // structuredData is either an array (old format) or an object (new format)
        if (isNonEmptyArray(structuredData)) {
          structuredDataNewFormat = false;
        } else if (isNonEmptyObject(structuredData)) {
          structuredDataNewFormat = true;
        } else {
          // If structured data is loaded late on the page, e.g. in delayed phase,
          // the scraper might not pick it up. You would need to fine tune wait for
          // check of the scraper for this site.
          log.error(`No structured data found in scrape result for URL ${auditResult.inspectionUrl}`);
          break;
        }

        // Use cheerio to generate a plain version of the scraped HTML
        const parsed = cheerioLoad(scrapeResult?.scrapeResult?.rawBody);
        plainPage = generatePlainHtml(parsed);
      }

      // Filter structured data relevant to this issue
      let wrongLdJson;
      if (structuredDataNewFormat) {
        [wrongLdJson] = structuredData.jsonld[entity];
      } else {
        wrongLdJson = structuredData.find((data) => entity === data['@type']);

        // If not found in the first level objects, try second level objects.
        // This typically happens for reviews within the Product entity.
        if (!wrongLdJson) {
          const children = structuredData
            .flatMap((parent) => Object.keys(parent).map((key) => parent[key]))
            .filter((data) => isObject(data) && data['@type'] === entity);
          if (children.length >= 1) {
            [wrongLdJson] = children;
          }
        }
      }

      if (!isNonEmptyObject(wrongLdJson)) {
        log.error(`Could not find structured data for issue of type ${entity} for URL ${auditResult.inspectionUrl}`);
        continue;
      }
      log.debug('Filtered structured data:', JSON.stringify(wrongLdJson));

      const firefallInputs = {
        entity,
        errors: issue.items.map((item) => item.issues.map((i) => i.issueMessage)).flat(),
        website_url: auditResult.inspectionUrl,
        wrong_ld_json: JSON.stringify(wrongLdJson, null, 4),
        website_markup: plainPage,
      };

      // Get suggestions from Firefall
      let response;
      try {
        const requestBody = await getPrompt(firefallInputs, 'structured-data-suggest', log);
        response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);
        firefallRequests += 1;

        if (response.choices?.length === 0 || response.choices[0].finish_reason !== 'stop') {
          throw new Error('No suggestions found');
        }
      } catch (e) {
        log.error(`Could not create suggestion because Firefall did not return any suggestions for issue of type ${issue.richResultType} for URL ${auditResult.inspectionUrl}`, e);
        continue;
      }

      let suggestion;
      try {
        suggestion = JSON.parse(response.choices[0].message.content);
      } catch (e) {
        log.error(`Could not parse Firefall response for issue of type ${issue.richResultType} for URL ${auditResult.inspectionUrl}`, e);
        continue;
      }

      // Reject suggestion if confidence score is too low
      if (suggestion?.confidenceScore < 0.6) {
        log.error(`Confidence score too low, skip suggestion of type ${issue.richResultType} for URL ${auditResult.inspectionUrl}`);
        continue;
      }

      existingSuggestions.set(structuredClone(issue), structuredClone(suggestion));
      issue.suggestion = suggestion;
    }
  }

  log.debug(`Used ${firefallRequests} Firefall requests in total for site ${auditUrl}`);
  log.debug('Generated suggestions data', JSON.stringify(auditData));

  return { ...auditData };
}

export default new AuditBuilder()
  .withRunner(structuredDataHandler)
  .withUrlResolver((site) => site.getBaseURL())
  .withPostProcessors([generateSuggestionsData, opportunityAndSuggestions])
  .build();
