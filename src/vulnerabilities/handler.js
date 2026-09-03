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

import {
  Audit, Opportunity as Oppty, Suggestion as SuggestionDataAccess, FixEntity as FixEntityDataAccess,
} from '@adobe/spacecat-shared-data-access';
import {
  DELIVERY_TYPES, hasText, isNonEmptyArray, tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';
import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData, createOpportunityProps } from './opportunity-data-mapper.js';
import { getImsOrgId, syncSuggestions } from '../utils/data-access.js';
import { mapVulnerabilityToSuggestion, toSuggestionData } from './suggestion-data-mapper.js';
import { noopUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const INTERVAL = 1; // days
const AUDIT_TYPE = Audit.AUDIT_TYPES.SECURITY_VULNERABILITIES;

/**
 * Fetches vulnerability report for a given AEM Cloud Service site from the starfish API.
 *
 * @param {string} baseURL - The base URL of the site
 * @param {object} context - The context object of the audit
 * @param {object} site - The site object containing delivery configuration and details.
 * @return {Promise<VulnerabilityReport>} A promise that resolves to the vulnerability report data.
 */
export async function fetchVulnerabilityReport(baseURL, context, site) {
  const { log, env, dataAccess } = context;

  // Retrieve site details
  const imsOrg = await getImsOrgId(site, dataAccess, log);
  if (!hasText(imsOrg)) {
    throw new Error('Missing IMS org');
  } else if (imsOrg === 'default') {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] site is configured with default IMS org`);
  }
  const { programId, environmentId } = site.getDeliveryConfig();
  if (!hasText(programId) || !hasText(environmentId)) {
    throw new Error('Invalid delivery config for AEM_CS');
  }

  // Get service access-token
  let token;
  try {
    const imsContext = {
      log,
      env: {
        IMS_HOST: env.IMS_HOST,
        IMS_CLIENT_ID: env.IMS_CLIENT_ID,
        IMS_CLIENT_CODE: env.IMS_CLIENT_CODE,
        IMS_CLIENT_SECRET: env.IMS_CLIENT_SECRET,
      },
    };
    const imsClient = ImsClient.createFrom(imsContext);
    token = await imsClient.getServiceAccessToken();
  } catch (e) {
    throw new Error(`Failed to retrieve IMS token: ${e.message}`);
  }

  // Fetch vulnerability report
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'x-api-key': env.IMS_CLIENT_ID,
    'x-gw-ims-org-id': imsOrg,
  };
  let resp;
  try {
    resp = await fetch(`${env.STARFISH_API_BASE_URL}/reports/${programId}/${environmentId}/vulnerabilities`, { headers });
  } catch (error) {
    throw new Error('Failed to fetch vulnerability report');
  }
  if (resp.status === 404) {
    log.warn(`[${AUDIT_TYPE}] [Site: ${site.getId()}] vulnerability report not found`);
    return null;
  }
  if (!resp.ok) {
    const json = await resp.json();
    throw new Error(`Failed to fetch vulnerability report (${resp.status}): ${json?.error}`);
  }
  const json = await resp.json();
  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] successfully fetched vulnerability report`);
  return json.data;
}

