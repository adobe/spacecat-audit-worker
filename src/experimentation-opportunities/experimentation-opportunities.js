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
import { wwwUrlResolver } from '../common/audit.js';

const DAYS = 30;
const MAX_OPPORTUNITIES = 10;
const CTR_THRESHOLD_MARGIN = 0.04;

const OPPTY_QUERIES = [
  'rageclick',
  'high-inorganic-high-bounce-rate',
  'high-organic-low-ctr',
];

/**
 * Audit handler container for all the opportunities
 * @param {*} auditUrl
 * @param {*} context
 * @param {*} site
 * @returns
 */

export async function handler(auditUrl, context, site) {
  const { sqs, log } = context;

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);
  const options = {
    domain: auditUrl,
    domainkey,
    interval: DAYS,
    granularity: 'hourly',
  };

  const queryResults = await rumAPIClient.queryMulti(OPPTY_QUERIES, options);
  const experimentationOpportunities = Object.values(queryResults).flatMap((oppty) => oppty);
  // for the high-organic-low-ctr opportunities urls, trigger the scrape
  const highOrganicLowCtrOpportunities = experimentationOpportunities.filter((oppty) => oppty.type === 'high-organic-low-ctr');
  /* c8 ignore start */
  highOrganicLowCtrOpportunities.sort((a, b) => {
    const aPotentialClicks = a.pageViews
    * (a.trackedKPISiteAverage - CTR_THRESHOLD_MARGIN - a.trackedPageKPIValue) * 100;
    const bPotentialClicks = b.pageViews
    * (b.trackedKPISiteAverage - CTR_THRESHOLD_MARGIN - b.trackedPageKPIValue) * 100;
    return bPotentialClicks - aPotentialClicks;
  });
  const topHighOrganicLowCtrOpportunities = highOrganicLowCtrOpportunities.slice(
    0,
    MAX_OPPORTUNITIES,
  );
  const topHighOrganicUrls = topHighOrganicLowCtrOpportunities.map((oppty) => oppty.page);
  log.info(`Triggering scrape for [${topHighOrganicUrls.join(',')}]`);
  const scrapeResult = await sqs.sendMessage('spacecat-scraping-jobs-dev', {
    processingType: 'default',
    jobId: site.getId(),
    urls: topHighOrganicUrls,
  });
  log.info(`scrapeResult: ${scrapeResult}`);
  /* c8 ignore stop */

  log.info(`Found ${experimentationOpportunities.length} many experimentation opportunites for ${auditUrl}`);

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
  .build();
