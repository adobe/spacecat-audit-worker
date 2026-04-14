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
  composeBaseURL,
  fetch,
  hasText,
  isObject,
} from '@adobe/spacecat-shared-utils';
import {
  AsyncJob, Site as SiteModel, SiteCandidate as SiteCandidateModel,
} from '@adobe/spacecat-shared-data-access';
import { BaseSlackClient, SLACK_TARGETS } from '@adobe/spacecat-shared-slack-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopPersister, noopUrlResolver } from '../common/index.js';

const DEFAULT_IGNORED_SUBDOMAIN_TOKENS = ['demo', 'dev', 'stag', 'stg', 'qa', '--', 'sitemap', 'test', 'preview', 'cm-verify', 'owa', 'mail', 'ssl', 'secure', 'publish', 'prod', 'proxy', 'muat', 'edge', 'eds', 'aem'];
const DEFAULT_IGNORED_DOMAINS = [/helix3.dev/, /fastly.net/, /ngrok-free.app/, /oastify.co/, /fastly-aem.page/, /findmy.media/, /impactful-[0-9]+\.site/, /shuyi-guan/, /adobevipthankyou/, /alshayauat/, /caseytokarchuk/, /\.pfizer$/, /adobeaemcloud.com/, /sabya.xyz/, /magento.com/, /appsechcl.com/, /workers.dev/, /livereview.site/, /localhost/, /lean.delivery/, /kestrelone/];

const IP_ADDRESS_REGEX = /^\d{1,3}(\.\d{1,3}){3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

/**
 * Checks if the domain passes the basic validity rules (not an IP, not an ignored
 * subdomain/domain, no port, no path/query).
 */
function isValidCandidate(domain, config, log) {
  const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);

  if (url.pathname !== '/' || url.search !== '') {
    log.info(`Rejected ${domain} because it contains path and/or search params`);
    return false;
  }

  if (IP_ADDRESS_REGEX.test(url.hostname)) {
    log.info(`Rejected ${domain} because it's an IP address`);
    return false;
  }

  const subdomain = url.hostname.split('.').slice(0, -2).join('.');

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
 * Verifies that the given URL is an AEM EDS (Helix) site by checking the DOM structure.
 * @returns {Promise<{isHelix: boolean, reason?: string}>}
 */
async function isHelixSite(url) {
  let resp;
  try {
    resp = await fetch(url);
  } catch (e) {
    return { isHelix: false, reason: `Cannot fetch the site: ${e.message}` };
  }

  const dom = await resp.text();
  const containsHelixDom = /<header><\/header>\s*<main>\s*<div>/.test(dom);

  if (!containsHelixDom) {
    return {
      isHelix: false,
      reason: `DOM is not in Helix format. Status: ${resp.status}`,
    };
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
      return response.json();
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
 * Main handler for the 'site-detection' async job type.
 *
 * Receives an SQS message with { jobId, type: 'site-detection' }.
 * Reads the payload (domain, hlxVersion) from the AsyncJob metadata,
 * validates the domain, verifies it's a Helix site, creates a SiteCandidate,
 * sends a Slack notification, and marks the job COMPLETED.
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

  // Load the job to get the payload
  let job = await AsyncJobEntity.findById(jobId);

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
    job.setStatus(AsyncJob.Status.FAILED);
    job.setError({ code: 'INVALID_PAYLOAD', message: 'Missing domain in job payload' });
    job.setEndedAt(new Date().toISOString());
    await job.save();
    return { auditResult: { error: 'Missing domain' }, fullAuditRef: 'site-detection' };
  }

  const baseURL = composeBaseURL(domain);

  log.info(`[site-detection] Job ${jobId}: processing domain ${domain} (baseURL: ${baseURL})`);

  try {
    // Step 1: Domain validation
    if (!isValidCandidate(domain, config, log)) {
      log.info(`[site-detection] Job ${jobId}: domain ${domain} rejected by validation rules`);
      job.setStatus(AsyncJob.Status.FAILED);
      job.setResult({ action: 'rejected', domain, reason: 'Domain failed validation rules' });
      job.setEndedAt(new Date().toISOString());
      await job.save();
      return { auditResult: { action: 'rejected', domain }, fullAuditRef: 'site-detection' };
    }

    // Step 2: Check for existing Site
    const existingSite = await Site.findByBaseURL(baseURL);
    if (existingSite && existingSite.getDeliveryType() === SiteModel.DELIVERY_TYPES.AEM_EDGE) {
      log.info(`[site-detection] Job ${jobId}: site already exists for ${baseURL}`);
      job.setStatus(AsyncJob.Status.FAILED);
      job.setResult({ action: 'duplicate', domain, reason: 'Site already exists' });
      job.setEndedAt(new Date().toISOString());
      await job.save();
      return { auditResult: { action: 'duplicate', domain }, fullAuditRef: 'site-detection' };
    }

    // Step 3: Check for existing SiteCandidate
    const existingCandidate = await SiteCandidate.findByBaseURL(baseURL);
    if (existingCandidate !== null) {
      log.info(`[site-detection] Job ${jobId}: site candidate already exists for ${baseURL}`);
      job.setStatus(AsyncJob.Status.FAILED);
      job.setResult({ action: 'duplicate', domain, reason: 'Site candidate already evaluated' });
      job.setEndedAt(new Date().toISOString());
      await job.save();
      return { auditResult: { action: 'duplicate', domain }, fullAuditRef: 'site-detection' };
    }

    // Step 4: Verify Helix site
    const { isHelix, reason: helixReason } = await isHelixSite(baseURL);
    if (!isHelix) {
      log.info(`[site-detection] Job ${jobId}: ${baseURL} is not a Helix site: ${helixReason}`);
      job.setStatus(AsyncJob.Status.FAILED);
      job.setResult({ action: 'rejected', domain, reason: `Not a Helix site: ${helixReason}` });
      job.setEndedAt(new Date().toISOString());
      await job.save();
      return { auditResult: { action: 'rejected', domain }, fullAuditRef: 'site-detection' };
    }

    // Step 5: Extract hlxConfig (best-effort; proceeds even if it fails)
    let hlxConfig = { hlxVersion: hlxVersion ?? null, rso: {} };
    try {
      hlxConfig = await extractHlxConfig(domain, hlxVersion, hlxAdminToken, log);
    } catch (e) {
      log.warn(`[site-detection] Job ${jobId}: failed to extract hlxConfig for ${domain}: ${e.message}`);
    }

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
    job = await AsyncJobEntity.findById(jobId);
    job.setStatus(AsyncJob.Status.COMPLETED);
    job.setResult({ action: 'created', domain, baseURL });
    job.setEndedAt(new Date().toISOString());
    await job.save();

    log.info(`[site-detection] Job ${jobId}: completed for ${baseURL}`);

    return {
      auditResult: { action: 'created', domain, baseURL },
      fullAuditRef: 'site-detection',
    };
  } catch (error) {
    log.error(`[site-detection] Job ${jobId}: unexpected error for ${domain}: ${error.message}`, error);

    try {
      job.setStatus(AsyncJob.Status.FAILED);
      job.setError({ code: 'EXCEPTION', message: error.message, details: error.stack });
      job.setEndedAt(new Date().toISOString());
      await job.save();
    } catch (saveErr) {
      log.error(`[site-detection] Job ${jobId}: failed to save error state: ${saveErr.message}`);
    }

    return { auditResult: { error: error.message }, fullAuditRef: 'site-detection' };
  }
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withPersister(noopPersister)
  .withMessageSender(() => ({}))
  .withRunner(siteDetectionRunner)
  .build();
