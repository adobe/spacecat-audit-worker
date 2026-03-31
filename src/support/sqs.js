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
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

/**
 * @class SQS utility to send messages to SQS
 * @param {string} region - AWS region
 * @param {object} log - log object
 * @param {object} context - context object for trace ID propagation
 */
class SQS {
  constructor(region, log, context) {
    this.sqsClient = new SQSClient({ region });
    this.log = log;
    this.context = context;
  }

  async sendMessage(queueUrl, message, msgGroupId, delaySeconds = 0) {
    const body = {
      ...message,
      timestamp: new Date().toISOString(),
    };

    // Auto-add trace ID from context if not already present in message
    // This maintains trace continuity across service boundaries (e.g., SpaceCat → Mystique)
    if (!('traceId' in body) && this.context?.traceId) {
      body.traceId = this.context.traceId;
    }

    // Auto-extract MessageGroupId from message for SQS fair queuing.
    // Uses type (opptyType) as the group identifier to ensure per-audit-type fairness.
    const resolvedGroupId = msgGroupId || body.type || undefined;

    const asJSON = JSON.stringify(body);
    const msgCommand = new SendMessageCommand({
      MessageBody: asJSON,
      QueueUrl: queueUrl,
      MessageGroupId: resolvedGroupId,
      DelaySeconds: delaySeconds,
    });

    try {
      const data = await this.sqsClient.send(msgCommand);
      const queueName = queueUrl?.split('/').pop() || 'unknown';
      const messageType = body.type || 'unknown';
      this.log.info(`Success, message sent. Queue: ${queueName}, Type: ${messageType}, MessageID: ${data.MessageId}${body.traceId ? `, TraceID: ${body.traceId}` : ''}${resolvedGroupId ? `, GroupID: ${resolvedGroupId}` : ''}`);
    } catch (e) {
      const { type, code, message: msg } = e;
      this.log.error(`Message send failed. Type: ${type}, Code: ${code}, Message: ${msg}`, e);
      throw e;
    }
  }
}

export default function sqsWrapper(fn) {
  return async (request, context) => {
    if (!context.sqs) {
      const { log } = context;
      const { region } = context.runtime;
      context.sqs = new SQS(region, log, context);
    }

    return fn(request, context);
  };
}
