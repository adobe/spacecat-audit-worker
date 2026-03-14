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
 * CLI Script to validate broken internal link suggestions marked as FIXED.
 * STANDALONE VERSION - can run from main branch
 *
 * Usage:
 *   node scripts/run-validate-fixed-suggestions-standalone.js --siteId <site-id>
 *
 * Options:
 *   --siteId <id>   Validate specific site by ID
 *   --output <file> Output results to JSON file (optional)
 *   --verbose       Enable verbose logging
 *
 * Environment:
 *   Requires AWS credentials and DynamoDB table configurations in .env
 */

import 'dotenv/config';
import wrap from '@adobe/helix-shared-wrap';
import dataAccess from '@adobe/spacecat-shared-data-access';
import {
  validateFixedSuggestions,
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

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    siteId: null,
    siteIds: [],
    output: null,
    verbose: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--siteId' && args[i + 1]) {
      options.siteId = args[i + 1];
      i += 1;
    } else if (arg === '--siteIds' && args[i + 1]) {
      // Accept comma-separated list of site IDs
      options.siteIds = args[i + 1].split(',').map((id) => id.trim());
      i += 1;
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[i + 1];
      i += 1;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/run-validate-fixed-suggestions-standalone.js [options]

Options:
  --siteId <id>        Validate specific site by ID
  --siteIds <ids>      Validate multiple sites (comma-separated)
  --output <file>      Output results to file (JSON or CSV based on extension)
  --verbose, -v        Enable verbose logging
  --help, -h           Show this help message

Environment Variables:
  Requires .env file with AWS credentials and DynamoDB table configurations.
  See .env.example for required variables.

Examples:
  node scripts/run-validate-fixed-suggestions-standalone.js --siteId abc-123
  node scripts/run-validate-fixed-suggestions-standalone.js --siteId abc-123 --output results.json
  node scripts/run-validate-fixed-suggestions-standalone.js --siteId abc-123 --output results.csv
  node scripts/run-validate-fixed-suggestions-standalone.js --siteIds "site1,site2,site3" --verbose
      `);
      process.exit(0);
    }
  }

  return options;
}

// Store options and log globally so they can be accessed in the wrapped function
let globalOptions;
let globalLog;
let globalResult;

// The main validation function that will be wrapped with dataAccess middleware
async function runValidation(request, context) {
  const { dataAccess: dataAccessObj } = context;

  if (!dataAccessObj) {
    throw new Error('Data access not available in context');
  }

  globalLog.info('Data access initialized successfully');

  if (globalOptions.siteId) {
    globalLog.info(`Validating site: ${globalOptions.siteId}`);
    globalResult = await validateFixedSuggestions({
      dataAccess: dataAccessObj,
      log: globalLog,
      siteId: globalOptions.siteId,
    });
  } else if (globalOptions.siteIds.length > 0) {
    globalLog.info(`Validating ${globalOptions.siteIds.length} sites: ${globalOptions.siteIds.join(', ')}`);
    globalResult = await validateFixedSuggestionsForSites({
      dataAccess: dataAccessObj,
      log: globalLog,
      siteIds: globalOptions.siteIds,
    });
  }

  return { status: 200 };
}

// Wrap the validation function with data access middleware
const wrappedValidation = wrap(runValidation).with(dataAccess);

async function main() {
  globalOptions = parseArgs();
  globalLog = createLogger(globalOptions.verbose);

  if (!globalOptions.siteId && globalOptions.siteIds.length === 0) {
    console.error('Error: Please provide --siteId <id> or --siteIds <comma-separated-ids>');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  globalLog.info('Starting validation of FIXED suggestions for broken internal links...');
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
    if (globalOptions.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }

  if (!globalResult) {
    globalLog.error('No validation result produced');
    process.exit(1);
  }

  // Generate and display report
  console.log('\n');
  console.log(generateReport(globalResult));

  // Output to file if requested
  if (globalOptions.output) {
    const fs = await import('fs');
    const path = await import('path');
    const ext = path.extname(globalOptions.output).toLowerCase();
    
    if (ext === '.csv') {
      // Generate CSV output with ALL suggestions
      const csvLines = [
        'Suggestion ID,Site ID,Opportunity ID,URL To,URL From,Title,Has Fix Entity,Fix Count,Validation Status,Reason,Is Still Broken',
      ];
      
      // Use allSuggestionsWithStatus if available (includes ALL suggestions)
      const suggestionsToExport = globalResult.allSuggestionsWithStatus || globalResult.stillBrokenSuggestions;
      
      for (const suggestion of suggestionsToExport) {
        // Map validation status to human-readable reason
        let reason = '';
        switch (suggestion.validationStatus) {
          case 'link-removed':
            reason = 'Link removed from page (genuinely fixed)';
            break;
          case 'now-working':
            reason = 'Link present but now working (genuinely fixed)';
            break;
          case 'still-broken':
            reason = 'Link still present and broken (NOT fixed)';
            break;
          case 'scrape-error':
            reason = `Could not validate: ${suggestion.error || 'Unknown error'}`;
            break;
          case 'missing-data':
            reason = `Missing data: ${suggestion.error || 'urlFrom or urlTo missing'}`;
            break;
          default:
            reason = suggestion.reason || suggestion.validationStatus || 'Unknown';
        }
        
        const csvRow = [
          suggestion.suggestionId || '',
          suggestion.siteId || '',
          suggestion.opportunityId || '',
          suggestion.urlTo || '',
          suggestion.urlFrom || '',
          (suggestion.title || '').replace(/"/g, '""'), // Escape quotes
          suggestion.hasFixEntity ? 'Yes' : 'No',
          suggestion.fixCount || '0',
          suggestion.validationStatus || '',
          reason,
          suggestion.isStillBroken ? 'Yes' : 'No',
        ].map((field) => `"${field}"`).join(',');
        csvLines.push(csvRow);
      }
      
      fs.writeFileSync(globalOptions.output, csvLines.join('\n'));
      globalLog.info(`CSV results written to: ${globalOptions.output} (${suggestionsToExport.length} suggestions)`);
    } else {
      // Default to JSON
      fs.writeFileSync(globalOptions.output, JSON.stringify(globalResult, null, 2));
      globalLog.info(`JSON results written to: ${globalOptions.output}`);
    }
  }

  // Exit with appropriate code
  if (globalResult.stillBrokenCount > 0) {
    globalLog.warn(`Found ${globalResult.stillBrokenCount} suggestions marked as FIXED that are still broken!`);
    process.exit(0); // Still success, just with findings
  } else {
    globalLog.info('All FIXED suggestions are valid!');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
