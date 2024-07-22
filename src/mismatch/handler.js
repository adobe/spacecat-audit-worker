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
import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMDomainkey } from '../support/utils.js';

async function runner(auditUrl, context, site) {
  const { log } = context;
  log.info(`Received mismatch audit request for ${auditUrl}`);

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);

  const options = {
    domain: auditUrl,
    domainkey,
    granularity: 'hourly',
    interval: 30,
  };
  log.info(`Audit options: ${options}`);

  const result = await rumAPIClient.query('variant', options);

  log.info(`RUM result for ${auditUrl} is, ${JSON.stringify(result)}`);

  return {
    auditResult: result,
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(runner)
  .build();