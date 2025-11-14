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

// import { getStaticContent } from '@adobe/spacecat-shared-utils';
// import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { calculateCitabilityScore } from './analyzer.js';
import {
  extractCustomerDomain,
  resolveConsolidatedBucketName,
} from '../utils/cdn-utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const LOG_PREFIX = '[PageCitability]';

export async function getS3Config(site, context) {
  const customerDomain = extractCustomerDomain(site);
  const domainParts = customerDomain.split(/[._]/);
  /* c8 ignore next */
  const customerName = domainParts[0] === 'www' && domainParts.length > 1 ? domainParts[1] : domainParts[0];
  const bucket = resolveConsolidatedBucketName(context);

  return {
    bucket,
    customerName,
    customerDomain,
    databaseName: `cdn_logs_${customerDomain}`,
    tableName: `aggregated_logs_${customerDomain}_consolidated`,
    getAthenaTempLocation: () => `s3://${bucket}/temp/athena-results/`,
  };
}

export async function extractUrls(context) {
  const {
    site, finalUrl, log,
  } = context;

  log.info(`${LOG_PREFIX} Extracting URLs for ${site.getBaseURL()}`);

  const s3Config = await getS3Config(site, context);
  if (!s3Config?.bucket) {
    return {
      auditResult: { urlCount: 0 }, fullAuditRef: finalUrl, urls: [], processingType: 'page-citability', siteId: site.getId(),
    };
  }

  // const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());

  // const now = new Date();
  // const startDate = new Date(now);
  // startDate.setDate(startDate.getDate() - 7);

  // const formatDate = (date) => ({
  //   year: date.getUTCFullYear().toString(),
  //   month: (date.getUTCMonth() + 1).toString().padStart(2, '0'),
  //   day: date.getUTCDate().toString().padStart(2, '0'),
  // });

  // const start = formatDate(startDate);
  // const end = formatDate(now);
  // const dateFilter = `(year = '${start.year}' AND month = '${start.month}'
  // AND day >= '${start.day}') OR (year = '${end.year}' AND month = '${end.month}'
  //  AND day <= '${end.day}')`;

  // const variables = {
  //   databaseName: s3Config.databaseName,
  //   tableName: s3Config.tableName,
  //   dateFilter,
  // };

  // const query = await getStaticContent(variables, './src/page-citability/sql/top-urls.sql');
  // const urls = await athenaClient.query(query, s3Config.databaseName, `[Athena] Bot URLs`);

  // Filter out URLs that already have recent citability scores
  // const { PageReadability } = dataAccess;
  // const existingScores = await PageReadability.allBySiteId(site.getId());
  // const existingUrls = new Set(existingScores.map(score => score.getUrl()));
  // const missingUrls = urls.filter(({ url }) => !existingUrls.has(url));

  // const urlsToAnalyze = missingUrls;
  const baseURL = site.getBaseURL();
  const urls = [
    '/uk/the-core/heating-stability-of-whey/',
    '/es/products/pura-proteina-de-suero-aislada-al-90/bpb-wpi9-0000',
    '/uk/food-safety',
    '/uk/the-core/citrulline-malate-smart-supplementation/',
    '/uk/products/colostrum/bpb-colo-0000',
    '/uk/products/creatine-monohydrate-tablets-1000mg/bpb-cmon-tabs',
    '/uk/products/co-enzyme-q10-coq10/bpb-coq-0000',
    '/uk/products/sports-multi-am-pm/bpps-smul',
    '/uk/products/cream-of-rice/bpb-cori',
    '/uk/the-core/',
  ];
  // log.info(`${LOG_PREFIX} Found ${urlsToAnalyze.length}
  // URLs (${existingScores.length} already analyzed)`);

  const urlsForScraping = urls.map((url) => ({
    url: `${baseURL}${url}`,
  }));

  return {
    auditResult: { urlCount: urls.length },
    fullAuditRef: finalUrl,
    urls: urlsForScraping,
    processingType: 'page-citability',
    siteId: site.getId(),
  };
}

async function fetchScrapedData(s3Path, context) {
  const scrapeData = await getObjectFromKey(
    context.s3Client,
    context.env.S3_SCRAPER_BUCKET_NAME,
    s3Path,
    context.log,
  );
  return scrapeData || null;
}

async function processUrl(url, scrapeResult, context) {
  try {
    if (!scrapeResult?.location) {
      return { url, success: false, error: 'Missing scrape result' };
    }

    const scrapeData = await fetchScrapedData(scrapeResult.location, context);

    if (!scrapeData?.botView || !scrapeData?.humanView) {
      return { url, success: false, error: 'Missing bot or human view data' };
    }

    const botHtml = scrapeData.botView.rawPage;
    const humanHtml = scrapeData.humanView.rawPage;

    if (!botHtml || !humanHtml) {
      return { url, success: false, error: 'Failed to extract HTML from views' };
    }

    const scores = await calculateCitabilityScore(botHtml, humanHtml);

    // Store in database
    // const { PageReadability } = context.dataAccess;
    // await PageReadability.create({
    //   siteId: context.site.getId(),
    //   url,
    //   citabilityScore: scores.citabilityScore,
    //   contentRatio: scores.contentRatio,
    //   wordDifference: scores.wordDifference,
    //   botWords: scores.botWords,
    //   normalWords: scores.normalWords,
    // });

    context.log.info(`${LOG_PREFIX} ${url} -> ${scores.citabilityScore}%`);
    return { url, success: true, ...scores };
  } catch (error) {
    return { url, success: false, error: error.message };
  }
}

export async function analyzeCitability(context) {
  const { audit, scrapeResultPaths, log } = context;

  log.info(`${LOG_PREFIX} Analyzing ${scrapeResultPaths.size} scrapes`);

  log.info(`${LOG_PREFIX} Scrape result paths: ${JSON.stringify(scrapeResultPaths, null, 2)}`);

  const results = [];
  for (const [url, s3Path] of scrapeResultPaths.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const result = await processUrl(url, { location: s3Path }, context);
    results.push(result);
  }

  const successful = results.filter((r) => r.success).length;
  log.info(`${LOG_PREFIX} Completed: ${successful}/${results.length} successful`);

  return {
    auditResult: { successfulPages: successful, failedPages: results.length - successful, results },
    fullAuditRef: audit.getFullAuditRef(),
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('extract-urls', extractUrls, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('analyze-citability', analyzeCitability)
  .build();
