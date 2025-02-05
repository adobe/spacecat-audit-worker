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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { storeMetrics } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMDomainkey } from '../support/utils.js';
import { wwwUrlResolver } from '../common/audit.js';

/* c8 ignore start */
const DAYS = 30;

/**
 * Audit handler to collect RUM traffic data for each URL
 * @param {*} auditUrl
 * @param {*} context
 * @param {*} site
 * @returns
 */

export async function handler(auditUrl, context, site) {
  const { log } = context;
  log.info(`running rum traffic audit for: ${auditUrl}`);

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);
  const options = {
    domain: auditUrl,
    domainkey,
    interval: DAYS,
    granularity: 'daily',
  };
  const result = await rumAPIClient.query('traffic-acquisition', options);
  const trafficData = result.reduce((acc, curr) => {
    acc[curr.url] = {
      total: curr.total,
      paid: curr.paid,
      earned: curr.earned,
      owned: curr.owned,
    };
    return acc;
  }, {});
  log.info(`Traffic data: ${JSON.stringify(trafficData, null, 2)}`);
  const metricsPath = await storeMetrics(
    trafficData,
    { siteId: site.id, source: 'rum', metric: 'rum-traffic' },
    context,
  );

  log.info(`Saved ${trafficData.length} urls traffic data for ${auditUrl} into internal S3 storage: ${metricsPath}`);

  return {
    auditResult: {
      trafficData,
    },
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(handler)
  .withMessageSender(() => true)
  .build();
/* c8 ignore end */
