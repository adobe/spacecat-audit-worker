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
 */
class SQS {
  constructor(region, log) {
    this.sqsClient = new SQSClient({ region });
    this.log = log;
  }

  async sendMessage(queueUrl, message) {
    const body = {
      ...message,
      timestamp: new Date().toISOString(),
    };

    const msgCommand = new SendMessageCommand({
      MessageBody: JSON.stringify(body),
      QueueUrl: queueUrl,
    });

    try {
      const data = await this.sqsClient.send(msgCommand);
      this.log.info(`Success, message sent. MessageID:  ${data.MessageId}`);
    } catch (e) {
      const { type, code, message: msg } = e;
      this.log.error(`Message sent failed. Type: ${type}, Code: ${code}, Message: ${msg}`);
      throw e;
    }
  }
}

export default function sqsWrapper(fn) {
  return async (request, context) => {
    if (!context.sqs) {
      const { log } = context;
      const { region } = context.runtime;
      context.sqs = new SQS(region, log);
    }

    return fn(request, context);
  };
}
