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

import { appendFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../common/logger.js';
import { fetchSuggestions } from '../common/fetch-suggestions.js';
import { exportToCSV, exportSummary } from '../common/csv-exporter.js';
import { importFromCSV } from '../common/csv-importer.js';
import { createClient } from '../client/spacecat-client.js';
import { getChecker, getBatchChecker, cleanupCheckers } from './checkers/index.js';
import {
  VALID_OPPORTUNITY_TYPES,
  SUGGESTION_STATUSES,
  DEFAULTS,
  FIX_STATUSES,
} from './config.js';

/* eslint-disable no-underscore-dangle */
// Get current directory for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/* eslint-enable no-underscore-dangle */

/**
 * Print usage information
 */
function printUsage() {
  /* eslint-disable-next-line no-console */
  console.log(`
Usage: node oppty-scripts/opportunities/index.js [options]

Options:
  --siteId=<uuid>              (Required) Site UUID
  --type=<type>                (Required) Opportunity type
                               Valid types: ${VALID_OPPORTUNITY_TYPES.join(', ')}
  --status=<status>            (Optional) Suggestion status to filter by
                               Valid statuses: ${Object.values(SUGGESTION_STATUSES).join(', ')}
                               Default: ${DEFAULTS.STATUS}
  --markFixed                  (Optional) Mark suggestions as FIXED and create Fix entities
                               Default: ${DEFAULTS.MARK_FIXED}
  --fromCsv=<path>             (Optional) Read results from existing CSV file instead of running checkers
                               Use with --markFixed to mark suggestions as fixed from CSV data
                               Path can be absolute or relative to oppty-scripts/data/
  --debug                      (Optional) Enable debug logging
  --help, -h                   Show this help message

Examples:
  # Check alt-text suggestions with OUTDATED status
  node oppty-scripts/opportunities/index.js --siteId=123e4567-e89b-12d3-a456-426614174000 --type=alt-text

  # Check and mark fixed broken-backlinks suggestions
  node oppty-scripts/opportunities/index.js --siteId=123e4567-e89b-12d3-a456-426614174000 --type=broken-backlinks --markFixed

  # Mark suggestions as fixed from existing CSV file (skips checker step)
  node oppty-scripts/opportunities/index.js --siteId=123e4567-e89b-12d3-a456-426614174000 --type=broken-internal-links --markFixed --fromCsv=14220f09-7bdd-4c91-9adf-adcbe0adf1df-broken-internal-links-2026-01-29.csv

  # Check meta-tags with custom status
  node oppty-scripts/opportunities/index.js --siteId=123e4567-e89b-12d3-a456-426614174000 --type=meta-tags --status=NEW

Environment Variables:
  SPACECAT_API_KEY             SpaceCat API key for authentication
  AWS_REGION                   AWS region (default: us-east-1)
  DYNAMO_TABLE_NAME_DATA       DynamoDB table name for unified data access (default: spacecat-services-data)
  DEBUG                        Enable debug logging (alternative to --debug)
`);
}

/**
 * Parse command line arguments
 * @returns {object} Parsed arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const parsed = {
    siteId: null,
    type: null,
    status: DEFAULTS.STATUS,
    markFixed: DEFAULTS.MARK_FIXED,
    fromCsv: null,
    debug: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg.startsWith('--siteId=')) {
      [, parsed.siteId] = arg.split('=');
    } else if (arg.startsWith('--type=')) {
      [, parsed.type] = arg.split('=');
    } else if (arg.startsWith('--status=')) {
      [, parsed.status] = arg.split('=');
    } else if (arg === '--markFixed' || arg.startsWith('--markFixed=')) {
      const [, value] = arg.split('=');
      parsed.markFixed = arg === '--markFixed' ? true : value === 'true';
    } else if (arg.startsWith('--fromCsv=')) {
      [, parsed.fromCsv] = arg.split('=');
    } else if (arg === '--debug') {
      parsed.debug = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  return parsed;
}

/**
 * Validate command line arguments
 * @param {object} args - Parsed arguments
 * @param {object} log - Logger instance
 */
function validateArguments(args, log) {
  const errors = [];

  if (!args.siteId) {
    errors.push('--siteId is required');
  } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.siteId)) {
    errors.push('--siteId must be a valid UUID');
  }

  if (!args.type) {
    errors.push('--type is required');
  } else if (!VALID_OPPORTUNITY_TYPES.includes(args.type)) {
    errors.push(`--type must be one of: ${VALID_OPPORTUNITY_TYPES.join(', ')}`);
  }

  if (args.status && !Object.values(SUGGESTION_STATUSES).includes(args.status)) {
    errors.push(`--status must be one of: ${Object.values(SUGGESTION_STATUSES).join(', ')}`);
  }

  if (errors.length > 0) {
    errors.forEach((error) => log.error(error));
    log.info('\nRun with --help for usage information');
    process.exit(1);
  }
}

