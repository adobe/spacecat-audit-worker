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
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { log } from './util.js';

// Set up the region
const REGION = 'us-east-1'; // change this to your desired region

// Your SQS queue URL
const queueURL = 'https://sqs.us-east-1.amazonaws.com/282898975672/spacecat-audit-results';

function SQSQueue(sqsClient, queueUrl) {
  async function sendMessage(message) {
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
      log('info', 'Success, message sent. MessageID:', data.MessageId);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'SQS message sent!' }),
      };
    } catch (err) {
      log('error', 'Error:', err);
      throw err;
    }
  }
  return { sendMessage };
}

export default SQSQueue;
