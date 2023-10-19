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

'use strict';

import { SQSClient } from '@aws-sdk/client-sqs';
import { log } from './util.js';
import SqsQueue from './sqs-queue.js';

let sqsClient;

function SQSWrapper(func) {
  return async (request, context) => {
    const region = process.env.AWS_REGION;
    const queueUrl = process.env.QUEUE_URL;

    if (!region) {
      throw new Error('region is required');
    }
    if (!queueUrl) {
      throw new Error('queueUrl is required');
    }

    // Initialize the SQSClient only if it hasn't been initialized yet
    if (!sqsClient) {
      log('info', `Creating SQS client in region ${region}`);
      sqsClient = new SQSClient({ region });
    }

    context.sqsQueue = SqsQueue(sqsClient, queueUrl);

    return func(request, context);
  };
}

export default SQSWrapper;
