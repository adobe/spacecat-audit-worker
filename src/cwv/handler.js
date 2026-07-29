/*
 * Copyright 2024 Adobe. All rights reserved.
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
  Audit,
  Suggestion as SuggestionModel,
  Opportunity as OpportunityModel,
} from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { buildCWVAuditResult } from './cwv-audit-result.js';
import { syncOpportunitiesAndSuggestions } from './opportunity-sync.js';
import { processAutoSuggest } from './auto-suggest.js';
import { sendLowSuggestionCountAlert } from '../support/plg-suggestion-alert.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const CWV_BLACKBOARD_ENGINE = 'blackboard';

/**
 * A site's CWV opportunity is owned by the Mystique blackboard producer cascade — rather
 * than this legacy audit — when `deliveryConfig.cwvEngine === "blackboard"` (Spec 009-04 /
 * ADR-0022). Mirrors the `altTextEngine` / `formsA11yEngine` per-site engine switches.
 * Degrades to legacy on absent / null / any other value.
 * @param {Object} site - Site with a `getDeliveryConfig()` accessor.
 * @returns {boolean}
 */
export function isCwvBlackboardEngine(site) {
  return site.getDeliveryConfig?.()?.cwvEngine === CWV_BLACKBOARD_ENGINE;
}

/**
 * Bow-out cleanup for a site migrated to the blackboard engine: resolve the pre-existing
 * legacy `type:"cwv"` opportunity and outdate its still-live suggestions, so the flip does
 * not strand active legacy rows the customer can no longer act on. Customer-/system-touched
 * suggestion states (FIXED / SKIPPED / ERROR / already-OUTDATED) are preserved as history;
 * only NEW / IN_PROGRESS suggestions are outdated. Idempotent: no active NEW opportunity →
 * no-op (mirrors this audit's own `allBySiteIdAndStatus(..., NEW).find(type==='cwv')`
 * find-existing, and the resolve pattern in `src/csp/csp.js`).
 * @param {Object} context - Audit context (dataAccess, log).
 * @param {Object} site - Site being audited.
 */
export async function resolveLegacyCwvOpportunity(context, site) {
  const { dataAccess, log } = context;
  const { Opportunity, Suggestion } = dataAccess;
  const siteId = site.getId();

  const opportunities = await Opportunity.allBySiteIdAndStatus(
    siteId,
    OpportunityModel.STATUSES.NEW,
  );
  const opportunity = opportunities.find((o) => o.getType() === Audit.AUDIT_TYPES.CWV);
  if (!opportunity) {
    return;
  }

  await opportunity.setStatus(OpportunityModel.STATUSES.RESOLVED);
  await opportunity.save();

  const suggestions = await opportunity.getSuggestions();
  const liveSuggestions = suggestions.filter((s) => ![
    SuggestionModel.STATUSES.OUTDATED,
    SuggestionModel.STATUSES.FIXED,
    SuggestionModel.STATUSES.ERROR,
    SuggestionModel.STATUSES.SKIPPED,
  ].includes(s.getStatus()));
  if (liveSuggestions.length > 0) {
    await Suggestion.bulkUpdateStatus(liveSuggestions, SuggestionModel.STATUSES.OUTDATED);
  }

  log.info(`[audit-worker-cwv] siteId: ${siteId} | resolved legacy cwv opportunity ${opportunity.getId()} and outdated ${liveSuggestions.length} live suggestion(s) (cwvEngine=blackboard bow-out)`);
}

/**
 * Step 1: CWV Data Collection and Code Import
 * Builds CWV audit result and triggers code import.
 *
 * Legacy-source bow-out (Spec 009-04 / ADR-0022): for a `cwvEngine === "blackboard"` site
 * the Mystique blackboard cascade already owns detection + source materialization, so this
 * step skips the RUM/PSI collection and returns an empty audit result (nothing reads the
 * persisted `cwv` audit result — trend audits read RUM directly). It also resolves any
 * pre-existing legacy opportunity here (Step 1 always runs on the initial trigger, so the
 * resolve is not gated on the import-worker round-trip). The `import-worker` hop itself is
 * kept (its payload contract requires a valid `type`); to skip the audit entirely for a
 * migrated site, disable the `cwv` handler for it in `Configuration` (see the coexistence
 * contract in the Mystique migration design doc §9.4).
 *
 * @param {Object} context - Context object containing site, finalUrl, log, env
 *                           (with env.RUM_ADMIN_KEY)
 * @returns {Promise<Object>} Object containing auditResult, fullAuditRef (for persister),
 *                            and import worker parameters (type, siteId, allowCache)
 */
