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
import { isNonEmptyArray, getStaticContent, resolveCanonicalUrl } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { Audit, PageIntent as PageIntentModel } from '@adobe/spacecat-shared-data-access';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import URI from 'urijs';
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
const NOTHING_TO_PROCESS = 'NOTHING TO PROCESS';

const NOTHING_TO_PROCESS_RESULT = (baseURL, siteId) => ({
  auditResult: {
    missingPageIntents: 0,
  },
  fullAuditRef: NOTHING_TO_PROCESS,
  urls: [{ url: baseURL }],
  processingType: 'minimal-content',
  siteId,
});

/**
 * Resolves the effective base URL for the page-intent audit.
 * If overrideBaseURL is not already set, uses resolveCanonicalUrl to follow redirects
 * and persists the result to the site's fetch config if www subdomain changed.
 * @param {Object} site - The site object
 * @param {Object} log - Logger instance
 * @returns {Promise<string>} The resolved base URL
 */
async function resolveEffectiveBaseUrl(site, log) {
  const siteId = site.getId();
  const siteConfig = site.getConfig();

  // If overrideBaseURL is already set, use it
  const existingOverride = siteConfig?.getFetchConfig()?.overrideBaseURL;
  if (existingOverride) {
    return existingOverride;
  }

  const baseURL = site.getBaseURL();

  // Resolve canonical URL for the site from the base URL
  const resolvedUrl = await resolveCanonicalUrl(baseURL);
  if (resolvedUrl === null) {
    return baseURL;
  }

  const baseUri = new URI(baseURL);
  const resolvedUri = new URI(resolvedUrl);

  const baseSubdomain = baseUri.subdomain();
  const resolvedSubdomain = resolvedUri.subdomain();

  // Only set override if www subdomain changed
  const wwwChanged = (baseSubdomain === 'www' && resolvedSubdomain !== 'www')
                  || (baseSubdomain !== 'www' && resolvedSubdomain === 'www');

  if (wwwChanged) {
    // Preserve the base URL's pathname in the override
    const basePathName = baseUri.pathname();
    const overrideBaseURL = basePathName !== '/'
      ? `${resolvedUri.origin()}${basePathName}`
      : resolvedUri.origin();
    log.info(`${LOG_PREFIX} Setting overrideBaseURL for site ${siteId}: ${baseURL} -> ${overrideBaseURL}`);
    siteConfig.updateFetchConfig({ overrideBaseURL });
    site.setConfig(Config.toDynamoItem(siteConfig));
    await site.save();
    return overrideBaseURL;
  }

  return baseURL;
}

export async function getPathsOfLastWeek(context) {
  const {
    env, site, finalUrl, log,
  } = context;

  const { S3_IMPORTER_BUCKET_NAME: importerBucket, PAGE_INTENT_BATCH_SIZE: batchSize = 10 } = env;
  const baseURL = await resolveEffectiveBaseUrl(site, log);
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

  if (!isNonEmptyArray(paths)) {
    log.info(`${LOG_PREFIX} No referral traffic paths found for site ${baseURL}`);
    return NOTHING_TO_PROCESS_RESULT(baseURL, site.getId());
  }

  const pageIntents = await site.getPageIntents();
  const existingPaths = new Set(pageIntents.map((pi) => {
    try {
      return new URL(pi.getUrl()).pathname;
    } catch {
      return pi.getUrl();
    }
  }));

  const missingPageIntents = paths
    .map(({ path }) => path)
    .filter((path) => !existingPaths.has(path));

  const numOfMissing = missingPageIntents.length;

  if (numOfMissing === 0) {
    log.info(`${LOG_PREFIX} No missing page intents for site ${baseURL}`);
    return NOTHING_TO_PROCESS_RESULT(baseURL, site.getId());
  }

  log.info(`${LOG_PREFIX} Found ${numOfMissing} pages missing page intent; processing batch of ${Math.min(batchSize, numOfMissing)} pages`);

  const urlsToScrape = missingPageIntents.slice(0, batchSize).map((path) => ({
    url: `${baseURL}${path}`,
  }));

  return {
    auditResult: {
      missingPageIntents: numOfMissing,
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

export function stripMarkdownCodeBlocks(content) {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
  cleaned = cleaned.replace(/\n?```\s*$/, '');
  return cleaned.trim();
}

export async function analyzePageIntent(url, textContent, context, log) {
  const userPrompt = createUserPrompt(url, textContent);
  const response = await prompt(SYSTEM_PROMPT, userPrompt, context);
  const cleanedContent = stripMarkdownCodeBlocks(response.content);
  const analysis = JSON.parse(cleanedContent);

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
      topic: analysis.topic || '',
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
  const fullAuditRef = audit.getFullAuditRef();

  if (fullAuditRef === NOTHING_TO_PROCESS) {
    return {
      auditResult: {
        result: NOTHING_TO_PROCESS,
      },
      fullAuditRef: audit.getFullAuditRef(),
    };
  }

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

    /* c8 ignore start */
    if (result.usage) {
      tokenUsage.totalPromptTokens += result.usage.prompt_tokens || 0;
      tokenUsage.totalCompletionTokens += result.usage.completion_tokens || 0;
      tokenUsage.totalTokens += result.usage.total_tokens || 0;
      tokenUsage.promptCount += 1;
    }
    /* c8 ignore end */
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
