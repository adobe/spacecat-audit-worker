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
  if (!process.env.AZURE_OPENAI_ENDPOINT) {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://aem-sites-1-genai-us-east-2.openai.azure.com';
  }
  if (!process.env.S3_SCRAPER_BUCKET_NAME) {
    process.env.S3_SCRAPER_BUCKET_NAME = 'spacecat-dev-scraper';
  }
  if (!process.env.AZURE_OPENAI_KEY) {
    process.env.AZURE_OPENAI_KEY = 'a32a817592b34f5198295e80367efdd3';
  }
  if (!process.env.AZURE_API_VERSION) {
    process.env.AZURE_API_VERSION = '2024-02-01';
  }
  if (!process.env.AZURE_COMPLETION_DEPLOYMENT) {
    process.env.AZURE_COMPLETION_DEPLOYMENT = 'gpt-4o';
  }

  const messageBody = { type: 'headings', siteId: 'c2473d89-e997-458d-a86d-b4096649c12b' };
  // const messageBody = {
  //   type: 'llm-blocked',
  //   siteId: 'b1555a54-48b4-47ee-97c1-438257bd3839',
  //   auditContext: {
  //     next: 'check-llm-blocked',
  //     auditId: 'a263123c-9f9a-44a8-9531-955884563472',
  //     type: 'llm-blocked',
  //     fullAuditRef: 'llm-blocked::cisco.com',
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
