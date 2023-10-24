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

export default class SqsClientMock {
  constructor(config) {
    this.config = config;
  }

  // eslint-disable-next-line class-methods-use-this
  send(command) {
    if (command instanceof SendMessageCommand) {
      if (JSON.parse(command.input.MessageBody).message.includes('error')) {
        return Promise.reject(new Error('SQSClient.send encountered an error'));
      }
      return Promise.resolve({ MessageId: 'testMessageId' });
    } else {
      return Promise.reject(new Error('Unknown command in mock'));
    }
  }
}
