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
import { wwwUrlResolver } from '../common/index.js';

const DAYS = 7;

const OPPTY_QUERIES = [
  'rageclick',
  'high-inorganic-high-bounce-rate',
  'high-organic-low-ctr',
];

function getRageClickOpportunityImpact(oppty) {
  // return the maximum number of samples across all the selectors that have rage click
  return oppty.metrics.reduce((acc, metric) => Math.max(acc, metric.samples || 0), 0);
}

function processRageClickOpportunities(opportunities) {
  opportunities.filter((oppty) => oppty.type === 'rageclick')
    .forEach((oppty) => {
      const index = opportunities.indexOf(oppty);
      // eslint-disable-next-line no-param-reassign
      opportunities[index] = {
        ...oppty,
        opportunityImpact: getRageClickOpportunityImpact(oppty),
      };
    });
}

export async function opportunityAndSuggestions(auditUrl, auditData, context, site) {
  const { log, sqs, env } = context;
  const { auditResult, isError = false } = auditData;
  if (isError) {
    log.error(`Experimentation opportunities audit failed for ${auditUrl}. AuditRef: ${auditResult.fullAuditRef}`);
    return;
  }

  const messages = auditResult.experimentationOpportunities?.filter((oppty) => oppty.type === 'high-organic-low-ctr')
    .map((oppty) => ({
      type: 'guidance:high-organic-low-ctr',
      siteId: auditData.siteId,
      auditId: auditData.id,
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        url: oppty.page,
        ctr: oppty.trackedPageKPIValue,
        siteAgerageCtr: oppty.trackedKPISiteAverage,
      },
    }));

  for (const message of messages) {
    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`Message sent: ${JSON.stringify(message)}`);
  }
}

/**
 * Audit handler container for all the opportunities
 * @param {*} auditUrl
 * @param {*} context
 * @param {*} site
 * @returns
 */

export async function handler(auditUrl, context) {
  const { log } = context;

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const options = {
    domain: auditUrl,
    interval: DAYS,
    granularity: 'hourly',
  };
  const queryResults = await rumAPIClient.queryMulti(OPPTY_QUERIES, options);
  const experimentationOpportunities = Object.values(queryResults).flatMap((oppty) => oppty);
  await processRageClickOpportunities(experimentationOpportunities);
  log.info(`Found ${experimentationOpportunities.length} experimentation opportunites for ${auditUrl}`);

  return {
    auditResult: {
      experimentationOpportunities,
    },
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(handler)
  .withUrlResolver(wwwUrlResolver)
  .withPostProcessors([opportunityAndSuggestions])
  .withMessageSender(() => true)
  .build();
