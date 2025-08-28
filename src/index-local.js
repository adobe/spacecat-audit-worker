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
  // const messageBody = {
  //   type: 'llm-error-pages',
  //   siteId: '028147f6-4a7a-4325-a758-376c460a559c',
  //   auditContext: {
  //     type: 'llm-error-pages',
  //     fullAuditRef: 'scrapes/40f377b0-2242-41d6-b215-e9ff8ace8b3d/',
  //   },
  // };
  const messageBody = {
    id: '7d657eec-7cad-4fbe-8de4-6bfd77b5acab',
    type: 'guidance:llm-error-pages',
    auditId: 'llm-error-pages-audit',
    siteId: '028147f6-4a7a-4325-a758-376c460a559c',
    data: {
      brokenLinks: [
        {
          urlFrom: 'ChatGPT, Perplexity',
          urlTo: 'https://akamai.synth/products/category_d/product_4',
          suggestionId: 'llm-404-suggestion-w34-2025-0',
          suggestedUrls: [
            'https://akamai.synth/',
          ],
          aiRationale: 'No alternative URLs were provided for analysis. According to the strict domain and list adherence rules, when no suitable same-domain alternatives exist, only the base URL of the domain should be suggested. This ensures users remain on the correct domain and preserves as much SEO value as possible, even though the specific product content is unavailable.',
        },
      ],
      opportunityId: 'llm-404-w34-2025',
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
