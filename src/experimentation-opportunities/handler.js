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
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AuditBuilder } from '../common/audit-builder.js';
import s3Client from '../support/s3-client.js';
import { wwwUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const DAYS = 7;
export const MAX_OPPORTUNITIES = 10;
/**
 * Even if the pages with high views have low CTR difference (from site wide CTR), those will be
 * considered as top opportunities, but the chance of improvement would be very less. so we are
 * adding a margin to the CTR difference to consider only those opportunities that have
 * significant difference between the page CTR and site wide CTR.
 */
const CTR_THRESHOLD_MARGIN = 0.04;
const VENDOR_METRICS_PAGEVIEW_THRESHOLD = 10000;

const EXPIRY_IN_DAYS = 7 * 24 * 60 * 60;

const OPPTY_QUERIES = [
  'rageclick',
  'high-inorganic-high-bounce-rate',
  'high-organic-low-ctr',
];

function getS3PathPrefix(url, site) {
  const urlObj = new URL(url);
  let { pathname } = urlObj;
  pathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return `scrapes/${site.getId()}${pathname}`;
}

async function invokeLambdaFunction(payload) {
  const lambdaClient = new LambdaClient({
    region: process.env.AWS_REGION,
    credentials: defaultProvider(),
  });
  const invokeParams = {
    FunctionName: process.env.SPACECAT_STATISTICS_LAMBDA_ARN,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload),
  };
  const response = await lambdaClient.send(new InvokeCommand(invokeParams));
  return JSON.parse(new TextDecoder().decode(response.Payload));
}

function getMetricsByVendor(metrics) {
  const metricsByVendor = metrics.reduce((acc, metric) => {
    const { vendor } = metric;
    if (!acc[vendor]) {
      acc[vendor] = {};
    }
    if (metric.type === 'traffic') {
      acc[vendor].pageviews = metric.value?.total;
    } else if (metric.type === 'ctr') {
      acc[vendor].ctr = metric.value?.page;
    }
    return acc;
  }, {});
  const header = 'vendor, pageviews, ctr';
  const metricsByVendorString = [
    header, // Add header row at the top
    ...Object.entries(metricsByVendor)
      .filter(
        ([vendor, { pageviews }]) => vendor !== '*' && pageviews > VENDOR_METRICS_PAGEVIEW_THRESHOLD,
      ) // Filter by pageviews > threshold
      .map(([vendor, { pageviews, ctr }]) => `${vendor}, ${pageviews}, ${ctr}`),
  ].join('\n');
  return metricsByVendorString;
}

export function getRecommendations(lambdaResult) {
  const recommendations = [];
  if (!lambdaResult) {
    return recommendations;
  }
  for (const [, guidance] of Object.entries(lambdaResult)) {
    recommendations.push({
      type: 'guidance',
      insight: guidance.insight,
      recommendation: guidance.recommendation,
      rationale: guidance.rationale,
    });
  }
  return recommendations;
}

/* c8 ignore start */
async function getPresignedUrl(fileName, context, url, site) {
  const { log, s3Client: s3ClientObj } = context;
  const screenshotPath = `${getS3PathPrefix(url, site)}/${fileName}`;
  try {
    log.info(`Generating presigned URL for ${screenshotPath}`);
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: screenshotPath,
    });
    const signedUrl = await getSignedUrl(s3ClientObj, command, {
      expiresIn: EXPIRY_IN_DAYS,
    });
    return signedUrl;
  } catch (error) {
    log.error(`Error generating presigned URL for ${screenshotPath}:`, error);
    return '';
  }
}

async function getUnscrapedUrls(context, site, urls) {
  const { log, s3Client: s3ClientObj } = context;
  const unscrapedUrls = [];
  for (const url of urls) {
    const screenshotPath = `${getS3PathPrefix(
      url.url,
      site,
    )}/screenshot-desktop.png`;
    const command = new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: screenshotPath,
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      await s3ClientObj.send(command);
      log.info(`URL ${url.url} is already scraped`);
    } catch (error) {
      log.info(`URL ${url.url} is not scraped yet`, error);
      unscrapedUrls.push(url);
    }
  }
  return unscrapedUrls;
}
/* c8 ignore stop */

