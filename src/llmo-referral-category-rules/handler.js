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

import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { generateReferralCategoryRules } from '../cdn-logs-report/patterns/patterns-uploader.js';

/**
 * Standalone per-site audit that (re)generates a site's shared referral category
 * rules when it has none yet (create-if-missing). It runs off the DB corpus
 * (`rpc_referral_traffic_top_urls`, which unions all referral sources), so it covers
 * every site with referral traffic — not just optel. Scheduled to fan out weekly
 * across referral sites, this is the "sweeper" that closes the rule-gen gap for
 * cdn-only and DRS-only sites (LLMO-6257 P2, Fix A).
 *
 * @param {string} auditUrl - resolved site URL (noop-resolved; unused by rule-gen).
 * @param {object} context - audit context (log, dataAccess, env, ...).
 * @param {object} site - the site being processed.
 * @returns {Promise<{auditResult: object, fullAuditRef: string}>}
 */
export async function referralCategoryRulesRunner(auditUrl, context, site) {
  const { log } = context;
  const siteId = site.getId();

  try {
    const generated = await generateReferralCategoryRules({ site, context });
    log.info(`[llmo-referral-category-rules] site ${siteId}: rule generation ran, generated=${generated}`);
    return { auditResult: { generated }, fullAuditRef: auditUrl };
  } catch (err) {
    // Return (don't throw) so a per-site failure doesn't trigger SQS retries that
    // would re-invoke the LLM; the outcome is recorded on the audit and logged.
    log.warn(`[llmo-referral-category-rules] rule generation failed for site ${siteId}: ${err.message}`);
    return { auditResult: { generated: false, error: err.message }, fullAuditRef: auditUrl };
  }
}

export default new AuditBuilder()
  .withRunner(referralCategoryRulesRunner)
  .withUrlResolver(noopUrlResolver)
  .build();
