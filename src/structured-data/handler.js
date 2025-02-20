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
import { getPrompt } from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import * as cheerio from 'cheerio';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';

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

  // TODO: Create proper opportunity format and document it

  // Use the following bulk URLs
  // https://www.bulk.com/uk/products/multivitamin-multimineral/bble-mvmm
  // https://www.bulk.com/uk/sports-nutrition/creatine
  // https://www.bulk.com/uk/sports-nutrition/informed-sport
  // https://www.bulk.com/uk/foods/breakfast
  // https://www.bulk.com/uk/sports-nutrition/pre-workout
  // https://www.bulk.com/uk/protein/banana-protein-powders
  // https://www.bulk.com/uk/health-wellbeing/hair-skin-nails
  // https://www.bulk.com/uk/sports-nutrition/endurance-hydration

  // Hardcode for development
  return [
    {
      inspectionUrl: 'https://www.bulk.com/uk/products/multivitamin-multimineral/bble-mvmm',
      indexStatusResult: {
        verdict: 'PASS',
        lastCrawlTime: '2025-02-20T04:28:06Z',
      },
      richResults: {
        verdict: 'FAIL',
        detectedItemTypes: [
          'Product snippets',
          'Merchant listings',
          'Breadcrumbs',
          'Review snippets',
        ],
        detectedIssues: [
          {
            richResultType: 'Breadcrumbs',
            items: [
              {
                name: 'Unnamed item',
                issues: [
                  {
                    issueMessage: 'Missing field "item"',
                    severity: 'ERROR',
                  },
                  {
                    issueMessage: 'Either "name" or "item.name" should be specified',
                    severity: 'ERROR',
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ];

  // eslint-disable-next-line no-unreachable
  let google;
  try {
    google = await GoogleClient.createFrom(context, baseURL);
  } catch (error) {
    log.error(`Failed to create Google client. Site was probably not onboarded to GSC yet. Error: ${error.message}`);
    throw new Error(`Failed to create Google client. Site was probably not onboarded to GSC yet. Error: ${error.message}`);
  }

  // TODO: Hardcode for development
  const urlInspectionResult = pages.map(async ({ url: page }) => {
    try {
      const { inspectionResult } = await google.urlInspect(page);
      log.info(`Successfully inspected URL: ${page}`);
      log.info(`Inspection result: ${JSON.stringify(inspectionResult)}`);

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

  // eslint-disable-next-line no-unreachable
  const results = await Promise.allSettled(urlInspectionResult);
  const filteredResults = results.filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);

  console.log('filteredResults', JSON.stringify(filteredResults));

  return filteredResults;
}

export async function convertToOpportunity(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
  let opportunity = opportunities.find((oppty) => oppty.getType() === 'structured-data');

  if (!opportunity) {
    const opportunityData = {
      siteId: auditData.siteId,
      auditId: auditData.id,
      runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Structured_Data_Runbook.docx?d=wf814159992be44a58b72ce1950c0c9ab&csf=1&web=1&e=5Qq6vm',
      type: 'structured-data',
      origin: 'AUTOMATION',
      title: 'Missing or invalid structured data',
      description: 'Structured data (JSON-LD) is a way to organize and label important information on your website so that search engines can understand it more easily. It\'s important because it can lead to improved visibility in search.',
      guidance: { // TODO?
        steps: [],
      },
      tags: ['Traffic acquisition'],
    };
    try {
      opportunity = await Opportunity.create(opportunityData);
    } catch (e) {
      log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`);
      throw e;
    }
  } else {
    opportunity.setAuditId(auditData.id);
    await opportunity.save();
  }

  const buildKey = (data) => `${data.inspectionUrl}`;

  const filteredAuditResult = auditData.auditResult
    .filter((result) => result.richResults?.detectedIssues?.length > 0);

  // TODO: Pass actual suggestions data

  await syncSuggestions({
    opportunity,
    newData: filteredAuditResult,
    buildKey,
    mapNewSuggestion: (data) => {
      const errors = data.richResults.detectedIssues.flatMap((issue) => issue.items.flatMap((item) => item.issues.map((i) => `${i.issueMessage}`))).sort();
      return {
        opportunityId: opportunity.getId(),
        type: 'CODE_CHANGE',
        rank: errors.length,
        data: {
          type: 'url',
          url: data.inspectionUrl,
          errors: errors.map((error) => ({
            id: error.replaceAll(/["\s]/g, '').toLowerCase(),
            errorTitle: error.replaceAll('"', "'"),
            fix: '', // todo: implement for auto-suggest
          })),
        },
      };
    },
    log,
  });
}

export async function structuredDataHandler(baseURL, context, site) {
  const { log, dataAccess } = context;
  const startTime = process.hrtime();

  const siteId = site.getId();

  // TODO: Replace error throws with audit object and success = false

  const topPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
  if (topPages.length === 0) {
    log.error(`No top pages for site ID ${siteId} found, ending audit.`);
    throw new Error(`No top pages for site ID ${siteId} found, ending audit.`);
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
}

// TODO: Move to utils
async function getScrapeForPage(path, context, site) {
  const { log, s3Client } = context;
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}${path}/scrape.json`;
  return getObjectFromKey(s3Client, bucketName, prefix, log);
}

// TODO: Move to utils
function stripHtmlTags(html) {
  return html.replace(/<\/?[^>]+(>|$)/g, '');
}

export async function generateSuggestionsData(finalUrl, auditData, context, site) {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;

  console.info('called generateSuggestionsData', finalUrl, JSON.stringify(auditData));

  // TODO: Check if audit was successful can be skipped for now as the audit throws if it fails.

  // Check if auto suggest was enabled
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('structured-data-auto-suggest', site)) {
    log.info('Auto-suggest is disabled for site');
    return { ...auditData };
  }

  // Init firefall
  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = {
    model: 'gpt-4o-mini',
    responseFormat: 'json_object',
  };

  // Only take results which have actual issues
  const results = auditData.auditResult
    .filter((result) => result.richResults?.detectedIssues?.length > 0);

  // Go through audit results, one for each URL
  for (const auditResult of results) {
    log.info(`Create suggestion for URL ${auditResult.inspectionUrl}`);

    // Get scraped version of website from S3 if available.
    let scrapeResult;
    const { pathname } = new URL(auditResult.inspectionUrl);
    try {
      scrapeResult = await getScrapeForPage(pathname, context, site);
    } catch (e) {
      log.error(`Could not find scrape for ${pathname}`, e);
      continue;
    }

    // Get extracted LD-JSON from scrape
    const structuredData = scrapeResult?.scrapeResult?.structuredData;
    if (structuredData.length === 0) {
      log.error(`No structured data found in scrape result for URL ${auditResult.inspectionUrl}`);
      continue;
    }
    log.debug('Found ld+json in scrape:', JSON.stringify(structuredData));

    let plainPage;
    // If plain html version is not available, transform scraped page
    if (!plainPage) {
      // Scraper already strips out some HTML tags
      // Use cheerio to get text from main element only
      const parsed = cheerio.load(scrapeResult?.scrapeResult?.rawBody);
      const main = parsed('main').prop('outerHTML');
      plainPage = stripHtmlTags(main);
    }

    // TODO: Add more mappings based on actual customer issues
    // TODO: Handle case "Review has multiple aggregate ratings"
    const entityMapping = {
      Breadcrumbs: 'BreadcrumbList',
      Product: 'Product',
    };

    // Go through every issue on page
    for (const issue of auditResult.richResults.detectedIssues) {
      log.debug(`Handle rich result issue of type ${issue.richResultType}`);

      const entity = entityMapping[issue.richResultType];
      if (!entity) {
        log.error(`Could not find entity mapping for issue of type ${issue.richResultType}`);
        continue;
      }

      // Filter structured data relevant to this issue
      const wrongLdJson = structuredData.find((data) => entity === data['@type']);
      if (!wrongLdJson) {
        log.error(`Could not find structured data for issue of type ${issue.richResultType}`);
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
      log.debug('Firefall inputs:', JSON.stringify(firefallInputs));

      // Get suggestions from Firefall
      let response;
      try {
        const requestBody = await getPrompt(firefallInputs, 'structured-data-suggest', log);
        response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);

        if (response.choices?.length === 0 || response.choices[0].finish_reason !== 'stop') {
          throw new Error('No suggestions found');
        }
      } catch (e) {
        log.error(`Could not create suggestion because Firefall did not return any suggestions for issue of type ${issue.richResultType}`, e);
        continue;
      }

      let suggestion;
      try {
        suggestion = JSON.parse(response.choices[0].message.content);
      } catch (e) {
        log.error(`Could not parse Firefall response for issue of type ${issue.richResultType}`, e);
        throw e;
      }

      issue.suggestion = suggestion;
    }
  }

  log.info('Finished generating suggestions data', JSON.stringify(auditData));

  return { ...auditData };
}

export default new AuditBuilder()
  .withRunner(structuredDataHandler)
  .withUrlResolver((site) => site.getBaseURL())
  .withPostProcessors([generateSuggestionsData]) // convertToOpportunity
  .build();
