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
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { getWeekInfo } from '@adobe/spacecat-shared-utils';
import { getNoCTAAboveTheFoldAnalysisQuery } from './queries.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

const AUDIT_CONSTANTS = {
  GUIDANCE_TYPE: 'guidance:no-cta-above-the-fold',
  OBSERVATION: 'High bounce rate detected on paid traffic page',
};

export async function runAudit(auditUrl, context, site) {
  const { log, env } = context;

  const siteId = site.getId();
  const baseURL = await site.getBaseURL();

  log.info(`[no-cta-above-the-fold] Starting audit for ${baseURL}`);

  const rumMetricsDatabase = env.RUM_METRICS_DATABASE ?? 'rum_metrics';
  const rumMetricsCompactTable = env.RUM_METRICS_COMPACT_TABLE ?? 'compact_metrics';
  const pageViewThreshold = env.PAID_DATA_THRESHOLD ?? 1000;
  const bucketName = env.S3_IMPORTER_BUCKET_NAME;

  if (!bucketName) {
    throw new Error(
      'S3_IMPORTER_BUCKET_NAME must be provided for no-cta-above-the-fold audit',
    );
  }

  const athenaTemp = `s3://${bucketName}/rum-metrics-compact/temp/out`;
  const { temporalCondition } = getWeekInfo();

  const athenaClient = AWSAthenaClient.fromContext(
    context,
    `${athenaTemp}/no-cta-above-the-fold/${siteId}-${Date.now()}`,
  );

  const query = getNoCTAAboveTheFoldAnalysisQuery({
    siteId,
    tableName: `${rumMetricsDatabase}.${rumMetricsCompactTable}`,
    temporalCondition,
    pageViewThreshold,
  });

  log.debug('[no-cta-above-the-fold] Executing Athena query...');

  const rows = await athenaClient.query(
    query,
    rumMetricsDatabase,
    '[Athena Query] No engageable content above the fold analysis',
  );

  return {
    auditResult: rows,
    fullAuditRef: auditUrl,
  };
}

export async function sendResultsToMystique(auditUrl, auditData, context, site) {
  const {
    log,
    env,
    sqs,
    audit,
  } = context;

  const baseURL = await site.getBaseURL();
  const { auditResult = [] } = auditData;
  const siteId = site.getId();
  const deliveryType = site.getDeliveryType();

  await Promise.all(
    auditResult.map(async (row) => {
      const url = row.url ?? `${baseURL}${row.path}`;
      const auditId = audit?.getId?.();

      const message = {
        type: AUDIT_CONSTANTS.GUIDANCE_TYPE,
        observation: AUDIT_CONSTANTS.OBSERVATION,
        siteId,
        url,
        auditId,
        deliveryType,
        time: new Date().toISOString(),
        data: {
          url,
        },
      };

      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      log.debug(
        `[no-cta-above-the-fold] [Site: ${auditUrl}] Sent Mystique message for ${url}`,
      );
    }),
  );

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runAudit)
  .withPostProcessors([sendResultsToMystique])
  .build();
