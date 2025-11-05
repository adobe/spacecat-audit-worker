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
/* c8 ignore start */
import { getStaticContent } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { Audit, PageIntent as PageIntentModel } from '@adobe/spacecat-shared-data-access';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getTemporalCondition } from '../utils/date-utils.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { prompt } from '../llmo-customer-analysis/utils.js';
import { SYSTEM_PROMPT, createUserPrompt } from './prompts.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const ATHENA_DATABASE = 'rum_metrics';
const ATHENA_TABLE = 'compact_metrics';
const LOG_PREFIX = '[PageIntent]';

export async function getPathsOfLastWeek(context) {
  const {
    env, site, finalUrl, log,
  } = context;

  const { S3_IMPORTER_BUCKET_NAME: importerBucket, PAGE_INTENT_BATCH_SIZE: batchSize = 10 } = env;
  const baseURL = site.getBaseURL();
  const tempLocation = `s3://${importerBucket}/rum-metrics-compact/temp/out/`;
  const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);
  const today = new Date();

  const variables = {
    tableName: `${ATHENA_DATABASE}.${ATHENA_TABLE}`,
    siteId: site.getSiteId(),
    temporalCondition: getTemporalCondition(today, 10),
  };

  log.info(`${LOG_PREFIX} Step 1: Extracting URLs for page intent analysis for site ${baseURL}`);

  const query = await getStaticContent(variables, './src/page-intent/sql/referral-traffic-paths.sql');
  const description = `[Athena Query] Fetching referral traffic data for ${baseURL}`;
  const paths = await athenaClient.query(query, ATHENA_DATABASE, description);
  const pageIntents = await site.getPageIntents();
  const existingUrls = new Set(pageIntents.map((pi) => pi.getUrl()));

  const missingPageIntents = paths
    .map(({ path }) => path)
    .filter((path) => !existingUrls.has(`${baseURL}${path}`));

  log.info(`${LOG_PREFIX} Found ${missingPageIntents.length} pages missing page intent; processing batch of ${batchSize} pages`);

  const urlsToScrape = missingPageIntents.slice(0, batchSize).map((path) => ({
    url: `${baseURL}${path}`,
  }));

  return {
    auditResult: {
      missingPageIntents: missingPageIntents.length,
    },
    fullAuditRef: finalUrl,
    urls: urlsToScrape,
    processingType: 'minimal-content',
    siteId: site.getId(),
  };
}

export async function fetchScrapeContent(url, s3Path, s3Client, bucketName, log) {
  const scrapeData = await getObjectFromKey(
    s3Client,
    bucketName,
    s3Path,
    log,
  );

  if (!scrapeData) {
    log.warn(`${LOG_PREFIX} No scrape data found for ${url}`);
    return null;
  }

  const { minimalContent } = scrapeData.scrapeResult;

  if (!minimalContent) {
    log.warn(`${LOG_PREFIX} No minimal content in scrape data for ${url}`);
    return null;
  }

  return minimalContent;
}

export async function analyzePageIntent(url, textContent, context, log) {
  const userPrompt = createUserPrompt(url, textContent);
  const response = await prompt(SYSTEM_PROMPT, userPrompt, context);
  const analysis = JSON.parse(response.content);

  log.debug(`${LOG_PREFIX} LLM analysis for ${url}: ${analysis.pageIntent}, topic: ${analysis.topic}`);

  // Validate the response - only accept standard intents
  const validIntents = Object.values(PageIntentModel.PAGE_INTENTS);
  if (!analysis.pageIntent || !validIntents.includes(analysis.pageIntent)) {
    log.warn(`${LOG_PREFIX} Invalid or null page intent '${analysis.pageIntent}' returned by LLM for ${url}`);
    return { analysis: null, usage: response.usage };
  }

  return { analysis, usage: response.usage };
}

export async function processPage(url, s3Path, processingContext) {
  const {
    s3Client, bucketName, siteId, PageIntent, context, log,
  } = processingContext;

  try {
    log.debug(`${LOG_PREFIX} Processing ${url} from ${s3Path}`);

    const scrapeContent = await fetchScrapeContent(url, s3Path, s3Client, bucketName, log);

    if (!scrapeContent) {
      return {
        url,
        success: false,
        error: 'No scrape data or minimal content found',
        usage: null,
      };
    }

    const { analysis, usage } = await analyzePageIntent(url, scrapeContent, context, log);

    if (!analysis) {
      return {
        url,
        success: false,
        error: 'Invalid or insufficient data for page intent classification',
        usage,
      };
    }

    await PageIntent.create({
      siteId,
      url,
      pageIntent: analysis.pageIntent,
      topic: analysis.topic,
    });

    log.info(`${LOG_PREFIX} Created: ${url} -> ${analysis.pageIntent}, ${analysis.topic}`);

    return {
      url,
      pageIntent: analysis.pageIntent,
      topic: analysis.topic,
      success: true,
      usage,
    };
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to process ${url}:`, error);
    return {
      url,
      success: false,
      error: error.message,
      usage: null,
    };
  }
}

export async function generatePageIntent(context) {
  const {
    site,
    audit,
    scrapeResultPaths,
    log,
    s3Client,
    env,
    dataAccess,
  } = context;

  const siteId = site.getId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const { PageIntent } = dataAccess;

  log.info(`${LOG_PREFIX} Step 2: Generating page intent for ${scrapeResultPaths.size} pages`);

  const processingContext = {
    s3Client,
    bucketName,
    siteId,
    PageIntent,
    context,
    log,
  };

  // Sequential processing is intentional here to prevent overwhelming the Azure OpenAI API
  const results = [];
  const tokenUsage = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    promptCount: 0,
  };

  for (const [url, s3Path] of scrapeResultPaths.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const result = await processPage(url, s3Path, processingContext);
    results.push(result);

    // Track token usage
    if (result.usage) {
      tokenUsage.totalPromptTokens += result.usage.prompt_tokens || 0;
      tokenUsage.totalCompletionTokens += result.usage.completion_tokens || 0;
      tokenUsage.totalTokens += result.usage.total_tokens || 0;
      tokenUsage.promptCount += 1;
    }
  }

  const successfulPages = results.filter((r) => r.success).length;
  const failedPages = results.filter((r) => !r.success).length;

  log.info(`${LOG_PREFIX} Completed: ${successfulPages} successful, ${failedPages} failed out of ${results.length} total`);
  log.info(`${LOG_PREFIX} Token usage: ${tokenUsage.totalTokens} total tokens across ${tokenUsage.promptCount} prompts (${tokenUsage.totalPromptTokens} prompt + ${tokenUsage.totalCompletionTokens} completion)`);

  return {
    auditResult: {
      successfulPages,
      failedPages,
      tokenUsage,
    },
    fullAuditRef: audit.getFullAuditRef(),
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('extract-urls', getPathsOfLastWeek, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('generate-intent', generatePageIntent)
  .build();
/* c8 ignore end */
