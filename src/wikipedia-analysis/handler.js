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

import { isValidUrl } from '@adobe/spacecat-shared-utils';

import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { resolveBrandForSite, applyBrandScope } from '../utils/brand-resolver.js';
import {
  createOffsiteLogger, withAuditPersistLog, errorField, AUDIT, PEER,
} from '../utils/offsite-logging.js';

// Long, unambiguous market suffixes. These are safe to strip even when fused
// directly to the brand word (e.g. "landroverusa" -> "landrover",
// "toyotaglobal" -> "toyota") because they almost never occur inside a real
// brand name.
const MARKET_SUFFIXES_RE = /(?:usa|global|international|worldwide)$/i;

// Two-letter country/region codes. These are ONLY stripped when they appear as a
// clearly delimited token (e.g. "walmart-uk" -> "walmart"). Stripping them when
// they are fused to the brand word corrupts legitimate names — "adobe" -> "ado",
// "garmin" -> "garm", "mercedes" -> "merced", "fiat" -> "fi", "linkedin" ->
// "linked" — so we require a separator immediately before the code. `name` is a
// single hostname segment (already split on '.'), so only -, _ can occur here.
const COUNTRY_CODE_SUFFIX_RE = /[-_](?:us|uk|eu|de|fr|es|it|nl|be|at|ch|au|ca|jp|kr|cn|br|mx|in|za)$/i;

const MULTI_PART_TLD_PREFIXES = new Set([
  'co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'mil',
  'bank', 'firm', 'gen', 'ind', 'res', 'nic',
]);

/**
 * Slack mrkdwn wraps URLs as `<https://…>` or `<https://…|link label>`.
 * Strips that wrapper so values from Slack commands match `isValidUrl`.
 * Also strips a single outer layer of `"…"` or `\"…\"` (e.g. JSON/shell quoting).
 *
 * We peel wrappers from the outside in (slice / pipe split), not with global
 * `.replace(/[<>"]/g, …)`: Slack links use `<url|label>` — the URL is only the
 * part before `|`; dropping every `<`/`>` would leave `url|label` and break
 * `isValidUrl`. Likewise we only strip matching outer quotes so a `"` or `\`
 * inside the URL (e.g. query) is not removed.
 *
 * @param {string} raw
 * @returns {string}
 */
function unwrapSlackMrkdwnLink(raw) {
  let s = raw.trim();
  const maxPasses = 6;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const before = s;

    if (s.length >= 2 && s.startsWith('<') && s.endsWith('>')) {
      s = s.slice(1, -1).trim();
      const pipeIdx = s.indexOf('|');
      if (pipeIdx !== -1) {
        s = s.slice(0, pipeIdx).trim();
      }
    }

    s = s.trim();
    if (s.length >= 4 && s.startsWith('\\"') && s.endsWith('\\"')) {
      s = s.slice(2, -2);
    } else if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      s = s.slice(1, -1);
    }

    s = s.trim();
    if (s === before) {
      break;
    }
  }
  return s.trim();
}

/**
 * Optional Wikipedia article URL from `message.data` (merged into RunnerAudit
 * `auditContext.messageData`).
 * `wikiUrl` wins over `wikipediaUrl` when both are set. Slack sends
 * `<https://…>` / `<https://…|label>`; those are normalized here. Invalid /
 * non-string values are ignored (see runner).
 *
 * Diagnostics go through the bound offsite logger (`olog`) so the Slack-supplied
 * `wikiUrl`/`wikipediaUrl` values are quoted/sanitized as `key=value` fields by
 * appendFields rather than interpolated raw into the message — a crafted value
 * (e.g. one containing a newline or a forged `key=value`) cannot split the line
 * or inject a second token.
 *
 * @param {object} [auditContext]
 * @param {object} [olog] bound offsite logger (see createOffsiteLogger)
 * @returns {{ url: string }|{ invalid: true, value: string }|undefined}
 */