/**
 * Perform an audit to check if the environment has vulnerable dependencies.
 *
 * @async
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function vulnerabilityAuditRunner(context) {
  const { finalUrl, site, log } = context;
  const baseURL = finalUrl;

  // This opportunity is only relevant for aem_cs delivery-type at the moment
  if (site.getDeliveryType() !== DELIVERY_TYPES.AEM_CS) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping vulnerability audit as site is of delivery type ${site.getDeliveryType()}`);
    return {
      auditResult: {
        finalUrl: baseURL,
        error: `Unsupported delivery type ${site.getDeliveryType()}`,
        success: false,
      },
      fullAuditRef: baseURL,
    };
  }

  try {
    const vulnerabilityReport = await fetchVulnerabilityReport(baseURL, context, site);
    if (!vulnerabilityReport) {
      const errorMessage = `[${AUDIT_TYPE}] [Site: ${site.getId()}] fetch successful, but report was empty / null`;
      log.warn(errorMessage);
      return {
        auditResult: {
          finalUrl: baseURL,
          error: errorMessage,
          success: false,
        },
        fullAuditRef: baseURL,
      };
    }

    const compCount = vulnerabilityReport.summary.totalComponents;
    const vulnCount = vulnerabilityReport.summary.totalVulnerabilities;

    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] identified: ${vulnCount} vulnerabilities in ${compCount} components`);

    return {
      auditResult: {
        finalUrl: baseURL,
        vulnerabilityReport,
        fullAuditRef: baseURL,
        auditContext: { interval: INTERVAL },
        success: true,
      },
      fullAuditRef: baseURL,
    };
  } catch (error) {
    const errorMessage = `[${AUDIT_TYPE}] [Site: ${site.getId()}] audit failed with error: ${error.message}`;
    log.error(errorMessage);
    return {
      auditResult: {
        finalUrl: baseURL,
        error: errorMessage,
        success: false,
      },
      fullAuditRef: baseURL,
    };
  }
}

export async function extractCodeBucket(context) {
  const { site } = context;
  const result = await vulnerabilityAuditRunner(context);

  // we explicitly do not fail here if the import worker failed,
  // but instead delegate that to the next step

  return {
    type: 'code',
    allowCache: false,
    siteId: site.getId(),
    auditResult: result.auditResult,
    fullAuditRef: result.fullAuditRef,
  };
}

/**
 * Builds a stable key for a suggestion's data used to match new audit data against
 * previously-stored suggestions. Both stored suggestion data and freshly-fetched audit
 * data (once run through toSuggestionData) share the same canonical shape
 * ({library, current_version, dependency_tree}), so buildKey only needs to support that
 * one shape. The key is "library@version" joined with each dependency-tree entry
 * (excluding "[root]" and stripped of its "@version" suffix — we don't key on
 * transitive parent versions, only on the vulnerable library's own version).
 *
 * @param {Object} data - Suggestion data in its canonical shape (see toSuggestionData).
 * @returns {string} - A stable key derived from library name/version and dependency tree.
 */
export const buildKey = ({
  library, current_version: currentVersion, dependency_tree: tree,
}) => {
  const parts = (tree || [])
    .filter((entry) => entry !== '[root]')
    .map((entry) => entry.replace(/@[^@]*$/, ''));
  return [`${library}@${currentVersion}`, ...parts].join('-');
};

export const extractCodeInfo = (data) => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  // Navigate the nested structure
  const { importResults } = data;
  if (!Array.isArray(importResults) || importResults.length === 0) {
    return null;
  }

  const firstImportResult = importResults[0];
  if (!firstImportResult || typeof firstImportResult !== 'object') {
    return null;
  }

  const results = firstImportResult.result;
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const codeInfo = results[0];
  return (
    codeInfo
    && typeof codeInfo === 'object'
    && typeof codeInfo.codeBucket === 'string'
    && codeInfo.codeBucket.trim() !== ''
    && typeof codeInfo.codePath === 'string'
    && codeInfo.codePath.trim() !== ''
  ) ? codeInfo : null;
};

/**
 * Builds a DEPLOYED CODE_CHANGE FixEntity payload for a customer self-fix — an open
 * finding that disappeared from the scan with no backing FixEntity, i.e. the customer
 * upgraded the dependency themselves. Stamped with the CUSTOMER_SELF_FIX origin so it is
 * distinguishable from ASO/automated fixes (which carry origin `spacecat`). changeDetails
 * is the reader-tolerant v1 freeform shape.
 *
 * @param {Object} suggestion - The self-fixed suggestion.
 * @param {Object} opportunity - The vulnerabilities opportunity.
 * @param {Object} site - The site (for delivery-type provenance).
 * @returns {Object} A FixEntity payload: status DEPLOYED, origin CUSTOMER_SELF_FIX.
 */
