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
import { AuditBuilder } from '../common/audit-builder.js';
import { sendAltTextOpportunityToMystique, chunkArray } from './opportunityHandler.js';
import { DATA_SOURCES } from '../common/constants.js';
import {
  MYSTIQUE_BATCH_SIZE, SUMMIT_PLG_PAGE_LIMIT, DEFAULT_PAGE_LIMIT,
  SCRAPE_MAX_AGE_HOURS, SCRAPE_PAGE_LOAD_TIMEOUT, ALT_TEXT_PROCESSING_ERROR_TAG,
} from './constants.js';
import { getTopPageUrls } from './url-utils.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;
const { AUDIT_STEP_DESTINATIONS } = AuditModel;

/**
 * Checks if the decorative agent classification is enabled.
 * Enabled when alt-text-decorative-agent handler has no enabled.sites (empty = enabled for all).
 * @param {Object} context - Lambda context with dataAccess
 * @returns {Promise<boolean>}
 */
export async function isDecorativeAgentEnabled(context) {
  const { Configuration } = context.dataAccess;
  const configuration = await Configuration.findLatest();
  const enabledSites = configuration.getEnabledSiteIdsForHandler('alt-text-decorative-agent');
  return !enabledSites.length;
}

/**
 * Determines the page limit for alt-text audit based on summit-plg configuration
 * @param {Object} site - Site object
 * @param {Object} context - Lambda context with log and dataAccess
 * @returns {Promise<number>} - Page limit (20 for summit-plg enabled, 100 otherwise)
 */
async function getTopPagesLimit(site, context) {
  const { log, dataAccess } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const isSummitPlgEnabled = configuration.isHandlerEnabledForSite('summit-plg', site);
  const pageLimit = isSummitPlgEnabled ? SUMMIT_PLG_PAGE_LIMIT : DEFAULT_PAGE_LIMIT;
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
  const endIndex = topPages.length > 0 ? effectiveOffset + topPages.length - 1 : effectiveOffset;
  log.debug(`[${AUDIT_TYPE}]: Using pages ${effectiveOffset}-${endIndex} of ${allTopPages.length} (limit: ${pageLimit})`);
  return { topPages, effectiveOffset };
}

/**
 * Appends a new status entry to the statusHistory and marks the step as started.
 * Stateless helper — takes and returns a plain auditResult object.
 * Computes queueDurationMs from the previous entry's completedAt.
 */
export function startStatus(auditResult, status, metadata = {}) {
  const existing = auditResult || {};
  const history = [...(existing.statusHistory || [])];
  const previousEntry = history[history.length - 1];

  const now = new Date().toISOString();
  const entry = { status, startedAt: now, ...metadata };

  if (previousEntry?.completedAt) {
    entry.queueDurationMs = new Date(now) - new Date(previousEntry.completedAt);
  } else {
    entry.queueDurationMs = null;
  }

  history.push(entry);
  return { ...existing, status, statusHistory: history };
}

/**
 * Completes the current (last) status entry with completedAt and stepDurationMs.
 * Stateless helper — takes and returns a plain auditResult object.
 */
export function completeStatus(auditResult, metadata = {}) {
  const existing = auditResult || {};
  const history = [...(existing.statusHistory || [])];
  const last = history[history.length - 1];
  if (last) {
    const now = new Date().toISOString();
    last.completedAt = now;
    last.stepDurationMs = new Date(now) - new Date(last.startedAt);
    Object.assign(last, metadata);
  }
  return { ...existing, statusHistory: history };
}

/**
 * Marks the current in-progress step as failed, or appends a new failed entry
 * if no step is in progress.
 * Stateless helper — takes and returns a plain auditResult object.
 * Note: does NOT set isError — callers must pass isError=true to persistAuditStatus separately.
 */
export function failCurrentStatus(auditResult, failedStatus, metadata = {}) {
  const existing = auditResult || {};
  const history = [...(existing.statusHistory || [])];
  const last = history[history.length - 1];
  if (last && !last.completedAt) {
    last.status = failedStatus;
    last.completedAt = new Date().toISOString();
    last.stepDurationMs = new Date(last.completedAt) - new Date(last.startedAt);
    Object.assign(last, metadata);
    return { ...existing, status: failedStatus, statusHistory: history };
  }
  let result = startStatus(existing, failedStatus, metadata);
  result = completeStatus(result);
  return result;
}

/**
 * Persists the audit status via Audit.updateByKeys (bypasses allowUpdates(false)).
 * Used by Steps 2/3 where the audit object is loaded once and tracked in a local variable.
 */
async function persistAuditStatus(dataAccess, auditId, auditResult, log, isError = false) {
  try {
    const { Audit } = dataAccess;
    const updates = { auditResult };
    if (isError) {
      updates.isError = true;
    }
    await Audit.updateByKeys({ auditId }, updates);
  } catch (error) {
    log.warn(`[${AUDIT_TYPE}][${ALT_TEXT_PROCESSING_ERROR_TAG}] Failed to save audit status: ${error.message}`);
  }
}

