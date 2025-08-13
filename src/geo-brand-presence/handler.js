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

import { getStoredMetrics } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const ORGANIC_KEYWORDS_QUESTIONS_IMPORT_TYPE = 'organic-keywords-questions';
const LLMO_QUESTIONS_IMPORT_TYPE = 'llmo-prompts-ahrefs';
export const GEO_BRAND_PRESENCE_OPPTY_TYPE = 'detect:geo-brand-presence';
export const GEO_FAQ_OPPTY_TYPE = 'guidance:geo-faq';
export const OPPTY_TYPES = [GEO_BRAND_PRESENCE_OPPTY_TYPE, GEO_FAQ_OPPTY_TYPE];

export async function sendToMystique(context) {
  const {
    auditContext, log, sqs, env, site, audit, s3Client,
  } = context;
  // eslint-disable-next-line prefer-rest-params
  log.info('sending data to mystique', auditContext);

  const storedMetricsConfig = {
    ...context,
    s3: {
      s3Bucket: context.env?.S3_IMPORTER_BUCKET_NAME,
      s3Client,
    },
  };
  const allKeywordQuestions = (await getStoredMetrics(
    { source: 'ahrefs', metric: ORGANIC_KEYWORDS_QUESTIONS_IMPORT_TYPE, siteId: site.getId() },
    storedMetricsConfig,
  )).filter(
    (keywordQuestion) => keywordQuestion?.questions?.length > 0,
  );

  // Get data from the last import only.
  // Ee use the following heuristic:
  // Use the .importTime of the last array item, and choose all entries within 5 minutes
  const lastImport = allKeywordQuestions[allKeywordQuestions.length - 1];
  if (!lastImport || !lastImport.importTime) {
    log.info('GEO BRAND PRESENCE: No keyword questions found, skipping message to mystique');
    return;
  }
  const importTime = +new Date(lastImport.importTime);
  const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
  const keywordQuestions = allKeywordQuestions
    .filter(({ importTime: t }) => t && Math.abs(importTime - +new Date(t)) < fiveMinutes)
    .map((keywordQuestion) => ({
      keyword: keywordQuestion.keyword,
      questions: keywordQuestion.questions,
      pageUrl: keywordQuestion.url,
      importTime: keywordQuestion.importTime,
      volume: keywordQuestion.volume,
    }));

  log.info(`GEO BRAND PRESENCE: Found ${keywordQuestions.length} keyword questions`);
  /* c8 ignore next 4 */
  if (keywordQuestions.length === 0) {
    log.info('GEO BRAND PRESENCE: No keyword questions found, skipping message to mystique');
    return;
  }
  await Promise.all(OPPTY_TYPES.map(async (opptyType) => {
    const message = {
      type: opptyType,
      siteId: site.getId(),
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: { keywordQuestions },
    };
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`${opptyType} Message sent to Mystique: ${JSON.stringify(message)}`);
  }));
}

export async function keywordPromptsImportStep(context) {
  const {
    site,
    data,
    finalUrl,
    log,
  } = context;

  /* c8 ignore start */
  const endDate = Date.parse(data) ? data : undefined;
  /* c8 ignore stop */

  log.info('Keyword questions import step for %s with endDate: %s', finalUrl, endDate);
  return {
    type: LLMO_QUESTIONS_IMPORT_TYPE,
    endDate,
    siteId: site.getId(),
    // auditResult can't be empty, so sending empty array
    auditResult: { keywordQuestions: [] },
    fullAuditRef: finalUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('keywordPromptsImportStep', keywordPromptsImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('sendToMystiqueStep', sendToMystique)
  .build();
