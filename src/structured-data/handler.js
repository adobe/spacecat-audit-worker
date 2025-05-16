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
import StructuredDataValidator from '@adobe/structured-data-validator';
import { join } from 'path';

import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { generatePlainHtml, getScrapeForPath } from '../support/utils.js';
import { cleanupStructuredDataMarkup } from './lib.js';

const auditType = Audit.AUDIT_TYPES.STRUCTURED_DATA;
const auditAutoSuggestType = Audit.AUDIT_TYPES.STRUCTURED_DATA_AUTO_SUGGEST;
const { AUDIT_STEP_DESTINATIONS } = Audit;

// Cache scrape results from S3, as individual pages might be requested multiple times
const scrapeCache = new Map();

async function getStructuredDataIssuesFromGSC(finalUrl, context, pages) {
  const { log } = context;

  let google;
  try {
    google = await GoogleClient.createFrom(context, finalUrl);
  } catch (error) {
    log.warn('Failed to create Google client. Site was probably not onboarded to GSC yet. Continue without data from GSC.', error);
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
      log.info(`Inspection result for ${page} from GSC:`, JSON.stringify(inspectionResult));

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

            issues.push({
              pageUrl: page,
              rootType,
              dataFormat: 'jsonld', // GSC does not specify where the data came from, so we assume it is LD-JSON
              issueMessage: issue.issueMessage,
              severity: issue.severity,
            });
          });
        });
      });
    } catch (error) {
      log.error(`Failed to get inspection results from GSC for URL: ${page}.`, error);
    }
  }));

  return issues;
}

