/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import secrets from '@adobe/helix-shared-secrets';
import wrap from '@adobe/helix-shared-wrap';
import { logger } from '@adobe/helix-universal-logger';
import { helixStatus } from '@adobe/helix-status';
import SQSQueue from './sqs-queue.js';
import { dynamoDBWrapper } from './db-wrapper.js'; // Assuming the exported content of './db' is default exported
import PSIClient from './psi-client.js'; // Assuming the exported content of './psi-client' is default exported

/**
 * This is the main function
 * @param {Request} request the request object (see fetch api)
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Response} a response
 */
async function run(request, context) {
  const {
    __ow_dynamodb: db,
  } = context;
  const sqsQueue = SQSQueue();
  const { message } = JSON.parse(context.invocation.event.Records[0].body);

  const psiClient = PSIClient({
    apiKey: process.env.PAGESPEED_API_KEY,
    baseUrl: process.env.PAGESPEED_API_BASE_URL,
  });

  const site = {
    domain: message.domain,
    path: message.path,
  };
  const auditResult = await psiClient.runAudit(`https://${site.domain}/${site.path}`);
  const auditResultMin = await db.saveAuditIndex(site, auditResult);
  await sqsQueue.sendMessage(auditResultMin);
  return new Response('SUCCESS');
}

export const main = wrap(run)
  .with(helixStatus)
  .with(dynamoDBWrapper)
  .with(logger.trace)
  .with(logger)
  .with(secrets);
