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

import SqsQueue from './sqs-queue.js';

function queueWrapper(func) {
  return async (request, context) => {
    const region = process.env.AWS_REGION;
    const queueUrl = process.env.AUDIT_RESULTS_QUEUE_URL;
    const { log } = context;

    if (!region) {
      throw new Error('AWS_REGION env variable is empty/not provided');
    }
    if (!queueUrl) {
      throw new Error('AUDIT_RESULTS_QUEUE_URL env variable is empty/not provided');
    }

    context.queue = SqsQueue(region, queueUrl, log);

    return func(request, context);
  };
}

export default queueWrapper;
