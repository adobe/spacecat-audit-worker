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
  // ======================================================================
  // CONFIGURE YOUR TEST HERE
  // ======================================================================
  const TEST_SITE_ID = 'f35ffe86-4d9b-4c13-a20b-9e6fc6231ead';
  const TEST_AUDIT_ID = 'test-audit-step3';
  // ======================================================================

  // Start at Step 3: run-audit-and-generate-suggestions
  // This assumes scraping is already done and data is in S3
  const messageBody = {
    type: 'image-optimization',
    siteId: TEST_SITE_ID,
    auditContext: {
      next: 'run-audit-and-generate-suggestions',
      auditId: TEST_AUDIT_ID,
      type: 'image-optimization',
      fullAuditRef: `scrapes/${TEST_SITE_ID}/`,
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
      debug: console.log, // Enable debug logging
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

  console.log('\n🚀 Running image-optimization audit (Step 3)...\n');
  console.log('📋 Configuration:');
  console.log(`   Site ID: ${TEST_SITE_ID}`);
  console.log(`   Audit ID: ${TEST_AUDIT_ID}`);
  console.log('   Step: 3️⃣  run-audit-and-generate-suggestions');
  console.log('   Action: Analyze images from S3 and generate optimization suggestions');
  console.log('   Features:');
  console.log('     • Real DM format verification (AVIF, WebP, JPEG, PNG)');
  console.log('     • Oversized image detection');
  console.log('     • Missing dimensions, lazy loading checks');
  console.log('     • And more...');
  console.log(`   S3 Bucket: ${process.env.S3_SCRAPER_BUCKET_NAME || 'NOT SET'}\n`);

  await universalMain(message, context);
};
