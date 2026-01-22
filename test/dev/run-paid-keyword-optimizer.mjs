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

/**
 * Manual test script for paid-keyword-optimizer audit
 *
 * Usage:
 *   node test/dev/run-paid-keyword-optimizer.mjs <siteId> [baseUrl]
 *
 * Examples:
 *   node test/dev/run-paid-keyword-optimizer.mjs 12345678-1234-1234-1234-123456789abc
 *   node test/dev/run-paid-keyword-optimizer.mjs 12345678-1234-1234-1234-123456789abc https://www.example.com
 *
 * Environment variables are loaded from .env file automatically.
 * Required env vars:
 *   - S3_IMPORTER_BUCKET_NAME
 *   - AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)
 *
 * Optional env vars:
 *   - RUM_METRICS_DATABASE (defaults to 'rum_metrics')
 *   - RUM_METRICS_COMPACT_TABLE (defaults to 'compact_metrics')
 */

import 'dotenv/config';
import {
  paidKeywordOptimizerRunner,
} from '../../src/paid-keyword-optimizer/handler.js';

// Configuration
const SITE_ID = process.argv[2];
const BASE_URL = process.argv[3] || process.env.SITE_BASE_URL || 'https://www.example.com';
const CUT_OFF_BOUNCE_RATE = 0.4; // Same threshold as in handler.js

if (!SITE_ID) {
  console.error('Usage: node test/dev/run-paid-keyword-optimizer.mjs <siteId> [baseUrl]');
  console.error('');
  console.error('Examples:');
  console.error('  node test/dev/run-paid-keyword-optimizer.mjs 12345678-1234-1234-1234-123456789abc');
  console.error('  node test/dev/run-paid-keyword-optimizer.mjs 12345678-1234-1234-1234-123456789abc https://www.adobe.com');
  process.exit(1);
}

// Mock logger
const log = {
  info: (...args) => console.log('[INFO]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};

// Mock site object
const mockSite = {
  getId: () => SITE_ID,
  getSiteId: () => SITE_ID,
  getBaseURL: () => BASE_URL,
  getDeliveryType: () => 'aem-edge',
};

// Environment variables (loaded from .env)
const env = {
  S3_IMPORTER_BUCKET_NAME: process.env.S3_IMPORTER_BUCKET_NAME,
  RUM_METRICS_DATABASE: process.env.RUM_METRICS_DATABASE || 'rum_metrics',
  RUM_METRICS_COMPACT_TABLE: process.env.RUM_METRICS_COMPACT_TABLE || 'compact_metrics',
  PAID_DATA_THRESHOLD: process.env.PAID_DATA_THRESHOLD || 1000,
};

// Validate required env vars
if (!env.S3_IMPORTER_BUCKET_NAME) {
  console.error('Error: S3_IMPORTER_BUCKET_NAME environment variable is required');
  console.error('Make sure your .env file contains this variable');
  process.exit(1);
}

// Build context for the handler
function buildContext() {
  return {
    log,
    env,
    runtime: { name: 'manual-test', region: process.env.AWS_REGION || 'us-east-1' },
    func: { package: 'test', version: '1.0.0', name: 'paid-keyword-optimizer-test' },
  };
}

async function runAudit() {
  console.log('='.repeat(80));
  console.log('Paid Keyword Optimizer Audit - Manual Test');
  console.log('='.repeat(80));
  console.log(`Site ID: ${SITE_ID}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`S3 Bucket: ${env.S3_IMPORTER_BUCKET_NAME}`);
  console.log(`RUM Database: ${env.RUM_METRICS_DATABASE}.${env.RUM_METRICS_COMPACT_TABLE}`);
  console.log('Mystique: SKIPPED (manual test mode)');
  console.log('='.repeat(80));

  const context = buildContext();
  const auditUrl = BASE_URL;

  try {
    // Run the audit
    console.log('\n[Step 1] Running paidKeywordOptimizerRunner...\n');
    const result = await paidKeywordOptimizerRunner(auditUrl, context, mockSite);

    console.log('\n' + '='.repeat(80));
    console.log('AUDIT RESULT SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Page Views: ${result.auditResult.totalPageViews.toLocaleString()}`);
    console.log(`Average Bounce Rate: ${(result.auditResult.averageBounceRate * 100).toFixed(2)}%`);
    console.log(`Predominantly Paid Pages: ${result.auditResult.predominantlyPaidCount}`);
    console.log(`Temporal Condition: ${result.auditResult.temporalCondition}`);

    if (result.auditResult.predominantlyPaidPages.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('PREDOMINANTLY PAID PAGES (sorted by traffic loss)');
      console.log('-'.repeat(80));

      // Sort by traffic loss descending
      const sortedPages = [...result.auditResult.predominantlyPaidPages]
        .sort((a, b) => b.trafficLoss - a.trafficLoss);

      sortedPages.forEach((page, idx) => {
        const bounceWarning = page.bounceRate >= CUT_OFF_BOUNCE_RATE ? ' ⚠️ HIGH' : '';
        console.log(`\n${idx + 1}. ${page.url || page.path}`);
        console.log(`   Bounce Rate: ${(page.bounceRate * 100).toFixed(2)}%${bounceWarning}`);
        console.log(`   Page Views: ${page.pageViews.toLocaleString()}`);
        console.log(`   Traffic Loss: ${page.trafficLoss.toFixed(2)}`);
        console.log(`   Engagement Rate: ${(page.engagementRate * 100).toFixed(2)}%`);
      });

      // Show what would be sent to Mystique
      const qualifyingPages = sortedPages.filter((page) => page.bounceRate >= CUT_OFF_BOUNCE_RATE);

      console.log('\n' + '-'.repeat(80));
      console.log('MYSTIQUE ANALYSIS (SKIPPED IN MANUAL TEST)');
      console.log('-'.repeat(80));

      if (qualifyingPages.length > 0) {
        console.log(`\nWould send ${qualifyingPages.length} pages with bounce rate >= ${(CUT_OFF_BOUNCE_RATE * 100)}%:`);
        qualifyingPages.forEach((page, idx) => {
          console.log(`  ${idx + 1}. ${page.url || page.path} (bounce: ${(page.bounceRate * 100).toFixed(1)}%)`);
        });

        console.log('\n[Sample Mystique Message Payload]:');
        const samplePayload = {
          type: 'guidance:paid-keyword-optimizer',
          siteId: SITE_ID,
          url: qualifyingPages[0].url,
          data: {
            urls: qualifyingPages.map((p) => p.url),
          },
        };
        console.log(JSON.stringify(samplePayload, null, 2));
      } else {
        console.log(`\nNo pages meet the bounce rate threshold (>= ${(CUT_OFF_BOUNCE_RATE * 100)}%)`);
        console.log('Mystique would NOT be called.');
      }
    } else {
      console.log('\nNo predominantly paid pages found.');
    }

    console.log('\n' + '='.repeat(80));
    console.log('Audit completed successfully!');
    console.log('='.repeat(80));

    // Optionally dump full JSON
    if (process.env.VERBOSE === 'true') {
      console.log('\n[Full Audit Result JSON]');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\nTip: Set VERBOSE=true to see full JSON output');
    }
  } catch (error) {
    console.error('\n[ERROR] Audit failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runAudit();