/**
 * Validate environment variables
 * Uses the new unified single-table design
 * @param {object} log - Logger instance
 */
function validateEnvironment(log) {
  const required = [
    'SPACECAT_API_KEY',
  ];

  const missing = required.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    log.error('Missing required environment variables:');
    missing.forEach((varName) => log.error(`  - ${varName}`));
    process.exit(1);
  }

  // DYNAMO_TABLE_NAME_DATA is optional - will use default if not provided
  if (!process.env.DYNAMO_TABLE_NAME_DATA) {
    log.debug('DYNAMO_TABLE_NAME_DATA not set, will use default: spacecat-services-data');
  }
}

/**
 * Process suggestions by checking if they're fixed via AI
 * @param {Array} suggestions - Array of suggestion objects
 * @param {string} opportunityType - Opportunity type
 * @param {string} opportunityId - Opportunity ID
 * @param {string} siteId - Site ID
 * @param {object} log - Logger instance
 * @returns {Promise<Array>} Processed results
 */
async function processSuggestions(suggestions, opportunityType, opportunityId, siteId, log) {
  log.info(`Processing ${suggestions.length} suggestions for opportunity ${opportunityId}`);

  // Check if batch checker is available for this opportunity type
  const batchChecker = getBatchChecker(opportunityType);

  if (batchChecker) {
    // Use batch processing for better performance
    log.info(`Using batch processing for ${opportunityType}`);
    try {
      const results = await batchChecker(suggestions, siteId, log);

      // Log results
      results.forEach((result) => {
        if (result.isFixedViaAI) {
          log.debug(`Suggestion ${result.suggestionId} is fixed via AI: ${result.reason}`);
        }
        if (result.isFixedManually) {
          log.debug(`Suggestion ${result.suggestionId} is fixed manually: ${result.reason}`);
        }
      });

      return results;
    } catch (error) {
      log.error(`Batch processing failed, falling back to individual processing: ${error.message}`);
      // Fall through to individual processing
    }
  }

  // Fall back to individual processing for checkers without batch support
  const checker = getChecker(opportunityType);
  const results = await Promise.all(
    suggestions.map(async (suggestion) => {
      try {
        // Support both async and sync checkers
        const result = await Promise.resolve(checker(suggestion, siteId, log));

        if (result.isFixedViaAI) {
          log.debug(`Suggestion ${result.suggestionId} is fixed via AI: ${result.reason}`);
        }
        if (result.isFixedManually) {
          log.debug(`Suggestion ${result.suggestionId} is fixed manually: ${result.reason}`);
        }

        return result;
      } catch (error) {
        log.error(`Failed to check suggestion ${suggestion.getId()}`, { error: error.message });
        return {
          suggestionId: suggestion.getId(),
          opportunityId,
          url: '',
          status: suggestion.getStatus(),
          isFixedViaAI: false,
          isFixedManually: false,
          reason: `Error checking suggestion: ${error.message}`,
          fixDetails: {},
        };
      }
    }),
  );

  return results;
}

/**
 * Format suggestion data as text
 * @param {object} suggestion - Suggestion object
 * @returns {string} Formatted suggestion text
 */