export async function collectCWVDataAndImportCode(context) {
  const { site, log } = context;
  const siteId = site.getId();

  if (isCwvBlackboardEngine(site)) {
    log.info(`[audit-worker-cwv] siteId: ${siteId} | Step 1: bowing out — deliveryConfig.cwvEngine=blackboard; resolving any legacy cwv opportunity and skipping RUM collection`);
    await resolveLegacyCwvOpportunity(context, site);
    return {
      // Nothing consumes the persisted cwv audit result (trends read RUM directly);
      // an empty result is correct for a bowed-out site.
      auditResult: { cwv: [] },
      fullAuditRef: context.finalUrl || site.getBaseURL(),
      // Import-worker payload contract requires a valid type; keep the hop (harmless for a
      // migrated site — the download is unused). Skipping it needs an import-worker-side
      // flag; the clean full-skip is the Configuration cwv handler-disable.
      type: 'code',
      siteId,
      allowCache: false,
    };
  }

  log.info(`[audit-worker-cwv] siteId: ${siteId} | Step 1: Collecting CWV data and triggering code import`);

  const { auditResult, fullAuditRef } = await buildCWVAuditResult(context);

  return {
    // These fields are required for the first step to persist audit result
    auditResult,
    fullAuditRef,
    // Trigger code import
    type: 'code',
    siteId,
    allowCache: false,
  };
}

/**
 * Step 2: Sync Opportunities and Suggestions
 * Creates opportunities and suggestions in SpaceCat and sends auto-suggest messages to Mystique
 * @param {Object} context - Context object containing site, audit, finalUrl, log, dataAccess,
 *                           sqs, env, s3Client
 * @returns {Promise<Object>} Status object with 'complete' status
 */
export async function syncOpportunityAndSuggestionsStep(context) {
  const { site, log, dataAccess } = context;
  const { Suggestion } = dataAccess;
  const siteId = site.getId();

  // Legacy-source bow-out (Spec 009-04 / ADR-0022). Defense-in-depth: Step 1 already bows
  // out + resolves for a blackboard-engine site, but if this step is reached it must NOT
  // create the shared type:"cwv" opportunity / CODE_CHANGE suggestion rows or send the
  // guidance:cwv message — otherwise the two flows write the same SpaceCat rows and collide
  // (the blackboard projector keys its parent on (type, scope_type='site', scope_id), so it
  // creates a *second* active cwv opportunity rather than reusing this null-scoped one). The
  // blackboard producer cascade owns detection→guidance→autofix and projects the
  // customer-facing suggestions itself.
  if (isCwvBlackboardEngine(site)) {
    log.info(`[audit-worker-cwv] siteId: ${siteId} | Step 2: bowing out — deliveryConfig.cwvEngine=blackboard, CWV opportunity is Mystique-owned; skipping opportunity/suggestion sync and auto-suggest`);
    return {
      status: 'complete',
    };
  }

  log.info(`[audit-worker-cwv] siteId: ${siteId} | Step 2: Syncing opportunities and suggestions`);

  const opportunity = await syncOpportunitiesAndSuggestions(context);
  await processAutoSuggest(context, opportunity, site);

  // Count all outstanding NEW suggestions after sync (includes unresolved issues from
  // prior runs). This represents what the PLG customer currently sees in their dashboard.
  // Resolved pages are marked OUTDATED by syncSuggestions and excluded from this count.
  const newSuggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionModel.STATUSES.NEW,
  );
  await sendLowSuggestionCountAlert(site, Audit.AUDIT_TYPES.CWV, newSuggestions.length, context);

  return {
    status: 'complete',
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('collectCWVDataAndImportCode', collectCWVDataAndImportCode, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('syncOpportunityAndSuggestions', syncOpportunityAndSuggestionsStep)
  .build();
