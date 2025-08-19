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

import { getStaticContent } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getTemporalCondition } from '../utils/date-utils.js';

const DETECT_PAGE_INTENT_FLOW = 'detect:page-intent';

/* c8 ignore start */
async function getPathsOfLastWeek(auditUrl, context, site) {
  const { env } = context;
  const { S3_IMPORTER_BUCKET_NAME: importerBucket } = env;

  const tempLocation = `s3://${importerBucket}/rum-metrics-compact/temp/out/`;
  const databaseName = 'rum_metrics';
  const tableName = 'compact_metrics';
  const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);

  const variables = {
    tableName: `${databaseName}.${tableName}`,
    siteId: site.getSiteId(),
    temporalCondition: getTemporalCondition(),
  };

  const query = await getStaticContent(variables, './src/page-intent/sql/referral-traffic-paths.sql');
  const description = `[Athena Query] Fetching referral traffic data for ${site.getBaseURL()}`;
  const paths = await athenaClient.query(query, databaseName, description);
  const pageIntents = await site.getPageIntents();
  const baseURL = site.getBaseURL();

  const hasPageIntent = (path) => {
    const url = `${baseURL}${path}`;
    const pageIntent = pageIntents.find((pi) => pi.getUrl() === url);
    if (!pageIntent) return false;
    return true;
  };

  const missingPageIntents = paths.map(({ path }) => path)
    .filter((path) => !hasPageIntent(path));

  return {
    auditResult: missingPageIntents,
    fullAuditRef: auditUrl,
  };
}

async function storeMetaData(auditData, context) {
  const { dataAccess } = context;
  const { Audit } = dataAccess;
  const auditResult = { numOfMissingPageIntents: auditData.auditResult?.length || 0 };
  const audit = await Audit.create({
    ...auditData,
    auditResult,
  });
  return audit;
}
async function updatePageIntent(auditUrl, auditData, context, site) {
  const {
    env, sqs,
  } = context;
  const { auditResult, id } = auditData;
  const baseUrl = site.getBaseURL();
  const siteId = site.getSiteId();

  for (const path of auditResult) {
    const mystiqueMessage = {
      type: DETECT_PAGE_INTENT_FLOW,
      siteId,
      url: `${baseUrl}${path}`,
      auditId: id,
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {},
    };

    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  }
} /* c8 ignore end */

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(getPathsOfLastWeek)
  .withPersister(storeMetaData)
  .withPostProcessors([updatePageIntent])
  .build();
