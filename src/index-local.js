/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-disable no-console */
import { main as universalMain } from './index.js';

export const main = async () => {
  const messageBody = { type: 'headings', siteId: '36e4848b-d6e5-4350-a7f9-610e78325966' };
  // const messageBody = {
  //   type: 'llm-blocked',
  //   siteId: 'c2473d89-e997-458d-a86d-b4096649c12b',
  //   auditContext: {
  //     next: 'check-llm-blocked',
  //     auditId: 'a263123c-9f9a-44a8-9531-955884563472',
  //     type: 'llm-blocked',
  //     fullAuditRef: 'llm-blocked::adobe.com',
  //   },
  // };

  const message = {
    Records: [
      {
        body: JSON.stringify(messageBody),
      },
    ],
  };

  const context = {
    env: process.env,
    log: {
      info: console.log,
      error: console.error,
      warn: console.warn,
      debug: console.debug,
    },
    runtime: {
      region: 'us-east-1',
    },
    func: {
      version: 'latest',
    },
    invocation: {
      event: {
        Records: [{
          body: JSON.stringify(messageBody),
        }],
      },
    },
  };

  await universalMain(message, context);
};
