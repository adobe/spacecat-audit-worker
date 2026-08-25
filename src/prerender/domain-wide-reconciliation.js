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

import { Audit, Suggestion } from '@adobe/spacecat-shared-data-access';
import {
  isDomainWideSuggestionData,
  isPathSuggestionData,
  normalizePathnameWithQuery,
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
 * True when a suggestion is the active (non-OUTDATED) domain-wide suggestion with
 * `edgeDeployed` set. Shared predicate for both the batch-selection lookup (which fetches
 * its own suggestion list) and the write-back (which reuses an already-fetched list) so
 * the "what counts as deployed" rule can't drift between them.
 * @param {Object} s - Suggestion entity
 * @returns {boolean}
 */
function isDeployedDomainWideSuggestion(s) {
  return s.getStatus() === Suggestion.STATUSES.NEW
    && isDomainWideSuggestionData(s.getData()) && !!s.getData()?.edgeDeployed;
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
  const domainWide = suggestions.find(isDeployedDomainWideSuggestion);
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
 * @param {Object} context - Audit context (dataAccess, log)
 * @param {string} siteId - Site ID
 * @param {Object} siteStatus - The site's already-read status.json (caller fetches this
 *   once via readSiteStatusJson and reuses it here rather than re-reading from S3)
 * @returns {Promise<string[]>} URLs to append to this run's scrape batch
 */
export async function getDomainWideReconciliationCandidates(context, siteId, siteStatus) {
  const { dataAccess, log } = context;
  const found = await findDeployedDomainWide(dataAccess, siteId);
  if (!found) {
    return [];
  }
  const { suggestions, domainWide } = found;
  const deployedAtMs = new Date(domainWide.getData().edgeDeployed).getTime();
  if (Number.isNaN(deployedAtMs)) {
    log.warn(`${LOG_PREFIX} Domain-wide suggestion ${domainWide.getId()} has an unparseable `
      + `edgeDeployed value; skipping reconciliation batch selection. siteId=${siteId}`);
    return [];
  }

  const covered = suggestions.filter((s) => {
    const data = s.getData();
    return !!data?.coveredByDomainWide && isIndividualUrlSuggestionData(data);
  });
  if (covered.length === 0) {
    return [];
  }

  const pageByPathname = new Map(
    (siteStatus?.pages ?? [])
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
 * Reconciles `coveredByDomainWide` against this run's confirmed edge state (LLMO-7052).
 * One suggestion fetch, one save, covering both directions:
 *
 *  - Add: when the domain-wide suggestion has `edgeDeployed`, NEW per-URL suggestions
 *    whose pathname is confirmed deployed at edge this run get `coveredByDomainWide` set
 *    (instead of moving to SKIPPED, so a domain-wide rollback naturally restores them to
 *    the Current tab). NEW path-type suggestions are covered unconditionally while
 *    domain-wide is active — they're redundant, not something to individually verify.
 *  - Remove: any suggestion (any status) currently `coveredByDomainWide` whose pathname is
 *    confirmed NOT deployed at edge this run has the flag cleared immediately — no grace
 *    period, and independent of whether a domain-wide suggestion currently exists at all.
 *
 * Both directions read from a single `opportunity.getSuggestions()` fetch and write
 * through a single `saveMany` call; the save is non-fatal on failure (logged, swallowed)
 * so a transient DB error on this reconciliation step doesn't fail an otherwise-successful
 * audit run — matching how other post-processing steps in this audit behave.
 *
 * @param {Object|null} opportunity - Opportunity entity (no-op if null)
 * @param {Object} context - Audit context (dataAccess, log, site)
 * @param {Array} successfulComparisons - This run's non-error comparison results
 * @returns {Promise<void>}
 */
export async function syncCoveredByDomainWide(opportunity, context, successfulComparisons) {
  const { dataAccess, log, site } = context;
  const SuggestionDA = dataAccess?.Suggestion;
  if (!opportunity || typeof opportunity.getSuggestions !== 'function' || !SuggestionDA?.saveMany) {
    return;
  }

  const baseUrl = site?.getBaseURL?.() || '';
  const siteId = site?.getId?.() || '';

  const suggestions = await opportunity.getSuggestions();

  const domainWideSuggestion = suggestions.find(isDeployedDomainWideSuggestion) ?? null;
  log.info(`${LOG_PREFIX} syncCoveredByDomainWide: isAllDomainDeployedAtEdge=`
    + `${!!domainWideSuggestion}, baseUrl=${baseUrl}`);

  // Pathname-only (not query-aware) is intentional here, unlike normalizePathnameWithQuery
  // used for status.json/candidate dedup elsewhere: coveredByDomainWide is assigned upstream
  // by matching /*-suffixed allowedRegexPatterns against pathname only, ignoring the query
  // string entirely (see buildUrlMatcher in spacecat-shared-tokowaka-client's
  // src/utils/pattern-utils.js) — a domain-wide or path-level rule covers every query-param
  // variant of a pathname identically. Reconciling at query-aware granularity would strand
  // variants like /page?v=2 unreconciled forever unless that exact variant gets scraped,
  // even though the routing rule that covers it doesn't distinguish query strings either.
  const deployedAtEdgePathnames = new Set();
  const notDeployedPathnames = new Set();
  successfulComparisons.forEach((r) => {
    (r.isDeployedAtEdge ? deployedAtEdgePathnames : notDeployedPathnames).add(toPathname(r.url));
  });
  // If two variants of the same pathname disagreed on isDeployedAtEdge this run (e.g.
  // /page?v=1 confirmed deployed, /page?v=2 didn't), the positive confirmation wins —
  // otherwise the same suggestion could match both toCover and toClear below and the
  // second mutation would silently overwrite the first in the same saveMany call.
  deployedAtEdgePathnames.forEach((pathname) => notDeployedPathnames.delete(pathname));

  const toCover = [];
  if (domainWideSuggestion) {
    const domainWideSuggestionId = domainWideSuggestion.getId();
    // The domain-wide suggestion itself is always NEW and always in this list, so
    // newSuggestions is never empty here — nothing further to guard on that front.
    const newSuggestions = suggestions.filter((s) => s.getStatus() === Suggestion.STATUSES.NEW);

    // Path and domain-wide suggestions have no url field — guard before calling toPathname.
    const urlSuggestionsToCover = deployedAtEdgePathnames.size > 0
      ? newSuggestions.filter((s) => {
        const data = s.getData();
        if (!data?.url) {
          return false;
        }
        return deployedAtEdgePathnames.has(toPathname(data.url))
          && !data?.edgeDeployed
          && !data?.coveredByDomainWide;
      })
      : [];

    // Path suggestions are redundant while domain-wide (/*) is active — cover unconditionally.
    const pathSuggestionsToCover = newSuggestions.filter((s) => {
      const data = s.getData();
      return isPathSuggestionData(data) && !data?.edgeDeployed && !data?.coveredByDomainWide;
    });

    toCover.push(...urlSuggestionsToCover, ...pathSuggestionsToCover);
    if (toCover.length === 0) {
      log.info(`${LOG_PREFIX} syncCoveredByDomainWide: no NEW suggestions to cover. `
        + `baseUrl=${baseUrl}, siteId=${siteId}`);
    } else {
      toCover.forEach((s) => s.setData({
        ...s.getData(),
        coveredByDomainWide: domainWideSuggestionId,
      }));
      log.info(`${LOG_PREFIX} All domain deployed: marking ${urlSuggestionsToCover.length} `
        + `per-URL and ${pathSuggestionsToCover.length} path suggestions as coveredByDomainWide. `
        + `baseUrl=${baseUrl}, siteId=${siteId}`);
    }
  }

  const toClear = suggestions.filter((s) => {
    const data = s.getData();
    return !!data?.coveredByDomainWide
      && isIndividualUrlSuggestionData(data)
      && notDeployedPathnames.has(toPathname(data.url));
  });
  toClear.forEach((s) => {
    // eslint-disable-next-line no-unused-vars
    const { coveredByDomainWide, ...rest } = s.getData();
    s.setData(rest);
    s.setUpdatedBy('system');
  });

  const toSave = [...toCover, ...toClear];
  if (toSave.length === 0) {
    return;
  }

  try {
    await SuggestionDA.saveMany(toSave);
    if (toClear.length > 0) {
      log.info(`${LOG_PREFIX} Domain-wide reconciliation: cleared coveredByDomainWide on `
        + `${toClear.length} suggestion(s) confirmed not deployed at edge this run.`);
    }
  } catch (e) {
    log.error(`${LOG_PREFIX} Failed to save coveredByDomainWide changes for ${toSave.length} `
      + `suggestion(s): ${e.message}`);
  }
}
