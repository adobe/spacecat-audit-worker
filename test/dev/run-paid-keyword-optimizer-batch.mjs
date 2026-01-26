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
 * Batch test script for paid-keyword-optimizer audit
 *
 * Usage:
 *   node test/dev/run-paid-keyword-optimizer-batch.mjs <sites-csv-file>
 *
 * Example:
 *   node test/dev/run-paid-keyword-optimizer-batch.mjs test/dev/sites.csv
 *
 * sites.csv format (tab-separated, with header row):
 *   hostname	siteId
 *   https://www.example.com	12345678-1234-1234-1234-123456789abc
 *   https://www.another.com	87654321-4321-4321-4321-cba987654321
 *
 * Output:
 *   One CSV file per site saved to test/dev/temp/<hostname>.csv
 *   (hostname without protocol, e.g., www.example.com.csv)
 *
 * Environment variables are loaded from .env file automatically.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  paidKeywordOptimizerRunner,
} from '../../src/paid-keyword-optimizer/handler.js';

// Get directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const SITES_FILE = process.argv[2];
const CUT_OFF_BOUNCE_RATE = 0.4; // Same threshold as in handler.js
const TEMP_DIR = path.join(__dirname, 'temp');

if (!SITES_FILE) {
  console.error('Usage: node test/dev/run-paid-keyword-optimizer-batch.mjs <sites-csv-file>');
  console.error('');
  console.error('Example:');
  console.error('  node test/dev/run-paid-keyword-optimizer-batch.mjs test/dev/sites.csv');
  console.error('');
  console.error('sites.csv format (tab-separated, with header row):');
  console.error('  hostname\\tsiteId');
  console.error('  https://www.example.com\\tuuid-here');
  console.error('  https://www.another.com\\tuuid-here');
  process.exit(1);
}

// Parse tab-separated CSV file
function parseTsvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row');
  }

  // Parse header to find column indices
  const header = lines[0].split('\t').map((col) => col.trim().toLowerCase());
  const hostnameIdx = header.indexOf('hostname');
  const siteIdIdx = header.indexOf('siteid');

  if (hostnameIdx === -1 || siteIdIdx === -1) {
    throw new Error('CSV header must contain "hostname" and "siteId" columns (tab-separated)');
  }

  // Parse data rows
  const parsedSites = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    const cols = line.split('\t');
    const hostname = cols[hostnameIdx]?.trim();
    const siteId = cols[siteIdIdx]?.trim();

    if (!hostname || !siteId) {
      throw new Error(`Row ${i + 1} is missing hostname or siteId`);
    }

    parsedSites.push({ hostname, siteId });
  }

  return parsedSites;
}

// Load and validate sites file
let sites;
try {
  sites = parseTsvFile(SITES_FILE);

  if (sites.length === 0) {
    throw new Error('No sites found in CSV file');
  }
} catch (error) {
  console.error(`Error reading sites file: ${error.message}`);
  process.exit(1);
}

// Mock logger (quieter for batch mode)
const log = {
  info: (...args) => console.log('[INFO]', ...args),
  debug: () => {}, // Suppress debug in batch mode
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
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
    func: { package: 'test', version: '1.0.0', name: 'paid-keyword-optimizer-batch' },
  };
}

// Create mock site object
function createMockSite(siteId, hostname) {
  return {
    getId: () => siteId,
    getSiteId: () => siteId,
    getBaseURL: () => hostname,
    getDeliveryType: () => 'aem-edge',
  };
}

// Ensure temp directory exists
function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    console.log(`Created temp directory: ${TEMP_DIR}`);
  }
}

// Write URLs to CSV file
function writeCsv(urls, outputPath) {
  const header = 'url';
  const rows = urls.map((url) => url);
  const content = [header, ...rows].join('\n');
  fs.writeFileSync(outputPath, content, 'utf-8');
}

// Extract hostname without protocol for filename
function getHostnameForFilename(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.host; // e.g., "www.example.com"
  } catch {
    // If URL parsing fails, strip protocol manually
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

async function runBatchAudit() {
  console.log('='.repeat(80));
  console.log('Paid Keyword Optimizer Audit - Batch Mode');
  console.log('='.repeat(80));
  console.log(`Sites to process: ${sites.length}`);
  console.log(`Bounce rate threshold: ${(CUT_OFF_BOUNCE_RATE * 100)}%`);
  console.log(`S3 Bucket: ${env.S3_IMPORTER_BUCKET_NAME}`);
  console.log('Mystique: SKIPPED (batch test mode)');
  console.log('='.repeat(80));

  // Ensure temp directory exists upfront
  ensureTempDir();

  const context = buildContext();
  const results = [];
  const outputFiles = [];
  let totalQualifyingUrls = 0;

  for (let i = 0; i < sites.length; i += 1) {
    const { hostname, siteId } = sites[i];
    console.log(`\n[${i + 1}/${sites.length}] Processing: ${hostname} (${siteId})`);

    const mockSite = createMockSite(siteId, hostname);

    try {
      const result = await paidKeywordOptimizerRunner(hostname, context, mockSite);

      const qualifyingPages = (result.auditResult.predominantlyPaidPages || [])
        .filter((page) => page.bounceRate >= CUT_OFF_BOUNCE_RATE);

      const urls = qualifyingPages.map((page) => page.url);

      // Write CSV file for this site
      const hostnameForFile = getHostnameForFilename(hostname);
      const outputPath = path.join(TEMP_DIR, `${hostnameForFile}.csv`);
      writeCsv(urls, outputPath);
      outputFiles.push(outputPath);

      totalQualifyingUrls += urls.length;

      results.push({
        hostname,
        siteId,
        status: 'success',
        totalPages: result.auditResult.predominantlyPaidCount,
        qualifyingPages: urls.length,
        outputFile: outputPath,
      });

      console.log(`   ✓ Found ${result.auditResult.predominantlyPaidCount} predominantly paid pages`);
      console.log(`   ✓ ${urls.length} pages with bounce rate >= ${(CUT_OFF_BOUNCE_RATE * 100)}%`);
      console.log(`   ✓ Saved to: ${hostnameForFile}.csv`);
    } catch (error) {
      console.error(`   ✗ Error: ${error.message}`);
      results.push({
        hostname,
        siteId,
        status: 'error',
        error: error.message,
      });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('BATCH SUMMARY');
  console.log('='.repeat(80));

  const successful = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'error');

  console.log(`Sites processed: ${sites.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Total qualifying URLs: ${totalQualifyingUrls}`);
  console.log(`\nOutput directory: ${TEMP_DIR}`);
  console.log(`CSV files created: ${outputFiles.length}`);

  if (failed.length > 0) {
    console.log('\nFailed sites:');
    failed.forEach((r) => {
      console.log(`  - ${r.hostname}: ${r.error}`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('Batch processing completed!');
  console.log('='.repeat(80));
}

runBatchAudit();
