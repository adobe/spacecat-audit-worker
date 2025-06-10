/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import AWSXray from 'aws-xray-sdk';
import { AthenaClient } from '@aws-sdk/client-athena';

/**
 * Adds an AthenaClient instance to the context.
 *
 * @returns {function(object, UniversalContext): Promise<Response>}
 */
export default function athenaClient(fn) {
  return async (request, context) => {
    if (!context.athenaClient) {
      const region = context.env?.AWS_REGION || 'us-east-1';
      const options = { region };
      context.athenaClient = AWSXray.captureAWSv3Client(new AthenaClient(options));
    }
    return fn(request, context);
  };
}
