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
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMDomainkey } from '../support/utils.js';

const DAYS = 30;
const OPPTY_QUERIES = [
  'exp-opportunity/rage-click',
  'exp-opportunity/high-inorganic-high-bounce-rate',
  'exp-opportunity/high-organic-low-bounce-rate',
];

let log = console;

/**
 * Audit handler container for all the opportunities
 * @param {*} auditUrl
 * @param {*} context
 * @param {*} site
 * @returns
 */

export async function opportunitiesHandler(auditUrl, context, site) {
  log = context.log;
  log.info(`Received Opportunities audit request for ${auditUrl}`);
  const startTime = process.hrtime();

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);
  const options = {
    domain: auditUrl,
    domainkey,
    interval: DAYS,
    granularity: 'hourly',
  };

  const queryResults = await rumAPIClient.queryMulti(OPPTY_QUERIES, options);
  const auditData = {
    experimentationOpportunities: [],
  };
  for (const queryResult of Object.keys(queryResults)) {
    if (OPPTY_QUERIES.includes(queryResult)) {
      auditData.experimentationOpportunities.push(...queryResults[queryResult]);
    }
  }

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`Opportunities Audit is completed in ${formattedElapsed} seconds for ${auditUrl}`);

  return {
    auditResult: auditData,
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(opportunitiesHandler)
  .build();
/* c8 ignore stop */
