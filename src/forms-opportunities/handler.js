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
import { FORMS_AUDIT_INTERVAL } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { generateOpptyData, getValidFormUrls } from './utils.js';
import { getScrapedDataForSiteId } from '../support/utils.js';
import createLowConversionOpportunities from './oppty-handlers/low-conversion-handler.js';
import createLowNavigationOpportunities from './oppty-handlers/low-navigation-handler.js';
import createLowViewsOpportunities from './oppty-handlers/low-views-handler.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const FORMS_OPPTY_QUERIES = [
  'cwv',
  'form-vitals',
];

export async function formsAuditRunner(auditUrl, context) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const options = {
    domain: auditUrl,
    interval: FORMS_AUDIT_INTERVAL,
    granularity: 'hourly',
  };

  const queryResults = await rumAPIClient.queryMulti(FORMS_OPPTY_QUERIES, options);
  const auditResult = {
    formVitals: queryResults['form-vitals'],
    auditContext: {
      interval: FORMS_AUDIT_INTERVAL,
    },
  };

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function sendA11yIssuesToMystique(latestAudit, context) {
  const {
    log, site, sqs, env,
  } = context;

  const { formA11yData } = await getScrapedDataForSiteId(site, context);
  if (formA11yData?.length === 0) {
    log.info(`[Form Opportunity] [Site Id: ${site.getId()}] No a11y data found`);
    return;
  }

  // TODO: how to handle multiple form in page?
  const a11yData = formA11yData.map((a11y) => ({
    form: a11y.form,
    a11yIssues: a11y.scrapeResult,
  }));

  const mystiqueMessage = {
    type: 'opportunity:forms-a11y',
    siteId: site.getId(),
    auditId: latestAudit.auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      a11yData,
    },
  };

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] Sent a11y issues to mystique`);
}

export async function runAuditAndSendUrlsForScrapingStep(context) {
  const {
    site, log, finalUrl,
  } = context;

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] starting audit`);
  const formsAuditRunnerResult = await formsAuditRunner(finalUrl, context);
  const { formVitals } = formsAuditRunnerResult.auditResult;

  // generating opportunity data from audit to be send to scraper
  const formOpportunities = await generateOpptyData(formVitals, context);
  const uniqueUrls = new Set();
  for (const opportunity of formOpportunities) {
    uniqueUrls.add(opportunity.form);
  }

  if (uniqueUrls.size < 10) {
    formVitals.sort((a, b) => {
      const totalPageViewsA = Object.values(a.pageview).reduce((acc, curr) => acc + curr, 0);
      const totalPageViewsB = Object.values(b.pageview).reduce((acc, curr) => acc + curr, 0);
      return totalPageViewsB - totalPageViewsA;
    });
    for (const fv of formVitals) {
      uniqueUrls.add(fv.form);
      if (uniqueUrls.size >= 10) {
        break;
      }
    }
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

export async function sendA11yUrlsForScrapingStep(context) {
  const {
    log, site,
  } = context;

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] getting scraped data for a11y audit`);
  const scrapedData = await getScrapedDataForSiteId(site, context);
  const latestAudit = await site.getLatestAuditByAuditType('forms-opportunities');
  const urls = getValidFormUrls(scrapedData);

  const result = {
    auditResult: latestAudit.auditResult,
    fullAuditRef: latestAudit.fullAuditRef,
    processingType: 'form-a11y',
    jobId: site.getId(),
    urls: urls.map((url) => ({ url })),
    siteId: site.getId(),
  };

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] sending urls for form-accessibility audit`);
  return result;
}

export async function processOpportunityStep(context) {
  const {
    log, site, finalUrl,
  } = context;

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] processing opportunity`);
  const scrapedData = await getScrapedDataForSiteId(site, context);
  const latestAudit = await site.getLatestAuditByAuditType('forms-opportunities');
  const excludeForms = new Set();
  await createLowNavigationOpportunities(finalUrl, latestAudit, scrapedData, context, excludeForms);
  await createLowViewsOpportunities(finalUrl, latestAudit, scrapedData, context, excludeForms);
  await createLowConversionOpportunities(finalUrl, latestAudit, scrapedData, context, excludeForms);
  await sendA11yIssuesToMystique(latestAudit, context);
  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] opportunity identified`);
  return {
    status: 'complete',
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('runAuditAndSendUrlsForScraping', runAuditAndSendUrlsForScrapingStep, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('sendA11yUrlsForScrapingStep', sendA11yUrlsForScrapingStep, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('processOpportunity', processOpportunityStep)
  .build();
