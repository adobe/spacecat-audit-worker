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

import { isValidUUID } from '@adobe/spacecat-shared-utils';
import { retrieveAuditById } from '../utils/data-access.js';

export async function isAuditEnabledForSite(type, site, context) {
  const { Configuration } = context.dataAccess;
  const configuration = await Configuration.findLatest();
  return configuration.isHandlerEnabledForSite(type, site);
}

export async function loadExistingAudit(auditId, context) {
  if (!isValidUUID(auditId)) {
    throw new Error('Valid auditId is required for step execution');
  }
  const audit = await retrieveAuditById(context.dataAccess, auditId, context.log);
  if (!audit) {
    throw new Error(`Audit record ${auditId} not found`);
  }
  return audit;
}

export async function sendContinuationMessage(message, context) {
  const { log } = context;
  const { queueUrl, payload } = message;

  try {
    const { sqs } = context;

    // const payload1 = {
    //   urls: [
    //     {
    //       url: 'https://www.petplace.com/pet-adoption/search',
    //     },
    //     {
    //       url: 'https://www.petplace.com/',
    //     },
    //     {
    //       url: 'https://www.petplace.com/pet-adoption/account',
    //     },
    //     {
    //       url: 'https://www.petplace.com/search',
    //     },
    //     {
    //       url: 'https://www.petplace.com/article/dogs/pet-care/top-1200-pet-names',
    //     },
    //   ],
    //   jobId: '5a377a31-b6c3-411c-8b00-62d7e1b116ac',
    //   processingType: 'form',
    // };

    log.info(`Debug log 6 ${JSON.stringify(payload, null, 2)}`);
    // log.info(`Debug log 61 ${JSON.stringify(payload1, null, 2)}`);
    log.info(`Debug log 7 ${queueUrl}`);

    await sqs.sendMessage(queueUrl, payload);

    // await sqs.sendMessage({
    //   QueueUrl: queueUrl,
    //   MessageBody: JSON.stringify(payload1),
    // });
  } catch (e) {
    log.error(`Failed to send message to queue ${queueUrl}`, e);
    throw e;
  }
}
