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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { generateOpptyData, generateOpptyDataForHighPageViewsLowFormNav } from './utils.js';
import { getScrapedDataForSiteId } from '../support/utils.js';
import convertToOpportunity from './opportunityHandler.js';
import highPageViewsLowFormNavOpportunity from './highPageViewsLowFormNavOpportunity.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const DAILY_THRESHOLD = 200;
const INTERVAL = 7; // days
const FORMS_OPPTY_QUERIES = [
  'cwv',
  'form-vitals',
];

export async function formsAuditRunner(auditUrl, context) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const options = {
    domain: auditUrl,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  const queryResults = await rumAPIClient.queryMulti(FORMS_OPPTY_QUERIES, options);
  const cwvMap = new Map(
    queryResults.cwv
      .filter((cwv) => cwv.type === 'url')
      .map((cwv) => [cwv.url, cwv]),
  );

  const auditResult = {
    formVitals: queryResults['form-vitals'].filter((data) => {
      // Calculate the sum of all values inside the `pageview` object
      const pageviewsSum = Object.values(data.pageview).reduce((sum, value) => sum + value, 0);
      return pageviewsSum >= DAILY_THRESHOLD * INTERVAL;
    })
      .map((formVital) => {
        const cwvData = cwvMap.get(formVital.url);
        const filteredCwvData = cwvData
          ? Object.fromEntries(Object.entries(cwvData).filter(([key]) => key !== 'url' && key !== 'pageviews' && key !== 'type'))
          : {};
        return {
          ...formVital,
          cwv: filteredCwvData, // Append cwv data
        };
      }),
    auditContext: {
      interval: INTERVAL,
    },
  };

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function runAuditAndSendUrlsForScrapingStep(context) {
  const {
    site, log, finalUrl,
  } = context;

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] starting audit`);
  const formsAuditRunnerResult = await formsAuditRunner(finalUrl, context);
  const { formVitals } = formsAuditRunnerResult.auditResult;

  // generating opportunity data from audit to be send to scraper
  let formOpportunities = generateOpptyData(formVitals);
  const uniqueUrls = new Set();
  for (const opportunity of formOpportunities) {
    uniqueUrls.add(opportunity.form);
  }

  // generating opportunity data from audit to be send to scraper
  // high page views low form navigation
  formOpportunities = generateOpptyDataForHighPageViewsLowFormNav(formVitals);
  for (const opportunity of formOpportunities) {
    uniqueUrls.add(opportunity.form);
  }

  const result = {
    auditResult: formsAuditRunnerResult.auditResult,
    fullAuditRef: formsAuditRunnerResult.fullAuditRef,
    processingType: 'form',
    jobId: site.getId(),
    urls: Array.from(uniqueUrls).map((url) => ({ url })),
    siteId: site.getId(),
  };

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] finished audit and sending urls for scraping`);
  return result;
}

export async function processOpportunityStep(context) {
  const {
    log, site, finalUrl,
  } = context;

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] processing opportunity`);
  const scrapedData = await getScrapedDataForSiteId(site, context);
  const latestAudit = await site.getLatestAuditByAuditType('forms-opportunities');
  await convertToOpportunity(finalUrl, latestAudit, scrapedData, context);
  await highPageViewsLowFormNavOpportunity(finalUrl, latestAudit, scrapedData, context);
  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] opportunity identified .`);
  return {
    status: 'complete',
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('runAuditAndSendUrlsForScraping', runAuditAndSendUrlsForScrapingStep, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('processOpportunity', processOpportunityStep)
  .build();
