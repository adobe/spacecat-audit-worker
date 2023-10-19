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

let sqsClient;

export default function SQSQueue(region, queueUrl, log) {
  if (!sqsClient) {
    sqsClient = new SQSClient({ region });
    log.info(`Creating SQS client in region ${region}`);
  }

  async function sendAuditResult(message) {
    const body = {
      message,
      timestamp: new Date().toISOString(),
    };

    const params = {
      DelaySeconds: 10,
      MessageBody: JSON.stringify(body),
      QueueUrl: queueUrl,
    };

    try {
      const data = await sqsClient.send(new SendMessageCommand(params));
      log.info('Success, message sent. MessageID:', data.MessageId);
    } catch (err) {
      log.error('Error:', err);
      throw err;
    }
  }
  return { sendAuditResult };
}
