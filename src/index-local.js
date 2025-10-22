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
  const messageBody = {
    type: 'missing-structured-data',
    siteId: 'cccdac43-1a22-4659-9086-b762f59b9928',
    auditContext: {
      next: 'detect-missing-structured-data-candidates',
      auditId: 'a263123c-9f9a-44a8-9531-955884563472',
      type: 'missing-structured-data',
      fullAuditRef: 'missing-structured-data::bulk.com',
    },
  };

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
      debug: () => {}, // Disable debug logging
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
