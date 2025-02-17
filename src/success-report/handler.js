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

/* eslint-disable */

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMDomainkey } from '../support/utils.js';
import { noopPersister, noopUrlResolver } from '../common/audit.js';

const INTERVAL = 7; // days
const OPPTY_QUERIES = [
  'cwv',
  'high-organic-low-ctr',
];

export async function successReportHandler(baseURL, context, site) {
  const { log, dataAccess } = context;
  const { LatestAuditCollection, Opportunity, Suggestion } = dataAccess;
  const startTime = process.hrtime();

  const siteId = site.getId();

  log.info(`Running success report for site: ${siteId}`);

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);
  const options = {
    domain: baseURL,
    domainkey,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  // const queryResults = await rumAPIClient.queryMulti(OPPTY_QUERIES, options);
  // log.info('success report RUM queryResults', JSON.stringify(queryResults));

  const opportunities = await Opportunity.allBySiteId(siteId);
  const THIRTY_DAYS_AGO = new Date();
  THIRTY_DAYS_AGO.setDate(THIRTY_DAYS_AGO.getDate() - 30);

  const suggestionsPromises = opportunities.map(async (opportunity) => {
    const suggestions = await Suggestion.allByOpportunityIdAndStatus(
      opportunity.getId(),
      'FIXED',
    );
    return suggestions
      .filter((suggestion) => new Date(suggestion.getUpdatedAt()) >= THIRTY_DAYS_AGO);
  });

  const allSuggestions = await Promise.all(suggestionsPromises);
  const fixedSuggestionsInLastMonth = allSuggestions.flat();

  const SEVEN_DAYS_AGO = new Date();
  SEVEN_DAYS_AGO.setDate(SEVEN_DAYS_AGO.getDate() - 7);

  const latestAudit = await LatestAuditCollection.allBySiteId(siteId);

  log.info('success report latestAudit', JSON.stringify(latestAudit));

  // For all the fixed suggestions, find the pageUrls
  // For all the fixed suggestions, find the time to fix the suggestion
  // Find the pageviews for those pageUrls in last month
  // Find the traffic improved for those pageUrls in last month
  // Find the CTR improved for those pageUrls in last month
  // Record pages for which CWV improved in last month
  // Find how many backlinks were fixed in last month
  // Find how many errors were fixed in last month

  // how many new experiments were created and published?
  // find traffic gain on those experiments

  const successReport = {
    totalSuggestionsFixed: fixedSuggestionsInLastMonth.length,
    totalTrafficGain: 0,
    averageTimeToFix: 0,
    totalPageViews: 0,
    totalHealthIssuesFixed: 0,
    totalBacklinksFixed: 0,
    totalErrorsFixed: 0,
    lhsImproved: {
      url1: 0,
      url2: 0,
    },
    ctrImproved: {
      url1: 0,
      url2: 0,
    },
  };

  const auditResult = {
    siteId,
    baseURL,
    successReport,
  };

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`Success report audit completed in ${formattedElapsed} seconds for ${baseURL}`);

  return {
    fullAuditRef: baseURL,
    auditResult,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withPersister(noopPersister)
  .withRunner(successReportHandler)
  .withUrlResolver((site) => site.getBaseURL())
  .withPostProcessors([])
  .build();
