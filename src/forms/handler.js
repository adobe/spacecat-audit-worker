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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { getRUMDomainkey, getRUMUrl } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/audit.js';

const DAILY_THRESHOLD = 1000;
const INTERVAL = 7; // days

export async function formsAuditRunner(auditUrl, context, site) {
  const { log } = context;
  const finalUrl = await getRUMUrl(auditUrl);
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context, auditUrl, log);
  const options = {
    domain: finalUrl,
    domainkey,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  const formsAuditLinks = await rumAPIClient.query('form-vitals', options);
  const auditResult = {
    formVitals: formsAuditLinks.filter((data) => {
      // Calculate the sum of all values inside the `pageview` object
      // eslint-disable-next-line max-len
      const pageviewsSum = Object.values(data.pageview).reduce((sum, value) => sum + value, 0);
      return pageviewsSum >= DAILY_THRESHOLD * INTERVAL;
    }),
    auditContext: {
      interval: INTERVAL,
    },
  };

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(formsAuditRunner)
  .build();