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
import { getImsOrgId, syncSuggestionsWithPublishDetection } from '../utils/data-access.js';
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
 * Builds a terminal DEPLOYED FixEntity payload for a rescan-confirmed vuln fix. Used
 * only as a fallback when no PR-open PENDING FixEntity is found to promote (see
 * {@link promoteVulnFixEntities}), so a suggestion is never flipped to FIXED without a
 * backing FixEntity. changeDetails is the reader-tolerant v1 freeform shape.
 *
 * @param {Object} suggestion - The confirmed-fixed suggestion.
 * @param {Object} opportunity - The vulnerabilities opportunity.
 * @param {Object} site - The site (for delivery-type provenance).
 * @returns {Object} A FixEntity payload with status DEPLOYED.
 */
export function buildVulnFixEntityPayload(suggestion, opportunity, site) {
  const data = suggestion.getData();
  return {
    opportunityId: opportunity.getId(),
    type: 'CODE_CHANGE',
    status: FixEntityDataAccess.STATUSES.DEPLOYED,
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
 * Resolves FixEntities for rescan-confirmed vuln fixes by promoting each suggestion's
 * existing PR-open PENDING FixEntity to DEPLOYED in place — this preserves the PR-url
 * provenance and avoids a second entity per fix. A suggestion with no PENDING FixEntity
 * to promote (edge case) gets a fresh DEPLOYED entity instead, so status never outruns
 * the FixEntity. Passed as syncSuggestionsWithPublishDetection's resolveFixEntities
 * hook; a throw leaves the suggestions unchanged for the next audit to retry.
 *
 * Idempotent on retry: reconcile persists FixEntities before flipping suggestion status
 * and, on any later failure, leaves the suggestion IN_PROGRESS for the next audit to
 * retry. A suggestion already backed by a DEPLOYED FixEntity is therefore skipped here,
 * so a partially-failed prior run (entity deployed, suggestion not yet FIXED) never
 * mints a duplicate DEPLOYED entity. A single FixEntity backing several suggestions is
 * likewise promoted at most once.
 *
 * @param {Array} fixedSuggestions - Suggestions confirmed fixed by the rescan.
 * @param {Object} opportunity - The vulnerabilities opportunity.
 * @param {Object} context - The audit context (provides dataAccess + site).
 * @returns {Promise<void>}
 */
export async function promoteVulnFixEntities(fixedSuggestions, opportunity, context) {
  const { dataAccess, site } = context;
  const { FixEntity } = dataAccess;

  const fixes = await FixEntity.getAllFixesWithSuggestionsByOpportunityId(opportunity.getId());
  // Index each suggestion's promotable PENDING FixEntity, and separately record which
  // suggestions already carry a DEPLOYED FixEntity (resolved on a prior, partially-failed
  // run) so the retry can skip them instead of creating a duplicate.
  const pendingBySuggestionId = new Map();
  const deployedSuggestionIds = new Set();
  for (const { fixEntity, suggestions: linked } of fixes) {
    const status = fixEntity.getStatus();
    for (const linkedSuggestion of linked) {
      if (status === FixEntityDataAccess.STATUSES.PENDING) {
        pendingBySuggestionId.set(linkedSuggestion.getId(), fixEntity);
      } else if (status === FixEntityDataAccess.STATUSES.DEPLOYED) {
        deployedSuggestionIds.add(linkedSuggestion.getId());
      }
    }
  }

  const toPromote = [];
  const toCreate = [];
  const promotedFixEntityIds = new Set();
  // Skip suggestions already backed by a DEPLOYED FixEntity — idempotent on next-audit retry.
  const unresolved = fixedSuggestions.filter((s) => !deployedSuggestionIds.has(s.getId()));
  for (const suggestion of unresolved) {
    const pending = pendingBySuggestionId.get(suggestion.getId());
    if (pending) {
      // One FixEntity (PR) can back several suggestions; promote it at most once so the
      // same entity is never handed to saveMany twice.
      if (!promotedFixEntityIds.has(pending.getId())) {
        promotedFixEntityIds.add(pending.getId());
        pending.setStatus(FixEntityDataAccess.STATUSES.DEPLOYED);
        // Durable "verified" marker (§10): stamp the deploy timestamp on every promotion.
        pending.setDeployedAt(new Date().toISOString());
        toPromote.push(pending);
      }
    } else {
      toCreate.push(buildVulnFixEntityPayload(suggestion, opportunity, site));
    }
  }

  if (toPromote.length > 0) {
    await FixEntity.saveMany(toPromote);
  }
  if (toCreate.length > 0) {
    await opportunity.addFixEntities(toCreate);
  }
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
 * Reconciles already-`FIXED` vuln suggestions against the current scan, keeping the
 * (Suggestion, FixEntity) pair consistent (PHASES.md §10). The base rescan-confirmation
 * sync only touches IN_PROGRESS/NEW suggestions; this pass owns the FIXED ones, joining
 * each to its active (PENDING/DEPLOYED) fix so the reopen decision is FixEntity-aware:
 *
 * - FIXED + PENDING, vuln gone     → asserted fix confirmed: promote PENDING → DEPLOYED
 *   (+ stamp deployedAt), keep FIXED (§10.2).
 * - FIXED + DEPLOYED, vuln back    → regression: reopen (NEW / PENDING_VALIDATION on paid)
 *   and roll the fix DEPLOYED → ROLLED_BACK (§10.3).
 * - FIXED + PENDING, vuln present, fix fresh → wait (§10.4), no change.
 * - FIXED + PENDING, vuln present, fix stale → reopen and fail the abandoned fix
 *   PENDING → FAILED (§10.5).
 *
 * Fail-safe: any error fetching the fix entities skips the whole pass for this run rather
 * than reopen/promote against incomplete data. Reopened suggestions are persisted before
 * the fix-entity transitions, so a reopen is never lost to a trailing fix-save failure.
 *
 * @param {Object} opportunity - The vulnerabilities opportunity.
 * @param {Array} newData - Canonical data for currently-reported vulns ([] on all-clear).
 * @param {Object} context - The audit context (provides dataAccess + site).
 * @param {Object} log - Logger.
 * @returns {Promise<void>}
 */
export async function reconcileFixedVulnSuggestions(opportunity, newData, context, log) {
  const { dataAccess, site } = context;
  const { FixEntity, Suggestion } = dataAccess;

  const suggestions = await opportunity.getSuggestions();
  const fixedSuggestions = suggestions.filter(
    (s) => s.getStatus() === SuggestionDataAccess.STATUSES.FIXED,
  );
  if (fixedSuggestions.length === 0) {
    return;
  }

  let fixes;
  try {
    fixes = await FixEntity.getAllFixesWithSuggestionsByOpportunityId(opportunity.getId());
  } catch (e) {
    log.warn(`[${AUDIT_TYPE}] failed to fetch fix entities for opportunity ${opportunity.getId()}; skipping FIXED reconcile this run: ${e.message}`);
    return;
  }

  // Join each suggestion to its active fix. A suggestion can carry historical fixes; only
  // PENDING (asserted) and DEPLOYED (verified) drive the decisions below.
  const pendingBySuggestionId = new Map();
  const deployedBySuggestionId = new Map();
  for (const { fixEntity, suggestions: linked } of fixes) {
    const status = fixEntity.getStatus();
    for (const linkedSuggestion of linked) {
      if (status === FixEntityDataAccess.STATUSES.PENDING) {
        pendingBySuggestionId.set(linkedSuggestion.getId(), fixEntity);
      } else if (status === FixEntityDataAccess.STATUSES.DEPLOYED) {
        deployedBySuggestionId.set(linkedSuggestion.getId(), fixEntity);
      }
    }
  }

  const presentKeys = new Set(newData.map(buildKey));
  const reopenStatus = reopenStatusForSite(site);

  const suggestionsToSave = [];
  const fixesToSave = [];
  for (const suggestion of fixedSuggestions) {
    const suggestionId = suggestion.getId();
    const present = presentKeys.has(buildKey(suggestion.getData()));
    const deployed = deployedBySuggestionId.get(suggestionId);
    const pending = pendingBySuggestionId.get(suggestionId);

    if (!present) {
      // Vuln gone. A DEPLOYED fix is already the correct terminal state; a still-PENDING
      // asserted fix is now scan-confirmed → promote it, keeping the suggestion FIXED.
      if (!deployed && pending) {
        pending.setStatus(FixEntityDataAccess.STATUSES.DEPLOYED);
        pending.setDeployedAt(new Date().toISOString());
        fixesToSave.push(pending);
      }
    } else if (deployed) {
      // Regression: a verified-fixed vuln reappeared → reopen + roll the fix back.
      suggestion.setStatus(reopenStatus);
      suggestion.setUpdatedBy('system');
      suggestionsToSave.push(suggestion);
      deployed.setStatus(FixEntityDataAccess.STATUSES.ROLLED_BACK);
      fixesToSave.push(deployed);
    } else if (pending && isAssertedFixStale(pending)) {
      // Asserted fix never confirmed past the staleness window while the vuln persists →
      // reopen + fail the abandoned fix.
      suggestion.setStatus(reopenStatus);
      suggestion.setUpdatedBy('system');
      suggestionsToSave.push(suggestion);
      pending.setStatus(FixEntityDataAccess.STATUSES.FAILED);
      fixesToSave.push(pending);
    }
    // else: present + fresh PENDING (wait) or present + no active fix → no change.
  }

  // Persist reopens first so a trailing fix-save failure can't strand a reopened
  // suggestion in a stuck FIXED state on the next audit.
  if (suggestionsToSave.length > 0) {
    await Suggestion.saveMany(suggestionsToSave);
  }
  if (fixesToSave.length > 0) {
    await FixEntity.saveMany(fixesToSave);
  }
}

/**
 * Runs the vulns suggestion sync with rescan-confirmation semantics (PHASES.md Phase 2),
 * shared by the normal (vulns-present) path and the all-clear (empty newData) path:
 * a disappeared autofixed (IN_PROGRESS) suggestion becomes FIXED with its PENDING
 * FixEntity promoted to DEPLOYED (§D3/§D4); a disappeared NEW suggestion becomes
 * OUTDATED (§D2). The publish step is skipped — 'security-vulnerabilities' is an
 * author-only opportunity type, so DEPLOYED is terminal (§T2.5).
 *
 * @param {Object} opportunity - The vulnerabilities opportunity.
 * @param {Array} newData - Canonical data for currently-reported vulns ([] on all-clear).
 * @param {Object} context - The audit context (provides dataAccess + site).
 * @param {Object} log - Logger.
 * @returns {Promise<void>}
 */
async function syncVulnSuggestions(opportunity, newData, context, log) {
  await syncSuggestionsWithPublishDetection({
    opportunity,
    newData,
    context,
    buildKey,
    mapNewSuggestion: (entry) => mapVulnerabilityToSuggestion(opportunity, entry),
    log,
    isReconcileCandidate: (s) => s.getStatus() === SuggestionDataAccess.STATUSES.IN_PROGRESS,
    // Confirmation is disappearance from the deployed-env rescan itself: a candidate that
    // reached this point (an IN_PROGRESS autofix, per isReconcileCandidate above) no longer
    // appears in the scan, which IS the fix confirmation — there is no per-suggestion AI
    // check to run. Returning true is that confirmation, not a stub.
    isIssueFixedWithAISuggestion: () => true,
    // reconcileDisappearedSuggestions invokes this hook as (fixedSuggestions, opp, isAuthorOnly).
    // Vulns substitutes the closure's `context` (which the hook does not supply) for that third
    // arg and drops isAuthorOnly: 'security-vulnerabilities' is author-only, so DEPLOYED is
    // terminal and the flag would never branch anything here.
    resolveFixEntities:
        (fixedSuggestions, opp) => promoteVulnFixEntities(fixedSuggestions, opp, context),
  });

  // §10: the base sync above only moves IN_PROGRESS/NEW suggestions. Now reconcile the
  // already-FIXED ones against this same scan — promote asserted fixes whose vuln is gone,
  // and reopen regressions / stale-unconfirmed asserts whose vuln is still present.
  await reconcileFixedVulnSuggestions(opportunity, newData, context, log);
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
