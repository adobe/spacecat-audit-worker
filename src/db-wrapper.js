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
import createDynamoDBService from './db.js';
import serviceWrap from './service-wrap.js';

export default function dynamoDBWrapper(func) {
  return async (...args) => {
    let params = {};
    let context = {};
    [params, context = {}] = args;
    const region = context.env.AWS_REGION;
    if (!region) {
      throw Error('Please define region in secrets');
    }
    serviceWrap(
      params,
      context,
      '__ow_dynamodb',
      createDynamoDBService,
    );
    return func(...args);
  };
}