/**
 * Persists the audit status with a fresh DB read to get the latest statusHistory.
 * Used by the guidance handler where concurrent Mystique batch responses can race.
 * The fresh read narrows the lost-update window to milliseconds.
 *
 * Always appends a new entry via startStatus + completeStatus (never failCurrentStatus).
 * This is safe because the guidance handler only runs after Step 3 has completed its
 * status entry — there should never be a dangling in-progress entry at this point.
 */
export async function persistAuditStatusWithFreshRead(
  dataAccess,
  auditId,
  status,
  metadata,
  log,
  isError = false,
) {
  try {
    const { Audit } = dataAccess;
    const freshAudit = await Audit.findById(auditId);
    const existing = freshAudit?.getAuditResult() || {};
    let auditResult = startStatus(existing, status);
    auditResult = completeStatus(auditResult, metadata);
    const updates = { auditResult };
    if (isError) {
      updates.isError = true;
    }
    await Audit.updateByKeys({ auditId }, updates);
  } catch (error) {
    log.warn(`[${AUDIT_TYPE}][${ALT_TEXT_PROCESSING_ERROR_TAG}] Failed to save audit status: ${error.message}`);
  }
}

export async function processImportStep(context) {
  const { site, finalUrl } = context;

  const s3BucketPath = `scrapes/${site.getId()}/`;
  const now = new Date().toISOString();

  return {
    auditResult: {
      status: 'preparing',
      statusHistory: [{
        status: 'preparing',
        startedAt: now,
        completedAt: now,
        stepDurationMs: 0,
        queueDurationMs: null,
        finalUrl,
      }],
    },
    fullAuditRef: s3BucketPath,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

/**
 * Sends all top page URLs to the scrape client for scraping.
 * The scrape client handles caching via maxScrapeAge.
 * @param {Object} context - Lambda context
 * @returns {Promise<Object>} - Scraping payload with all top page URLs
 */
export async function processScraping(context) {
  const {
    log, site, dataAccess, audit,
  } = context;
  const { Opportunity } = dataAccess;
  const siteId = site.getId();

  let auditResult = audit.getAuditResult();
  auditResult = startStatus(auditResult, 'scraping');
  await persistAuditStatus(dataAccess, audit.getId(), auditResult, log);

  try {
    log.debug(`[${AUDIT_TYPE}]: Processing scraping step for site ${siteId}`);

    // Get page limit based on summit-plg configuration
    const { pageLimit, isSummitPlg } = await getTopPagesLimit(site, context);

    // Get top page URLs via fallback chain (Ahrefs -> RUM -> includedURLs)
    const allTopPageUrls = await getTopPageUrls({
      siteId, site, dataAccess, context, log,
    });

    if (allTopPageUrls.length === 0) {
      const errorMsg = `No top pages found for site ${siteId}`;
      log.error(`[${AUDIT_TYPE}][${ALT_TEXT_PROCESSING_ERROR_TAG}] ${errorMsg}`);
      auditResult = failCurrentStatus(auditResult, 'no_top_pages', { error: errorMsg });
      await persistAuditStatus(dataAccess, audit.getId(), auditResult, log, true);
      return { auditResult, fullAuditRef: audit.getFullAuditRef() };
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
          const windowPages = allTopPageUrls
            .slice(storedOffset, storedOffset + pageLimit);
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
    const window = getTopPagesWindow(allTopPageUrls, pageLimit, topPagesOffset, isSummitPlg, log);
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
    // Send ALL top page URLs to SCRAPE_CLIENT.
    // The scrape client handles caching via maxScrapeAge — it reuses recent scrapes
    // and only re-scrapes stale/missing URLs. This ensures all URLs are registered
    // in the scrape job's storage records, making them discoverable by downstream
    // consumers (e.g., mystique) through the scrape jobs API.
    log.info(`[${AUDIT_TYPE}]: Sending ${topPages.length} URLs to scrape client (maxScrapeAge: ${SCRAPE_MAX_AGE_HOURS}h)`);

    auditResult = completeStatus(auditResult, { urlCount: topPages.length });
    await persistAuditStatus(dataAccess, audit.getId(), auditResult, log);

    return {
      urls: topPages.map((url) => ({ url })),
      siteId,
      type: 'default',
      maxScrapeAge: SCRAPE_MAX_AGE_HOURS,
      options: {
        pageLoadTimeout: SCRAPE_PAGE_LOAD_TIMEOUT,
      },
    };
  } catch (error) {
    log.error(`[${AUDIT_TYPE}][${ALT_TEXT_PROCESSING_ERROR_TAG}] processScraping failed: ${error.message}`);
    auditResult = failCurrentStatus(auditResult, 'scraping_failed', { error: error.message });
    await persistAuditStatus(dataAccess, audit.getId(), auditResult, log, true);
    throw error;
  }
}

export async function processAltTextWithMystique(context) {
  const {
    log, site, audit, dataAccess,
  } = context;

  log.debug(`[${AUDIT_TYPE}]: Processing alt-text with Mystique for site ${site.getId()}`);

  let auditResult = audit.getAuditResult();
  auditResult = startStatus(auditResult, 'processing');
  await persistAuditStatus(dataAccess, audit.getId(), auditResult, log);

  try {
    const { Opportunity, Suggestion } = dataAccess;
    const siteId = site.getId();

    // Get page limit based on summit-plg configuration
    const { pageLimit, isSummitPlg } = await getTopPagesLimit(site, context);

    // Get top page URLs via fallback chain (Ahrefs -> RUM -> includedURLs)
    const allTopPageUrls = await getTopPageUrls({
      siteId, site, dataAccess, context, log,
    });

    // Look up existing opportunity to read stored offset
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    let altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === AUDIT_TYPE,
    );

    // Read offset (already computed and saved by processScraping)
    const topPagesOffset = altTextOppty?.getData()?.topPagesOffset || 0;
    const {
      topPages, effectiveOffset,
    } = getTopPagesWindow(allTopPageUrls, pageLimit, topPagesOffset, isSummitPlg, log);

    // Get ALL page URLs to send to Mystique
    const pageUrls = [...topPages];
    if (pageUrls.length === 0) {
      const errorMsg = `No top pages found for site ${site.getId()}`;
      log.error(`[${AUDIT_TYPE}][${ALT_TEXT_PROCESSING_ERROR_TAG}] ${errorMsg}`);
      auditResult = failCurrentStatus(auditResult, 'no_top_pages', { error: errorMsg });
      await persistAuditStatus(dataAccess, audit.getId(), auditResult, log, true);
      return { auditResult };
    }

    // Filter out URLs without scrapes before sending to Mystique.
    // Uses scrapeResultPaths (Map<url, s3Path>) from the SCRAPE_CLIENT step,
    // which is the same data source mystique queries via scrape jobs API.
    const { scrapeResultPaths } = context;
    if (scrapeResultPaths) {
      const urlsWithScrapes = pageUrls.filter((url) => scrapeResultPaths.has(url));
      const missingCount = pageUrls.length - urlsWithScrapes.length;
      if (urlsWithScrapes.length === 0) {
        const errorMsg = `Cannot proceed: none of the ${pageUrls.length} URLs have scrape results. `
          + 'Mystique will not be able to find content for these pages.';
        log.error(`[${AUDIT_TYPE}][${ALT_TEXT_PROCESSING_ERROR_TAG}] ${errorMsg}`);
        auditResult = failCurrentStatus(auditResult, 'no_scrape_results', { error: errorMsg });
        await persistAuditStatus(dataAccess, audit.getId(), auditResult, log, true);
        return { auditResult };
      }
      if (missingCount > 0) {
        log.warn(`[${AUDIT_TYPE}]: Excluding ${missingCount}/${pageUrls.length} URLs without scrapes`);
      }
      log.info(`[${AUDIT_TYPE}]: Sending ${urlsWithScrapes.length} of ${pageUrls.length} URLs with scrapes to Mystique`);
      pageUrls.length = 0;
      pageUrls.push(...urlsWithScrapes);
    } else {
      log.warn(`[${AUDIT_TYPE}]: No scrapeResultPaths in context, skipping scrape verification`);
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

    const decorativeAgentEnabled = await isDecorativeAgentEnabled(context);

    await sendAltTextOpportunityToMystique(
      site.getBaseURL(),
      pageUrls,
      site.getId(),
      audit.getId(),
      context,
      imageUrlsWithAltText,
      isSummitPlg,
      decorativeAgentEnabled,
    );

    log.debug(`[${AUDIT_TYPE}]: Sent ${pageUrls.length} pages to Mystique for generating alt-text suggestions`);

    const statusMeta = { urlCount: pageUrls.length, batchCount: urlBatches.length };
    auditResult = completeStatus(auditResult, statusMeta);
    await persistAuditStatus(dataAccess, audit.getId(), auditResult, log);

    return { auditResult };
  } catch (error) {
    log.error(`[${AUDIT_TYPE}][${ALT_TEXT_PROCESSING_ERROR_TAG}] Failed to process with Mystique: ${error.message}`);
    auditResult = failCurrentStatus(auditResult, 'processing_failed', { error: error.message });
    await persistAuditStatus(dataAccess, audit.getId(), auditResult, log, true);
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('processImport', processImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('processScraping', processScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('processAltTextWithMystique', processAltTextWithMystique)
  .build();
