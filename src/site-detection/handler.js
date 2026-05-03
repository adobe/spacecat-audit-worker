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

import dns from 'dns/promises';
import {
  composeBaseURL,
  fetch,
  hasText,
  isObject,
} from '@adobe/spacecat-shared-utils';
import {
  AsyncJob, Site as SiteModel, SiteCandidate as SiteCandidateModel,
} from '@adobe/spacecat-shared-data-access';
import { BaseSlackClient, SLACK_TARGETS } from '@adobe/spacecat-shared-slack-client';

// '--' intentionally blocks RSO staging domains (ref--site--owner.hlx.live / .aem.live)
// from being accepted as primary domains. If an operator needs to allow RSO domains
// as primary hostnames, override via SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS (omitting '--').
const DEFAULT_IGNORED_SUBDOMAIN_TOKENS = ['demo', 'dev', 'stag', 'stg', 'qa', '--', 'sitemap', 'test', 'preview', 'cm-verify', 'owa', 'mail', 'ssl', 'secure', 'publish', 'prod', 'proxy', 'muat', 'edge', 'eds', 'aem'];
const DEFAULT_IGNORED_DOMAINS = [/helix3.dev/, /fastly.net/, /ngrok-free.app/, /oastify.co/, /fastly-aem.page/, /findmy.media/, /impactful-[0-9]+\.site/, /shuyi-guan/, /adobevipthankyou/, /alshayauat/, /caseytokarchuk/, /\.pfizer$/, /adobeaemcloud.com/, /sabya.xyz/, /magento.com/, /appsechcl.com/, /workers.dev/, /livereview.site/, /localhost/, /lean.delivery/, /kestrelone/];

const IP_ADDRESS_REGEX = /^\d{1,3}(\.\d{1,3}){3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

// Generic reason surfaced to callers when isHelixSite rejects a domain.
// Specific detail (status, DNS error, resolved IP) is only ever logged.
const NOT_HELIX_REASON = 'Site did not serve a Helix-format DOM';

/**
 * Checks if the domain passes the basic validity rules (not an IP, not an ignored
 * subdomain/domain, no port, no path/query).
 */
function isValidCandidate(domain, config, log) {
  let url;
  try {
    url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
  } catch {
    log.info(`Rejected ${domain} because it is not a valid hostname`);
    return false;
  }

  if (url.pathname !== '/' || url.search !== '') {
    log.info(`Rejected ${domain} because it contains path and/or search params`);
    return false;
  }

  if (IP_ADDRESS_REGEX.test(url.hostname)) {
    log.info(`Rejected ${domain} because it's an IP address`);
    return false;
  }

  const subdomain = url.hostname.split('.').slice(0, -2).join('.');

  // Apex domains (e.g. "adobe.com") produce an empty subdomain string.
  // These are rejected — they are unlikely to be customer-controlled EDS sites.
  if (!subdomain) {
    log.info(`Rejected ${domain} because it is an apex domain`);
    return false;
  }

  // www-only subdomains (e.g. "www.adobe.com") normalise to an apex baseURL after
  // composeBaseURL strips the www. prefix. Reject them for the same reason as apex domains.
  if (subdomain === 'www') {
    log.info(`Rejected ${domain} because it is a www-only alias of an apex domain`);
    return false;
  }

  if (config.ignoredSubdomains.some((token) => subdomain.includes(token))) {
    log.info(`Rejected ${domain} because it contains an ignored subdomain`);
    return false;
  }

  if (subdomain.length === 1) {
    log.info(`Rejected ${domain} because it contains a one-character subdomain`);
    return false;
  }

  if (config.ignoredDomains.some((pattern) => url.hostname.match(pattern))) {
    log.info(`Rejected ${domain} because it matches an ignored domain`);
    return false;
  }

  if (hasText(url.port)) {
    log.info(`Rejected ${domain} because it contains a port`);
    return false;
  }

  return true;
}

/**
 * Detects IP literals that point at private / loopback / link-local / CGNAT
 * ranges, or at IPv6 equivalents. Used to block SSRF via hostnames that
 * DNS-resolve to internal addresses (e.g. corp hosts, AWS metadata at
 * 169.254.169.254, Docker bridge networks).
 */
function isPrivateIP(address) {
  if (typeof address !== 'string') {
    return true;
  }

  // IPv4
  const v4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 10
      || a === 127
      || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }

  // IPv6 — reject loopback, link-local, ULA, and v4-mapped addresses whose
  // embedded v4 is private.
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') {
    return true;
  }
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }
  const v4Mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Mapped) {
    return isPrivateIP(v4Mapped[1]);
  }

  return false;
}

/**
 * Resolves all A/AAAA records for a hostname and returns true if every resolved
 * address is public. Logs (but does not surface) the reason on rejection.
 */
