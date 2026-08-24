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

import { Audit } from '@adobe/spacecat-shared-data-access';
import {
  isDomainWideSuggestionData,
  isPathSuggestionData,
  normalizePathnameWithQuery,
  readSiteStatusJson,
  toPathname,
} from './utils/utils.js';
import { DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE } from './utils/constants.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

/**
 * True when a suggestion's data represents an individual per-URL suggestion (not
 * domain-wide, not path-type).
 * @param {Object} data - Suggestion data
 * @returns {boolean}
 */
function isIndividualUrlSuggestionData(data) {
  return !!data?.url && !isDomainWideSuggestionData(data) && !isPathSuggestionData(data);
}

/**
 * Finds the site's NEW prerender opportunity and, within it, the domain-wide
 * suggestion that currently has `edgeDeployed` set.
 * @param {Object} dataAccess - Data access layer
 * @param {string} siteId - Site ID
 * @returns {Promise<{suggestions: Array, domainWide: Object}|null>}
 */
async function findDeployedDomainWide(dataAccess, siteId) {
  const opportunities = await dataAccess?.Opportunity?.allBySiteIdAndStatus?.(siteId, 'NEW') ?? [];
  const opportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);
  if (!opportunity) {
    return null;
  }
  const suggestions = await opportunity.getSuggestions?.() ?? [];
  const domainWide = suggestions.find(
    (s) => isDomainWideSuggestionData(s.getData()) && !!s.getData()?.edgeDeployed,
  );
  if (!domainWide) {
    return null;
  }
  return { suggestions, domainWide };
}

/**
 * True when a status.json page entry represents a genuine post-deploy confirmation:
 * a *successful* scrape that happened strictly after the domain-wide suggestion's own
 * `edgeDeployed` timestamp. Anything else — no entry, a failed/bot-blocked attempt
 * regardless of when, or a successful-but-pre-deploy entry — means we still don't know
 * this URL's current edge state relative to the deploy, so it stays eligible.
 *
 * Deliberately checks `scrapingStatus`, not just `scrapedAt`: uploadStatusSummaryToS3
 * stamps `scrapedAt` on every attempt regardless of outcome — `currentPages` sets it
 * unconditionally per result, and `missingPages` (bot-blocked/dropped scrapes) carries
 * `scrapingStatus: 'failed'` with its own `scrapedAt` too. A bare age comparison would
 * permanently retire a URL from the backlog after a single failed scrape, even though
 * it was never actually confirmed either way.
 * @param {Object|undefined} pageEntry - status.json page entry for this URL, if any
 * @param {number} deployedAtMs - domain-wide suggestion's edgeDeployed, as epoch ms
 * @returns {boolean}
 */
function hasPostDeployConfirmation(pageEntry, deployedAtMs) {
  if (!pageEntry?.scrapedAt || pageEntry.scrapingStatus !== 'success') {
    return false;
  }
  return new Date(pageEntry.scrapedAt).getTime() > deployedAtMs;
}

/**
 * Selects up to DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE per-URL suggestions that are
 * currently `coveredByDomainWide` but have no genuine post-deploy scrape confirmation
 * yet (LLMO-7052). Intended to be appended *additively* to the daily scrape batch, on
 * top of DAILY_BATCH_SIZE, so reconciliation runs on a fixed cadence independent of
 * whether these URLs would otherwise be selected by organic/agentic/included ranking.
 *
 * Ordered oldest-`scrapedAt`-first (missing entries sort first) so the backlog drains
 * deterministically rather than resampling the same subset every run. A URL naturally
 * drops out of this selection once it gets any post-deploy scrape — no bookkeeping
 * needed to track "already handled".
 *
 * @param {Object} context - Audit context (dataAccess, log, s3Client, env)
 * @param {string} siteId - Site ID
 * @returns {Promise<string[]>} URLs to append to this run's scrape batch
 */
