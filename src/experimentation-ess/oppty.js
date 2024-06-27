/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import RUMAPIClient, { createOpptyURL } from '@adobe/spacecat-shared-rum-api-client-v1';
import { AuditBuilder } from '../common/audit-builder.js';

function filterRUMData(data) {
  return data.pageviews > 5000; // ignore the pages with low pageviews
}

function processRUMResponse(data) {
  return data
    .filter(filterRUMData)
    .map((row) => ({
      url: row.url,
      pageviews: row.pageviews,
    }));
}

async function processAudit(auditUrl, context) {
  const rumAPIClient = RUMAPIClient.createFrom(context);

  const params = {
    url: auditUrl,
    interval: 7,
  };

  const responseData = await rumAPIClient.getOpptyData(params);

  // log.info(`Received data for ${auditUrl}`);

  return {
    auditResult: processRUMResponse(responseData),
    fullAuditRef: createOpptyURL(params),
  };
}

export async function opptyAuditRunner(baseURL, context) {
  const { log } = context;
  log.info(`Received Oppty audit request for ${baseURL}`);
  const startTime = process.hrtime();
  const auditData = await processAudit(baseURL, context);
  const elapsed = process.hrtime(startTime);
  log.info(`Oppty audit completed in ${elapsed[0]}s`);
  return auditData;
}

export default new AuditBuilder()
  .withRunner(opptyAuditRunner)
  .build();