function resolveWikipediaUrlOverride(auditContext, olog) {
  const md = auditContext?.messageData;
  if (!md) {
    olog?.debug('audit_orchestration_url_override_resolved', 'No messageData on audit context', { reason: 'no_message_data' });
    return undefined;
  }

  const wikiVal = md.wikiUrl;
  const wikipediaVal = md.wikipediaUrl;

  olog?.debug('audit_orchestration_url_override_resolved', 'Resolving Wikipedia URL override from messageData', {
    wikiUrl: wikiVal, wikipediaUrl: wikipediaVal,
  });

  const rawOverride = wikiVal || wikipediaVal;

  if (rawOverride === undefined || rawOverride === null || rawOverride === '') {
    olog?.debug('audit_orchestration_url_override_resolved', 'No usable wikiUrl/wikipediaUrl override', { reason: 'no_override_value' });
    return undefined;
  }

  if (typeof rawOverride !== 'string') {
    olog?.debug('audit_orchestration_url_override_resolved', 'Override rejected: expected a string value', {
      reason: 'non_string', valueType: typeof rawOverride,
    });
    return undefined;
  }

  const normalized = unwrapSlackMrkdwnLink(rawOverride);
  if (!normalized) {
    olog?.debug('audit_orchestration_url_override_resolved', 'Override rejected: empty after Slack/mrkdwn normalization', {
      reason: 'empty_after_normalize',
    });
    return undefined;
  }

  if (!isValidUrl(normalized)) {
    olog?.debug('audit_orchestration_url_override_resolved', 'Override rejected: not a valid URL', {
      reason: 'invalid_url', value: normalized,
    });
    return { invalid: true, value: normalized };
  }

  olog?.debug('audit_orchestration_url_override_resolved', 'Override accepted', { url: normalized });

  return { url: normalized };
}

/**
 * Wikipedia Analysis Audit Handler
 *
 * This audit triggers the Wikipedia Analysis workflow in Mystique to:
 * 1. Analyze the company's Wikipedia page
 * 2. Find and analyze competitor Wikipedia pages
 * 3. Generate improvement suggestions
 *
 * The audit sends a message to Mystique which performs the actual analysis
 * and returns results via the guidance handler.
 */

/**
 * Extracts a human-readable brand name from a site URL.
 * Strips protocol, www prefix, TLD, and common regional/market suffixes
 * so the result is suitable for Wikipedia search.
 *
 * Handles subdomain URLs (e.g. corporate.walmart.com → walmart) by
 * extracting the second-level domain rather than the first hostname segment.
 *
 * Region stripping is deliberately conservative: long market suffixes
 * (usa/global/international/worldwide) are removed even when fused to the brand,
 * but short two-letter country codes are only removed when separated by a
 * delimiter (e.g. "walmart-uk" → "walmart"). This avoids mangling brands whose
 * names happen to end in a country code (e.g. "adobe" must NOT become "ado").
 *
 * @param {string} baseURL - The site's base URL or domain
 * @returns {string} Cleaned brand name
 */
function extractBrandFromUrl(baseURL) {
  try {
    const urlStr = baseURL.startsWith('http') ? baseURL : `https://${baseURL}`;
    const { hostname } = new URL(urlStr);

    const parts = hostname
      .replace(/^www\./, '')
      .split('.');

    let tldLength = 1;
    if (parts.length >= 3 && MULTI_PART_TLD_PREFIXES.has(parts[parts.length - 2])) {
      tldLength = 2;
    }

    const brandIndex = parts.length - tldLength - 1;
    const name = brandIndex >= 0 ? parts[brandIndex] : parts[0];

    const stripped = name
      .replace(MARKET_SUFFIXES_RE, '')
      .replace(COUNTRY_CODE_SUFFIX_RE, '')
      .replace(/[-_]$/, ''); // tidy a delimiter left dangling by suffix removal (e.g. "brand-usa" -> "brand")

    return stripped || name;
  } catch {
    return baseURL;
  }
}

/**
 * Retrieves Wikipedia-related configuration from the site
 * @param {Object} site - The site object
 * @returns {Object} Wikipedia configuration
 */
function getWikipediaConfig(site) {
  const config = site.getConfig();
  const baseURL = site.getBaseURL();

  return {
    companyName: config?.getCompanyName?.() || extractBrandFromUrl(baseURL),
    companyWebsite: baseURL,
    wikipediaUrl: config?.getWikipediaUrl?.() || '', // Empty = auto-detect
    competitors: config?.getCompetitors?.() || [], // Empty = auto-detect
    competitorRegion: config?.getCompetitorRegion?.() || null,
  };
}

/**
 * Run Wikipedia Analysis audit
 * @param {string} url - The resolved URL for the audit
 * @param {Object} context - The audit context
 * @param {Object} site - The site being audited
 * @param {Object} [auditContext] - RunnerAudit context; optional
 *     `messageData.wikiUrl` / `messageData.wikipediaUrl` from `message.data`
 * @returns {Promise<Object>} Audit result
 */
