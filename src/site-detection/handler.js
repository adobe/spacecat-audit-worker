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
/* c8 ignore start */
import { fetch, hasText, stripWWW } from '@adobe/spacecat-shared-utils';
import { noopPersister, noopUrlResolver } from '../common/audit.js';
import { AuditBuilder } from '../common/audit-builder.js';

const CORALOGIX_API_URL = 'https://ng-api-http.coralogix.com/api/v1/dataprime/query';
const CORALOGIX_QUERY = 'source logs | create $d.split_hosts from arraySplit($d.request_x_forwarded_host, \',\') | create $d.xFwHost from $d.split_hosts[0] | distinct $d.xFwHost, $l.subsystemname';

async function fetchXFWHosts(authorization, log) {
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
  const batches = data.split('\n')
    .filter(Boolean); // Split the response into batches

  return batches.reduce((acc, batch) => {
    try {
      const jsonData = JSON.parse(batch);
      if (!jsonData.result?.results) return acc;

      jsonData.result.results.forEach(({ userData }) => {
        if (!userData) return;

        try {
          const { xFwHost, subsystemname } = JSON.parse(userData);
          if (hasText(xFwHost) && hasText(subsystemname)) {
            acc.push({
              xFwHost: stripWWW(xFwHost),
              hlxVersion: subsystemname,
            });
          }
        } catch (error) {
          log.error('Error parsing userData:', error);
        }
      });
    } catch (error) {
      log.error('Error parsing batch coralogix data:', error);
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
    throw new Error(`Failed to re-feed site ${xFwHost}: ${response.statusText}`);
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
  } = env;

  const sites = await dataAccess.getSites();
  log.info(`Sites: ${sites.length}`);
  const siteCandidates = await dataAccess.getSiteCandidates();
  log.info(`Site candidates: ${siteCandidates.length}`);

  const knownHosts = new Set([...sites, ...siteCandidates]
    .map((s) => s.getBaseURL())
    .map((url) => url.replace(/^https?:\/\//, '')));

  log.info(`Known hosts: ${knownHosts.size}`);

  const xFwHosts = await fetchXFWHosts(authorization, log);
  log.info(`xFwHosts: ${JSON.stringify(xFwHosts)}`);
  const unknownHosts = xFwHosts.filter((host) => !knownHosts.has(host.xFwHost));
  log.info(`Unknown hosts: ${JSON.stringify(unknownHosts)}`);

  for (const unknownHost of unknownHosts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await refeed(unknownHost.xFwHost, unknownHost.hlxVersion, siteDetectionWebHook);
    } catch (e) {
      log.warn(`Failed to re-feed ${unknownHost}: ${e.message}`);
    }
  }
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withPersister(noopPersister)
  .withMessageSender(() => ({}))
  .withRunner(siteDetectionRunner)
  .build();
/* c8 ignore end */
