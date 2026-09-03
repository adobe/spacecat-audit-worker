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
 * True when a suggestion is the active (NEW) domain-wide suggestion with `edgeDeployed` set.
 * Shared by batch-selection and write-back so "deployed" can't drift between them.
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
 * True when a status.json page entry is a successful scrape strictly after `deployedAtMs`.
 * Checks `scrapingStatus`, not just age, so a failed/bot-blocked scrape doesn't permanently
 * retire a URL from the backlog.
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
 * Selects up to DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE `coveredByDomainWide` suggestions
 * with no post-deploy scrape confirmation yet (LLMO-7052), appended additively to the
 * daily scrape batch. Ordered oldest-`scrapedAt`-first so the backlog drains deterministically.
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
 * Partitions this run's comparisons into deployed/not-deployed identity keys (same key as
 * buildSuggestionKey — each suggestion reconciled against its own result only). On a
 * same-key disagreement this run, positive confirmation wins.
 * @param {Array} successfulComparisons - This run's non-error comparison results
 * @returns {{deployedAtEdgeKeys: Set<string>, notDeployedKeys: Set<string>}}
 */
function partitionComparisonResults(successfulComparisons) {
  const deployedAtEdgeKeys = new Set();
  const notDeployedKeys = new Set();
  successfulComparisons.forEach((r) => {
    (r.isDeployedAtEdge ? deployedAtEdgeKeys : notDeployedKeys)
      .add(normalizePathnameWithQuery(r.url));
  });
  deployedAtEdgeKeys.forEach((key) => notDeployedKeys.delete(key));
  return { deployedAtEdgeKeys, notDeployedKeys };
}

/**
 * Add branch: NEW suggestions confirmed deployed at edge this run get `coveredByDomainWide`
 * set. No-op (returns []) when no domain-wide suggestion is currently deployed.
 * @param {Array} suggestions - All suggestions on the opportunity
 * @param {Object|null} domainWideSuggestion - The active deployed domain-wide suggestion, if any
 * @param {Set<string>} deployedAtEdgeKeys - Identity keys confirmed deployed this run
 * @param {{log: Object, baseUrl: string, siteId: string}} logCtx
 * @returns {Array} Suggestions mutated (and needing save)
 */
function computeSuggestionsToCover(suggestions, domainWideSuggestion, deployedAtEdgeKeys, {
  log, baseUrl, siteId,
}) {
  if (!domainWideSuggestion) {
    return [];
  }
  const domainWideSuggestionId = domainWideSuggestion.getId();
  // Domain-wide suggestion is always NEW, so newSuggestions is never empty here.
  const newSuggestions = suggestions.filter((s) => s.getStatus() === Suggestion.STATUSES.NEW);

  // Path and domain-wide suggestions have no url field — guard before normalizing.
  const urlSuggestionsToCover = deployedAtEdgeKeys.size > 0
    ? newSuggestions.filter((s) => {
      const data = s.getData();
      if (!data?.url) {
        return false;
      }
      return deployedAtEdgeKeys.has(normalizePathnameWithQuery(data.url))
        && !data?.edgeDeployed
        && !data?.coveredByDomainWide;
    })
    : [];

  // Path suggestions are redundant while domain-wide (/*) is active — cover unconditionally.
  const pathSuggestionsToCover = newSuggestions.filter((s) => {
    const data = s.getData();
    return isPathSuggestionData(data) && !data?.edgeDeployed && !data?.coveredByDomainWide;
  });

  const toCover = [...urlSuggestionsToCover, ...pathSuggestionsToCover];
  if (toCover.length === 0) {
    log.info(`${LOG_PREFIX} syncCoveredByDomainWide: no NEW suggestions to cover. `
      + `baseUrl=${baseUrl}, siteId=${siteId}`);
  } else {
    toCover.forEach((s) => {
      s.setData({
        ...s.getData(),
        coveredByDomainWide: domainWideSuggestionId,
      });
      s.setUpdatedBy('system');
    });
    log.info(`${LOG_PREFIX} All domain deployed: marking ${urlSuggestionsToCover.length} `
      + `per-URL and ${pathSuggestionsToCover.length} path suggestions as coveredByDomainWide. `
      + `baseUrl=${baseUrl}, siteId=${siteId}`);
  }
  return toCover;
}

/**
 * Remove branch: any suggestion currently `coveredByDomainWide` and confirmed NOT deployed
 * this run has the flag cleared — no grace period, any status.
 * @param {Array} suggestions - All suggestions on the opportunity
 * @param {Set<string>} notDeployedKeys - Identity keys confirmed not deployed this run
 * @returns {Array} Suggestions mutated (and needing save)
 */
function computeSuggestionsToClear(suggestions, notDeployedKeys) {
  const toClear = suggestions.filter((s) => {
    const data = s.getData();
    return !!data?.coveredByDomainWide
      && isIndividualUrlSuggestionData(data)
      && notDeployedKeys.has(normalizePathnameWithQuery(data.url));
  });
  toClear.forEach((s) => {
    // eslint-disable-next-line no-unused-vars
    const { coveredByDomainWide, ...rest } = s.getData();
    s.setData(rest);
    s.setUpdatedBy('system');
  });
  return toClear;
}

/**
 * Reconciles `coveredByDomainWide` against this run's confirmed edge state (LLMO-7052).
 * One fetch, one save. Save failures are logged and swallowed — non-fatal, doesn't fail the
 * audit run.
 * @param {Object|null} opportunity - Opportunity entity (no-op if null)
 * @param {Object} context - Audit context (dataAccess, log, site)
 * @param {Array} successfulComparisons - This run's non-error comparison results
 * @returns {Promise<void>}
 */
export async function syncCoveredByDomainWide(opportunity, context, successfulComparisons) {
  const { dataAccess, log, site } = context;
  const SuggestionDA = dataAccess?.Suggestion;
  if (!opportunity) {
    return;
  }

  const baseUrl = site?.getBaseURL?.() || '';
  const siteId = site?.getId?.() || '';

  const suggestions = await opportunity.getSuggestions();

  const domainWideSuggestion = suggestions.find(isDeployedDomainWideSuggestion) ?? null;
  log.info(`${LOG_PREFIX} syncCoveredByDomainWide: isAllDomainDeployedAtEdge=`
    + `${!!domainWideSuggestion}, baseUrl=${baseUrl}`);

  const { deployedAtEdgeKeys, notDeployedKeys } = partitionComparisonResults(successfulComparisons);

  const toCover = computeSuggestionsToCover(suggestions, domainWideSuggestion, deployedAtEdgeKeys, {
    log, baseUrl, siteId,
  });
  const toClear = computeSuggestionsToClear(suggestions, notDeployedKeys);

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