export function buildVulnFixEntityPayload(suggestion, opportunity, site) {
  const data = suggestion.getData();
  return {
    opportunityId: opportunity.getId(),
    type: 'CODE_CHANGE',
    status: FixEntityDataAccess.STATUSES.DEPLOYED,
    origin: FixEntityDataAccess.ORIGINS.CUSTOMER_SELF_FIX,
    executedAt: new Date().toISOString(),
    deployedAt: new Date().toISOString(),
    changeDetails: {
      system: site.getDeliveryType(),
      library: data.library,
      oldValue: data.current_version,
      updatedValue: data.recommended_version,
      dependencyTree: data.dependency_tree,
    },
    suggestions: [suggestion.getId()],
  };
}

/**
 * Staleness window for an asserted-but-unconfirmed fix (§10.5). When a FIXED suggestion's
 * fix is still PENDING (never scan-confirmed) and the vuln keeps reappearing past this
 * window (measured from the fix's executedAt), the assertion is treated as stale and the
 * suggestion is reopened so an unverified claim can't mask a live vuln forever.
 */
const STALE_ASSERTED_FIX_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Reopen target for a re-detected or aged-out FIXED suggestion: PENDING_VALIDATION on
 * validation-required (paid) sites, else NEW — mirrors the regression rule in
 * data-access.js `defaultMergeStatusFunction`.
 * @param {Object} site - The site.
 * @returns {string} NEW or PENDING_VALIDATION.
 */
const reopenStatusForSite = (site) => (
  site.requiresValidation
    ? SuggestionDataAccess.STATUSES.PENDING_VALIDATION
    : SuggestionDataAccess.STATUSES.NEW
);

/**
 * True when an asserted (PENDING) fix has gone unconfirmed past the staleness window.
 * @param {Object} fix - The PENDING FixEntity.
 * @returns {boolean}
 */
const isAssertedFixStale = (fix) => {
  const executedAt = fix.getExecutedAt();
  return Boolean(executedAt)
    && (Date.now() - new Date(executedAt).getTime() > STALE_ASSERTED_FIX_MS);
};

/**
 * Reconciles vuln suggestions against the current scan, owning EVERY status transition so
 * the (Suggestion, FixEntity) pair stays consistent (spec:
 * docs/specs/2026-09-02-security-vulnerabilities-fixed-lifecycle-reconcile.md). Joins each
 * suggestion to its FixEntity so the decision is FixEntity-aware:
 *
 * - open (NEW/PENDING_VALIDATION) + no fix, vuln gone → customer self-fix: suggestion
 *   FIXED + create a DEPLOYED FixEntity stamped origin CUSTOMER_SELF_FIX.
 * - FIXED + PENDING, vuln gone     → asserted fix confirmed: promote PENDING → DEPLOYED
 *   (+ stamp deployedAt), keep FIXED.
 * - FIXED + DEPLOYED, vuln back    → regression: archive the old suggestion to OUTDATED,
 *   open a fresh NEW/PENDING_VALIDATION suggestion, roll the fix DEPLOYED → ROLLED_BACK.
 * - FIXED + PENDING, vuln present, fix fresh → wait, no change.
 * - FIXED + PENDING, vuln present, fix stale → archive old to OUTDATED, open a fresh
 *   suggestion, fail the fix PENDING → FAILED.
 *
 * Runs BEFORE the base syncSuggestions (which then only creates brand-new findings and
 * refreshes present ones). Regression/stale never mutate the FIXED record in place — the
 * old record is archived and a fresh finding opened — so history stays clean.
 *
 * Safety: any error fetching the fix entities skips the whole pass for this run rather
 * than acting on incomplete data; a self-fix FixEntity is created BEFORE its suggestion is
 * flipped FIXED (never FIXED without a backing fix); suggestion writes are persisted before
 * the fix-entity transitions so a trailing fix-save failure can't strand a reopen.
 *
 * @param {Object} opportunity - The vulnerabilities opportunity.
 * @param {Array} newData - Canonical data for currently-reported vulns ([] on all-clear).
 * @param {Object} context - The audit context (provides dataAccess + site).
 * @param {Object} log - Logger.
 * @returns {Promise<void>}
 */
