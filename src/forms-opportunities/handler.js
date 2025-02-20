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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import convertToOpportunity from './opportunityHandler.js';
import generateOpptyData from './utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const DAILY_THRESHOLD = 200;
const INTERVAL = 7; // days
const FORMS_OPPTY_QUERIES = [
  'cwv',
  'form-vitals',
];

export async function formsAuditRunner(auditUrl, context) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const options = {
    domain: auditUrl,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  const queryResults = await rumAPIClient.queryMulti(FORMS_OPPTY_QUERIES, options);
  const cwvMap = new Map(
    queryResults.cwv
      .filter((cwv) => cwv.type === 'url')
      .map((cwv) => [cwv.url, cwv]),
  );

  const auditResult = {
    formVitals: queryResults['form-vitals'].filter((data) => {
      // Calculate the sum of all values inside the `pageview` object
      const pageviewsSum = Object.values(data.pageview).reduce((sum, value) => sum + value, 0);
      return pageviewsSum >= DAILY_THRESHOLD * INTERVAL;
    })
      .map((formVital) => {
        const cwvData = cwvMap.get(formVital.url);
        const filteredCwvData = cwvData
          ? Object.fromEntries(Object.entries(cwvData).filter(([key]) => key !== 'url' && key !== 'pageviews' && key !== 'type'))
          : {};
        return {
          ...formVital,
          cwv: filteredCwvData, // Append cwv data
        };
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
  .addStep('sendUrlsForScraping', async (context) => {
    const {
      site, audit, log, finalUrl,
    } = context;
    log.info(`Debug log 0 ${site.getBaseURL()}`);
    log.info(`Debug log 00 ${finalUrl}`);
    log.info(`Debug log 000 ${audit}`);
    const formsAuditRunnerResult = await formsAuditRunner(finalUrl, context);
    log.info(`Debug log 1 ${JSON.stringify(formsAuditRunnerResult, null, 2)}`);

    const { formVitals } = formsAuditRunnerResult.auditResult;
    const formOpportunities = generateOpptyData(formVitals);
    log.info(`Debug log 2 ${JSON.stringify(formOpportunities, null, 2)}`);
    const uniqueUrls = new Set();
    for (const opportunity of formOpportunities) {
      uniqueUrls.add(opportunity.form);
    }
    log.info(`Debug log 3 ${Array.from(uniqueUrls)}`);
    // const urlArray = Array.from(uniqueUrls);

    const result = {
      // auditResult: formsAuditRunnerResult.auditResult,
      fullAuditRef: formsAuditRunnerResult.fullAuditRef,
      auditResult: { status: 'preparing' },
      // fullAuditRef: `s3://content-bucket/${site.getId()}/raw.json`,
      // Additional data for content scraper
      processingType: 'form',
      jobId: site.getId(),
      urls: Array.from(uniqueUrls).map((url) => ({ url })),
      // urls: urlArray,
      siteId: site.getId(),
      // context,
      // auditContext: {
      //   next: 'processOpportunity',
      //   auditId: site.getId(),
      //   auditType: 'forms-opportunities',
      //   fullAuditRef: `s3://content-bucket/${site.getId()}/raw.json`,
      // },
    };

    log.info(`Debug log 4: ${JSON.stringify(result, null, 2)}`);

    return result;
  }, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)

  .addStep('processOpportunity', convertToOpportunity)
  // .withRunner(formsAuditRunner)
  // .withPostProcessors([convertToOpportunity])
  .build();
