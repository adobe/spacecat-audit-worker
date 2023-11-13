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
 * @class SQSQueue class to send audit results to SQS
 * @param {string} region - AWS region
 * @param {string} queueUrl - SQS queue URL
 * @param {object} log - OpenWhisk log object
 */
export default class SQSQueue {
  constructor(context) {
    const { region, log } = context;
    const { queueUrl } = context.attributes;

    this.queueUrl = queueUrl;
    this.log = log;

    this.sqsClient = new SQSClient({ region });
    log.info(`Creating SQS client in region ${region}`);
  }

  async sendAuditResult(message) {
    const body = {
      message,
      timestamp: new Date().toISOString(),
    };

    const params = {
      DelaySeconds: 10,
      MessageBody: JSON.stringify(body),
      QueueUrl: this.queueUrl,
    };

    try {
      const data = await this.sqsClient.send(new SendMessageCommand(params));
      this.log.info(`Success, message sent. MessageID: ${data.MessageId}`);
    } catch (err) {
      this.log.error(`${err}`);
      throw err;
    }
  }

  destroy() {
    this.sqsClient.destroy();
  }
}
