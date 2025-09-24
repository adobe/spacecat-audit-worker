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
import {
  checkDynamoItem, generateOpptyData, getUrlsDataForAccessibilityAudit,
} from './utils.js';
import { getScrapedDataForSiteId } from '../support/utils.js';
import createLowConversionOpportunities from './oppty-handlers/low-conversion-handler.js';
import createLowNavigationOpportunities from './oppty-handlers/low-navigation-handler.js';
import createLowViewsOpportunities from './oppty-handlers/low-views-handler.js';
import { createAccessibilityOpportunity } from './oppty-handlers/accessibility-handler.js';

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

export async function runAuditAndSendUrlsForScrapingStep(context) {
  const {
    site, log, finalUrl, dataAccess,
  } = context;

  const { SiteTopForm } = dataAccess;
  const topForms = await SiteTopForm.allBySiteId(site.getId());

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] starting audit`);
  const formsAuditRunnerResult = await formsAuditRunner(finalUrl, context);
  const { formVitals } = formsAuditRunnerResult.auditResult;

  // check audit size as per dynamo
  const { safe, sizeKB } = checkDynamoItem(formVitals);
  if (!safe) {
    log.info(`[Form Opportunity] [Site Id: ${site.getId()}] estimated audit item size: ${sizeKB.toFixed(2)} KB`);
    log.info(`[Form Opportunity] [Site Id: ${site.getId()}] audit item not safe for dynamo, trimming audit data`);
    // Group entries by formsource and calculate main pageview
    const formsourceGroups = {};
    formVitals.forEach((entry) => {
      const { formsource } = entry;
      if (!formsource) return;

      const totalPageview = Object.values(entry.pageview).reduce((sum, val) => sum + val, 0);
      if (!formsourceGroups[formsource]) formsourceGroups[formsource] = [];
      formsourceGroups[formsource].push({ entry, totalPageview });
    });

    // Helper to get top/bottom N including ties
    function getTopBottomWithTies(pages, n = 2) {
      const sorted = [...pages].sort((a, b) => b.totalPageview - a.totalPageview);
      return sorted.length < 2 * n
        ? sorted.map((p) => p.entry)
        : [...sorted.slice(0, n), ...sorted.slice(-n)].map((p) => p.entry);
    }

    // Collect all entries to keep
    // eslint-disable-next-line max-len
    const entriesToKeep = Object.values(formsourceGroups).flatMap((group) => getTopBottomWithTies(group, 2));

    // Mutate original formVitals in place
    formVitals.length = 0; // Clear the array
    formVitals.push(...entriesToKeep); // Push only top/bottom entries
    log.info(`[Form Opportunity] [Site Id: ${site.getId()}] trimmed form vitals ${JSON.stringify(formVitals)}`);
  }

  // generating opportunity data from audit to be send to scraper
  const formOpportunities = await generateOpptyData(formVitals, context);
  const uniqueUrls = new Set();
  for (const opportunity of formOpportunities) {
    uniqueUrls.add(opportunity.form);
  }

  // Add topFormUrls that don't have formSource
  for (const topForm of topForms) {
    const url = topForm.getUrl();
    const formSource = topForm.getFormSource();

    // Add URL if it doesn't have a formSource
    if (!formSource) {
      uniqueUrls.add(url);
    }
  }

  if (uniqueUrls.size < 10) {
    // Create a copy of formVitals to sort without modifying the original array
    const sortedFormVitals = [...formVitals].sort((a, b) => {
      const totalPageViewsA = Object.values(a.pageview).reduce((acc, curr) => acc + curr, 0);
      const totalPageViewsB = Object.values(b.pageview).reduce((acc, curr) => acc + curr, 0);
      return totalPageViewsB - totalPageViewsA;
    });
    for (const fv of sortedFormVitals) {
      uniqueUrls.add(fv.url);
      if (uniqueUrls.size >= 10) {
        break;
      }
    }
  }

  const urlsData = Array.from(uniqueUrls).map((url) => {
    const formSources = formVitals.filter((fv) => fv.url === url).map((fv) => fv.formsource)
      .filter((source) => !!source);
    return {
      url,
      ...(formSources.length > 0 && { formSources }),
    };
  });

  const result = {
    processingType: 'form',
    allowCache: false,
    jobId: site.getId(),
    urls: urlsData,
    siteId: site.getId(),
    auditResult: formsAuditRunnerResult.auditResult,
    fullAuditRef: formsAuditRunnerResult.fullAuditRef,
  };

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] finished audit and sending urls for scraping`);
  return result;
}

export async function sendA11yUrlsForScrapingStep(context) {
  const {
    log, site, dataAccess,
  } = context;
  const { SiteTopForm } = dataAccess;
  const topForms = await SiteTopForm.allBySiteId(site.getId());

  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] getting scraped data for a11y audit`);
  const scrapedData = await getScrapedDataForSiteId(site, context);
  const latestAudit = await site.getLatestAuditByAuditType('forms-opportunities');
  const { formVitals } = latestAudit.getAuditResult();
  const urlsData = getUrlsDataForAccessibilityAudit(scrapedData, formVitals, context);

  // Merge top form URLs with existing urlsData
  const existingUrls = new Set(urlsData.map((item) => item.url));

  for (const topForm of topForms) {
    const url = topForm.getUrl();
    const formSource = topForm.getFormSource();

    // Only add forms that have a formSource
    if (formSource && !existingUrls.has(url)) {
      const formSources = [formSource];
      urlsData.push({
        url,
        formSources,
      });
      existingUrls.add(url);
    } else if (formSource && existingUrls.has(url)) {
      // URL exists, merge form sources if needed
      const existingItem = urlsData.find((item) => item.url === url);
      if (existingItem && !existingItem.formSources.includes(formSource)) {
        if (existingItem.formSources.length === 1 && existingItem.formSources[0] === 'form') {
          existingItem.formSources = [formSource];
        } else {
          existingItem.formSources.push(formSource);
        }
      }
    }
  }
  const result = {
    auditResult: latestAudit.auditResult,
    fullAuditRef: latestAudit.fullAuditRef,
    processingType: 'form-accessibility',
    jobId: site.getId(),
    urls: urlsData,
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
  await createAccessibilityOpportunity(latestAudit, context);
  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] opportunity4 identified`);
  return {
    status: 'complete',
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('runAuditAndSendUrlsForScraping', runAuditAndSendUrlsForScrapingStep, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  // eslint-disable-next-line max-len
  // .addStep('sendA11yUrlsForScrapingStep', sendA11yUrlsForScrapingStep, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('processOpportunity', processOpportunityStep)
  .build();
