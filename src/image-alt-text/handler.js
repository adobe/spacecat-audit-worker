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
import { Audit as AuditModel, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { AuditBuilder } from '../common/audit-builder.js';
import { sendAltTextOpportunityToMystique, chunkArray } from './opportunityHandler.js';
import { DATA_SOURCES } from '../common/constants.js';
import { MYSTIQUE_BATCH_SIZE } from './constants.js';
import { isAuditEnabledForSite } from '../common/audit-utils.js';
import { getScrapeJsonPath } from '../headings/utils.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;
const { AUDIT_STEP_DESTINATIONS } = AuditModel;

/**
 * Determines the page limit for alt-text audit based on summit-plg configuration
 * @param {Object} site - Site object
 * @param {Object} context - Lambda context with log and dataAccess
 * @returns {Promise<number>} - Page limit (20 for summit-plg enabled, 100 otherwise)
 */
async function getTopPagesLimit(site, context) {
  const { log } = context;
  const isSummitPlgEnabled = await isAuditEnabledForSite('summit-plg', site, context);
  const pageLimit = isSummitPlgEnabled ? 20 : 100;
  log.debug(`[${AUDIT_TYPE}]: Page limit set to ${pageLimit} (summit-plg enabled: ${isSummitPlgEnabled})`);
  return { pageLimit, isSummitPlg: isSummitPlgEnabled };
}

/**
 * Computes the page window based on offset for summit-plg sites.
 * Non-summit-plg sites always start at offset 0.
 * @param {Array} allTopPages - All top pages
 * @param {number} pageLimit - Max pages per window
 * @param {number} topPagesOffset - Stored offset from opportunity data
 * @param {boolean} isSummitPlg - Whether summit-plg is enabled
 * @param {Object} log - Logger
 * @returns {{ topPages: Array, effectiveOffset: number }}
 */
function getTopPagesWindow(allTopPages, pageLimit, topPagesOffset, isSummitPlg, log) {
  let effectiveOffset = isSummitPlg ? topPagesOffset : 0;
  if (isSummitPlg && effectiveOffset >= allTopPages.length) {
    log.info(`[${AUDIT_TYPE}]: Offset ${effectiveOffset} exceeds ${allTopPages.length} pages, wrapping to 0`);
    effectiveOffset = 0;
  }
  const topPages = allTopPages.slice(effectiveOffset, effectiveOffset + pageLimit);
  log.debug(`[${AUDIT_TYPE}]: Using pages ${effectiveOffset}-${effectiveOffset + topPages.length - 1} of ${allTopPages.length} (limit: ${pageLimit})`);
  return { topPages, effectiveOffset };
}

export async function processImportStep(context) {
  const { site, finalUrl } = context;

  const s3BucketPath = `scrapes/${site.getId()}/`;

  return {
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

/**
 * Checks for existing scrapes and submits missing URLs to scrape client
 * @param {Object} context - Lambda context
 * @returns {Promise<Object>} - Scraping payload with missing URLs
 */
export async function processScraping(context) {
  const {
    log, site, dataAccess, s3Client, env,
  } = context;
  const { SiteTopPage, Opportunity } = dataAccess;
  const siteId = site.getId();

  log.debug(`[${AUDIT_TYPE}]: Processing scraping step for site ${siteId}`);

  // Get page limit based on summit-plg configuration
  const { pageLimit, isSummitPlg } = await getTopPagesLimit(site, context);

  // Get top pages from ahrefs
  const allTopPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');

  if (allTopPages.length === 0) {
    throw new Error(`No top pages found for site ${siteId}`);
  }

  // Read stored offset and check suggestions for advancement (fail-safe: default 0)
  let topPagesOffset = 0;
  let altTextOppty = null;
  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === AUDIT_TYPE,
    );
    if (altTextOppty) {
      const storedOffset = altTextOppty.getData()?.topPagesOffset || 0;

      if (isSummitPlg) {
        // Check for NEW suggestions in the current window
        const suggestions = await altTextOppty.getSuggestions();
        const windowPages = allTopPages
          .slice(storedOffset, storedOffset + pageLimit)
          .map((p) => p.getUrl());
        const windowSet = new Set(windowPages);

        const newSuggestionsInWindow = suggestions.filter((s) => {
          const pageUrl = s.getData()?.recommendations?.[0]?.pageUrl;
          return pageUrl
            && windowSet.has(pageUrl)
            && s.getStatus() === 'NEW';
        });

        if (newSuggestionsInWindow.length === 0) {
          topPagesOffset = storedOffset + pageLimit;
          log.debug(`[${AUDIT_TYPE}]: No NEW suggestions in current window, advancing offset to ${topPagesOffset}`);
        } else {
          topPagesOffset = storedOffset;
          log.debug(`[${AUDIT_TYPE}]: ${newSuggestionsInWindow.length} NEW suggestions in current window, keeping offset at ${topPagesOffset}`);
        }
      } else {
        topPagesOffset = storedOffset;
      }
    }
  } catch (error) {
    log.warn(`[${AUDIT_TYPE}]: Failed to read opportunity offset, defaulting to 0: ${error.message}`);
  }

  // Compute page window using offset (handles wrap-around)
  const window = getTopPagesWindow(allTopPages, pageLimit, topPagesOffset, isSummitPlg, log);
  const { topPages, effectiveOffset } = window;

  // Save the effective offset back to the opportunity
  if (altTextOppty) {
    try {
      const existingData = altTextOppty.getData() || {};
      altTextOppty.setData({
        ...existingData,
        topPagesOffset: effectiveOffset,
      });
      await altTextOppty.save();
    } catch (error) {
      log.warn(`[${AUDIT_TYPE}]: Failed to save opportunity offset: ${error.message}`);
    }
  }
  log.debug(`[${AUDIT_TYPE}]: Checking scrapes for ${topPages.length} top pages (limit: ${pageLimit})`);

  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  // Check S3 for existing scrapes in parallel
  const scrapeCheckResults = await Promise.allSettled(
    topPages.map(async (page) => {
      const url = page.getUrl();
      try {
        const s3Key = getScrapeJsonPath(url, siteId);

        await s3Client.send(new HeadObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
        }));

        // If HeadObjectCommand succeeds, scrape exists
        return { url, exists: true };
      } catch (error) {
        // If NotFound or NoSuchKey, scrape doesn't exist
        // For any other error, assume scrape is missing (fail-safe)
        if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
          log.debug(`[${AUDIT_TYPE}]: Scrape not found for ${url}`);
        } else {
          log.warn(`[${AUDIT_TYPE}]: Error checking scrape for ${url}: ${error.message}, assuming missing`);
        }
        return { url, exists: false };
      }
    }),
  );

  // Collect URLs that need scraping
  const urlsToScrape = scrapeCheckResults
    .filter((result) => result.status === 'fulfilled' && !result.value.exists)
    .map((result) => ({ url: result.value.url }));

  log.info(`[${AUDIT_TYPE}]: Found ${urlsToScrape.length} URLs needing scraping out of ${topPages.length} top pages`);

  // If no URLs need scraping, send the first URL anyway to ensure next step can proceed
  if (urlsToScrape.length === 0) {
    log.debug(`[${AUDIT_TYPE}]: All scrapes exist, sending first URL to ensure scrape client step completes`);
    return {
      urls: [{ url: topPages[0].getUrl() }],
      siteId,
      type: 'default',
      allowCache: true,
      maxScrapeAge: 0,
    };
  }

  // Return payload for SCRAPE_CLIENT
  return {
    urls: urlsToScrape,
    siteId,
    type: 'default',
    allowCache: false,
    maxScrapeAge: 0,
  };
}

