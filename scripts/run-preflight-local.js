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

// Load environment variables
dotenv.config();

// Mock data for testing
const createMockContext = () => {
  const mockLog = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  const mockSite = {
    getId: () => 'test-site-id',
  };

  const mockJob = {
    getId: () => 'test-job-id',
    getStatus: () => AsyncJob.Status.IN_PROGRESS,
    getMetadata: () => ({
      payload: {
        urls: [
          'https://main--adobe-screens-brandads--anagarwa.aem.page/',
          'https://main--adobe-screens-brandads--anagarwa.aem.page/test-page'
        ],
        step: 'identify',
        checks: ['body-size', 'lorem-ipsum', 'h1-count'],
        enableAuthentication: false
      }
    })
  };

  const mockS3Client = {
    listObjectsV2: async () => ({
      Contents: [
        { Key: 'scrapes/test-site-id/scrape.json' },
        { Key: 'scrapes/test-site-id/test-page/scrape.json' }
      ]
    }),
    getObject: async ({ Key }) => {
      // Mock scraped data
      const mockData = {
        'scrapes/test-site-id/scrape.json': {
          finalUrl: 'https://main--adobe-screens-brandads--anagarwa.aem.page/',
          scrapeResult: {
            rawBody: `
              <!DOCTYPE html>
              <html>
              <head>
                <title>Inside Adobe - AEM Screens!</title>
                <meta name="description" content="Decorative double Helix">
              </head>
              <body>
                <h1>Inside Adobe - AEM Screens!</h1>
                <p>Decorative double Helix</p>
                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
              </body>
              </html>
            `
          }
        },
        'scrapes/test-site-id/test-page/scrape.json': {
          finalUrl: 'https://main--adobe-screens-brandads--anagarwa.aem.page/test-page',
          scrapeResult: {
            rawBody: `
              <!DOCTYPE html>
              <html>
              <head>
                <title>Test Page</title>
                <meta name="description" content="This is a test page">
              </head>
              <body>
                <h1>Test page</h1>
                <p>This is a test page with some content.</p>
              </body>
              </html>
            `
          }
        }
      };

      return {
        Body: {
          transformToString: async () => JSON.stringify(mockData[Key])
        }
      };
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

// Helper function to get S3 object keys using prefix
const getObjectKeysUsingPrefix = async (s3Client, bucketName, prefix, log) => {
  try {
    const response = await s3Client.listObjectsV2({ Bucket: bucketName, Prefix: prefix });
    return response.Contents.map(obj => obj.Key);
  } catch (error) {
    log.error('Error getting S3 object keys:', error);
    return [];
  }
};

// Helper function to get object from S3 key
const getObjectFromKey = async (s3Client, bucketName, key, log) => {
  try {
    const response = await s3Client.getObject({ Bucket: bucketName, Key: key });
    const data = await response.Body.transformToString();
    return JSON.parse(data);
  } catch (error) {
    log.error(`Error getting object from S3 key ${key}:`, error);
    return null;
  }
};

// Mock utility functions
const saveIntermediateResults = async (context, results, description) => {
  context.log.info(`[preflight-audit] Saving intermediate results for: ${description}`);
  return results;
};

// Main execution function
async function runPreflightLocal() {
  console.log('🚀 Starting local preflight audit...\n');

  try {
    // Create mock context
    const context = createMockContext();

    // Add mock utility functions to context
    context.getObjectKeysUsingPrefix = getObjectKeysUsingPrefix;
    context.getObjectFromKey = getObjectFromKey;
    context.saveIntermediateResults = saveIntermediateResults;

    console.log('📋 Test URLs:');
    console.log('  - https://main--adobe-screens-brandads--anagarwa.aem.page/');
    console.log('  - https://main--adobe-screens-brandads--anagarwa.aem.page/test-page\n');

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
  runPreflightLocal();
}

export { runPreflightLocal, createMockContext }; 