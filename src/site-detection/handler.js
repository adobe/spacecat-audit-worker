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

import { fetch, hasText, stripWWW } from '@adobe/spacecat-shared-utils';
import URI from 'urijs';
import { noopPersister, noopUrlResolver } from '../common/audit.js';
import { AuditBuilder } from '../common/audit-builder.js';

const CORALOGIX_API_URL = 'https://ng-api-http.coralogix.com/api/v1/dataprime/query';
const CORALOGIX_QUERY = 'source logs | create $d.split_hosts from arraySplit($d.request_x_forwarded_host, \',\') | create $d.domain from $d.split_hosts[0] | distinct $d.domain, $l.subsystemname, $d.request_x_forwarded_host';

const DEFAULT_IGNORED_SUBDOMAIN_TOKENS = ['demo', 'dev', 'stag', 'stg', 'qa', '--', 'sitemap', 'test', 'preview', 'cm-verify', 'owa', 'mail', 'ssl', 'secure', 'publish', 'prod', 'proxy', 'muat', 'edge', 'eds', 'aem'];
const DEFAULT_IGNORED_DOMAINS = [/helix3.dev/, /fastly.net/, /ngrok-free.app/, /oastify.co/, /fastly-aem.page/, /findmy.media/, /impactful-[0-9]+\.site/, /shuyi-guan/, /adobevipthankyou/, /alshayauat/, /caseytokarchuk/, /\.pfizer$/, /adobeaemcloud.com/, /sabya.xyz/, /magento.com/, /appsechcl.com/, /workers.dev/, /livereview.site/, /localhost/, /lean.delivery/, /kestrelone/];

const IP_ADDRESS_REGEX = /^\d{1,3}(\.\d{1,3}){3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

function isValidCandidate(config, domain, log) {
  /* c8 ignore next 1 */
  const uri = new URI(domain.startsWith('http') ? domain : `https://${domain}`);
  const {
    ignoredSubdomains,
    ignoredDomains,
  } = config;

  // x-fw-host header should contain hostname only. If it contains path and/or search
  // params, then it's most likely a h4ck attempt
  if (uri.path() !== '/' || uri.query() !== '') {
    log.info(`Rejected ${domain} because it contains path and/or search params`);
    return false;
  }

  // disregard the IP addresses
  if (IP_ADDRESS_REGEX.test(domain)) {
    log.info(`Rejected ${domain} because it's an IP address`);
    return false;
  }

  // disregard the non-prod hostnames
  if (ignoredSubdomains.some((ignored) => uri.subdomain().includes(ignored))) {
    log.info(`Rejected ${domain} because it contains an ignored subdomain`);
    return false;
  }

  // ignore on-character subdomains
  if (uri.subdomain().length === 1) {
    log.info(`Rejected ${domain} because it contains an on-character subdomain`);
    return false;
  }

  // disregard unwanted domains
  if (ignoredDomains.some((ignored) => uri.domain().match(ignored))) {
    log.info(`Rejected ${domain} because it contains an ignored domain`);
    return false;
  }

  // disregard candidates with ports
  if (hasText(uri.port())) {
    log.info(`Rejected ${domain} because it contains a port`);
    return false;
  }

  return true;
}

async function fetchCandidates(authorization, log) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 60 * 60 * 1000);

  const options = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authorization}`,
      'Content-Type': 'application/json',
    },
    body: {
      query: CORALOGIX_QUERY,
      metadata: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    },
  };
  const response = await fetch(CORALOGIX_API_URL, options);

  if (!response.ok) {
    throw new Error(`Coralogix API request was not successful. Status: ${response.status}.`);
  }

  const data = await response.text(); // Since response is NDJSON, treat it as text initially
  const batches = data.split('\n').filter(Boolean); // Split the response into batches

  // response may contain duplicate domains since uniqueness is based on
  // domain - request_x_forwarded_host pair
  const domains = new Set();

  return batches.reduce((acc, batch) => {
    try {
      const jsonData = JSON.parse(batch);
      if (!jsonData.result?.results) return acc;

      jsonData.result.results.forEach(({ userData }) => {
        /* c8 ignore next 1 */
        if (!userData) return;

        const {
          request_x_forwarded_host: xFwHost,
          subsystemname,
          domain,
        } = JSON.parse(userData);
        if (!domains.has(domain) && hasText(xFwHost) && hasText(subsystemname)) {
          domains.add(domain);
          acc.push({
            domain,
            xFwHost: stripWWW(xFwHost),
            hlxVersion: subsystemname,
          });
        }
      });
    } catch (e) {
      log.error('Failed to parse Coralogix response');
      throw e;
    }
    return acc;
  }, []);
}

async function refeed(xFwHost, hlxVersion, webhook) {
  const hlxVersions = {
    helix5: 5,
    helix4: 4,
  };

  const response = await fetch(webhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      requestXForwardedHost: xFwHost,
      hlxVersion: hlxVersions[hlxVersion],
    },
  });

  if (!response.ok) {
    throw new Error(`Re-feed request failed with ${response.status}`);
  }
}

export async function siteDetectionRunner(_, context) {
  const {
    dataAccess,
    env,
    log,
  } = context;
  const {
    CORALOGIX_API_KEY: authorization,
    SITE_DETECTION_WEBHOOK: siteDetectionWebHook,
    SITE_DETECTION_IGNORED_DOMAINS: ignoredDomains = DEFAULT_IGNORED_DOMAINS,
    SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS: ignoredSubdomains = DEFAULT_IGNORED_SUBDOMAIN_TOKENS,
  } = env;

  const config = {
    ignoredDomains,
    ignoredSubdomains,
  };

  const sites = await dataAccess.getSites();
  const siteCandidates = await dataAccess.getSiteCandidates();

  const knownHosts = new Set([...sites, ...siteCandidates]
    .map((s) => s.getBaseURL())
    .map((url) => url.replace(/^https?:\/\//, '')));

  const unfilteredCandidates = await fetchCandidates(authorization, log);

  const candidates = unfilteredCandidates
    .filter((candidate) => !knownHosts.has(candidate.domain))
    .filter((candidate) => isValidCandidate(config, candidate.domain, log));

  log.info(`Out of ${unfilteredCandidates.length} candidates, found ${candidates.length} valid candidates`);

  // TODO: replace the HOOK call with a proper post-processing step
  for (const candidate of candidates) {
    try {
      log.info(`Re-feeding ${candidate.domain}; x-fw: ${candidate.xFwHost}, v: ${candidate.hlxVersion}`);
      // eslint-disable-next-line no-await-in-loop
      await refeed(candidate.xFwHost, candidate.hlxVersion, siteDetectionWebHook);
    } catch (e) {
      log.warn(`Failed to re-feed ${candidate.domain}: ${e.message}`);
    }
  }

  return {
    auditResult: candidates,
    fullAuditRef: 'site-detection',
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withPersister(noopPersister)
  .withMessageSender(() => ({}))
  .withRunner(siteDetectionRunner)
  .build();