export async function getDomainWideReconciliationCandidates(context, siteId) {
  const { dataAccess, log } = context;
  const found = await findDeployedDomainWide(dataAccess, siteId);
  if (!found) {
    return [];
  }
  const { suggestions, domainWide } = found;
  const deployedAtMs = new Date(domainWide.getData().edgeDeployed).getTime();

  const covered = suggestions.filter((s) => {
    const data = s.getData();
    return !!data?.coveredByDomainWide && isIndividualUrlSuggestionData(data);
  });
  if (covered.length === 0) {
    return [];
  }

  const siteStatus = await readSiteStatusJson(siteId, context);
  const pageByPathname = new Map(
    (siteStatus.pages ?? [])
      .filter((p) => p.url)
      .map((p) => [normalizePathnameWithQuery(p.url), p]),
  );

  const backlog = covered.filter((s) => {
    const pathname = normalizePathnameWithQuery(s.getData().url);
    return !hasPostDeployConfirmation(pageByPathname.get(pathname), deployedAtMs);
  });

  const getScrapedAt = (s) => pageByPathname
    .get(normalizePathnameWithQuery(s.getData().url))?.scrapedAt ?? '';
  backlog.sort((a, b) => getScrapedAt(a).localeCompare(getScrapedAt(b)));

  const selected = backlog.slice(0, DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE);
  log.info(`${LOG_PREFIX} Domain-wide reconciliation: ${covered.length} coveredByDomainWide `
    + `suggestion(s), ${backlog.length} pending post-deploy confirmation, selecting `
    + `${selected.length} for this run's batch. siteId=${siteId}`);
  return selected.map((s) => s.getData().url);
}

/**
 * Clears `coveredByDomainWide` on any per-URL suggestion whose pathname was scraped
 * successfully this run and confirmed `isDeployedAtEdge: false` (LLMO-7052). Runs
 * against the full set of this run's successful comparisons, not just URLs pulled in by
 * getDomainWideReconciliationCandidates, so incidental confirmations from ordinary
 * organic/agentic/included rotation are caught too.
 *
 * No grace period: a single confirmed `isDeployedAtEdge: false` result clears the flag
 * immediately, symmetric with markDeployedUrlSuggestionsAsCovered, which already trusts
 * a single confirmed scrape to *set* it. If this fires before a still-propagating CDN
 * deploy has fully caught up, the next confirmed `isDeployedAtEdge: true` re-covers it
 * via that same add-side path.
 *
 * @param {Object|null} opportunity - Opportunity entity (no-op if null)
 * @param {Object} context - Audit context (dataAccess, log)
 * @param {Array} successfulComparisons - This run's non-error comparison results
 * @returns {Promise<void>}
 */
export async function reconcileCoveredByDomainWide(opportunity, context, successfulComparisons) {
  const { dataAccess, log } = context;
  if (!opportunity || typeof opportunity.getSuggestions !== 'function') {
    return;
  }

  const notDeployedPathnames = new Set(
    successfulComparisons
      .filter((r) => !r.isDeployedAtEdge)
      .map((r) => toPathname(r.url)),
  );
  if (notDeployedPathnames.size === 0) {
    return;
  }

  const suggestions = await opportunity.getSuggestions();
  const toClear = suggestions.filter((s) => {
    const data = s.getData();
    return !!data?.coveredByDomainWide
      && isIndividualUrlSuggestionData(data)
      && notDeployedPathnames.has(toPathname(data.url));
  });
  if (toClear.length === 0) {
    return;
  }

  toClear.forEach((s) => {
    // eslint-disable-next-line no-unused-vars
    const { coveredByDomainWide, ...rest } = s.getData();
    s.setData(rest);
    s.setUpdatedBy('system');
  });

  try {
    await dataAccess.Suggestion.saveMany(toClear);
    log.info(`${LOG_PREFIX} Domain-wide reconciliation: cleared coveredByDomainWide on `
      + `${toClear.length} suggestion(s) confirmed not deployed at edge this run.`);
  } catch (e) {
    log.error(`${LOG_PREFIX} Failed to clear coveredByDomainWide on ${toClear.length} `
      + `suggestion(s): ${e.message}`);
  }
}