async function getStructuredDataIssuesFromScraper(finalUrl, context, pages, site) {
  const { log } = context;

  const issues = [];

  await Promise.all(pages.map(async ({ url: page }) => {
    let scrapeResult;
    const { pathname } = new URL(page);
    try {
      if (!scrapeCache.has(pathname)) {
        scrapeCache.set(pathname, getScrapeForPath(pathname, context, site));
      }
      scrapeResult = await scrapeCache.get(pathname);
    } catch (e) {
      log.error(`Could not find scrape for ${pathname}. Make sure that scrape-top-pages did run.`, e);
      return;
    }

    const waeResult = scrapeResult?.scrapeResult?.structuredData;

    // If scrape contains old format of structured data, skip
    if (isNonEmptyArray(waeResult)) {
      return;
    }
    log.info('Structured data from scrape', JSON.stringify(waeResult, null, 4));

    const schemaOrgPath = join(
      process.cwd(),
      'src',
      'structured-data',
      'schemaorg-current-https.jsonld',
    );

    const validator = new StructuredDataValidator(schemaOrgPath);
    const validatorIssues = await validator.validate(waeResult);
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
      if (existingIssue) {
        continue;
      }

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

  // TODO: Temporarily disable grouping issues by rootTypes in favor of grouping issues by pageUrl.
  // Re-enable this logic together with improved grouping support in the UI.
  /* const equalityFields = ['rootType', 'issueMessage', 'dataFormat', 'severity'];
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
  }, []); */

  return issues;
}

/**
 * Processes an audit of a set of pages from a site using Google's URL inspection tool.
 *
 * @async
 * @function
 * @param {string} finalUrl - The final URL for the audit.
 * @param {Object} context - The context object.
 * @param {Array} pages - An array of page URLs to be audited.
 *
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of objects,
 * each containing the inspection URL, filtered index status result, and filtered rich results.
 * If an error occurs during the inspection of a URL, the object will include an error message.
 *
 * @throws {Error} - Throws an error if the audit process fails.
 */
export async function processStructuredData(finalUrl, context, pages, site) {
  const { log } = context;

  const [gscPagesWithIssues, scraperPagesWithIssues] = await Promise.all([
    getStructuredDataIssuesFromGSC(finalUrl, context, pages),
    getStructuredDataIssuesFromScraper(finalUrl, context, pages, site),
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
    log.info('No pages with structured data issues found in GSC or in scraped data');
  }

  return {
    success: true,
    issues: pagesWithIssues,
  };
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
    log.warn('Audit failed, skipping suggestions data generation');
    return { ...auditData };
  }

  // Check if auto suggest was enabled
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite(auditAutoSuggestType, site)) {
    log.warn('Auto-suggest is disabled for site');
    return { ...auditData };
  }

  // Initialize Firefall client
  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = {
    model: 'gpt-4o',
    responseFormat: 'json_object',
  };

  let firefallRequests = 0;

  // Cache suggestions so that we only generate one suggestion for each issue
  const existingSuggestions = new Map();
  const buildKey = (data) => `${data.dataFormat}::${data.rootType}::${data.severity}::${data.issueMessage}`;

  // Go through audit results, one for each URL
  for (const issue of auditData.auditResult.issues) {
    // Limit to avoid excessive Firefall requests. Can be increased if needed.
    if (firefallRequests >= parseInt(AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT, 10)) {
      log.error(`Aborting suggestion generation as more than ${AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT} Firefall requests have been used.`);
      break;
    }

    log.info(`Handle rich result issue of type ${issue.rootType} occurring on ${issue.pageUrl}`);

    // Check if a suggestion for the issue is already in the suggestion Map
    const existingSuggestionKey = existingSuggestions.keys().find((key) => key === buildKey(issue));
    if (existingSuggestionKey) {
      log.info(`Re-using existing suggestion for issue of type ${issue.rootType} and URL ${issue.pageUrl}`);
      issue.suggestion = existingSuggestions.get(existingSuggestionKey);
    } else {
      let scrapeResult;

      const inspectionUrl = issue.pageUrl;
      const { pathname } = new URL(inspectionUrl);
      try {
        if (!scrapeCache.has(pathname)) {
          scrapeCache.set(pathname, getScrapeForPath(pathname, context, site));
        }
        scrapeResult = await scrapeCache.get(pathname);
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
        // DEPRECATED: This case is to support the old scraper format, should be removed soon
        if (isNonEmptyArray(structuredData)) {
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
        } else if (isNonEmptyObject(structuredData) && structuredData[issue.dataFormat]) {
          // This case happens if structured data issue is from GSC
          // which limited information on where the issue is located
          wrongMarkup = structuredData[issue.dataFormat]?.[issue.rootType]?.[0];
        }

        if (!isNonEmptyObject(wrongMarkup)) {
          log.error(`Could not find structured data for issue of type ${issue.rootType} for URL ${inspectionUrl}`);
          continue;
        }
      }

      // Cleanup markup if RDFa or microdata
      try {
        if (issue.dataFormat === 'rdfa' || issue.dataFormat === 'microdata') {
          const parsed = cheerioLoad(wrongMarkup);
          wrongMarkup = cleanupStructuredDataMarkup(parsed);
        }
      } catch (e) {
        log.warn(`Could not cleanup markup for issue of type ${issue.rootType} for URL ${inspectionUrl}`, e);
      }

      log.info('Filtered structured data:', wrongMarkup);

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
      log.info('Firefall inputs', JSON.stringify(firefallInputs, null, 4));

      // Get suggestions from Firefall
      let response;
      try {
        const requestBody = await getPrompt(firefallInputs, 'structured-data-suggest', log);
        response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);
        firefallRequests += 1;

        if (response.choices?.length === 0 || response.choices[0].finish_reason !== 'stop') {
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

        issue.suggestion = suggestion;
        existingSuggestions.set(buildKey(issue), structuredClone(suggestion));
      } catch (e) {
        log.error(`Creating suggestion for type ${issue.rootType} for URL ${inspectionUrl} failed:`, e);
      }
    }

    issue.errors = [];

    let fix = '';
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
        markup = `\`\`\`json
${JSON.stringify(correctedMarkup, null, 4)}
\`\`\``;
      } else {
        // TODO: Try to format HTML correctly
        markup = `\`\`\`html
${correctedMarkup}
\`\`\``;
      }

      fix = `
## Affected page
 * ${issue.pageUrl}
## Issue Explanation
${errorDescription}
## Corrected Structured Data
${markup}

## Rationale
${aiRationale}

_Confidence score: ${score}_`;
    } else {
      fix = `
## Affected page
  * ${issue.pageUrl}
## Issue Detected for ${issue.rootType}
${issue.issueMessage}`;

      if (issue.source) {
        let markup;
        if (issue.dataFormat === 'jsonld') {
          markup = `\`\`\`json
${JSON.stringify(issue.source, null, 4)}
\`\`\``;
        } else {
          markup = `\`\`\`html
${issue.source}
\`\`\``;
        }
        fix += `
## Problematic Structured Data
${markup}
`;
      }
    }

    issue.errors.push({ fix, id: issue.rootType.replaceAll(/["\s]/g, '').toLowerCase(), errorTitle: `${issue.rootType}: ${issue.issueMessage}` });
  }

  log.info(`Used ${firefallRequests} Firefall requests in total for site ${auditUrl}`);
  log.info('Generated suggestions data', JSON.stringify(auditData));

  return { ...auditData };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  // Check if audit was successful
  if (auditData.auditResult.success === false) {
    log.warn('Audit failed, skipping opportunity generation');
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    { siteId: auditData.siteId, id: auditData.id },
    context,
    createOpportunityData,
    auditType,
  );

  // TODO: Temporarily group issues by pageUrl as the UI does not support displaying
  // the same page multiple times or displaying issues grouped by rootType
  const issuesByPageUrl = auditData.auditResult.issues.reduce((acc, issue) => {
    const existingIssue = acc.find((i) => i.pageUrl === issue.pageUrl);
    if (!existingIssue) {
      acc.push(issue);
    } else {
      existingIssue.errors.push(...issue.errors);
    }
    return acc;
  }, []);

  const buildKey = (data) => `${data.pageUrl}`;

  await syncSuggestions({
    opportunity,
    newData: issuesByPageUrl,
    buildKey,
    context,
    mapNewSuggestion: (data) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: data.severity === 'ERROR' ? 1 : 0,
      data: {
        type: 'url',
        url: data.pageUrl,
        errors: data.errors,
      },
    }),
    log,
  });

  return { ...auditData };
}

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.info(`Importing top pages for ${finalUrl}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    finalUrl,
  };
}

export async function submitForScraping(context) {
  const {
    site,
    dataAccess,
    log,
    finalUrl,
  } = context;
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  if (topPages.length === 0) {
    throw new Error('No top pages found for site');
  }

  log.info(`Submitting for scraping ${topPages.length} top pages for site ${site.getId()}, finalUrl: ${finalUrl}`);

  return {
    urls: topPages.map((topPage) => ({ url: topPage.getUrl() })),
    siteId: site.getId(),
    type: 'structured-data',
  };
}

export async function runAuditAndGenerateSuggestions(context) {
  const {
    site, finalUrl, log, dataAccess, audit,
  } = context;
  const { SiteTopPage } = dataAccess;

  const startTime = process.hrtime();
  const siteId = site.getId();

  try {
    let topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    if (!isNonEmptyArray(topPages)) {
      log.error(`No top pages for site ID ${siteId} found. Ensure that top pages were imported.`);
      throw new Error(`No top pages for site ID ${siteId} found.`);
    } else {
      topPages = topPages.map((page) => ({ url: page.getUrl() }));
    }

    let auditResult = await processStructuredData(finalUrl, context, topPages, site);

    // Create opportunities and suggestions
    auditResult = await generateSuggestionsData(finalUrl, { auditResult }, context, site);
    auditResult = await opportunityAndSuggestions(finalUrl, {
      siteId: site.getId(),
      auditId: audit.getId(),
      ...auditResult,
    }, context);

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
    const formattedElapsed = elapsedSeconds.toFixed(2);

    log.info(`Structured data audit completed in ${formattedElapsed} seconds for ${finalUrl}`);

    return {
      fullAuditRef: finalUrl,
      auditResult,
    };
  } catch (e) {
    log.error(`Structured data audit failed for ${finalUrl}`, e);
    return {
      fullAuditRef: finalUrl,
      auditResult: {
        error: e.message,
        success: false,
      },
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
