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

import GoogleClient from '@adobe/spacecat-shared-google-client';
import { isArray, getPrompt } from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { promises as fs } from 'fs';
import * as cheerio from 'cheerio';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';

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

  // Hardcode for development
  /* return [
    {
      inspectionUrl: 'https://www.revolt.tv/article/2021-09-02/101801/lil-nas-x-drops-pregnancy-photos-before-birth-of-debut-album-montero',
      indexStatusResult: {
        verdict: 'PASS',
        lastCrawlTime: '2025-01-29T08:30:18Z',
      },
      richResults: {
        verdict: 'FAIL',
        detectedItemTypes: [
          'Breadcrumbs',
        ],
        detectedIssues: [
          {
            richResultType: 'Breadcrumbs',
            items: [
              {
                name: 'Unnamed item',
                issues: [
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
  ]; */

  return [
    {
      inspectionUrl: 'https://www.wilson.com/en-us/product/rf-01-future-3-tennis-racket-bundle',
      indexStatusResult: {
        verdict: 'PASS',
        lastCrawlTime: '2025-01-29T08:30:18Z',
      },
      richResults: {
        verdict: 'FAIL',
        detectedItemTypes: [
          'Product',
        ],
        detectedIssues: [
          {
            richResultType: 'Product',
            items: [
              {
                name: 'Missing item',
                issues: [
                  {
                    issueMessage: 'Either "offers", "review", or "aggregateRating" should be specified',
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
  const urlInspectionResult = pages.map(async (page) => {
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
                (issue) => issue?.severity === 'ERROR',
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
  const { log } = context;
  const startTime = process.hrtime();

  const siteId = site.getId();

  const structuredDataURLs = await site.getConfig().getIncludedURLs('structured-data');
  if (structuredDataURLs && isArray(structuredDataURLs) && structuredDataURLs.length === 0) {
    log.error(`No product detail pages found for site ID: ${siteId}`);
    throw new Error(`No product detail pages found for site: ${baseURL}`);
  }

  const auditResult = await processStructuredData(baseURL, context, structuredDataURLs);

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`Structured data audit completed in ${formattedElapsed} seconds for ${baseURL}`);

  return {
    fullAuditRef: baseURL,
    auditResult,
  };
}

export async function generateSuggestionsData(finalUrl, auditData, context) {
  const { log } = context;

  console.info('called generateSuggestionsData', finalUrl, JSON.stringify(auditData));

  // TODO: Check if audit was successful can be skipped for now as the audit throws if it fails.

  // TODO: Check if auto suggest was enabled
  // Need to register structured-data-auto-suggest handler first and activate it for customer
  /* const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('structured-data-auto-suggest', site)) {
    log.info('Auto suggest is disabled for for site');
    return { ...auditData };
  } */

  // Init firefall
  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = { responseFormat: 'json_object' };

  // Only take results which have actual issues
  const results = auditData.auditResult
    .filter((result) => result.richResults?.detectedIssues?.length > 0);

  // Go through audit results, one for each URL
  for (const auditResult of results) {
    log.info(`Create suggestion for URL ${auditResult.inspectionUrl}`);

    // TODO: Get crawled version of website from S3 if available.
    //   Issue: Content scraper strips out all head and script tags which contain structured data.
    //   Issue: There is no defined dependency between audit and scrape. So scrape might not exist.

    // eslint-disable-next-line no-await-in-loop
    const crawledPage = await fs.readFile('./src/structured-data/crawled-page-example.html', { encoding: 'utf8' });

    // Get .plain.html version of page to pass to the LLM, as crawled version is likely too large
    // TODO: Alternatively we can extract text only from the crawled page and use it instead
    let plainPage;
    try {
      // TODO: Properly strip extension
      // TODO: .plain.html is not available for folder mapped pages, so hardcode for now
      // eslint-disable-next-line no-await-in-loop
      // const plainPageResponse = await fetch(`${auditResult.inspectionUrl}.plain.html`);
      // plainPage = await plainPageResponse.text();
      // eslint-disable-next-line no-await-in-loop
      plainPage = await fs.readFile('./src/structured-data/plain-crawled-page-example.html', { encoding: 'utf8' });
    } catch (e) {
      log.error(`Could not create suggestion because fetching of plain HTML failed for URL ${auditResult.inspectionUrl}: ${e.message}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    let crawledPageParsed;
    try {
      crawledPageParsed = cheerio.load(crawledPage);
    } catch (e) {
      log.error(`Could not create suggestion because parsing of markup failed for URL ${auditResult.inspectionUrl}: ${e.message}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    // Find all LD-JSON structured data in script tags of crawled page
    // TODO: There might be more structured data on the site using different formats
    const ldJsonData = [];
    try {
      const ldJsonTags = crawledPageParsed('script[type="application/ld+json"]');
      log.info(`Found ${ldJsonTags.length} LD-JSON tags on page`);

      if (ldJsonTags.length === 0) {
        log.error(`No structured data found on page ${auditResult.inspectionUrl}`);
        // eslint-disable-next-line no-continue
        continue;
      }

      ldJsonTags.each((_, tag) => {
        const jsonData = JSON.parse(crawledPageParsed(tag).html());
        if (jsonData['@graph']) {
          // Split individual entities
          jsonData['@graph'].forEach((entity) => {
            ldJsonData.push(entity);
          });
        } else {
          ldJsonData.push(jsonData);
        }
      });
    } catch (e) {
      log.error(`Could not create suggestion because parsing of structured data failed for URL ${auditResult.inspectionUrl}: ${e.message}`);
    }
    log.info('Extracted ld+json data:', JSON.stringify(ldJsonData));

    // TODO: Add more mappings based on actual customer issues
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
        // eslint-disable-next-line no-continue
        continue;
      }

      // Filter structured data relevant to this issue
      const wrongLdJson = ldJsonData.find((data) => entity === data['@type']);
      if (!wrongLdJson) {
        log.error(`Could not find structured data for issue of type ${issue.richResultType}`);
        // eslint-disable-next-line no-continue
        continue;
      }
      log.info('Filtered structured data:', JSON.stringify(wrongLdJson));

      const firefallInputs = {
        entity,
        errors: issue.items.map((item) => item.issues.map((i) => i.issueMessage)).flat(),
        website_url: auditResult.inspectionUrl,
        wrong_ld_json: JSON.stringify(wrongLdJson, null, 4),
        website_markup: plainPage,
      };

      log.info('Firefall inputs:', JSON.stringify(firefallInputs));

      // Get suggestions from Firefall
      // eslint-disable-next-line no-await-in-loop
      const requestBody = await getPrompt(firefallInputs, 'structured-data-suggest', log);
      // eslint-disable-next-line no-await-in-loop
      const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);

      if (response.choices?.length === 0 || response.choices[0].finish_reason !== 'stop') {
        log.error(`Could not create suggestion because Firefall did not return any suggestions for issue of type ${issue.richResultType}`);
        // eslint-disable-next-line no-continue
        continue;
      }

      const suggestion = JSON.parse(response.choices[0].message.content);
      log.info('Received Firefall response:', JSON.stringify(suggestion));

      issue.suggestion = suggestion;
    }
  }

  log.info('Finished generating suggestions data', JSON.stringify(auditData));

  return { ...auditData };
}

export default new AuditBuilder()
  .withRunner(structuredDataHandler)
  .withUrlResolver((site) => site.getBaseURL())
  .withPostProcessors([generateSuggestionsData]) // , convertToOpportunity
  .build();