export async function processAltTextWithMystique(context) {
  const {
    log, site, audit, dataAccess,
  } = context;

  log.debug(`[${AUDIT_TYPE}]: Processing alt-text with Mystique for site ${site.getId()}`);

  try {
    const { Opportunity, Suggestion } = dataAccess;
    const siteId = site.getId();

    // Get page limit based on summit-plg configuration
    const { pageLimit, isSummitPlg } = await getTopPagesLimit(site, context);

    // Get top pages and included URLs
    const { SiteTopPage } = dataAccess;
    const allTopPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');

    // Look up existing opportunity to read stored offset
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    let altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === AUDIT_TYPE,
    );

    // Read offset (already computed and saved by processScraping)
    const topPagesOffset = altTextOppty?.getData()?.topPagesOffset || 0;
    const {
      topPages, effectiveOffset,
    } = getTopPagesWindow(allTopPages, pageLimit, topPagesOffset, isSummitPlg, log);

    const includedURLs = await site?.getConfig?.()?.getIncludedURLs('alt-text') || [];

    // Get ALL page URLs to send to Mystique
    const pageUrls = [...new Set([...topPages.map((page) => page.getUrl()), ...includedURLs])];
    if (pageUrls.length === 0) {
      throw new Error(`No top pages found for site ${site.getId()}`);
    }

    const urlBatches = chunkArray(pageUrls, MYSTIQUE_BATCH_SIZE);

    let imageUrlsWithAltText = [];

    if (altTextOppty) {
      log.info(`[${AUDIT_TYPE}]: Updating opportunity for new audit run`);

      const existingSuggestions = await altTextOppty.getSuggestions();
      log.debug(`[${AUDIT_TYPE}]: Found ${existingSuggestions.length} existing suggestions`);

      // Filter suggestions with URLs not in current pageUrls
      const pageUrlSet = new Set(pageUrls);
      const IGNORED_STATUSES = ['SKIPPED', 'FIXED', 'OUTDATED'];

      const suggestionsToOutdate = existingSuggestions.filter((suggestion) => {
        const rec = suggestion.getData()?.recommendations?.[0];
        const suggestionPageUrl = rec?.pageUrl;

        // Skip if no page URL
        if (!suggestionPageUrl) {
          return false;
        }

        // Never mark manually edited suggestions as outdated
        if (rec?.isManuallyEdited === true) {
          return false;
        }

        // Skip if already in an ignored status
        if (IGNORED_STATUSES.includes(suggestion.getStatus())) {
          return false;
        }

        // Mark as outdated if URL is NOT in current pageUrls
        return !pageUrlSet.has(suggestionPageUrl);
      });

      log.debug(`[${AUDIT_TYPE}]: Found ${suggestionsToOutdate.length} suggestions to mark as OUTDATED (URLs no longer in top pages)`);

      // Mark filtered suggestions as OUTDATED
      if (suggestionsToOutdate.length > 0) {
        await Suggestion.bulkUpdateStatus(suggestionsToOutdate, SuggestionModel.STATUSES.OUTDATED);
        log.info(`[${AUDIT_TYPE}]: Marked ${suggestionsToOutdate.length} suggestions as OUTDATED`);
      }

      // Collect image URLs from remaining NEW suggestions (excluding just-outdated ones)
      const outdatedSet = new Set(suggestionsToOutdate);
      imageUrlsWithAltText = [...new Set(
        existingSuggestions
          .filter((s) => s.getStatus() === SuggestionModel.STATUSES.NEW && !outdatedSet.has(s))
          .map((s) => s.getData()?.recommendations?.[0]?.imageUrl)
          .filter(Boolean),
      )];
      log.debug(`[${AUDIT_TYPE}]: Found ${imageUrlsWithAltText.length} existing image URLs with alt text`);

      // Reset only Mystique-related data, keep existing metrics, store offset
      const existingData = altTextOppty.getData() || {};
      const resetData = {
        ...existingData,
        topPagesOffset: effectiveOffset,
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: urlBatches.length,
        processedSuggestionIds: [],
      };
      altTextOppty.setData(resetData);
      await altTextOppty.save();
      log.debug(`[${AUDIT_TYPE}]: Updated opportunity data for new audit run`);
    } else {
      log.debug(`[${AUDIT_TYPE}]: Creating new opportunity for site ${siteId}`);
      const opportunityDTO = {
        siteId,
        auditId: audit.getId(),
        runbook: 'https://adobe.sharepoint.com/:w:/s/aemsites-engineering/EeEUbjd8QcFOqCiwY0w9JL8BLMnpWypZ2iIYLd0lDGtMUw?e=XSmEjh',
        type: AUDIT_TYPE,
        origin: 'AUTOMATION',
        title: 'Make images on your site accessible (and boost SEO) — alt-text suggestions have been prepared',
        description: 'Descriptive alt-text improves accessibility and allows search engines to better understand image content.',
        guidance: {
          recommendations: [
            {
              insight: 'Alt text for images decreases accessibility and limits discoverability',
              recommendation: 'Add meaningful alt text on images that clearly articulate the subject matter of the image',
              type: null,
              rationale: 'Alt text for images is vital to ensure your content is discoverable and usable for many people as possible',
            },
          ],
        },
        data: {
          topPagesOffset: 0,
          projectedTrafficLost: 0,
          projectedTrafficValue: 0,
          decorativeImagesCount: 0,
          dataSources: [
            DATA_SOURCES.RUM,
            DATA_SOURCES.SITE,
            DATA_SOURCES.AHREFS,
          ],
          mystiqueResponsesReceived: 0,
          mystiqueResponsesExpected: urlBatches.length,
          processedSuggestionIds: [],
        },
        tags: ['seo', 'accessibility'],
      };

      altTextOppty = await Opportunity.create(opportunityDTO);
      log.debug(`[${AUDIT_TYPE}]: Created new opportunity with ID ${altTextOppty.getId()}`);
    }

    await sendAltTextOpportunityToMystique(
      site.getBaseURL(),
      pageUrls,
      site.getId(),
      audit.getId(),
      context,
      imageUrlsWithAltText,
      isSummitPlg,
    );

    log.debug(`[${AUDIT_TYPE}]: Sent ${pageUrls.length} pages to Mystique for generating alt-text suggestions`);

    // Clean up outdated suggestions
    // Small delay to ensure no concurrent operations
    // comment for now to avoid having empty optty in case M blows up
    // await new Promise((resolve) => {
    //   setTimeout(resolve, 1000);
    // });
    // await cleanupOutdatedSuggestions(altTextOppty, log);
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Failed to process with Mystique: ${error.message}`);
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('processImport', processImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('processScraping', processScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('processAltTextWithMystique', processAltTextWithMystique)
  .build();
