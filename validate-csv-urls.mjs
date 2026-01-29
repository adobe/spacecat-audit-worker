#!/usr/bin/env node

/**
 * URL Validator Script for CSV Files
 * 
 * Reads a CSV file with URLs and runs technical SEO checks:
 * - HTTP status (4xx/5xx errors)
 * - Redirects (redirect chains)
 * - Canonical tags (pointing elsewhere)
 * - Noindex (meta/header)
 * - Robots.txt blocking
 * 
 * Outputs two CSV files:
 * - *-blocked.csv: URLs with blockers
 * - *-success.csv: Clean URLs
 * 
 * Usage:
 *   node validate-csv-urls.mjs <input.csv>
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import {
  validateUrls,
} from './src/utils/seo-validators.js';

// Simple console logger
const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
};

/**
 * Parse CSV file
 */
function readCsvFile(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  return records;
}

/**
 * Write CSV file
 */
function writeCsvFile(filePath, records, columns) {
  const csv = stringify(records, {
    header: true,
    columns,
  });
  fs.writeFileSync(filePath, csv, 'utf-8');
}

/**
 * Process validation result and add blocker details
 */
function processValidationResult(result) {
  const isBlocked = !result.indexable;
  const blockers = result.blockers || [];
  let blockerDetails = '';
  
  // Build blocker details from checks
  if (result.checks?.httpStatus && !result.checks.httpStatus.passed) {
    blockerDetails = `HTTP ${result.checks.httpStatus.statusCode}`;
  }
  
  if (result.checks?.redirects && !result.checks.redirects.passed) {
    if (blockerDetails) blockerDetails += '; ';
    blockerDetails += `${result.checks.redirects.redirectCount} redirects: ${result.checks.redirects.redirectChain}`;
  }
  
  if (result.checks?.canonical && !result.checks.canonical.passed) {
    if (blockerDetails) blockerDetails += '; ';
    blockerDetails += `Canonical: ${result.checks.canonical.canonicalUrl}`;
  }
  
  if (result.checks?.noindex && !result.checks.noindex.passed) {
    if (blockerDetails) blockerDetails += '; ';
    if (result.checks.noindex.hasNoindexMeta) blockerDetails += 'Has noindex meta tag';
    if (result.checks.noindex.hasNoindexHeader) blockerDetails += 'Has noindex header';
  }
  
  if (result.checks?.robotsTxt && !result.checks.robotsTxt.passed) {
    if (blockerDetails) blockerDetails += '; ';
    blockerDetails += 'Blocked by robots.txt';
  }
  
  return {
    ...result,
    isBlocked,
    blockersString: blockers.join(', '),
    blockerDetails,
  };
}

/**
 * Main function
 */
async function main() {
  const inputFile = process.argv[2];
  
  if (!inputFile) {
    console.error('Usage: node validate-csv-urls.mjs <input.csv>');
    process.exit(1);
  }
  
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }
  
  console.log('🚀 Starting URL validation...');
  console.log(`📁 Input file: ${inputFile}\n`);
  
  // Read input CSV
  const records = readCsvFile(inputFile);
  console.log(`📊 Found ${records.length} URLs to check\n`);
  
  if (records.length === 0) {
    console.error('❌ No URLs found in CSV file');
    process.exit(1);
  }
  
  // Filter out records without URLs
  const validRecords = records.filter(r => r.url);
  
  console.log('🔄 Validating URLs (10 concurrent requests)...\n');
  
  // Validate all URLs using the batch function with concurrency control
  const context = { log };
  const validationResults = await validateUrls(validRecords, context);
  
  console.log();
  
  // Process results and add blocker details
  const results = validationResults.map(result => {
    const processed = processValidationResult(result);
    
    // Log individual result
    if (processed.isBlocked) {
      console.log(`❌ ${result.url}: ${processed.blockersString}`);
    } else {
      console.log(`✅ ${result.url}`);
    }
    
    return processed;
  });
  
  // Split into blocked and success
  const blockedUrls = results.filter(r => r.isBlocked);
  const successUrls = results.filter(r => !r.isBlocked);
  
  console.log('\n\n📊 Summary:');
  console.log(`   Total URLs: ${results.length}`);
  console.log(`   ✅ Clean URLs: ${successUrls.length}`);
  console.log(`   ❌ Blocked URLs: ${blockedUrls.length}`);
  
  // Generate output file names
  const inputBaseName = path.basename(inputFile, path.extname(inputFile));
  const inputDir = path.dirname(inputFile);
  const blockedFile = path.join(inputDir, `${inputBaseName}-blocked.csv`);
  const successFile = path.join(inputDir, `${inputBaseName}-success.csv`);
  
  // Get all columns from input
  const inputColumns = Object.keys(records[0] || {});
  
  // Prepare blocked URLs output
  if (blockedUrls.length > 0) {
    const blockedOutput = blockedUrls.map(r => {
      const { checks, indexable, blockers, blockersString, isBlocked, ...rest } = r;
      return {
        ...rest,
        blocked_reason: blockersString,
        blocked_details: r.blockerDetails,
      };
    });
    
    const blockedColumns = [...inputColumns, 'blocked_reason', 'blocked_details'];
    writeCsvFile(blockedFile, blockedOutput, blockedColumns);
    console.log(`\n✅ Blocked URLs saved to: ${blockedFile}`);
  } else {
    console.log('\n✅ No blocked URLs found');
  }
  
  // Prepare success URLs output
  if (successUrls.length > 0) {
    const successOutput = successUrls.map(r => {
      const { checks, indexable, blockers, blockersString, isBlocked, blockerDetails, ...rest } = r;
      return rest;
    });
    
    writeCsvFile(successFile, successOutput, inputColumns);
    console.log(`✅ Success URLs saved to: ${successFile}`);
  } else {
    console.log('⚠️  No clean URLs found');
  }
  
  console.log('\n🎉 Done!\n');
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