async function resolvesToPublicAddress(hostname, log) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (e) {
    log.warn(`[site-detection] DNS lookup failed for ${hostname}: ${e.message}`);
    return false;
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    log.warn(`[site-detection] No addresses resolved for ${hostname}`);
    return false;
  }

  for (const { address } of addresses) {
    if (isPrivateIP(address)) {
      log.warn(`[site-detection] ${hostname} resolves to a non-public address; rejecting`);
      return false;
    }
  }

  return true;
}

/**
 * Verifies that the given URL is an AEM EDS (Helix) site by checking the DOM
 * structure. Blocks SSRF by rejecting hostnames whose DNS resolves to a private
 * address and by disabling redirect following (a 30x response is treated as
 * not-a-Helix-site). The reason returned to the caller is intentionally generic;
 * detail stays in the log.
 *
 * @returns {Promise<{isHelix: boolean, reason?: string}>}
 */
async function isHelixSite(url, log) {
  const { hostname } = new URL(url);

  if (!await resolvesToPublicAddress(hostname, log)) {
    return { isHelix: false, reason: NOT_HELIX_REASON };
  }

  let resp;
  try {
    resp = await fetch(url, { redirect: 'manual' });
  } catch (e) {
    log.warn(`[site-detection] fetch failed for ${url}: ${e.message}`);
    return { isHelix: false, reason: NOT_HELIX_REASON };
  }

  // A redirect could point at an internal host we did not validate; treat as non-Helix.
  if (resp.status >= 300 && resp.status < 400) {
    log.info(`[site-detection] ${url} returned redirect status ${resp.status}; treating as non-Helix`);
    return { isHelix: false, reason: NOT_HELIX_REASON };
  }

  let dom;
  try {
    dom = await resp.text();
  } catch (e) {
    log.warn(`[site-detection] reading body failed for ${url}: ${e.message}`);
    return { isHelix: false, reason: NOT_HELIX_REASON };
  }

  if (!/<header><\/header>\s*<main>\s*<div>/.test(dom)) {
    log.info(`[site-detection] ${url} DOM did not match Helix shape (status ${resp.status})`);
    return { isHelix: false, reason: NOT_HELIX_REASON };
  }

  return { isHelix: true };
}

/**
 * Parses a hlx.live / aem.live RSO domain into its components.
 * Returns null if the domain does not match the pattern.
 */
function parseHlxRSO(domain) {
  const match = domain.match(/^([\w-]+)--([\w-]+)--([\w-]+)\.(hlx\.live|aem\.live)$/);
  if (!match) {
    return null;
  }
  return {
    ref: match[1], site: match[2], owner: match[3], tld: match[4],
  };
}

/**
 * Attempts to fetch the aggregated hlx config for a v5 site.
 * Requires HLX_ADMIN_TOKEN in the worker environment.
 */
async function fetchHlxConfig(rso, hlxAdminToken, log) {
  if (!hasText(hlxAdminToken)) {
    return null;
  }

  const { owner, site } = rso;
  const url = `https://admin.hlx.page/config/${owner}/aggregated/${site}.json`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `token ${hlxAdminToken}` },
    });

    if (response.status === 200) {
      return await response.json();
    }
    if (response.status === 404) {
      log.debug(`No hlx config found for ${owner}/${site}`);
      return null;
    }

    log.error(`Error fetching hlx config for ${owner}/${site}. Status: ${response.status}`);
  } catch (e) {
    log.error(`Error fetching hlx config for ${owner}/${site}: ${e.message}`);
  }

  return null;
}

/**
 * Extracts the hlxConfig from the primary domain if it matches the RSO pattern.
 * For v5+ sites, attempts to enrich with the admin API config.
 */
async function extractHlxConfig(domain, hlxVersion, hlxAdminToken, log) {
  const hlxConfig = { hlxVersion: hlxVersion ?? null, rso: {} };

  const rso = parseHlxRSO(domain);
  if (!isObject(rso)) {
    return hlxConfig;
  }

  hlxConfig.rso = rso;

  if ((hlxVersion ?? 0) >= 5 || rso.tld === 'aem.live') {
    const config = await fetchHlxConfig(rso, hlxAdminToken, log);
    if (isObject(config)) {
      const { cdn, code, content } = config;
      if (isObject(cdn)) {
        hlxConfig.cdn = cdn;
      }
      if (isObject(code)) {
        hlxConfig.code = code;
      }
      if (isObject(content)) {
        hlxConfig.content = content;
      }
      hlxConfig.hlxVersion = 5;
    }
  }

  return hlxConfig;
}

/**
 * Builds the Slack blocks for the site discovery notification.
 */
