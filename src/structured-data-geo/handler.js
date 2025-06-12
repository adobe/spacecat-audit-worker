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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { getPrompt, isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { importTopPages, submitForScraping } from '../structured-data/handler.js';
import { getScrapeForPath } from '../support/utils.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from '../structured-data/opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const structuredDataAuditType = Audit.AUDIT_TYPES.STRUCTURED_DATA;

export async function findPagesWithFAQMismatch(allPages, context) {
  const { site, log } = context;

  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = {
    model: 'gpt-4o-mini',
    responseFormat: 'json_object',
  };

  let numAiCalls = 0;
  const AI_CALL_LIMIT = 10;
  const faqScrapeResults = await Promise.all(allPages.map(async (page) => {
    try {
      const { pathname } = new URL(page.url);
      const scrape = await getScrapeForPath(pathname, context, site);

      // check if there is already FAQ data on this page - if yes, skip
      const hasFAQData = scrape.scrapeResult?.structuredData?.findIndex((data) => data['@type'] === 'FAQPage') >= 0;
      if (hasFAQData) {
        return false;
      }

      if (!scrape.scrapeResult?.rawBody) {
        return false;
      }

      if (numAiCalls >= AI_CALL_LIMIT) {
        return false;
      }
      numAiCalls += 1;

      const firefallInput = {
        website_markup: scrape.scrapeResult.rawBody,
      };

      // determine whether there is an FAQ on the page
      const prompt = await getPrompt(firefallInput, 'structured-data-detect-faq', log);
      const aiResult = await firefallClient.fetchChatCompletion(prompt, firefallOptions);

      if (!aiResult?.choices?.[0]?.message?.content) {
        return false;
      }

      const responseJson = JSON.parse(aiResult.choices[0].message.content);
      return responseJson.hasFAQ;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      return false;
    }
  }));

  log.info(`Ran ${numAiCalls} pages through LLM.`);

  return allPages.filter((page, i) => faqScrapeResults[i]);
}

export async function handleGEOStructuredData(context) {
  const {
    site, finalUrl, log, dataAccess, audit,
  } = context;
  const { SiteTopPage } = dataAccess;
  const siteId = site.getId();

  let topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
  if (!isNonEmptyArray(topPages)) {
    log.error(`No top pages for site ID ${siteId} found. Ensure that top pages were imported.`);
    throw new Error(`No top pages for site ID ${siteId} found.`);
  } else {
    topPages = topPages.map((page) => ({ url: page.getUrl() }));
  }

  const pagesWithFAQMismatch = await findPagesWithFAQMismatch(topPages.slice(0, 20), context);

  if (!isNonEmptyArray(pagesWithFAQMismatch)) {
    return {
      fullAuditRef: finalUrl,
      auditResult: {
        message: 'No pages with FAQ mismatch found',
      },
    };
  }

  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    structuredDataAuditType,
  );

  await syncSuggestions({
    opportunity,
    newData: pagesWithFAQMismatch,
    context,
    buildKey: (data) => `${data.url}-FAQs`,
    log,
    mapNewSuggestion: (data) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: 10,
      data: {
        type: 'url',
        url: data.url,
        errors: [
          {
            id: `${data.url}-faq-missing`,
            errorTitle: 'Missing FAQ',
            fix: 'Detected a page with FAQs that doesn\'t provide the FAQ as structured data.',
          },
        ],
      },
    }),
  });

  return {
    fullAuditRef: finalUrl,
    auditResult: {
      message: `Successfully created suggestion to update ${pagesWithFAQMismatch.length} pages with FAQ structured data`,
      pages: JSON.stringify(pagesWithFAQMismatch),
    },
  };
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('run-handler', handleGEOStructuredData)
  .build();
