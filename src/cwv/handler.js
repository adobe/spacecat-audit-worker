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
import { getRUMDomainkey } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/audit.js';

const DAILY_THRESHOLD = 1000;
const INTERVAL = 7; // days
const CWV_QUERIES = [
  'cwv',
  'form-vitals',
];

function checkHasForm(matchingFormVital) {
  const { formview, formsubmit, formengagement } = matchingFormVital;

  // Check if 'formview', 'formsubmit' or 'formengagement' is undefined or empty
  const isFormViewPresent = formview && Object.keys(formview).length > 0;
  const isFormSubmitPresent = formsubmit && Object.keys(formsubmit).length > 0;
  const isFormEngagementPresent = formengagement && Object.keys(formengagement).length > 0;
  // Return the boolean value based on presence of formview, formsubmit or formengegement
  return isFormViewPresent || isFormSubmitPresent || isFormEngagementPresent;
}

export async function CWVRunner(auditUrl, context, site) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);
  const options = {
    domain: auditUrl,
    domainkey,
    interval: INTERVAL,
    granularity: 'hourly',
  };
  const cwvData = await rumAPIClient.queryMulti(CWV_QUERIES, options);
  const auditResult = {
    cwv: cwvData.cwv.filter((data) => data.pageviews >= DAILY_THRESHOLD * INTERVAL)
      .map((cwvItem) => {
        // Find a matching formVital by URL
        const matchingFormVital = cwvData['form-vitals'].find(
          (formVital) => formVital.url === cwvItem.url,
        );

        const hasForm = matchingFormVital ? checkHasForm(matchingFormVital) : false;
        return { ...cwvItem, hasForm };
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
  .withRunner(CWVRunner)
  .build();
