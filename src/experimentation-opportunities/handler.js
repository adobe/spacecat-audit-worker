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

const { AUDIT_STEP_DESTINATIONS } = Audit;

const DAYS = 7;

const HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE = 'high-organic-low-ctr';
const RAGECLICK_OPPTY_TYPE = 'rageclick';
const HIGH_INORGANIC_HIGH_BOUNCE_RATE_OPPTY_TYPE = 'high-inorganic-high-bounce-rate';

const OPPTY_QUERIES = [
  RAGECLICK_OPPTY_TYPE,
  HIGH_INORGANIC_HIGH_BOUNCE_RATE_OPPTY_TYPE,
  HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE,
];

function getRageClickOpportunityImpact(oppty) {
  // return the maximum number of samples across all the selectors that have rage click
  return oppty.metrics.reduce((acc, metric) => Math.max(acc, metric.samples || 0), 0);
}

function processRageClickOpportunities(opportunities) {
  opportunities.filter((oppty) => oppty.type === 'rageclick')
    .forEach((oppty) => {
      const index = opportunities.indexOf(oppty);
      // eslint-disable-next-line no-param-reassign
      opportunities[index] = {
        ...oppty,
        opportunityImpact: getRageClickOpportunityImpact(oppty),
      };
    });
}

export async function generateOpportunityAndSuggestions(context) {
  const {
    log, sqs, env, site, audit,
  } = context;
  const auditResult = audit.getAuditResult();
  log.info('auditResult in generateOpportunityAndSuggestions: ', JSON.stringify(auditResult, null, 2));

  const messages = auditResult?.experimentationOpportunities?.filter(
    (oppty) => oppty.type === HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE,
  ).map((oppty) => ({
    type: 'guidance:high-organic-low-ctr',
    siteId: site.getId(),
    auditId: audit.id,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      url: oppty.page,
      ctr: oppty.trackedPageKPIValue,
      siteAgerageCtr: oppty.trackedKPISiteAverage,
    },
  }));

  for (const message of messages) {
    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`Message sent to Mystique: ${JSON.stringify(message)}`);
  }
}

function getHighOrganicLowCtrOpportunityUrls(experimentationOpportunities) {
  return experimentationOpportunities?.filter(
    (oppty) => oppty.type === HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE,
  )?.map((oppty) => oppty.page);
}

/**
 * Audit handler container for all the opportunities
 * @param {*} auditUrl
 * @param {*} context
 * @param {*} site
 * @returns
 */

export async function experimentOpportunitiesAuditRunner(auditUrl, context, site) {
  const { log } = context;

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const options = {
    domain: auditUrl,
    interval: DAYS,
    granularity: 'hourly',
  };
  const queryResults = await rumAPIClient.queryMulti(OPPTY_QUERIES, options);
  const experimentationOpportunities = Object.values(queryResults).flatMap((oppty) => oppty);
  processRageClickOpportunities(experimentationOpportunities);
  log.info(`Found ${experimentationOpportunities.length} experimentation opportunites for ${auditUrl}`);

  return {
    auditResult: {
      experimentationOpportunities,
    },
    fullAuditRef: auditUrl,
    type: 'experimentation-opportunities',
    processingType: 'default',
    jobId: site.getId(),
    urls: getHighOrganicLowCtrOpportunityUrls(experimentationOpportunities).map((url) => ({ url })),
    siteId: site.getId(),
  };
}

export async function runAuditAndScrapeStep(context) {
  const { site, finalUrl } = context;
  const result = await experimentOpportunitiesAuditRunner(finalUrl, context, site);

  return {
    auditResult: result.auditResult,
    fullAuditRef: result.fullAuditRef,
    type: 'experimentation-opportunities',
    processingType: 'default',
    jobId: site.getId(),
    urls: getHighOrganicLowCtrOpportunityUrls(
      result.auditResult?.experimentationOpportunities,
    ).map((url) => ({ url })),
    siteId: site.getId(),
  };
}

export function organicKeywordsStep(context) {
  const {
    site, log, finalUrl, audit,
  } = context;
  const auditData = audit.getFullAuditRef();
  const auditResult = audit.getAuditResult();
  log.info('auditref', JSON.stringify(auditData, null, 2));
  log.info('auditResult', JSON.stringify(auditResult, null, 2));
  const urls = getHighOrganicLowCtrOpportunityUrls(auditResult.experimentationOpportunities);
  log.info(`Organic keywords step for ${finalUrl}, found ${urls.length} urls`);
  return {
    type: 'organic-keywords',
    siteId: site.getId(),
    // TODO: change to all urls, after support is added to the organic-keywords importter
    pageUrl: urls?.[0],
  };
}

export function importAllTrafficStep(context) {
  const {
    site, log, finalUrl,
  } = context;
  log.info(`Import all traffic step for ${finalUrl}`);
  return {
    type: 'all-traffic',
    siteId: site.getId(),
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('runAuditAndScrapeStep', runAuditAndScrapeStep, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('organicKeywordsStep', organicKeywordsStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('importAllTrafficStep', importAllTrafficStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('generateOpportunityAndSuggestions', generateOpportunityAndSuggestions)
  .build();
