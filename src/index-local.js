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
process.env.SPACECAT_SKIP_VAULT_SECRETS = '1';

const { main: universalMain } = await import('./index.js');

/**
 * Local testing entry point
 *
 * Vault is skipped (`SPACECAT_SKIP_VAULT_SECRETS` is set before loading `index.js`). Provide
 * secrets via `.env` / shell instead. To run the full stack including Vault, invoke `index.js`
 * with `SPACECAT_SKIP_VAULT_SECRETS` unset.
 *
 * Required environment variables:
 *   SPACECAT_API_BASE_URL - e.g., https://spacecat-services--api-service.aem-dev.hlx.page
 *   SPACECAT_API_KEY - Your API key
 *   QUEUE_SPACECAT_TO_MYSTIQUE - Queue name (e.g., spacecat-to-mystique)
 *
 * Before running, seed test data:
 *   ./scripts/seed-test-data.sh <siteId> <apiKey> [baseUrl]
 */
export const main = async () => {
  // Change this to test different audit types
  const AUDIT_TYPE = process.env.AUDIT_TYPE || 'sitemap';
  const SITE_ID = process.env.SITE_ID || 'cfaa3c1b-58a7-4cc8-bec9-ba9d7e201894';

  const messageBody = {
    type: AUDIT_TYPE,
    siteId: SITE_ID,
    auditContext: {
      next: `check-${AUDIT_TYPE}`,
      auditId: 'a263123c-9f9a-44a8-9531-955884563472',
      type: AUDIT_TYPE,
      fullAuditRef: `${AUDIT_TYPE}::example.com`,
    },
  };

  console.log(`\n=== Running ${AUDIT_TYPE} for siteId: ${SITE_ID} ===\n`);

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
      debug: console.log, // Enable debug logging for local testing
    },
    runtime: {
      region: 'us-east-1',
    },
    func: {
      name: 'audit-worker',
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
