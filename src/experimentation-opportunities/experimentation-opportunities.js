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
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import AWSXray from 'aws-xray-sdk';
import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMDomainkey } from '../support/utils.js';
import { wwwUrlResolver } from '../common/audit.js';

const DAYS = 30;
export const MAX_OPPORTUNITIES = 10;
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
  const { log } = context;
  const screenshotPath = `${getS3PathPrefix(url, site)}/${fileName}`;
  try {
    const s3Client = AWSXray.captureAWSv3Client(new S3Client({ region: process.env.AWS_REGION }));
    log.info(`Generating presigned URL for ${screenshotPath}`);
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: screenshotPath,
    });
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
    });
    return signedUrl;
  } catch (error) {
    log.error(`Error generating presigned URL for ${screenshotPath}:`, error);
    return '';
  }
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
  log.info(`Triggering scrape for [${JSON.stringify(topHighOrganicUrls, null, 2)}]`);
  await sqs.sendMessage(process.env.SCRAPING_JOBS_QUEUE_URL, {
    processingType: 'default',
    jobId: site.getId(),
    urls: topHighOrganicUrls,
  });
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

async function createOrUpdateOpportunityEntity(opportunity, context, existingOpportunities) {
  const { log, dataAccess } = context;
  const { Opportunity } = dataAccess;
  const existingOpportunity = existingOpportunities.find(
    (oppty) => (oppty.getType() === opportunity.type) && oppty.getData()
    && (oppty.getData().page === opportunity.data.page),
  );
  if (existingOpportunity) {
    if (existingOpportunity.getStatus() === 'NEW') {
      // remove and create a new opportunity entity with new data
      log.info(`[${opportunity.type}] Opportunity entity with status: NEW for ${opportunity.data.page} exists, so removing it and creating a new opportunity entity`);
      await existingOpportunity.remove();
    } else {
      log.info(`[${opportunity.type}] Opportunity entity already exists with status: ${existingOpportunity.getStatus()} for ${opportunity.data.page}, so skipping`);
      return false;
    }
  }
  await Opportunity.create(opportunity);
  return true;
}

function convertToOpportunityEntity(oppty, auditData) {
  return {
    siteId: auditData.siteId,
    auditId: auditData.id,
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/Doc.aspx?sourcedoc=%7B19613D9B-93D4-4112-B7C8-DBE0D9DCC55B%7D&file=Experience_Success_Studio_High_Organic_Traffic_Low_CTR_Runbook.docx&action=default&mobileredirect=true',
    type: 'high-organic-low-ctr',
    origin: 'AUTOMATION',
    title: 'page with high organic traffic but low click through rate detected',
    description: 'Adjusting the wording, images and/or layout on the page to resonate more with a specific audience should increase the overall engagement on the page and ultimately bump conversion.',
    status: 'NEW',
    guidance: {
      recommendations: oppty.recommendations,
    },
    tags: ['Engagement'],
    data: {
      page: oppty.page,
      pageViews: oppty.pageViews,
      samples: oppty.samples,
      screenshot: oppty.screenshot,
      trackedKPISiteAverage: oppty.trackedKPISiteAverage,
      trackedPageKPIName: oppty.trackedPageKPIName,
      trackedPageKPIValue: oppty.trackedPageKPIValue,
      opportunityImpact: oppty.opportunityImpact,
      metrics: oppty.metrics,
    },
  };
}

export async function postProcessor(auditUrl, auditData, context) {
  const { log } = context;
  const { dataAccess } = context;
  let updatedEntities = 0;
  log.info(`Experimentation Opportunities post processing started for ${auditUrl} from audit ${auditData.id}`);
  const existingOpportunities = await dataAccess.Opportunity.allBySiteId(auditData.siteId);

  // Get opportunities with recommendations
  const opportunities = auditData.auditResult.experimentationOpportunities
    .filter((oppty) => oppty.type === 'high-organic-low-ctr' && oppty.recommendations);
  // Process all opportunities in parallel and wait for completion
  await Promise.all(opportunities.map(async (oppty) => {
    const opportunity = convertToOpportunityEntity(oppty, auditData);
    try {
      const status = await createOrUpdateOpportunityEntity(
        opportunity,
        context,
        existingOpportunities,
      );
      if (status) {
        updatedEntities += 1;
      }
    } catch (error) {
      log.error(`Error creating/updating opportunity entity for ${opportunity.data.page}: ${error.message}`);
    }
    return opportunity;
  }));

  log.info(`Created/updated ${updatedEntities} opportunity entities for ${auditUrl}`);
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
  await processRageClickOpportunities(experimentationOpportunities);
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
  .withPostProcessors([postProcessor])
  .withMessageSender(() => true)
  .build();
