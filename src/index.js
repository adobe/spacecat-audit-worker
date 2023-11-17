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
import wrap from '@adobe/helix-shared-wrap';
import { helixStatus } from '@adobe/helix-status';
import { Response } from '@adobe/fetch';
import secrets from '@adobe/helix-shared-secrets';
import sqs from './support/sqs.js';
import cwv from './cwv/handler.js';

const HANDLERS = {
  cwv,
};

/**
 * Wrapper to turn an SQS record into a function param
 * Inspired by https://github.com/adobe/helix-admin/blob/main/src/index.js#L104C1-L128C5
 *
 * @param {UniversalAction} fn
 * @returns {function(object, UniversalContext): Promise<Response>}
 */
function sqsEventAdapter(fn) {
  return async (req, context) => {
    const { log } = context;
    let message;

    try {
      log.info(`number of records in message: ${context.invocation?.event?.Records.length}`);
      // currently not publishing batch messages
      message = JSON.parse(context.invocation?.event?.Records[0]?.body);
    } catch (e) {
      log.error('Function was not invoked properly, message body is not a valid JSON');
      return new Response('', {
        status: 400,
        headers: {
          'x-error': 'Event does not contain a valid message body',
        },
      });
    }
    return fn(message, context);
  };
}

/**
 * This is the main function
 * @param {object} message the message object received from SQS
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Response} a response
 */
async function run(message, context) {
  const { log } = context;
  const { type, url } = message;

  log.info(`Audit req received for url: ${url}`);

  const handler = HANDLERS[type];
  if (!handler) {
    const msg = `no such audit type: ${type}`;
    log.error(msg);
    return new Response('', { status: 404 });
  }

  const t0 = Date.now();

  try {
    return await handler(message, context);
  } catch (e) {
    const t1 = Date.now();
    log.error(`handler exception after ${t1 - t0}ms`, e);
    return new Response('', {
      status: e.statusCode || 500,
      headers: {
        'x-error': 'internal server error',
      },
    });
  }
}

export const main = wrap(run)
  .with(sqsEventAdapter)
  .with(sqs)
  .with(secrets)
  .with(helixStatus);
