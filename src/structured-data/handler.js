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
  getPrompt, isNonEmptyArray, isNonEmptyObject, isObject,
} from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { load as cheerioLoad } from 'cheerio';

import StructuredDataValidator from '@marbec/structured-data-parser';
import { join } from 'path';
import { AuditBuilder } from '../common/audit-builder.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { generatePlainHtml, getScrapeForPath } from '../support/utils.js';

const auditType = Audit.AUDIT_TYPES.STRUCTURED_DATA;
const auditAutoSuggestType = Audit.AUDIT_TYPES.STRUCTURED_DATA_AUTO_SUGGEST;

async function getStructuredDataIssuesFromGSC(baseUrl, context, pages) {
  const { log } = context;

  let google;
  try {
    google = await GoogleClient.createFrom(context, baseUrl);
  } catch (error) {
    log.error(`Failed to create Google client. Site was probably not onboarded to GSC yet. Error: ${error.message}`);
    throw new Error(`Failed to create Google client. Site was probably not onboarded to GSC yet. Error: ${error.message}`);
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
      log.info(`Successfully inspected URL: ${page}`);
      log.debug(`Inspection result: ${JSON.stringify(inspectionResult)}`);

      const richResults = inspectionResult?.richResultsResult;
      if (!richResults) {
        return;
      }

      richResults.detectedItems.forEach((type) => {
        type.items.forEach((item) => {
          item.issues.forEach((issue) => {
            const rootType = entityMapping[type.richResultType];
            if (!rootType) {
              log.warn(`Skipping GSC issue, because cannot map GSC type "${type.richResultType}" to schema.org type.`);
              return;
            }

            issues.push({
              pageUrl: page,
              rootType,
              dataFormat: 'jsonld', // GSC does not specify where the data came from, so we assume it is LD-JSON
              issueMessage: `${item.name}: ${issue.issueMessage}`,
              severity: issue.severity,
            });
          });
        });
      });
    } catch (error) {
      log.error(`Failed to inspect URL: ${page}. Error: ${error.message}`);
    }
  }));

  return issues;
}

async function getStructuredDataIssuesFromScraper(baseUrl, context, pages, site) {
  const { log } = context;

  const issues = [];

  await Promise.all(pages.map(async ({ url: page }) => {
    let scrapeResult;
    const { pathname } = new URL(page);
    try {
      scrapeResult = await getScrapeForPath(pathname, context, site);
    } catch (e) {
      log.error(`Could not find scrape for ${pathname}. Make sure that scrape-top-pages did run.`, e);
      return;
    }

    const waeResult = scrapeResult?.scrapeResult?.structuredData;

    // If scrape contains old format of structured data, skip
    if (isNonEmptyArray(waeResult)) {
      return;
    }
    log.info('WAE result', JSON.stringify(waeResult, null, 4));

    const schemaOrgPath = join(
      process.cwd(),
      'src',
      'structured-data',
      'schemaorg-current-https.jsonld',
    );

    const validator = new StructuredDataValidator(schemaOrgPath);
    const validatorIssues = await validator.validate(waeResult);
    for (const issue of validatorIssues) {
      issues.push({
        pageUrl: page,
        ...issue,
      });
    }
  }));

  return issues;
}

async function deduplicateIssues(context, gscIssues, scraperIssues) {
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
        log.warn(`Structured Data: GSC issue for type ${issue.rootType} was not found by structured data parser.`, JSON.stringify(issue, null, 4));
      }
    }
  }

  // Group issues
  const equalityFields = ['rootType', 'issueMessage', 'dataFormat', 'severity'];
  const deduplicatedIssues = issues.reduce((acc, issue) => {
    const existingIssue = acc
      .find((i) => equalityFields.every((field) => i[field] === issue[field]));
    if (!existingIssue) {
      const { pageUrl, ...rest } = issue;
      acc.push({ pageUrls: [pageUrl], ...rest });
    } else {
      existingIssue.pageUrls.push(issue.pageUrl);
    }
    return acc;
  }, []);

  return deduplicatedIssues;
}

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
export async function processStructuredData(baseURL, context, pages, site) {
  const { log } = context;

  // TODO: Somehow deduplicate issues between GSC and validator
  // TODO: Log missing issues that appear in GSC but not in validator

  const [gscPagesWithIssues, scraperPagesWithIssues] = await Promise.all([
    getStructuredDataIssuesFromGSC(baseURL, context, pages),
    getStructuredDataIssuesFromScraper(baseURL, context, pages, site),
  ]);

  log.info('GSC issues', gscPagesWithIssues);
  log.info('Scraper issues', scraperPagesWithIssues);

  // Deduplicate issues
  const pagesWithIssues = await deduplicateIssues(
    context,
    gscPagesWithIssues,
    scraperPagesWithIssues,
  );

  log.info('Deduplicated issues', pagesWithIssues);

  // Abort early if no issues are found
  if (pagesWithIssues.length === 0) {
    log.info('No pages with structured data issues found in GSC or Scraper');
  }

  return {
    success: true,
    issues: pagesWithIssues,
  };
}

