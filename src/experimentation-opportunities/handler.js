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
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { getCountryCodeFromLang } from '../utils/url-utils.js';
import {
  getObjectFromKey,
} from '../utils/s3-utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const IMPORT_ORGANIC_KEYWORDS = 'organic-keywords';

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
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      url: oppty.page,
      ctr: oppty.trackedPageKPIValue,
      siteAverageCtr: oppty.trackedKPISiteAverage,
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
 * Generates mock experimentation opportunities for URLs that don't have real RUM data
 * @param {string[]} urlsWithoutData - Array of URLs missing real analytics
 * @returns {Array} Array of mock experimentation opportunities
 */
function generateMockOpportunitiesForMissingUrls(urlsWithoutData) {
  return urlsWithoutData.map((url) => ({
    type: HIGH_ORGANIC_LOW_CTR_OPPTY_TYPE,
    page: url,
    pageViews: Math.round(1000 + Math.random() * 4000),
    trackedPageKPIValue: 0.015 + Math.random() * 0.03,
    trackedKPISiteAverage: 0.035,
    organicTraffic: Math.round(800 + Math.random() * 1200),
  }));
}

/**
 * Audit handler container for all the opportunities
 * @param {*} auditUrl
 * @param {*} context
 * @param {*} site
 * @returns
 */

export async function experimentOpportunitiesAuditRunner(auditUrl, context, staticUrls = null) {
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

  // Handle static URLs
  if (staticUrls && staticUrls.length > 0) {
    log.info(`Processing ${staticUrls.length} static URLs for experimentation opportunities`);

    // Map real RUM data for the specific static URLs, if none, generate mock data
    const realDataOpportunities = experimentationOpportunities.filter(
      (oppty) => staticUrls.includes(oppty.page),
    );
    const urlsWithRealData = realDataOpportunities.map((oppty) => oppty.page);
    const urlsWithoutData = staticUrls.filter((url) => !urlsWithRealData.includes(url));
    const mockOpportunities = generateMockOpportunitiesForMissingUrls(urlsWithoutData);
    const finalExperimentationOpportunities = [...realDataOpportunities, ...mockOpportunities];

    if (realDataOpportunities.length > 0) {
      log.info(`Using real RUM data for ${realDataOpportunities.length} URLs: ${urlsWithRealData.join(', ')}`);
    }
    if (mockOpportunities.length > 0) {
      log.info(`Using mock data for ${mockOpportunities.length} URLs: ${urlsWithoutData.join(', ')}`);
    }

    return {
      auditResult: {
        experimentationOpportunities: finalExperimentationOpportunities,
      },
      fullAuditRef: auditUrl,
    };
  }

  log.info(`Found ${experimentationOpportunities.length} experimentation opportunites for ${auditUrl}`);

  return {
    auditResult: {
      experimentationOpportunities,
    },
    fullAuditRef: auditUrl,
  };
}

export async function runAuditAndScrapeStep(context) {
  const { site, finalUrl } = context;
  const staticUrls = context.auditContext?.additionalAuditData?.staticUrls;
  const result = await experimentOpportunitiesAuditRunner(finalUrl, context, staticUrls);

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

async function toggleImport(site, importType, enable, log) {
  const siteConfig = site.getConfig();
  if (enable) {
    siteConfig.enableImport(importType);
  } else {
    siteConfig.disableImport(importType);
  }
  site.setConfig(Config.toDynamoItem(siteConfig));
  try {
    await site.save();
  } catch (error) {
    log.error(`Error enabling ${importType} for site ${site.getId()}: ${error.message}`);
  }
}

async function getLangFromScrape(s3Client, bucketName, s3BucketPrefix, pathname, log) {
  // remove the trailing slash from the pathname
  const pathnameWithoutTrailingSlash = pathname.replace(/\/$/, '');
  const key = `${s3BucketPrefix}${pathnameWithoutTrailingSlash}/scrape.json`;
  const pageScrapeJson = await getObjectFromKey(s3Client, bucketName, key, log) || {};
  return pageScrapeJson.scrapeResult?.tags?.lang;
}

function isImportEnabled(importType, imports) {
  return imports.find((importConfig) => importConfig.type === importType)?.enabled;
}

export async function organicKeywordsStep(context) {
  const {
    site, log, finalUrl, audit, s3Client,
  } = context;
  log.info(`Organic keywords step started for ${finalUrl}`);
  let organicKeywordsImportEnabled = false;
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const s3BucketPrefix = `scrapes/${site.getId()}`;
  const auditResult = audit.getAuditResult();
  const urls = getHighOrganicLowCtrOpportunityUrls(auditResult.experimentationOpportunities);
  log.info(`Organic keywords step for ${finalUrl}, found ${urls.length} urls`);
  const imports = site.getConfig().getImports();
  if (!isImportEnabled(IMPORT_ORGANIC_KEYWORDS, imports)) {
    log.info(`Enabling ${IMPORT_ORGANIC_KEYWORDS} for site ${site.getId()}`);
    await toggleImport(site, IMPORT_ORGANIC_KEYWORDS, true, log);
    organicKeywordsImportEnabled = true;
  }
  let urlConfigs = await Promise.all(urls.map(async (url) => {
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (error) {
      log.error(`Invalid url ${url}: ${error.message}`);
      return null;
    }
    const lang = await getLangFromScrape(
      s3Client,
      bucketName,
      s3BucketPrefix,
      urlObj.pathname,
      log,
    );
    log.info(`Lang for ${url} is ${lang}`);
    const geo = getCountryCodeFromLang(lang);
    return { url, geo };
  }));
  urlConfigs = urlConfigs.filter(Boolean);
  log.info(`Url configs: ${JSON.stringify(urlConfigs, null, 2)}`);
  if (organicKeywordsImportEnabled) {
    // disable the import after the step is done, if it was enabled in the beginning
    log.info(`Disabling ${IMPORT_ORGANIC_KEYWORDS} for site ${site.getId()}`);
    await toggleImport(site, IMPORT_ORGANIC_KEYWORDS, false, log);
  }
  return {
    type: IMPORT_ORGANIC_KEYWORDS,
    siteId: site.getId(),
    urlConfigs,
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
