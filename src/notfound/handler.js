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

import RUMAPIClient, { create404URL } from '@adobe/spacecat-shared-rum-api-client-v1';
import { dateAfterDays } from '@adobe/spacecat-shared-utils';
import {
  getRUMUrl,
} from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';

const AUDIT_TYPE = '404';
const PAGEVIEW_THRESHOLD = 100;

export function filter404Data(data) {
  return data.views > PAGEVIEW_THRESHOLD
      && !!data.url
      && data.url.toLowerCase() !== 'other'
      && data.source_count > 0;
}

function process404Response(data) {
  return data
    .filter(filter404Data)
    .map((row) => ({
      url: row.url,
      pageviews: row.views,
      sources: row.all_sources.filter((source) => !!source),
    }));
}

export async function audit404Runner(baseURL, context) {
  const { log } = context;

  log.info(`Received audit req for domain: ${baseURL}`);
  const finalUrl = await getRUMUrl(baseURL);

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const startDate = dateAfterDays(-7);

  const params = {
    url: finalUrl,
    interval: -1,
    startdate: startDate.toISOString().split('T')[0],
    enddate: new Date().toISOString().split('T')[0],
  };

  const data = await rumAPIClient.get404Sources(params);
  const auditResult = process404Response(data);
  const fullAuditRef = create404URL(params);

  log.info(`Successfully audited ${baseURL} for ${AUDIT_TYPE} type audit`);

  return { auditResult, fullAuditRef };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(audit404Runner)
  .build();
