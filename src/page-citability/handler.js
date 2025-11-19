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

import { getStaticContent } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { calculateCitabilityScore } from './analyzer.js';
import {
  extractCustomerDomain,
  resolveConsolidatedBucketName,
  buildDateFilter,
  buildUserAgentFilter,
} from '../utils/cdn-utils.js';
import { joinBaseAndPath } from '../utils/url-utils.js';

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

const createEmptyResult = (baseURL, siteId) => ({
  auditResult: { urlCount: 0 },
  fullAuditRef: baseURL,
  processingType: 'page-citability',
  urls: [{ url: baseURL }],
  siteId,
});

function getDateFilter() {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 7);

  return buildDateFilter(startDate, now);
}

export async function extractUrls(context) {
  const {
    site, finalUrl, log,
  } = context;
  const baseURL = site.getBaseURL();
  const siteId = site.getId();

  log.info(`${LOG_PREFIX} Extracting URLs for ${baseURL}`);

  const s3Config = await getS3Config(site, context);
  const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());

  const variables = {
    databaseName: s3Config.databaseName,
    tableName: s3Config.tableName,
    dateFilter: getDateFilter(),
    userAgentFilter: buildUserAgentFilter(),
  };

  const query = await getStaticContent(variables, './src/page-citability/sql/top-urls.sql');
  const urls = await athenaClient.query(query, s3Config.databaseName, '[Athena] Bot URLs');

  if (urls.length === 0) {
    log.info(`${LOG_PREFIX} No URLs found for site in Athena ${baseURL} with site id ${siteId}`);
    return createEmptyResult(baseURL, siteId);
  }

  // Filter out URLs that already have recent citability scores
  const { PageCitability } = context.dataAccess;
  const existingScores = await PageCitability.allBySiteId(siteId);
  const existingUrls = new Set(existingScores.map((score) => score.getUrl()));
  const urlsToAnalyze = urls.filter(({ url }) => !existingUrls.has(url));

  if (urlsToAnalyze.length === 0) {
    log.info(`${LOG_PREFIX} No missing URLs found for site ${baseURL} with site id ${siteId}`);
    return createEmptyResult(baseURL, siteId);
  }

  log.info(`${LOG_PREFIX} Found ${urlsToAnalyze.length} URLs (${existingScores.length} already analyzed)`);

  const urlsForScraping = urlsToAnalyze.map(({ url }) => ({ url: joinBaseAndPath(baseURL, url) }));

  return {
    auditResult: { urlCount: urlsToAnalyze.length },
    fullAuditRef: finalUrl,
    urls: urlsForScraping,
    processingType: 'page-citability',
    siteId,
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
    /* c8 ignore next 3 */
    if (!scrapeResult?.location) {
      return { url, success: false, error: 'Missing scrape result' };
    }

    const scrapeData = await fetchScrapedData(scrapeResult.location, context);

    /* c8 ignore next 3 */
    if (!scrapeData?.botView || !scrapeData?.humanView) {
      return { url, success: false, error: 'Missing bot or human view data' };
    }

    const { rawPage: botHtml } = scrapeData.botView;
    const { rawPage: humanHtml } = scrapeData.humanView;

    /* c8 ignore next 3 */
    if (!botHtml || !humanHtml) {
      return { url, success: false, error: 'Failed to extract HTML from views' };
    }

    const scores = await calculateCitabilityScore(botHtml, humanHtml);

    // Store in database
    const { PageCitability } = context.dataAccess;
    await PageCitability.create({
      siteId: context.site.getId(),
      url,
      citabilityScore: scores.citabilityScore,
      contentRatio: scores.contentRatio,
      wordDifference: scores.wordDifference,
      botWords: scores.botWords,
      normalWords: scores.normalWords,
    });

    context.log.info(`${LOG_PREFIX} ${url} -> ${scores.citabilityScore}%`);
    return { url, success: true, ...scores };
    /* c8 ignore next 3 */
  } catch (error) {
    return { url, success: false, error: error.message };
  }
}

export async function analyzeCitability(context) {
  const { audit, scrapeResultPaths, log } = context;

  log.info(`${LOG_PREFIX} Analyzing ${scrapeResultPaths.size} scrapes`);

  const results = [];
  const entries = Array.from(scrapeResultPaths.entries());
  const BATCH_SIZE = 10;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(
      batch.map(([url, s3Path]) => processUrl(url, { location: s3Path }, context)),
    );
    results.push(...batchResults);
    log.info(`${LOG_PREFIX} Processed batch ${i / BATCH_SIZE + 1}/${Math.ceil(entries.length / BATCH_SIZE)}`);
  }

  const successful = results.filter((r) => r.success).length;
  log.info(`${LOG_PREFIX} Completed: ${successful}/${results.length} successful`);

  return {
    auditResult: { successfulPages: successful, failedPages: results.length - successful },
    fullAuditRef: audit.getFullAuditRef(),
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('extract-urls', extractUrls, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('analyze-citability', analyzeCitability)
  .build();
