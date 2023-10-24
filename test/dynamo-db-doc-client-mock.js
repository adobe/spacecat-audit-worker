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
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

export default class DBDocClientMock {
  constructor(config) {
    this.config = config;
  }

  static from() {
    return new DBDocClientMock();
  }

  send(command) {
    if (command instanceof PutCommand) {
      return Promise.resolve({ });
    } else if (command instanceof GetCommand) {
      return Promise.resolve({
        Item: {
          domain: 'www.testdomain.com',
          path: '/testpath',
        },
      });
    } else {
      return Promise.reject(new Error('Unknown command in mock'));
    }
  }
}
