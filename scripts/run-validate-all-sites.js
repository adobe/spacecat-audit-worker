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
 * Script to validate ALL sites, skipping publish and main-- sites
 */

import 'dotenv/config';
import wrap from '@adobe/helix-shared-wrap';
import dataAccess from '@adobe/spacecat-shared-data-access';
import {
  validateFixedSuggestionsForSites,
  generateReport,
} from './validate-fixed-suggestions-standalone.js';

// Simple console logger
const createLogger = (verbose = false) => ({
  info: (msg) => console.log(`[INFO] ${msg}`),
  debug: (msg) => { if (verbose) console.log(`[DEBUG] ${msg}`); },
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
});

// Store globals
let globalLog;
let globalResult;
let csvStream;
let outputFile;

// The main validation function
async function runValidation(request, context) {
  const { dataAccess: dataAccessObj } = context;

  if (!dataAccessObj) {
    throw new Error('Data access not available in context');
  }

  globalLog.info('Data access initialized successfully');
  globalLog.info('Fetching all sites...');

  // Fetch all sites
  const allSites = await dataAccessObj.Site.all();
  globalLog.info(`Found ${allSites.length} total sites`);

  // Filter out publish and main-- sites
  const filteredSites = allSites.filter((site) => {
    const baseURL = site.getBaseURL();
    
    // Skip publish sites
    if (baseURL.startsWith('https://publish')) {
      globalLog.debug(`Skipping publish site: ${baseURL}`);
      return false;
    }
    
    // Skip main-- sites
    if (baseURL.includes('https://main--')) {
      globalLog.debug(`Skipping main-- site: ${baseURL}`);
      return false;
    }
    
    return true;
  });

  globalLog.info(`Filtered to ${filteredSites.length} sites (skipped ${allSites.length - filteredSites.length} publish/main-- sites)`);

  // Extract site IDs
  const siteIds = filteredSites.map((site) => site.getId());

  globalLog.info(`Starting validation for ${siteIds.length} sites...`);

  // Run validation with CSV streaming if output file is provided
  globalResult = await validateFixedSuggestionsForSites({
    dataAccess: dataAccessObj,
    log: globalLog,
    siteIds,
    csvStream, // Pass the stream for line-by-line writing
  });

  return { status: 200 };
}

// Wrap the validation function with data access middleware
const wrappedValidation = wrap(runValidation).with(dataAccess);

async function main() {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  outputFile = process.argv.find((arg, i) => process.argv[i - 1] === '--output');
  
  globalLog = createLogger(verbose);

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
Usage: node scripts/run-validate-all-sites.js [options]

Options:
  --output <file>      Output results to file (JSON or CSV based on extension)
  --verbose, -v        Enable verbose logging
  --help, -h           Show this help message

This script will:
- Fetch all sites from the database
- Skip sites starting with "https://publish"
- Skip sites containing "https://main--"
- Validate all remaining sites
- Write results line-by-line to CSV (streaming mode)

Examples:
  node scripts/run-validate-all-sites.js
  node scripts/run-validate-all-sites.js --output all-sites-validation.csv
  node scripts/run-validate-all-sites.js --verbose --output results.json
    `);
    process.exit(0);
  }

  // Setup CSV streaming if output is CSV
  if (outputFile) {
    const path = await import('path');
    const ext = path.extname(outputFile).toLowerCase();
    
    if (ext === '.csv') {
      const fs = await import('fs');
      csvStream = fs.createWriteStream(outputFile);
      
      // Write CSV header
      csvStream.write('Suggestion ID,Site ID,Opportunity ID,URL To,URL From,Title,Has Fix Entity,Fix Count,Validation Status,Reason,Is Still Broken\n');
      
      globalLog.info(`Writing results line-by-line to: ${outputFile}`);
    }
  }

  globalLog.info('Starting validation of FIXED suggestions for ALL sites...');
  globalLog.info('Initializing data access...');

  // Create context for the wrapped function
  const context = {
    log: globalLog,
    env: process.env,
    runtime: { name: 'script' },
    func: { version: '1.0.0' },
  };

  try {
    await wrappedValidation({}, context);
  } catch (error) {
    globalLog.error(`Validation failed: ${error.message}`);
    if (verbose) {
      console.error(error.stack);
    }
    
    // Close CSV stream if open
    if (csvStream) {
      csvStream.end();
    }
    
    process.exit(1);
  }

  // Close CSV stream if it was used
  if (csvStream) {
    csvStream.end();
    globalLog.info(`CSV file closed: ${outputFile}`);
  }

  if (!globalResult) {
    globalLog.error('No validation result produced');
    process.exit(1);
  }

  // Generate and display report
  console.log('\n');
  console.log(generateReport(globalResult));

  // Output to JSON file if requested (CSV was already written line-by-line)
  if (outputFile && !csvStream) {
    const fs = await import('fs');
    fs.writeFileSync(outputFile, JSON.stringify(globalResult, null, 2));
    globalLog.info(`JSON results written to: ${outputFile}`);
  }

  // Exit with appropriate code
  if (globalResult.stillBrokenCount > 0) {
    globalLog.warn(`Found ${globalResult.stillBrokenCount} suggestions marked as FIXED that are still broken!`);
    process.exit(0);
  } else {
    globalLog.info('All FIXED suggestions are valid!');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