export async function reconcileVulnSuggestions(opportunity, newData, context, log) {
  const { dataAccess, site } = context;
  const { FixEntity, Suggestion } = dataAccess;

  const presentKeys = new Set(newData.map(buildKey));
  const newDataByKey = new Map(newData.map((d) => [buildKey(d), d]));
  const suggestions = await opportunity.getSuggestions();

  // Candidates needing FixEntity-aware reconciliation: every FIXED suggestion, plus any
  // open finding (NEW/PENDING_VALIDATION) that DISAPPEARED from the scan (a self-fix).
  // Present open findings and every other status are left to the base sync.
  const isOpen = (s) => s.getStatus() === SuggestionDataAccess.STATUSES.NEW
    || s.getStatus() === SuggestionDataAccess.STATUSES.PENDING_VALIDATION;
  const fixedSuggestions = suggestions.filter(
    (s) => s.getStatus() === SuggestionDataAccess.STATUSES.FIXED,
  );
  const selfFixedSuggestions = suggestions.filter(
    (s) => isOpen(s) && !presentKeys.has(buildKey(s.getData())),
  );
  if (fixedSuggestions.length === 0 && selfFixedSuggestions.length === 0) {
    return;
  }

  let fixes;
  try {
    fixes = await FixEntity.getAllFixesWithSuggestionsByOpportunityId(opportunity.getId());
  } catch (e) {
    log.warn(`[${AUDIT_TYPE}] failed to fetch fix entities for opportunity ${opportunity.getId()}; skipping vuln reconcile this run: ${e.message}`);
    return;
  }

  // Join each suggestion to its fixes. PENDING (asserted) and DEPLOYED (verified) drive the
  // FIXED-side decisions; the linked-ids set drives self-fix detection ("no fix at all").
  const pendingBySuggestionId = new Map();
  const deployedBySuggestionId = new Map();
  const linkedFixSuggestionIds = new Set();
  for (const { fixEntity, suggestions: linked } of fixes) {
    const status = fixEntity.getStatus();
    for (const linkedSuggestion of linked) {
      linkedFixSuggestionIds.add(linkedSuggestion.getId());
      if (status === FixEntityDataAccess.STATUSES.PENDING) {
        pendingBySuggestionId.set(linkedSuggestion.getId(), fixEntity);
      } else if (status === FixEntityDataAccess.STATUSES.DEPLOYED) {
        deployedBySuggestionId.set(linkedSuggestion.getId(), fixEntity);
      }
    }
  }

  const reopenStatus = reopenStatusForSite(site);
  const suggestionsToSave = []; // existing suggestions whose status changed
  const newSuggestionPayloads = []; // fresh findings opened for regressions / stale reopens
  const newFixPayloads = []; // self-fix DEPLOYED FixEntities to create
  const fixesToSave = []; // existing fixes promoted / rolled-back / failed

  // Regression/stale reopen: archive the old FIXED record to OUTDATED and open a fresh
  // finding for the still-present vuln, rather than mutating the FIXED record in place.
  const archiveAndReopen = (suggestion) => {
    suggestion.setStatus(SuggestionDataAccess.STATUSES.OUTDATED);
    suggestion.setUpdatedBy('system');
    suggestionsToSave.push(suggestion);
    const entry = newDataByKey.get(buildKey(suggestion.getData()));
    newSuggestionPayloads.push({
      ...mapVulnerabilityToSuggestion(opportunity, entry),
      status: reopenStatus,
    });
  };

  for (const suggestion of fixedSuggestions) {
    const id = suggestion.getId();
    const present = presentKeys.has(buildKey(suggestion.getData()));
    const deployed = deployedBySuggestionId.get(id);
    const pending = pendingBySuggestionId.get(id);

    if (!present) {
      // Vuln gone. A still-PENDING asserted fix is now scan-confirmed → promote it; a
      // DEPLOYED fix is already the correct terminal state.
      if (!deployed && pending) {
        pending.setStatus(FixEntityDataAccess.STATUSES.DEPLOYED);
        pending.setDeployedAt(new Date().toISOString());
        fixesToSave.push(pending);
      }
    } else if (deployed) {
      // Regression: a verified-fixed vuln reappeared → archive + reopen, roll the fix back.
      archiveAndReopen(suggestion);
      deployed.setStatus(FixEntityDataAccess.STATUSES.ROLLED_BACK);
      fixesToSave.push(deployed);
    } else if (pending && isAssertedFixStale(pending)) {
      // Asserted fix never confirmed past the staleness window → archive + reopen, fail it.
      archiveAndReopen(suggestion);
      pending.setStatus(FixEntityDataAccess.STATUSES.FAILED);
      fixesToSave.push(pending);
    }
    // else: present + fresh PENDING (wait) or present + no active fix → no change.
  }

  for (const suggestion of selfFixedSuggestions) {
    const id = suggestion.getId();
    const pending = pendingBySuggestionId.get(id);
    suggestion.setStatus(SuggestionDataAccess.STATUSES.FIXED);
    suggestion.setUpdatedBy('system');
    suggestionsToSave.push(suggestion);
    if (pending) {
      // Edge: the open finding already had a PENDING fix → promote it, don't create one.
      pending.setStatus(FixEntityDataAccess.STATUSES.DEPLOYED);
      pending.setDeployedAt(new Date().toISOString());
      fixesToSave.push(pending);
    } else if (!linkedFixSuggestionIds.has(id)) {
      // No fix at all → the customer fixed it themselves; synthesize a DEPLOYED FixEntity
      // stamped with the customer-self-fix origin.
      newFixPayloads.push(buildVulnFixEntityPayload(suggestion, opportunity, site));
    }
    // else: an existing non-PENDING fix already backs it → just mark FIXED (idempotent).
  }

  // Create self-fix FixEntities BEFORE flipping their suggestions FIXED, so a FIXED is never
  // left without a backing fix; on failure leave everything for the next audit to retry.
  if (newFixPayloads.length > 0) {
    try {
      await opportunity.addFixEntities(newFixPayloads);
    } catch (e) {
      log.warn(`[${AUDIT_TYPE}] failed to create self-fix fix entities for opportunity ${opportunity.getId()}; skipping vuln reconcile this run: ${e.message}`);
      return;
    }
  }
  // Persist suggestion status changes (incl. archived OUTDATED) and the fresh findings
  // BEFORE the fix-entity transitions, so a trailing fix-save failure can't strand a reopen.
  if (suggestionsToSave.length > 0) {
    await Suggestion.saveMany(suggestionsToSave);
  }
  if (newSuggestionPayloads.length > 0) {
    await opportunity.addSuggestions(newSuggestionPayloads);
  }
  if (fixesToSave.length > 0) {
    await FixEntity.saveMany(fixesToSave);
  }
}