async function runWikipediaAnalysisAudit(url, context, site, auditContext = {}) {
  const { log } = context;
  const siteId = site.getId();
  const olog = createOffsiteLogger(log, { audit: AUDIT.WIKIPEDIA, siteId });

  olog.start('audit_orchestration_started', `Starting Wikipedia analysis audit for site: ${siteId}`);

  try {
    const wikipediaConfig = getWikipediaConfig(site);

    const wikipediaUrlOverride = resolveWikipediaUrlOverride(auditContext, olog);
    if (wikipediaUrlOverride?.invalid) {
      olog.warn('audit_orchestration_brand_profile_resolved', 'Ignoring invalid wikipedia URL override', {
        reason: 'invalid_url_override', value: wikipediaUrlOverride.value,
      });
    } else if (wikipediaUrlOverride?.url) {
      wikipediaConfig.wikipediaUrl = wikipediaUrlOverride.url;
      olog.debug('audit_orchestration_brand_profile_resolved', 'Using Wikipedia URL override from audit message', {
        url: wikipediaUrlOverride.url,
      });
    }

    // Validate that we have a company name
    if (!wikipediaConfig.companyName) {
      olog.warn('audit_orchestration_brand_profile_resolved', 'No company name configured for site, skipping audit', { reason: 'no_company_name' });
      return {
        auditResult: {
          success: false,
          error: 'No company name configured for this site',
        },
        fullAuditRef: url,
      };
    }

    olog.success('audit_orchestration_brand_profile_resolved', 'Resolved Wikipedia config', {
      companyName: wikipediaConfig.companyName,
      website: wikipediaConfig.companyWebsite,
      wikipediaUrl: wikipediaConfig.wikipediaUrl,
    });

    const slackContext = auditContext?.slackContext;

    return {
      auditResult: {
        success: true,
        status: 'pending_analysis',
        config: wikipediaConfig,
        ...(slackContext && { slackContext }),
      },
      fullAuditRef: url,
    };
  } catch (error) {
    olog.failure('audit_orchestration_started', 'Audit failed', { ...errorField(error) });
    return {
      auditResult: {
        success: false,
        error: error.message,
      },
      fullAuditRef: url,
    };
  }
}

/**
 * Post processor to send Wikipedia analysis request to Mystique
 * @param {string} auditUrl - The audit URL
 * @param {Object} auditData - The audit data
 * @param {Object} context - The context object
 * @returns {Promise<Object>} Updated audit data
 */
async function sendMystiqueMessagePostProcessor(auditUrl, auditData, context) {
  const {
    log, sqs, env, dataAccess, audit,
  } = context;
  const { siteId, auditResult } = auditData;

  const olog = createOffsiteLogger(log, {
    audit: AUDIT.WIKIPEDIA, siteId, auditId: audit?.getId(),
  });

  // Skip if audit failed
  if (!auditResult.success) {
    olog.skip('audit_analysis_mystique_request_handoff', 'Audit failed, skipping Mystique message', { reason: 'audit_failed' });
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    olog.warn('audit_analysis_mystique_request_handoff', 'SQS or Mystique queue not configured, skipping message', { reason: 'not_configured' });
    return auditData;
  }

  try {
    // Get site for additional data
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      olog.warn('audit_analysis_mystique_request_handoff', 'Site not found, skipping Mystique message', { reason: 'site_not_found' });
      return auditData;
    }

    const { config } = auditResult;

    const baseMessage = {
      type: 'guidance:wikipedia-analysis',
      siteId,
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        companyName: config.companyName,
        companyWebsite: config.companyWebsite,
        wikipediaUrl: config.wikipediaUrl,
        competitors: config.competitors,
        competitorRegion: config.competitorRegion,
      },
    };

    let brand = null;
    try {
      brand = await resolveBrandForSite(context, site);
    } catch (brandError) {
      olog.warn('audit_analysis_scope_resolved', 'Brand resolution failed unexpectedly; proceeding without scope', { ...errorField(brandError) });
    }
    const message = applyBrandScope(baseMessage, brand);

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    const wikipediaUrlForLog = config.wikipediaUrl?.trim()
      ? config.wikipediaUrl
      : '(empty → auto-detect)';

    olog.success(
      'audit_analysis_mystique_request_handoff',
      'Queued Wikipedia analysis request to Mystique',
      {
        peer: PEER.MYSTIQUE,
        direction: 'outbound',
        companyName: config.companyName,
        wikipediaUrl: wikipediaUrlForLog,
        ...(brand ? { brandId: brand.brandId } : {}),
      },
    );
  } catch (error) {
    olog.failure('audit_analysis_mystique_request_handoff', 'Failed to send Mystique message', { peer: PEER.MYSTIQUE, direction: 'outbound', ...errorField(error) }, error);
    // Re-throw to fail the audit if we can't send to Mystique
    throw error;
  }

  return auditData;
}

export { extractBrandFromUrl };

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runWikipediaAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor, withAuditPersistLog(AUDIT.WIKIPEDIA)])
  .build();