async function updateRecommendations(oppty, context, site) {
  const { log } = context;
  log.info(`Generating guidance for ${oppty.page}`);
  const lambdaPayload = {
    type: 'llm-insights',
    payload: {
      rumData: {
        url: oppty.page,
        s3BucketName: process.env.S3_SCRAPER_BUCKET_NAME,
        promptPath: 'prompts/improving-ctr-guidance-vendor-v2.prompt',
        screenshotPaths: [`${getS3PathPrefix(oppty.page, site)}/screenshot-desktop.png`],
        scrapeJsonPath: `${getS3PathPrefix(oppty.page, site)}/scrape.json`,
        vendorDetails: getMetricsByVendor(oppty.metrics),
        additionalContext: '',
      },
    },
  };

  let lambdaResult;
  try {
    // eslint-disable-next-line no-await-in-loop
    log.info('Invoking lambda function with payload: ', JSON.stringify(lambdaPayload, null, 2));
    const lambdaResponse = await invokeLambdaFunction(lambdaPayload);
    log.info('Lambda Response: ', JSON.stringify(lambdaResponse, null, 2));
    const lambdaResponseBody = typeof lambdaResponse.body === 'string'
      ? JSON.parse(lambdaResponse.body)
      : lambdaResponse.body;
    lambdaResult = lambdaResponseBody ? lambdaResponseBody.result : null;
    if (!lambdaResult || lambdaResult.error) {
      log.error('Error in LLM insights. LLM Response body:', lambdaResponseBody);
      return;
    }
  } catch (error) {
    log.error('Error invoking lambda function: ', error);
    return;
  }
  // eslint-disable-next-line no-param-reassign
  oppty.recommendations = getRecommendations(lambdaResult);
  // eslint-disable-next-line no-param-reassign
  oppty.screenshot = await getPresignedUrl('screenshot-desktop.png', context, oppty.page, site);
  // eslint-disable-next-line no-param-reassign
  oppty.thumbnail = await getPresignedUrl('screenshot-desktop-thumbnail.png', context, oppty.page, site);
}

async function processHighOrganicLowCtrOpportunities(opportunites, context, site) {
  const { sqs, log } = context;
  // add s3 client to the context
  const wrappedFunction = s3Client(() => Promise.resolve());
  await wrappedFunction({}, context);
  log.info(`s3 client added to the context: ${context.s3Client}`);

  const highOrganicLowCtrOpportunities = opportunites.filter((oppty) => oppty.type === 'high-organic-low-ctr')
    .map((oppty) => {
      const { pageViews, trackedPageKPIValue, trackedKPISiteAverage } = oppty;
      const opportunityImpact = Math.floor(pageViews
          * (trackedKPISiteAverage - CTR_THRESHOLD_MARGIN - trackedPageKPIValue));
      return {
        ...oppty,
        opportunityImpact,
      };
    });
  log.info(`Found ${highOrganicLowCtrOpportunities.length} high organic low CTR opportunities`);
  highOrganicLowCtrOpportunities.sort((a, b) => b.opportunityImpact - a.opportunityImpact);
  const topHighOrganicLowCtrOpportunities = highOrganicLowCtrOpportunities.slice(
    0,
    MAX_OPPORTUNITIES,
  );
  const topHighOrganicUrls = topHighOrganicLowCtrOpportunities.map((oppty) => ({
    url: oppty.page,
  }));
  // create urls which are not scraped early
  const unscrapedUrls = await getUnscrapedUrls(context, site, topHighOrganicUrls);
  log.info(`Triggering scrape for [${JSON.stringify(unscrapedUrls, null, 2)}]`);
  if (unscrapedUrls.length > 0) {
    await sqs.sendMessage(process.env.SCRAPING_JOBS_QUEUE_URL, {
      processingType: 'default',
      jobId: site.getId(),
      urls: unscrapedUrls,
    });
  }
  // wait for the scrape to complete
  // TODO: replace this with a SQS message to run another handler to process the scraped content,
  // to eliminate duplicate lambda run time

  // generate the guidance for the top opportunities in parallel
  const promises = topHighOrganicLowCtrOpportunities.map(
    (oppty) => updateRecommendations(oppty, context, site),
  );
  await Promise.all(promises);
  for (const oppty of topHighOrganicLowCtrOpportunities) {
    // eslint-disable-next-line no-await-in-loop
    // await updateRecommendations(oppty, context, site);
    // update the oppty in the opporrtunities list
    const index = opportunites.findIndex(
      (opp) => opp.page === oppty.page && opp.type === oppty.type,
    );
    if (index !== -1) {
      // eslint-disable-next-line no-param-reassign
      opportunites[index] = oppty;
    }
  }
}

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

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const opportunity = auditData.auditResult.experimentationOpportunities
    .filter((oppty) => oppty.type === 'high-organic-low-ctr' && oppty.recommendations);
  await Promise.all(opportunity.map(async (oppty) => convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    'high-organic-low-ctr',
    oppty,
  )));
}

/**
 * Audit handler container for all the opportunities
 * @param {*} auditUrl
 * @param {*} context
 * @param {*} site
 * @returns
 */

export async function handler(auditUrl, context, site) {
  const { log } = context;

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const options = {
    domain: auditUrl,
    interval: DAYS,
    granularity: 'hourly',
  };
  const queryResults = await rumAPIClient.queryMulti(OPPTY_QUERIES, options);
  const experimentationOpportunities = Object.values(queryResults).flatMap((oppty) => oppty);
  await processHighOrganicLowCtrOpportunities(experimentationOpportunities, context, site);
  await processRageClickOpportunities(experimentationOpportunities);
  log.info(`Found ${experimentationOpportunities.length} experimentation opportunities for ${auditUrl}`);

  return {
    auditResult: {
      experimentationOpportunities,
    },
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(handler)
  .withUrlResolver(wwwUrlResolver)
  .withPostProcessors([opportunityAndSuggestions])
  .withMessageSender(() => true)
  .build();
