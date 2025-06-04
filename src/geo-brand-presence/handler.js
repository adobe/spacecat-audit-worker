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

/* c8 ignore start */

import { getStoredMetrics } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const GEO_BRAND_PRESENCE_OPPTY_TYPE = 'guidance:geo-brand-presence';

export async function sendToMystique(context) {
  const {
    log, sqs, env, site, audit, s3Client,
  } = context;
  const storedMetricsConfig = {
    ...context,
    s3: {
      s3Bucket: context.env?.S3_IMPORTER_BUCKET_NAME,
      s3Client,
    },
  };
  const keywordQuestions = await getStoredMetrics(
    { source: 'ahrefs', metric: 'keyword-questions', siteId: site.getId() },
    storedMetricsConfig,
  ).map((keywordQuestion) => ({
    keyword: keywordQuestion.keyword,
    questions: keywordQuestion.questions,
    pageUrl: keywordQuestion.url,
  }));

  const message = {
    type: GEO_BRAND_PRESENCE_OPPTY_TYPE,
    siteId: site.getId(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      keywordQuestions,
    },
  };
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.info(`GEO BRAND PRESENCE Message sent to Mystique: ${JSON.stringify(message)}`);
}

export async function keywordsImportStep(context) {
  const { site, finalUrl } = context;
  return {
    type: 'organic-keywords-nonbranded',
    siteId: site.getId(),
    auditResult: {},
    fullAuditRef: finalUrl,
  };
}

export async function keywordQuestionsImportStep(context) {
  const {
    site, log, finalUrl, s3Client,
  } = context;
  const storedMetricsConfig = {
    ...context,
    s3: {
      s3Bucket: context.env?.S3_IMPORTER_BUCKET_NAME,
      s3Client,
    },
  };
  const nonBrandedKeywords = await getStoredMetrics(
    { source: 'ahrefs', metric: 'organic-keywords-nonbranded', siteId: site.getId() },
    storedMetricsConfig,
  ).filter((keyword) => keyword.isBranded === false).map((keyword) => keyword.keyword);
  log.info(`Non branded keywords step for ${finalUrl}, found ${nonBrandedKeywords.length} keywords: ${nonBrandedKeywords.join(', ')}`);
  return {
    type: 'keywords-questions',
    siteId: site.getId(),
    keywords: nonBrandedKeywords,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('keywordsImportStep', keywordsImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('keywordQuestionsImportStep', keywordQuestionsImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('sendToMystique', sendToMystique)
  .build();
/* c8 ignore end */