/**
 * Runs the vulns suggestion sync for a scan, shared by the normal (vulns-present) path and
 * the all-clear (empty newData) path. Two steps, reconcile first:
 *
 * 1. reconcileVulnSuggestions owns EVERY status transition (self-fix, rescan-confirm,
 *    regression, stale) — see its doc for the decision table.
 * 2. syncSuggestions then only creates brand-new findings and refreshes data on present
 *    ones. mergeStatusFunction returns null so it makes NO status decisions: the default
 *    merge would flip an archived OUTDATED record whose vuln is still present back to NEW
 *    (data-access.js defaultMergeStatusFunction), resurrecting the record reconcile just
 *    archived in a regression. Its OUTDATED sweep is a no-op because reconcile has already
 *    transitioned every disappeared open finding.
 *
 * @param {Object} opportunity - The vulnerabilities opportunity.
 * @param {Array} newData - Canonical data for currently-reported vulns ([] on all-clear).
 * @param {Object} context - The audit context (provides dataAccess + site).
 * @param {Object} log - Logger.
 * @returns {Promise<void>}
 */
async function syncVulnSuggestions(opportunity, newData, context, log) {
  await reconcileVulnSuggestions(opportunity, newData, context, log);

  await syncSuggestions({
    opportunity,
    newData,
    context,
    buildKey,
    mapNewSuggestion: (entry) => mapVulnerabilityToSuggestion(opportunity, entry),
    mergeStatusFunction: () => null,
    log,
  });
}

/**
 * Creates opportunities and syncs suggestions.
 *
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @returns {Object} The audit data unchanged (opportunities created as side effect).
 */