function formatSuggestion(suggestion) {
  const id = suggestion.getId();
  const type = suggestion.getType();
  const data = suggestion.getData();

  return `Suggestion ID: ${id}
Type: ${type}
Data: ${JSON.stringify(data, null, 2)}
`;
}

/**
 * Format fix entity data as text
 * @param {object} fixEntity - Fix entity object
 * @returns {string} Formatted fix entity text
 */
function formatFixEntity(fixEntity) {
  const suggestionIds = Array.isArray(fixEntity.suggestionIds)
    ? fixEntity.suggestionIds.join(', ')
    : 'N/A';

  return `Fix Entity ID: ${fixEntity.id || 'N/A'}
Opportunity ID: ${fixEntity.opportunityId || 'N/A'}
Type: ${fixEntity.type || 'N/A'}
Status: ${fixEntity.status || 'N/A'}
Suggestion IDs: ${suggestionIds}
Created At: ${fixEntity.createdAt || 'N/A'}
Updated At: ${fixEntity.updatedAt || 'N/A'}
Executed By: ${fixEntity.executedBy || 'N/A'}
Executed At: ${fixEntity.executedAt || 'N/A'}
Published At: ${fixEntity.publishedAt || 'N/A'}
Origin: ${fixEntity.origin || 'N/A'}
Change Details:
${JSON.stringify(fixEntity.changeDetails || {}, null, 2)}
`;
}

/**
 * Save migration data to file
 * @param {string} siteId - Site ID
 * @param {string} opportunityType - Opportunity type
 * @param {Array} migratedSuggestions - Array of migrated suggestion objects
 * @param {Array} createdFixes - Array of created fix entities
 * @param {object} log - Logger instance
 * @returns {Promise<string>} Path to saved migration file
 */
async function saveMigrationData(siteId, opportunityType, migratedSuggestions, createdFixes, log) {
  const defaultOutputDir = join(__dirname, '..', 'data');

  // Ensure output directory exists
  try {
    await mkdir(defaultOutputDir, { recursive: true });
  } catch (error) {
    log.error('Failed to create output directory', { error: error.message });
    throw new Error(`Failed to create output directory: ${error.message}`);
  }

  const filename = `${siteId}-migration.txt`;
  const filepath = join(defaultOutputDir, filename);

  // Build migration text content
  const timestamp = new Date().toISOString();
  let migrationText = `\n${'='.repeat(80)}\n`;
  migrationText += `MIGRATION RUN: ${timestamp}\n`;
  migrationText += `Oppty-type: ${opportunityType}\n`;
  migrationText += `Suggestions Migrated: ${migratedSuggestions.length}\n`;
  migrationText += `Fix Entities Created: ${createdFixes.length}\n`;
  migrationText += `${'='.repeat(80)}\n\n`;
  migrationText += 'SUGGESTIONS MIGRATED\n';
  migrationText += `${'-'.repeat(80)}\n\n`;

  migratedSuggestions.forEach((suggestion, index) => {
    migrationText += `Suggestion ${index + 1}:\n`;
    migrationText += formatSuggestion(suggestion);
    migrationText += '\n';
  });

  migrationText += 'FIX ENTITIES CREATED\n';
  migrationText += `${'-'.repeat(80)}\n\n`;

  createdFixes.forEach((fixEntity, index) => {
    migrationText += `Fix Entity ${index + 1}:\n`;
    migrationText += formatFixEntity(fixEntity);
    migrationText += '\n';
  });

  // Append to file
  try {
    await appendFile(filepath, migrationText, 'utf-8');
    log.info(`Migration data appended to: ${filepath}`);
    return filepath;
  } catch (error) {
    log.error('Failed to append migration file', { error: error.message, filepath });
    throw new Error(`Failed to append migration file: ${error.message}`);
  }
}

/**
 * Mark suggestions as FIXED and create Fix entities
 * @param {Array} results - Processed results
 * @param {string} siteId - Site ID
 * @param {string} opportunityType - Opportunity type
 * @param {object} dataAccess - Data access instance
 * @param {object} apiClient - SpaceCat API client
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Stats about marked suggestions
 *  and migration data
 */
