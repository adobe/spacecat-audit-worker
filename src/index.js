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
import secrets from '@adobe/helix-shared-secrets';
import wrap from '@adobe/helix-shared-wrap';
import { helixStatus } from '@adobe/helix-status';
import dynamoDBWrapper from './db-wrapper.js';
import PSIClient from './psi-client.js';
import queueWrapper from './queue-wrapper.js';

/**
 * This is the main function
 * @param {Request} request the request object (see fetch api)
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Response} a response
 */
async function run(request, context) {
  const { db, queue } = context;
  const event = context.invocation?.event;
  if (!event) {
    return new Response('', {
      status: 400,
      headers: {
        'x-error': 'Action was not triggered by an event',
      },
    });
  }
  let message = event.Records[0]?.body?.message;
  if (!message) {
    return new Response('', {
      status: 400,
      headers: {
        'x-error': 'Event does not contain a message body',
      },
    });
  }
  message = JSON.parse(message);
  const psiClient = PSIClient({
    apiKey: context.env.PAGESPEED_API_KEY,
    baseUrl: context.env.PAGESPEED_API_BASE_URL,
  });

  if (!message.domain) {
    return new Response('', {
      status: 400,
      headers: {
        'x-error': 'Event message does not contain a domain',
      },
    });
  }

  const site = {
    domain: message.domain,
    path: message.path,
  };
  try {
    const auditResult = await psiClient.runAudit(`https://${site.domain}/${site.path}`);
    const auditResultMin = await db.saveAuditIndex(site, auditResult);
    await queue.sendAuditResult(auditResultMin);
  } catch (e) {
    await db.saveAuditError(site, e);
  }
  return new Response('SUCCESS');
}

export const main = wrap(run)
  .with(dynamoDBWrapper)
  .with(queueWrapper)
  .with(secrets)
  .with(helixStatus);
