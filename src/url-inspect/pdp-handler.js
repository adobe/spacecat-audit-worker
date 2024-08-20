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
import { isArray } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { processUrlInspect } from './url-inspect.js';

export async function gscPdpStructuredDataHandler(baseURL, context, site) {
  const { log } = context;
  log.info(`Received Product Detail Page indexability audit request for ${baseURL}`);
  const startTime = process.hrtime();

  const siteId = site.getId();

  const productDetailPages = await site.getConfig().getProductDetailPages('pdp-indexability');
  if (isArray(productDetailPages) && productDetailPages.length === 0) {
    log.error(`No top pages found for site ID: ${siteId}`);
    throw new Error(`No top pages found for site: ${baseURL}`);
  }

  const auditResult = await processUrlInspect(baseURL, context, productDetailPages);

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`URL Inspect Audit completed in ${formattedElapsed} seconds for ${baseURL}`);

  return {
    fullAuditRef: baseURL,
    auditResult,
  };
}

export default new AuditBuilder()
  .withRunner(gscPdpStructuredDataHandler)
  .withUrlResolver((site) => site.getBaseURL())
  .build();
