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
import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMDomainkey } from '../support/utils.js';
import { wwwUrlResolver } from '../common/audit.js';

const DAYS = 30;
const MAX_OPPORTUNITIES = 10;
/**
 * Even if the pages with high views have low CTR difference (from site wide CTR), those will be
 * considered as top opportunities, but the chance of improvement would be very less. so we are
 * adding a margin to the CTR difference to consider only those opportunities that have
 * significant difference between the page CTR and site wide CTR.
 */
const CTR_THRESHOLD_MARGIN = 0.04;
const VENDOR_METRICS_PAGEVIEW_THRESHOLD = 10000;

const OPPTY_QUERIES = [
  'rageclick',
  'high-inorganic-high-bounce-rate',
  'high-organic-low-ctr',
];
/* c8 ignore start */

function getS3PathPrefix(url, site) {
  const urlObj = new URL(url);
  let { pathname } = urlObj;
  pathname = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `scrapes/${site.getId()}${pathname}`;
}

async function invokeLambdaFunction(payload, context) {
  const { log } = context;
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
  log.info('Lambda Response: ', JSON.stringify(response, null, 2));
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
        screenshotPaths: [`${getS3PathPrefix(oppty.page, site)}screenshot-desktop.png`],
        scrapeJsonPath: `${getS3PathPrefix(oppty.page, site)}scrape.json`,
        vendorDetails: getMetricsByVendor(oppty.metrics),
        additionalContext: '',
      },
    },
  };
  log.info('Lambda Payload: ', JSON.stringify(lambdaPayload, null, 2));
  let lambdaResult;
  try {
    // eslint-disable-next-line no-await-in-loop
    const lambdaResponse = await invokeLambdaFunction(lambdaPayload, context);
    log.info('Lambda Response: ', JSON.stringify(lambdaResponse, null, 2));
    const lambdaResponseBody = typeof (lambdaResponse.body) === 'string' ? JSON.parse(lambdaResponse.body) : lambdaResponse.body;
    lambdaResult = lambdaResponseBody.result;
  } catch (error) {
    log.error('Error invoking lambda function: ', error);
  }
  if (!lambdaResult) {
    log.error(`Error obtaining from LLM: No result from lambda function for ${oppty.page}`);
  } else {
    const recommendations = oppty.recommendations || [];
    for (const guidance of lambdaResult) {
      recommendations.push({
        type: 'guidance',
        insight: guidance.insight,
        recommendation: guidance.recommendation,
        rationale: guidance.rationale,
      });
    }
    // eslint-disable-next-line no-param-reassign
    oppty.recommendations = recommendations;
  }
}

async function processHighOrganicLowCtrOpportunities(opportunites, context, site) {
  const { sqs, log } = context;
  const highOrganicLowCtrOpportunities = opportunites.filter((oppty) => oppty.type === 'high-organic-low-ctr')
    .map((oppty) => {
      const { pageViews, trackedPageKPIValue, trackedKPISiteAverage } = oppty;
      const potentialClicks = pageViews
          * (trackedKPISiteAverage - CTR_THRESHOLD_MARGIN - trackedPageKPIValue)
          * 100;
      return {
        ...oppty,
        potentialClicks,
      };
    });
  log.info(`Found ${highOrganicLowCtrOpportunities.length} high organic low CTR opportunities`);
  highOrganicLowCtrOpportunities.sort((a, b) => b.potentialClicks - a.potentialClicks);
  const topHighOrganicLowCtrOpportunities = highOrganicLowCtrOpportunities.slice(
    0,
    MAX_OPPORTUNITIES,
  );
  log.info(`highest: ${highOrganicLowCtrOpportunities[0].potentialClicks}.. Lowest: ${highOrganicLowCtrOpportunities[highOrganicLowCtrOpportunities.length - 1].potentialClicks}`);
  const topHighOrganicUrls = topHighOrganicLowCtrOpportunities.map((oppty) => ({
    url: oppty.page,
  }));
  log.info(`Triggering scrape for [${JSON.stringify(topHighOrganicUrls, null, 2)}]`);
  await sqs.sendMessage(process.env.SCRAPING_JOBS_QUEUE_URL, {
    processingType: 'default',
    jobId: site.getId(),
    urls: topHighOrganicUrls,
  });
  log.info('Scrape triggered');
  // Temp Solution: wait couple of minute for the scrape to finish
  // TODO: replace this with a SQS message to run another handler to process the scraped content,
  // to eliminate duplicate lambda run time
  // await new Promise((resolve) => {
  //   setTimeout(resolve, 120000);
  // });
  log.info('Scrape finished, processing opportunities');
  // generate the guidance for the top opportunities
  for (const oppty of topHighOrganicLowCtrOpportunities) {
    // eslint-disable-next-line no-await-in-loop
    await updateRecommendations(oppty, context, site);
  }
}
/* c8 ignore stop */

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
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);
  const options = {
    domain: auditUrl,
    domainkey,
    interval: DAYS,
    granularity: 'hourly',
  };

  const queryResults = await rumAPIClient.queryMulti(OPPTY_QUERIES, options);
  const experimentationOpportunities = Object.values(queryResults).flatMap((oppty) => oppty);
  await processHighOrganicLowCtrOpportunities(experimentationOpportunities, context, site);
  log.info(`Found ${experimentationOpportunities.length} experimentation opportunites for ${auditUrl}`);

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
  .build();
