/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { noContent, ok } from '@adobe/spacecat-shared-http-utils';
import DrsClient, { SCRAPE_DATASET_IDS } from '@adobe/spacecat-shared-drs-client';
import { OFFSITE_DOMAINS, REDDIT_COMMENTS_DAYS_BACK } from '../offsite-brand-presence/constants.js';

const LOG_PREFIX = '[OffsiteCompetitorAnalysis:Guidance]';

const URL_CONFIG = Object.freeze({
  wikipedia: OFFSITE_DOMAINS['wikipedia.org'],
  youtube: OFFSITE_DOMAINS['youtube.com'],
  reddit: OFFSITE_DOMAINS['reddit.com'],
});

/**
 * Extracts URLs from competitors in the Mystique response, grouped by platform.
 *
 * @param {Array} competitors - The competitors array from competitorProfile
 * @returns {{ wikipedia: string[], youtube: string[], reddit: string[] }}
 */
function extractUrlsByPlatform(competitors) {
  const urls = { wikipedia: [], youtube: [], reddit: [] };

  for (const competitor of competitors) {
    if (competitor?.wikipediaUrl) {
      urls.wikipedia.push(competitor.wikipediaUrl);
    }
    for (const url of competitor?.youtubeUrls || []) {
      if (url) urls.youtube.push(url);
    }
    for (const url of competitor?.redditUrls || []) {
      if (url) urls.reddit.push(url);
    }
  }

  return urls;
}

/**
 * Adds URLs to the URL store via AuditUrl.create.
 *
 * @param {string} siteId - The site ID
 * @param {object} urlsByPlatform - URLs grouped by platform
 * @param {object} dataAccess - Data access layer
 * @param {object} log - Logger
 * @returns {Promise<object>} Successfully stored URLs grouped by platform
 */
async function addUrlsToUrlStore(siteId, urlsByPlatform, dataAccess, log) {
  const { AuditUrl } = dataAccess;
  const stored = { wikipedia: [], youtube: [], reddit: [] };

  const entries = [];
  for (const [platform, urls] of Object.entries(urlsByPlatform)) {
    const { auditType } = URL_CONFIG[platform];
    for (const url of urls) {
      entries.push({ platform, url, auditType });
    }
  }

  log.info(`${LOG_PREFIX} Adding ${entries.length} URLs to URL store`);

  const results = await Promise.all(
    entries.map(async ({ platform, url, auditType }) => {
      try {
        await AuditUrl.create({
          siteId,
          url,
          byCustomer: false,
          audits: [auditType],
          createdBy: 'system',
          updatedBy: 'system',
        });
        return { platform, url };
      } catch (error) {
        log.warn(`${LOG_PREFIX} Failed to add URL to store: ${url} - ${error.message}`);
        return null;
      }
    }),
  );

  for (const result of results) {
    if (result) {
      stored[result.platform].push(result.url);
    }
  }

  const totalStored = Object.values(stored).reduce((sum, urls) => sum + urls.length, 0);
  const totalFailed = entries.length - totalStored;
  log.info(`${LOG_PREFIX} URL store complete: ${totalStored} created, ${totalFailed} failed`);

  return stored;
}

/**
 * Triggers DRS scrape jobs for the stored URLs.
 *
 * @param {object} storedUrls - Successfully stored URLs grouped by platform
 * @param {string} siteId - The site ID
 * @param {object} context - Context with env and log
 * @returns {Promise<Array>} Results of DRS job submissions
 */
async function triggerDrsScraping(storedUrls, siteId, context) {
  const { log } = context;
  const drsClient = DrsClient.createFrom(context);

  if (!drsClient.isConfigured()) {
    log.error(`${LOG_PREFIX} DRS not configured, skipping scraping`);
    return [];
  }

  const jobs = [];
  for (const [platform, urls] of Object.entries(storedUrls)) {
    if (urls.length === 0) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const { datasetIds } = URL_CONFIG[platform];
    for (const datasetId of datasetIds) {
      const params = { datasetId, siteId, urls };
      if (datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS) {
        params.daysBack = REDDIT_COMMENTS_DAYS_BACK;
      }
      jobs.push({ platform, datasetId, params });
    }
  }

  log.info(`${LOG_PREFIX} Submitting ${jobs.length} DRS scrape jobs`);

  return Promise.all(
    jobs.map(async ({ platform, datasetId, params }) => {
      try {
        const result = await drsClient.submitScrapeJob(params);
        log.info(`${LOG_PREFIX} DRS job created for ${platform}/${datasetId}: jobId=${result.job_id}`);
        return {
          platform, datasetId, status: 'success', jobId: result.job_id,
        };
      } catch (err) {
        log.error(`${LOG_PREFIX} DRS job failed for ${platform}/${datasetId}: ${err.message}`);
        return {
          platform, datasetId, status: 'error', error: err.message,
        };
      }
    }),
  );
}

/**
 * Handles the Mystique response for offsite competitor analysis.
 * Extracts competitor URLs (Wikipedia, YouTube, Reddit) and sends them
 * to the URL store and DRS for scraping.
 *
 * @param {object} message - SQS message from Mystique
 * @param {object} context - Context with dataAccess, log, etc.
 * @returns {Promise<object>} HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { siteId, data } = message;

  log.info(`${LOG_PREFIX} Received guidance for siteId: ${siteId}`);

  const competitors = data?.competitorProfile?.competitors;
  if (!competitors || competitors.length === 0) {
    log.info(`${LOG_PREFIX} No competitors found in response, nothing to process`);
    return noContent();
  }

  log.info(`${LOG_PREFIX} Processing ${competitors.length} competitors`);

  const urlsByPlatform = extractUrlsByPlatform(competitors);
  const totalUrls = Object.values(urlsByPlatform).reduce((sum, urls) => sum + urls.length, 0);

  if (totalUrls === 0) {
    log.info(`${LOG_PREFIX} No URLs found in competitor data`);
    return noContent();
  }

  log.info(`${LOG_PREFIX} Extracted ${totalUrls} URLs: ${urlsByPlatform.wikipedia.length} wikipedia, ${urlsByPlatform.youtube.length} youtube, ${urlsByPlatform.reddit.length} reddit`);

  const storedUrls = await addUrlsToUrlStore(siteId, urlsByPlatform, dataAccess, log);
  const drsResults = await triggerDrsScraping(storedUrls, siteId, context);

  log.info(`${LOG_PREFIX} Guidance processing complete for site ${siteId}: ${drsResults.length} DRS jobs triggered`);

  return ok();
}