async function markSuggestionsAsFixed(
  results,
  siteId,
  opportunityType,
  dataAccess,
  apiClient,
  log,
) {
  const { Suggestion } = dataAccess;
  const fixedResults = results.filter((r) => r.isFixedViaAI || r.isFixedManually);

  if (fixedResults.length === 0) {
    log.info('No suggestions to mark as FIXED');
    return {
      marked: 0, fixEntitiesCreated: 0, migratedSuggestions: [], createdFixes: [],
    };
  }

  log.separator(`Marking ${fixedResults.length} Suggestions as FIXED`);

  // Group by opportunity ID
  const byOpportunity = {};
  fixedResults.forEach((result) => {
    if (!byOpportunity[result.opportunityId]) {
      byOpportunity[result.opportunityId] = [];
    }
    byOpportunity[result.opportunityId].push(result);
  });

  let totalMarked = 0;
  let totalFixEntities = 0;
  const allMigratedSuggestions = [];
  const allCreatedFixes = [];

  for (const [opportunityId, opptyResults] of Object.entries(byOpportunity)) {
    try {
      log.info(`Processing opportunity ${opportunityId} with ${opptyResults.length} fixed suggestions`);

      // Fetch suggestion objects first
      // eslint-disable-next-line no-await-in-loop
      const suggestions = await Promise.all(
        opptyResults.map((result) => Suggestion.findById(result.suggestionId)),
      );
      const validSuggestions = suggestions.filter((s) => s !== null);

      if (validSuggestions.length === 0) {
        log.warn(`No valid suggestions found for opportunity ${opportunityId}`);
        // eslint-disable-next-line no-continue
        continue;
      }

      // Create fix entities via API using suggestion data as changeDetails
      const fixes = validSuggestions.map((suggestion) => ({
        type: suggestion.getType(),
        changeDetails: suggestion.getData(),
        status: FIX_STATUSES.PUBLISHED,
        suggestionIds: [suggestion.getId()],
        publishedAt: suggestion.getUpdatedAt(),
        executedAt: suggestion.getUpdatedAt(),
        executedBy: 'script',
        origin: 'reporting',
      }));

      // eslint-disable-next-line no-await-in-loop
      const createdFixes = await apiClient.createFixEntities(siteId, opportunityId, fixes);
      log.info(`Created ${fixes.length} fix entities for opportunity ${opportunityId}`);
      totalFixEntities += fixes.length;

      // Collect migration data
      allMigratedSuggestions.push(...validSuggestions);

      // Handle both single fix entity and array of fix entities
      if (Array.isArray(createdFixes)) {
        allCreatedFixes.push(...createdFixes);
      } else {
        allCreatedFixes.push(createdFixes);
      }

      if (validSuggestions.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await Suggestion.bulkUpdateStatus(validSuggestions, SUGGESTION_STATUSES.FIXED);
        log.info(`Updated ${validSuggestions.length} suggestions to FIXED status`);
        totalMarked += validSuggestions.length;
      }
    } catch (error) {
      log.error(`Failed to process opportunity ${opportunityId}`, { error: error.message });
    }
  }

  return {
    marked: totalMarked,
    fixEntitiesCreated: totalFixEntities,
    migratedSuggestions: allMigratedSuggestions,
    createdFixes: allCreatedFixes,
  };
}

/**
 * Main execution function
 */