function buildSlackBlocks(baseURL, hlxConfig, channel) {
  const rso = hlxConfig?.rso;
  const rsoRef = rso?.ref ? `, _ref:_ ${rso.ref}` : '';
  const rsoText = rso?.owner ? ` (_owner:_ *${rso.owner}/${rso.site}*${rsoRef})` : '';

  return {
    channel,
    text: `New site discovered: ${baseURL}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `I discovered a new site on Edge Delivery Services: *<${baseURL}|${baseURL}>*. Would you like me to include it in the Star Catalogue? (_source:_ *CDN*${rsoText})`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'As Customer' },
            action_id: 'approveSiteCandidate',
            style: 'primary',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'As Friends/Family' },
            action_id: 'approveFriendsFamily',
            style: 'primary',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Ignore' },
            action_id: 'ignoreSiteCandidate',
            style: 'danger',
          },
        ],
      },
    ],
  };
}

/**
 * Finalises the job with a terminal COMPLETED state and the given result payload.
 * Any save error is logged but swallowed — the return shape reflects the intended
 * outcome regardless of DB transient failure.
 */
async function finalizeCompleted(job, result, log) {
  job.setStatus(AsyncJob.Status.COMPLETED);
  job.setResult(result);
  job.setEndedAt(new Date().toISOString());
  try {
    await job.save();
  } catch (e) {
    log.error(`[site-detection] failed to save COMPLETED state for job ${job.getId()}: ${e.message}`);
  }
}

/**
 * Finalises the job with a terminal FAILED state. Reserved for unexpected
 * exceptions — not for "evaluated and rejected/duplicate" outcomes.
 */
async function finalizeFailed(job, error, log) {
  try {
    job.setStatus(AsyncJob.Status.FAILED);
    job.setError({ code: error.code ?? 'EXCEPTION', message: error.message, details: error.stack });
    job.setEndedAt(new Date().toISOString());
    await job.save();
  } catch (saveErr) {
    log.error(`[site-detection] failed to save error state: ${saveErr.message}`);
  }
}

/**
 * Main handler for the 'site-detection' async job type.
 *
 * Receives an SQS message with { jobId, type: 'site-detection' }.
 * Reads the payload (domain, hlxVersion) from the AsyncJob metadata,
 * validates the domain, verifies it's a Helix site, creates a SiteCandidate,
 * sends a Slack notification, and marks the job COMPLETED.
 *
 * Terminal states:
 *   COMPLETED + action=created    — SiteCandidate created
 *   COMPLETED + action=duplicate  — already a Site or SiteCandidate
 *   COMPLETED + action=rejected   — domain failed validation / not a Helix site
 *   FAILED    + error             — unexpected exception; safe to retry
 */
export async function siteDetectionRunner(message, context) {
  const { dataAccess, env, log } = context;
  const { AsyncJob: AsyncJobEntity, Site, SiteCandidate } = dataAccess;

  const {
    SITE_DETECTION_IGNORED_DOMAINS: rawIgnoredDomains,
    SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS: rawIgnoredSubdomains,
    HLX_ADMIN_TOKEN: hlxAdminToken,
    SLACK_SITE_DISCOVERY_CHANNEL_INTERNAL: slackChannel,
  } = env;

  const ignoredDomains = rawIgnoredDomains
    ? rawIgnoredDomains.split(',').flatMap((d) => {
      const t = d.trim();
      const body = t.startsWith('/') && t.endsWith('/') ? t.slice(1, -1) : t;
      try {
        return [new RegExp(body)];
      } catch (e) {
        log.warn(`[site-detection] Skipping invalid regex pattern "${t}": ${e.message}`);
        return [];
      }
    })
    : DEFAULT_IGNORED_DOMAINS;

  const ignoredSubdomains = rawIgnoredSubdomains
    ? rawIgnoredSubdomains.split(',').map((t) => t.trim())
    : DEFAULT_IGNORED_SUBDOMAIN_TOKENS;

  const config = { ignoredDomains, ignoredSubdomains };

  const { jobId } = message;

  if (!hasText(jobId)) {
    log.error('[site-detection] Received message without jobId, skipping');
    return { auditResult: { error: 'Missing jobId' }, fullAuditRef: 'site-detection' };
  }

  const job = await AsyncJobEntity.findById(jobId);

  if (!job) {
    log.error(`[site-detection] Job ${jobId} not found`);
    return { auditResult: { error: 'Job not found' }, fullAuditRef: 'site-detection' };
  }

  if (job.getStatus() !== AsyncJob.Status.IN_PROGRESS) {
    log.warn(`[site-detection] Job ${jobId} is not IN_PROGRESS (${job.getStatus()}), skipping`);
    return { auditResult: { skipped: true }, fullAuditRef: 'site-detection' };
  }

  const { domain, hlxVersion } = job.getMetadata()?.payload ?? {};

  if (!hasText(domain)) {
    log.error(`[site-detection] Job ${jobId}: missing domain in payload`);
    // Malformed payload is not a runtime failure — mark FAILED so a redelivery
    // doesn't loop on the same bad message, but wrap the save so a DB transient
    // cannot escape and poison-pill the queue.
    await finalizeFailed(
      job,
      { code: 'INVALID_PAYLOAD', message: 'Missing domain in job payload' },
      log,
    );
    return { auditResult: { error: 'Missing domain' }, fullAuditRef: 'site-detection' };
  }

  const baseURL = composeBaseURL(domain);

  log.info(`[site-detection] Job ${jobId}: processing domain ${domain} (baseURL: ${baseURL})`);

  try {
    // Step 1: Domain validation
    if (!isValidCandidate(domain, config, log)) {
      log.info(`[site-detection] Job ${jobId}: domain ${domain} rejected by validation rules`);
      await finalizeCompleted(
        job,
        { action: 'rejected', domain, reason: 'Domain failed validation rules' },
        log,
      );
      return { auditResult: { action: 'rejected', domain }, fullAuditRef: 'site-detection' };
    }

    // Step 2: Check for existing Site
    const existingSite = await Site.findByBaseURL(baseURL);
    if (existingSite && existingSite.getDeliveryType() === SiteModel.DELIVERY_TYPES.AEM_EDGE) {
      log.info(`[site-detection] Job ${jobId}: site already exists for ${baseURL}`);
      await finalizeCompleted(
        job,
        { action: 'duplicate', domain, reason: 'Site already exists' },
        log,
      );
      return { auditResult: { action: 'duplicate', domain }, fullAuditRef: 'site-detection' };
    }

    // Step 3: Check for existing SiteCandidate
    const existingCandidate = await SiteCandidate.findByBaseURL(baseURL);
    if (existingCandidate !== null) {
      log.info(`[site-detection] Job ${jobId}: site candidate already exists for ${baseURL}`);
      await finalizeCompleted(
        job,
        { action: 'duplicate', domain, reason: 'Site candidate already evaluated' },
        log,
      );
      return { auditResult: { action: 'duplicate', domain }, fullAuditRef: 'site-detection' };
    }

    // Step 4: Verify Helix site
    const { isHelix, reason: helixReason } = await isHelixSite(baseURL, log);
    if (!isHelix) {
      log.info(`[site-detection] Job ${jobId}: ${baseURL} is not a Helix site: ${helixReason}`);
      await finalizeCompleted(
        job,
        { action: 'rejected', domain, reason: helixReason },
        log,
      );
      return { auditResult: { action: 'rejected', domain }, fullAuditRef: 'site-detection' };
    }

    // Step 5: Extract hlxConfig (best-effort; fetchHlxConfig handles errors internally)
    const hlxConfig = await extractHlxConfig(domain, hlxVersion, hlxAdminToken, log);

    // Step 6: Create SiteCandidate
    await SiteCandidate.create({
      baseURL,
      source: SiteCandidateModel.SITE_CANDIDATE_SOURCES.CDN,
      status: SiteCandidateModel.SITE_CANDIDATE_STATUS.PENDING,
      hlxConfig,
    });

    log.info(`[site-detection] Job ${jobId}: created SiteCandidate for ${baseURL}`);

    // Step 7: Send Slack notification (best-effort; does not fail the job)
    if (hasText(slackChannel)) {
      try {
        const slackClient = BaseSlackClient.createFrom(context, SLACK_TARGETS.WORKSPACE_INTERNAL);
        const messagePayload = buildSlackBlocks(baseURL, hlxConfig, slackChannel);
        await slackClient.postMessage(messagePayload);
        log.info(`[site-detection] Job ${jobId}: Slack notification sent for ${baseURL}`);
      } catch (e) {
        log.warn(`[site-detection] Job ${jobId}: failed to send Slack notification: ${e.message}`);
      }
    } else {
      log.warn(`[site-detection] Job ${jobId}: SLACK_SITE_DISCOVERY_CHANNEL_INTERNAL not set, skipping Slack`);
    }

    // Step 8: Mark job COMPLETED
    await finalizeCompleted(job, { action: 'created', domain, baseURL }, log);

    log.info(`[site-detection] Job ${jobId}: completed for ${baseURL}`);

    return {
      auditResult: { action: 'created', domain, baseURL },
      fullAuditRef: 'site-detection',
    };
  } catch (error) {
    log.error(`[site-detection] Job ${jobId}: unexpected error for ${domain}: ${error.message}`, error);
    await finalizeFailed(job, error, log);
    return { auditResult: { error: error.message }, fullAuditRef: 'site-detection' };
  }
}

export default siteDetectionRunner;
