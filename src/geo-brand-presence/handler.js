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
// const ORGANIC_KEYWORDS_NONBRANDED_IMPORT_TYPE = 'organic-keywords-nonbranded';
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
  const keywordQuestions = (await getStoredMetrics(
    { source: 'ahrefs', metric: ORGANIC_KEYWORDS_QUESTIONS_IMPORT_TYPE, siteId: site.getId() },
    storedMetricsConfig,
  ))?.filter(
    (keywordQuestion) => keywordQuestion?.questions?.length > 0,
  )?.map((keywordQuestion) => ({
    keyword: keywordQuestion.keyword,
    q: keywordQuestion.questions,
    pageUrl: keywordQuestion.url,
    importTime: keywordQuestion.importTime,
  }));
  // remove duplicates, as metrics will keep appending the same keyword questions for every run
  const uniqueKeywordQuestions = keywordQuestions.reduce((acc, curr) => {
    const existing = acc.find(
      (item) => item.keyword === curr.keyword && item.pageUrl === curr.pageUrl,
    );
    if (existing && new Date(existing.importTime) > new Date(curr.importTime)) {
      return acc;
    }
    return [
      ...acc.filter(
        (item) => item.keyword !== curr.keyword && item.pageUrl !== curr.pageUrl,
      ),
      curr,
    ];
  }, []);
  log.info(`GEO BRAND PRESENCE: Found ${uniqueKeywordQuestions?.length} keyword questions`);
  if (uniqueKeywordQuestions.length === 0) {
    log.info('GEO BRAND PRESENCE: No keyword questions found, skipping message to mystique');
    return;
  }
  const message = {
    type: GEO_BRAND_PRESENCE_OPPTY_TYPE,
    siteId: site.getId(),
    url: site.getBaseURL(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      keywordQuestions: uniqueKeywordQuestions,
    },
  };
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.info(`GEO BRAND PRESENCE Message sent to Mystique: ${JSON.stringify(message)}`);
}

export async function keywordQuestionsImportStep(context) {
  const {
    site,
    finalUrl,
    log,
  } = context;
  log.info(`Keyword questions import step for ${finalUrl}`);
  return {
    type: ORGANIC_KEYWORDS_QUESTIONS_IMPORT_TYPE,
    siteId: site.getId(),
    // auditResult can't be empty, so sending empty array
    auditResult: { keywordQuestions: [] },
    fullAuditRef: finalUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('keywordQuestionsImportStep', keywordQuestionsImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('sendToMystiqueStep', sendToMystique)
  .build();