async function main() {
  const args = parseArguments();
  const log = createLogger(args.debug);

  log.separator('SpaceCat Opportunity Fix Verification');

  // Validate arguments and environment
  validateArguments(args, log);
  validateEnvironment(log);

  log.info('Configuration:', {
    siteId: args.siteId,
    type: args.type,
    status: args.status,
    markFixed: args.markFixed,
    fromCsv: args.fromCsv || 'none',
  });

  try {
    let allResults = [];
    let dataAccess;
    let site;

    // Check if we should read from CSV instead of running checkers
    if (args.fromCsv) {
      log.separator('Reading Results from CSV');

      // Resolve CSV path (support both absolute and relative paths)
      let csvPath = args.fromCsv;
      if (!csvPath.startsWith('/')) {
        // Relative path - look in oppty-scripts/data directory
        const defaultDataDir = join(__dirname, '..', 'data');
        csvPath = join(defaultDataDir, csvPath);
      }

      // Import results from CSV
      allResults = await importFromCSV(csvPath, log);

      log.info(`Loaded ${allResults.length} results from CSV`);

      // We still need dataAccess for marking as fixed
      if (args.markFixed) {
        log.info('Initializing data access for marking suggestions as fixed...');
        const { dataAccess: da } = await fetchSuggestions({
          siteId: args.siteId,
          opportunityType: args.type,
          status: args.status,
          log,
          skipFetch: true, // Just initialize, don't fetch
        });
        dataAccess = da;
      }
    } else {
      // Original flow: Fetch suggestions and run checkers
      // Step 1: Fetch suggestions
      log.separator('Step 1: Fetching Suggestions');
      const fetchResult = await fetchSuggestions({
        siteId: args.siteId,
        opportunityType: args.type,
        status: args.status,
        log,
      });

      site = fetchResult.site;
      dataAccess = fetchResult.dataAccess;
      const { opportunities } = fetchResult;
      const { totalSuggestions } = fetchResult;

      log.info(`Site: ${site.getBaseURL()}`);
      log.info(`Found ${totalSuggestions} suggestions across ${opportunities.length} opportunities`);

      if (totalSuggestions === 0) {
        log.warn('No suggestions found. Exiting.');
        process.exit(0);
      }

      // Step 2: Check each suggestion
      log.separator('Step 2: Checking Suggestions');

      for (const { opportunity, suggestions } of opportunities) {
        // eslint-disable-next-line no-await-in-loop
        const results = await processSuggestions(
          suggestions,
          args.type,
          opportunity.getId(),
          args.siteId,
          log,
        );
        allResults = allResults.concat(results);
      }

      // Log pages for which scrapes were not found
      const scrapesNotFound = allResults
        .filter((r) => r.scrapeFailed && r.reason?.includes('No scrape data found'))
        .map((r) => r.url);

      if (scrapesNotFound.length > 0) {
        log.logScrapesNotFound(args.siteId, scrapesNotFound);
      }

      // Step 3: Export results to CSV
      log.separator('Step 3: Exporting Results');
      const csvPath = await exportToCSV({
        results: allResults,
        siteId: args.siteId,
        opportunityType: args.type,
        log,
      });

      await exportSummary(allResults, args.siteId, args.type, undefined, log);

      log.info(`Results exported to: ${csvPath}`);
    }

    // Step 4: Mark as fixed (if requested)
    if (args.markFixed) {
      if (!dataAccess) {
        log.error('Cannot mark suggestions as fixed: data access not initialized');
        process.exit(1);
      }

      const apiClient = createClient();
      const stats = await markSuggestionsAsFixed(
        allResults,
        args.siteId,
        args.type,
        dataAccess,
        apiClient,
        log,
      );

      log.summary('Mark Fixed Results', {
        'Suggestions Marked as FIXED': stats.marked,
        'Fix Entities Created': stats.fixEntitiesCreated,
      });

      // Save migration data to file
      if (stats.migratedSuggestions.length > 0 || stats.createdFixes.length > 0) {
        try {
          const migrationPath = await saveMigrationData(
            args.siteId,
            args.type,
            stats.migratedSuggestions,
            stats.createdFixes,
            log,
          );
          log.info(`Migration data saved to: ${migrationPath}`);
        } catch (error) {
          log.error('Failed to save migration data', { error: error.message });
        }
      }
    }

    log.separator('Completed Successfully');

    // Cleanup resources (e.g., close shared browser)
    await cleanupCheckers(log);

    process.exit(0);
  } catch (error) {
    log.error('Fatal error:', { error: error.message, stack: error.stack });

    // Cleanup resources even on error
    try {
      await cleanupCheckers(log);
    } catch (cleanupError) {
      log.debug(`Error during cleanup: ${cleanupError.message}`);
    }

    process.exit(1);
  }
}

// Run main function
main();
