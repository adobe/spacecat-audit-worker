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
import { wwwUrlResolver } from '../common/audit.js';
import highFormViewsLowConversionsOpportunity from './highFormViewsLowConversionsOpportunity.js';
import highPageViewsLowFormCTROpportunity from './highPageViewsLowFormCTAOpportunity.js';
import sendUrlsForScraping from './sendOpportunityUrlsToSQSForScraping.js';

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
  .withRunner(formsAuditRunner)
  .withPostProcessors([
    highFormViewsLowConversionsOpportunity,
    highPageViewsLowFormCTROpportunity,
    sendUrlsForScraping])
  .build();