export async function structuredDataHandler(baseURL, context, site) {
  const { log, dataAccess } = context;
  const startTime = process.hrtime();

  try {
    /* const topPages = [{
      url: 'https://www.aemshop.net/structured-data/breadcrumb/invalid1',
    }]; */

    const siteId = site.getId();
    const topPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
    if (!isNonEmptyArray(topPages)) {
      log.error(`No top pages for site ID ${siteId} found. Ensure that top pages were imported.`);
      throw new Error(`No top pages for site ID ${siteId} found.`);
    }

    const auditResult = await processStructuredData(baseURL, context, topPages, site);

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

  log.info('Generate suggestions data', auditData);

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

  // Go through audit results, one for each URL
  for (const issue of auditData.auditResult.issues) {
    // Limit to avoid excessive Firefall requests. Can be increased if needed.
    if (firefallRequests >= parseInt(AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT, 10)) {
      log.error(`Aborting suggestion generation as more than ${AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT} Firefall requests have been used.`);
      break;
    }

    log.debug(`Handle rich result issue of type ${issue.rootType} occuring on ${issue.pageUrls}`);

    // Cache scrape of page, if needed
    let scrapeResult;

    // TODO: If scrape not found, try other entries in pageUrls and change primary url
    const inspectionUrl = issue.pageUrls[0];
    const { pathname } = new URL(inspectionUrl);
    try {
      scrapeResult = await getScrapeForPath(pathname, context, site);
    } catch (e) {
      log.error(`Could not find scrape for ${pathname}. Make sure that scrape-top-pages did run.`, e);
      break;
    }

    // Get extracted LD-JSON from scrape
    const structuredData = scrapeResult?.scrapeResult?.structuredData;

    // structuredData is either an array (old format) or an object (new format)
    if (!isNonEmptyArray(structuredData) && !isNonEmptyObject(structuredData)) {
      // If structured data is loaded late on the page, e.g. in delayed phase,
      // the scraper might not pick it up. You would need to fine tune wait for
      // check of the scraper for this site.
      log.error(`No structured data found in scrape result for URL ${inspectionUrl}`);
      break;
    }

    // Get wrong markup either from @source attribute or from scrape
    let wrongMarkup;
    if (issue.source) {
      wrongMarkup = issue.source;
    } else {
      wrongMarkup = structuredData.find((data) => issue.rootType === data['@type']);

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

      if (!isNonEmptyObject(wrongMarkup)) {
        log.error(`Could not find structured data for issue of type ${issue.rootType} for URL ${inspectionUrl}`);
        continue;
      }
    }

    log.debug('Filtered structured data:', wrongMarkup);

    // Use cheerio to generate a plain version of the scraped HTML
    const parsed = cheerioLoad(scrapeResult?.scrapeResult?.rawBody);
    const plainPage = generatePlainHtml(parsed);

    const firefallInputs = {
      entity: issue.rootType,
      error: issue.issueMessage,
      data_format: issue.dataFormat,
      website_url: inspectionUrl,
      wrong_markup: wrongMarkup,
      website_markup: plainPage,
    };
    if (issue.path) {
      firefallInputs.path = JSON.stringify(issue.path);
    }
    log.debug('Firefall inputs', JSON.stringify(firefallInputs, null, 4));

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
      log.error(`Could not create suggestion because Firefall did not return any suggestions for issue of type ${issue.rootType} for URL ${inspectionUrl}`, e);
      continue;
    }

    let suggestion;
    try {
      suggestion = JSON.parse(response.choices[0].message.content);
    } catch (e) {
      log.error(`Could not parse Firefall response for issue of type ${issue.rootType} for URL ${inspectionUrl}`, e);
      continue;
    }

    // Reject suggestion if confidence score is too low
    if (suggestion?.confidenceScore < 0.6) {
      log.error(`Confidence score too low, skip suggestion of type ${issue.rootType} for URL ${inspectionUrl}`);
      continue;
    }

    issue.suggestion = suggestion;
  }

  log.debug(`Used ${firefallRequests} Firefall requests in total for site ${auditUrl}`);
  log.debug('Generated suggestions data', JSON.stringify(auditData));

  return { ...auditData };
}

// TODO: Ensure that this can be displayed in the UI
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

  // TODO: How to define suggestion key, probably type + issue message + pageUrl
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

export default new AuditBuilder()
  .withRunner(structuredDataHandler)
  .withUrlResolver((site) => site.getBaseURL())
  .withPostProcessors([generateSuggestionsData, opportunityAndSuggestions])
  .build();