export const opportunityAndSuggestionsStep = async (context) => {
  const {
    site, data, audit, log, sqs, env, finalUrl, dataAccess,
  } = context;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    throw new Error('Audit failed, skipping suggestions generation');
  }

  const { vulnerabilityReport } = auditResult;

  // Drop components whose active vulnerabilities list is null/empty — every CVE on them
  // has been ignored and there is nothing the customer can act on. Routing the all-ignored
  // case through the "no vulnerabilities" branch below also resolves any stale opportunity.
  const actionableComponents = isNonEmptyArray(vulnerabilityReport.vulnerableComponents)
    ? vulnerabilityReport.vulnerableComponents.filter((c) => isNonEmptyArray(c.vulnerabilities))
    : [];

  if (!isNonEmptyArray(actionableComponents)) {
    // No vulnerabilities found
    // Fetch opportunity
    let opportunity;
    try {
      const opportunities = await site.getOpportunitiesByStatus(Oppty.STATUSES.NEW);
      opportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);
    } catch (e) {
      log.error(`Fetching opportunities for siteId ${site.getId()} failed with error: ${e.message}`);
      throw new Error(`Failed to fetch opportunities for siteId ${site.getId()}: ${e.message}`);
    }

    if (opportunity) {
      // No vulnerabilities found. Route through the same rescan-confirmation sync with
      // empty data so every existing suggestion "disappears": autofixed (IN_PROGRESS)
      // ones become FIXED (their PENDING FixEntity promoted to DEPLOYED) and the rest
      // OUTDATED; already-FIXED are preserved by the protected-statuses guard (§T3.2).
      // Then resolve the opportunity.
      log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no vulnerabilities found, but found opportunity; resolving via sync`);
      await syncVulnSuggestions(opportunity, [], context, log);
      await opportunity.setStatus(Oppty.STATUSES.RESOLVED);
      opportunity.setUpdatedBy('system');
      await opportunity.save();
    }

    return { status: 'complete' };
  }

  // Update opportunity
  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    AUDIT_TYPE,
    createOpportunityProps(auditResult.vulnerabilityReport),
  );

  // Transform raw components into the canonical suggestion data shape before syncing,
  // so both existing and new suggestion data share the same shape and merge cleanly.
  const newData = actionableComponents.map(toSuggestionData);

  // Populate suggestions (rescan-confirmation semantics — see syncVulnSuggestions).
  await syncVulnSuggestions(opportunity, newData, context, log);

  const codeInfo = extractCodeInfo(data);
  if (!codeInfo) {
    log.info(
      `[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping code generation with starfish-auto-code, because
      import worker could not get code.`,
    );
    return { status: 'complete' };
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_STARFISH_AUTO_CODE) {
    log.warn(
      `[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping code generation with starfish-auto-code, because
      QUEUE_SPACECAT_TO_STARFISH_AUTO_CODE is not configured.`,
    );
    return { status: 'complete' };
  }

  const refreshedOpportunity = await dataAccess.Opportunity.findById?.(opportunity.getId());
  const suggestions = await (refreshedOpportunity || opportunity).getSuggestions();
  const newSuggestions = suggestions.filter((s) => [
    SuggestionDataAccess.STATUSES.NEW,
    SuggestionDataAccess.STATUSES.PENDING_VALIDATION,
  ].includes(s.getStatus()));
  const suggestionIds = newSuggestions.map((s) => s.getId());
  const imsOrg = await getImsOrgId(site, dataAccess, log);
  const message = {
    type: 'codefix:security-vulnerabilities',
    siteId: site.getId(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      opportunityId: opportunity.getId(),
      suggestionIds,
      codeBucket: codeInfo.codeBucket,
      codePath: codeInfo.codePath,
      imsOrg,
    },
  };

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] sending message to starfish-auto-code for code fix generation: ${JSON.stringify(message)}`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_STARFISH_AUTO_CODE, message);
  return { status: 'complete' };
};

export default new AuditBuilder()
// Note the import worker MUST trigger the next step regardless if code repo is configured
  .withUrlResolver(noopUrlResolver)
  .addStep('import-from-starfish', extractCodeBucket, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('generate-suggestion-data', opportunityAndSuggestionsStep)
  .build();
