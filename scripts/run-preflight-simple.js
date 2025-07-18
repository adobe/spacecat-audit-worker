#!/usr/bin/env node

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

import dotenv from 'dotenv';
import { preflightAudit } from '../src/preflight/handler.js';
import { AsyncJob } from '@adobe/spacecat-shared-data-access';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../src/utils/s3-utils.js';

// Load environment variables
dotenv.config();

// Configuration - Modify these values to test different scenarios
const TEST_CONFIG = {
  // Test URLs - modify these to test different URL formats
  urls: [
    'https://main--adobe-screens-brandads--anagarwa.aem.page',
    'https://main--adobe-screens-brandads--anagarwa.aem.page/',
    'https://main--adobe-screens-brandads--anagarwa.aem.page/test-page'
  ],
  
  // Audit checks to run
  checks: ['body-size', 'lorem-ipsum', 'h1-count'],
  
  // Audit step
  step: 'identify',
  
  // Enable authentication
  enableAuthentication: false,
  
  // Site ID
  siteId: 'test-site-id',
  
  // Job ID
  jobId: 'test-job-id'
};

// Mock S3 data - modify this to test different scenarios
const createMockS3Data = () => {
  const mockData = {};
  
  TEST_CONFIG.urls.forEach(url => {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.replace(/\/$/, '');
    const key = `scrapes/${TEST_CONFIG.siteId}${pathname}/scrape.json`;
    
    mockData[key] = {
      finalUrl: url, // This is what we want to test - the finalUrl format
      scrapeResult: {
        rawBody: `
          <!DOCTYPE html>
          <html>
          <head>
            <title>Test Page</title>
            <meta name="description" content="Test description">
          </head>
          <body>
            <h1>Test Page Title</h1>
            <p>This is test content with some lorem ipsum text.</p>
            <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
          </body>
          </html>
        `
      }
    };
  });
  
  return mockData;
};

// Create mock context
const createMockContext = () => {
  const mockLog = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  const mockSite = {
    getId: () => TEST_CONFIG.siteId,
  };

  const mockJob = {
    getId: () => TEST_CONFIG.jobId,
    getStatus: () => AsyncJob.Status.IN_PROGRESS,
    getMetadata: () => ({
      payload: {
        urls: TEST_CONFIG.urls,
        step: TEST_CONFIG.step,
        checks: TEST_CONFIG.checks,
        enableAuthentication: TEST_CONFIG.enableAuthentication
      }
    })
  };

  const s3Data = createMockS3Data();
  
  const mockS3Client = {
    send: async (command) => {
      // Mock the AWS SDK v3 command interface
      if (command.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: Object.keys(s3Data).map(key => ({ Key: key })),
          NextContinuationToken: null
        };
      } else if (command.constructor.name === 'GetObjectCommand') {
        const key = command.input.Key;
        const data = s3Data[key];
        if (!data) {
          throw new Error(`No data found for key: ${key}`);
        }
        
        return {
          Body: {
            transformToString: async () => JSON.stringify(data)
          },
          ContentType: 'application/json'
        };
      }
      throw new Error(`Unsupported command: ${command.constructor.name}`);
    }
  };

  const mockDataAccess = {
    AsyncJob: {
      findById: async () => ({
        setStatus: () => {},
        setResultType: () => {},
        setResult: () => {},
        setEndedAt: () => {},
        setError: () => {},
        save: async () => {}
      })
    }
  };

  const mockEnv = {
    S3_SCRAPER_BUCKET_NAME: 'test-bucket'
  };

  return {
    site: mockSite,
    job: mockJob,
    s3Client: mockS3Client,
    log: mockLog,
    dataAccess: mockDataAccess,
    env: mockEnv
  };
};



const saveIntermediateResults = async (context, results, description) => {
  context.log.info(`[preflight-audit] Saving intermediate results for: ${description}`);
  return results;
};

// Main execution function
async function runPreflightSimple() {
  console.log('🚀 Starting simple preflight audit...\n');
  console.log('📋 Configuration:');
  console.log(`  URLs: ${JSON.stringify(TEST_CONFIG.urls)}`);
  console.log(`  Checks: ${JSON.stringify(TEST_CONFIG.checks)}`);
  console.log(`  Step: ${TEST_CONFIG.step}`);
  console.log(`  Site ID: ${TEST_CONFIG.siteId}`);
  console.log(`  Job ID: ${TEST_CONFIG.jobId}\n`);

  try {
    // Create mock context
    const context = createMockContext();

    // Add mock utility functions to context
    context.saveIntermediateResults = saveIntermediateResults;

    console.log('🔍 Running preflight audit...\n');

    // Run the preflight audit
    await preflightAudit(context);

    console.log('\n✅ Preflight audit completed successfully!');
    console.log('📊 Check the logs above for detailed results.');

  } catch (error) {
    console.error('\n❌ Preflight audit failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  runPreflightSimple();
}

export { runPreflightSimple, createMockContext, TEST_CONFIG }; 