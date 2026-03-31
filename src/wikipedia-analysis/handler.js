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

const LOG_PREFIX = '[Wikipedia]';

const REGION_SUFFIXES_RE = /(?:usa|us|uk|eu|de|fr|es|it|nl|be|at|ch|au|ca|jp|kr|cn|br|mx|in|za|global|international|worldwide)$/i;

/**
 * Short hint for logs: type and safe preview of a messageData override field.
 * @param {unknown} value
 * @returns {string}
 */
function formatOverrideFieldHint(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const t = value.trim();
    const preview = t.length > 120 ? `${t.slice(0, 120)}…` : t;
    return `string(len=${value.length}, preview="${preview}")`;
  }
  return `${typeof value}(${String(value)})`;
}

/**
 * @param {{ url: string }|{ invalid: true, value: string }|undefined} resolution
 * @returns {string}
 */
function summarizeWikipediaUrlOverride(resolution) {
  if (resolution === undefined) return 'none';
  if (resolution.invalid) return `invalid(trimmed="${resolution.value}")`;
  return `url="${resolution.url}"`;
}

/**
 * Slack mrkdwn wraps URLs as `<https://…>` or `<https://…|link label>`.
 * Strips that wrapper so values from Slack commands match `isValidUrl`.
 *
 * @param {string} raw
 * @returns {string}
 */
function unwrapSlackMrkdwnLink(raw) {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('<') && s.endsWith('>')) {
    s = s.slice(1, -1).trim();
    const pipeIdx = s.indexOf('|');
    if (pipeIdx !== -1) {
      s = s.slice(0, pipeIdx).trim();
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
 * @param {object} [auditContext]
 * @param {{ debug?: Function, info?: Function }} [log]
 * @returns {{ url: string }|{ invalid: true, value: string }|undefined}
 */
function resolveWikipediaUrlOverride(auditContext, log) {
  const md = auditContext?.messageData;
  if (!md) {
    log?.debug?.(
      `${LOG_PREFIX} Wikipedia URL override: no messageData (put wikiUrl/wikipediaUrl in message.data)`,
    );
    return undefined;
  }

  const wikiVal = md.wikiUrl;
  const wikipediaVal = md.wikipediaUrl;
  log?.debug?.(
    `${LOG_PREFIX} Wikipedia URL override: messageData fields wikiUrl=${formatOverrideFieldHint(wikiVal)} wikipediaUrl=${formatOverrideFieldHint(wikipediaVal)}`,
  );

  const rawOverride = wikiVal || wikipediaVal;

  if (rawOverride === undefined || rawOverride === null || rawOverride === '') {
    log?.debug?.(
      `${LOG_PREFIX} Wikipedia URL override: neither wikiUrl nor wikipediaUrl is a usable value`,
    );
    return undefined;
  }

  if (typeof rawOverride !== 'string') {
    log?.info?.(
      `${LOG_PREFIX} Wikipedia URL override rejected: expected string from wikiUrl||wikipediaUrl, got ${typeof rawOverride}`,
    );
    return undefined;
  }

  const normalized = unwrapSlackMrkdwnLink(rawOverride);
  if (!normalized) {
    log?.info?.(
      `${LOG_PREFIX} Wikipedia URL override rejected: empty or whitespace-only after Slack/mrkdwn normalization`,
    );
    return undefined;
  }

  if (!isValidUrl(normalized)) {
    log?.info?.(
      `${LOG_PREFIX} Wikipedia URL override rejected: isValidUrl=false for "${normalized}"`,
    );
    return { invalid: true, value: normalized };
  }

  log?.debug?.(
    `${LOG_PREFIX} Wikipedia URL override accepted: "${normalized}"`,
  );

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
 * @param {string} baseURL - The site's base URL or domain
 * @returns {string} Cleaned brand name
 */
function extractBrandFromUrl(baseURL) {
  try {
    const urlStr = baseURL.startsWith('http') ? baseURL : `https://${baseURL}`;
    const { hostname } = new URL(urlStr);

    const name = hostname
      .replace(/^www\./, '')
      .split('.')[0];

    return name.replace(REGION_SUFFIXES_RE, '') || name;
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

  log.info(`${LOG_PREFIX} Starting Wikipedia analysis audit for site: ${site.getId()}`);

  try {
    const wikipediaConfig = getWikipediaConfig(site);

    const wikipediaUrlOverride = resolveWikipediaUrlOverride(auditContext, log);
    log.info(
      `${LOG_PREFIX} wikipediaUrlOverride resolution: ${summarizeWikipediaUrlOverride(wikipediaUrlOverride)}`,
    );
    if (wikipediaUrlOverride?.invalid) {
      log.warn(`${LOG_PREFIX} Ignoring invalid wikipedia URL override: ${wikipediaUrlOverride.value}`);
    } else if (wikipediaUrlOverride?.url) {
      wikipediaConfig.wikipediaUrl = wikipediaUrlOverride.url;
      log.info(`${LOG_PREFIX} Using Wikipedia URL override from audit message: ${wikipediaUrlOverride.url}`);
    }

    // Validate that we have a company name
    if (!wikipediaConfig.companyName) {
      log.warn(`${LOG_PREFIX} No company name configured for site, skipping audit`);
      return {
        auditResult: {
          success: false,
          error: 'No company name configured for this site',
        },
        fullAuditRef: url,
      };
    }

    log.info(`${LOG_PREFIX} Wikipedia config: companyName=${wikipediaConfig.companyName}, website=${wikipediaConfig.companyWebsite}`);

    return {
      auditResult: {
        success: true,
        status: 'pending_analysis',
        config: wikipediaConfig,
      },
      fullAuditRef: url,
    };
  } catch (error) {
    log.error(`${LOG_PREFIX} Audit failed: ${error.message}`);
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

  // Skip if audit failed
  if (!auditResult.success) {
    log.info(`${LOG_PREFIX} Audit failed, skipping Mystique message`);
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`${LOG_PREFIX} SQS or Mystique queue not configured, skipping message`);
    return auditData;
  }

  try {
    // Get site for additional data
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.warn(`${LOG_PREFIX} Site not found, skipping Mystique message`);
      return auditData;
    }

    const { config } = auditResult;

    const message = {
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

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    const wikipediaUrlForLog = config.wikipediaUrl?.trim()
      ? config.wikipediaUrl
      : '(empty → auto-detect)';
    log.info(
      `${LOG_PREFIX} Queued Wikipedia analysis request to Mystique for ${config.companyName} wikipediaUrl=${wikipediaUrlForLog}`,
    );
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send Mystique message: ${error.message}`);
    // Re-throw to fail the audit if we can't send to Mystique
    throw error;
  }

  return auditData;
}

export { extractBrandFromUrl };

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runWikipediaAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
