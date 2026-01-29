#!/usr/bin/env node

/**
 * On-Page SEO Testing Script
 * 
 * Processes upstream CSV suggestions, applies opportunity selection logic,
 * runs technical SEO checks, and outputs filtered results for analysis.
 * 
 * Features:
 * - SERP position filtering (4-20 primary, 4-30 fallback)
 * - Opportunity scoring based on CTR and search volume
 * - Technical validation (HTTP status, redirects, canonical, noindex, robots.txt)
 * - Multiple output CSVs for analysis
 * 
 * Usage:
 *   node src/on-page-seo/test-opportunities.mjs <input.csv> [--top N] [--check-all]
 * 
 * Options:
 *   --top N         Select top N opportunities (default: 3)
 *   --check-all     Run technical checks on ALL URLs (default: selected only)
 *   --check-selected Run technical checks only on selected opportunities (default)
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { validateUrls } from '../utils/seo-validators.js';

// Simple console logger
const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  debug: (msg) => console.log(`🔍 ${msg}`),
};

/**
 * Parse command-line arguments
 */
function parseArgs(args) {
  const inputFile = args[0];
  let topN = 3;
  let checkMode = 'selected'; // 'selected' or 'all'
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--top' && args[i + 1]) {
      topN = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--check-all') {
      checkMode = 'all';
    } else if (args[i] === '--check-selected') {
      checkMode = 'selected';
    }
  }
  
  return { inputFile, topN, checkMode };
}

/**
 * Read CSV file
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
  if (records.length === 0) {
    log.warn(`No records to write for ${path.basename(filePath)}`);
    return;
  }
  
  const csv = stringify(records, {
    header: true,
    columns,
  });
  fs.writeFileSync(filePath, csv, 'utf-8');
  log.info(`Saved: ${filePath} (${records.length} rows)`);
}

/**
 * Determines if a page is eligible for optimization based on SERP position.
 * 
 * Business Rules (from handler.js):
 * - Positions 1-3: Exclude (already performing well)
 * - Positions 4-20: Include (sweet spot - low-hanging fruit)
 * - Positions 21-30: Secondary (softer range if < 3 opportunities)
 * - Positions 31+: Exclude (too difficult for quick wins)
 */
function isEligibleForOptimization(serpPosition, useSofterRange = false) {
  if (!serpPosition || serpPosition === '') return false;
  
  const pos = parseFloat(serpPosition);
  if (isNaN(pos)) return false;
  
  if (pos >= 4 && pos <= 20) {
    return true; // Primary range
  }
  if (useSofterRange && pos >= 21 && pos <= 30) {
    return true; // Secondary range (if needed)
  }
  return false; // Too high (1-3) or too low (31+)
}

/**
 * Parse search volume that may have 'k' or 'm' suffix
 * @param {string|number} value - Volume value (e.g., "2.6k", "150", 2600)
 * @returns {number} Parsed numeric value
 */
function parseSearchVolume(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  
  const str = String(value).toLowerCase().trim();
  
  // Handle 'k' suffix (thousands)
  if (str.endsWith('k')) {
    return parseFloat(str.slice(0, -1)) * 1000;
  }
  
  // Handle 'm' suffix (millions)
  if (str.endsWith('m')) {
    return parseFloat(str.slice(0, -1)) * 1000000;
  }
  
  return parseFloat(str) || 0;
}

/**
 * Calculates opportunity impact based on search volume and ranking potential
 * Formula: searchVolume * (targetCTR - currentCTR)
 * 
 * Strategy: Target the next major CTR tier (realistic one-level improvement)
 * - Positions 21-30 → Target top 20 (position 20)
 * - Positions 11-20 → Target top 10 (position 10) 
 * - Positions 6-10 → Target top 5 (position 5)
 * - Positions 4-5 → Target top 3 (position 3)
 * 
 * Adapted from opportunity-data-mapper.js:calculateOpportunityImpact
 */
function calculateOpportunityScore(searchVolume, currentRanking) {
  // Industry average CTR by position
  const ctrByPosition = {
    1: 0.32, 2: 0.24, 3: 0.18, 4: 0.13, 5: 0.10,
    6: 0.08, 7: 0.06, 8: 0.05, 9: 0.04, 10: 0.03,
  };

  const currentCTR = ctrByPosition[Math.floor(currentRanking)] || 0.02;
  
  // Determine target position based on current tier
  let targetPosition;
  if (currentRanking >= 21) {
    targetPosition = 20; // Outside page 2 → aim for page 2
  } else if (currentRanking >= 11) {
    targetPosition = 10; // Page 2 → aim for bottom of page 1
  } else if (currentRanking >= 6) {
    targetPosition = 5; // Lower page 1 → aim for top 5
  } else if (currentRanking >= 4) {
    targetPosition = 3; // Position 4-5 → aim for top 3
  } else {
    targetPosition = 1; // Already top 3 → aim for #1
  }
  
  const targetCTR = ctrByPosition[Math.floor(targetPosition)] || 0.32;

  // Score = potential traffic gain
  return Math.round(searchVolume * (targetCTR - currentCTR));
}

/**
 * Apply opportunity selection logic (from handler.js)
 * 
 * Steps:
 * 1. Filter by SERP position (4-20)
 * 2. If < topN, soften range to (4-30)
 * 3. Calculate opportunity scores
 * 4. Sort by score descending
 * 5. Select top N
 */
function selectOpportunities(records, topN) {
  log.info(`\n📊 Opportunity Selection:`);
  log.info(`   Total URLs in CSV: ${records.length}`);
  
  // Step 1: Filter eligible opportunities by SERP position (4-20)
  let eligibleOpportunities = records.filter((record) => {
    const serpPosition = record.serp_position || record.serpPosition || record.ranking;
    return isEligibleForOptimization(serpPosition, false);
  });
  
  log.info(`   Eligible (positions 4-20): ${eligibleOpportunities.length}`);
  
  // Step 2: If fewer than topN, soften range to 4-30
  if (eligibleOpportunities.length < topN) {
    log.warn(`   Fewer than ${topN} opportunities found, softening range to positions 4-30`);
    eligibleOpportunities = records.filter((record) => {
      const serpPosition = record.serp_position || record.serpPosition || record.ranking;
      return isEligibleForOptimization(serpPosition, true);
    });
    log.info(`   Eligible (positions 4-30): ${eligibleOpportunities.length}`);
  }
  
  // Step 3: Calculate opportunity scores
  const scoredOpportunities = eligibleOpportunities.map((record) => {
    const serpPosition = parseFloat(record.serp_position || record.serpPosition || record.ranking || 99);
    const searchVolume = parseSearchVolume(record.volume_per_month || record.searchVolume || 0);
    const score = calculateOpportunityScore(searchVolume, serpPosition);
    
    return {
      ...record,
      opportunity_score: score,
    };
  });
  
  // Step 4: Sort by score descending
  scoredOpportunities.sort((a, b) => b.opportunity_score - a.opportunity_score);
  
  // Step 5: Select top N
  const selectedOpportunities = scoredOpportunities.slice(0, topN);
  
  // Add rank field
  selectedOpportunities.forEach((opp, index) => {
    opp.selected_rank = index + 1;
  });
  
  log.info(`   Selected top ${selectedOpportunities.length} opportunities`);
  
  // Show top opportunities
  console.log('\n🎯 Selected Opportunities:');
  selectedOpportunities.forEach((opp, index) => {
    const pos = opp.serp_position || opp.serpPosition || opp.ranking;
    const vol = opp.volume_per_month || opp.searchVolume || 0;
    console.log(`   ${index + 1}. [Score: ${opp.opportunity_score}] Position ${pos}, Volume ${vol} - ${opp.url}`);
  });
  
  return selectedOpportunities;
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
    const issues = [];
    if (result.checks.noindex.hasNoindexMeta) issues.push('noindex meta tag');
    if (result.checks.noindex.hasNoindexHeader) issues.push('noindex header');
    blockerDetails += issues.join(', ');
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
 * Run technical checks on URLs
 */
async function runTechnicalChecks(urls) {
  log.info(`\n🔍 Running Technical Checks:`);
  log.info(`   Checking ${urls.length} URLs (10 concurrent requests)...\n`);
  
  const context = { log };
  const validationResults = await validateUrls(urls, context);
  
  console.log();
  
  // Process results and add blocker details
  const results = validationResults.map(result => {
    const processed = processValidationResult(result);
    
    // Log individual result
    if (processed.isBlocked) {
      console.log(`   ❌ ${result.url}: ${processed.blockersString}`);
    } else {
      console.log(`   ✅ ${result.url}`);
    }
    
    return processed;
  });
  
  const blockedCount = results.filter(r => r.isBlocked).length;
  const cleanCount = results.filter(r => !r.isBlocked).length;
  
  log.info(`\n   Summary: ${cleanCount} clean, ${blockedCount} blocked`);
  
  return results;
}

/**
 * Generate output files
 */
function generateOutputs(inputFile, selectedOpportunities, technicalResults, allRecords) {
  const inputBaseName = path.basename(inputFile, path.extname(inputFile));
  
  // Create output directory in the same folder as this script
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const outputDir = path.join(scriptDir, 'output');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    log.info(`Created output directory: ${outputDir}`);
  }
  
  log.info(`\n📝 Generating Output Files:`);
  log.info(`   Output directory: ${outputDir}\n`);
  
  // 1. Filtered opportunities CSV with technical check results merged in
  if (selectedOpportunities.length > 0) {
    // Merge technical check results into selected opportunities
    const opportunitiesWithTechnicalChecks = selectedOpportunities.map(opp => {
      const technicalResult = technicalResults.find(t => t.url === opp.url);
      
      if (technicalResult) {
        return {
          ...opp,
          technical_check_passed: technicalResult.indexable ? 'YES' : 'NO',
          technical_issue_details: technicalResult.indexable ? '' : technicalResult.blockerDetails,
        };
      }
      
      // If no technical check was run for this URL, mark as not checked
      return {
        ...opp,
        technical_check_passed: 'NOT_CHECKED',
        technical_issue_details: '',
      };
    });
    
    const opportunitiesFile = path.join(outputDir, `${inputBaseName}-filtered-opportunities.csv`);
    const allColumns = Object.keys(opportunitiesWithTechnicalChecks[0]);
    writeCsvFile(opportunitiesFile, opportunitiesWithTechnicalChecks, allColumns);
  }
  
  // 2. All URLs with technical checks (when --check-all is used)
  // This file contains ALL URLs from input CSV with their technical validation status
  if (technicalResults.length > allRecords.length * 0.5) {
    // Only generate this file if we checked more than half the URLs (i.e., --check-all was likely used)
    const allUrlsFile = path.join(outputDir, `${inputBaseName}-all-urls-with-checks.csv`);
    
    // Calculate opportunity scores for ALL URLs (not just selected ones)
    const allUrlsWithScores = technicalResults.map(r => {
      const { checks, indexable, blockers, isBlocked, ...rest } = r;
      
      // Calculate score and eligibility for this URL
      const serpPosition = parseFloat(rest.serp_position || rest.serpPosition || rest.ranking || 99);
      const searchVolume = parseSearchVolume(rest.volume_per_month || rest.searchVolume || 0);
      const score = calculateOpportunityScore(searchVolume, serpPosition);
      
      // Check SERP position eligibility
      const isEligiblePrimary = isEligibleForOptimization(serpPosition, false);
      const isEligibleSofter = isEligibleForOptimization(serpPosition, true);
      let eligibilityStatus = '';
      if (serpPosition >= 1 && serpPosition <= 3) {
        eligibilityStatus = 'TOO_HIGH (1-3)';
      } else if (serpPosition >= 4 && serpPosition <= 20) {
        eligibilityStatus = 'ELIGIBLE (4-20)';
      } else if (serpPosition >= 21 && serpPosition <= 30) {
        eligibilityStatus = 'ELIGIBLE_SOFTER (21-30)';
      } else if (serpPosition > 30) {
        eligibilityStatus = 'TOO_LOW (31+)';
      } else {
        eligibilityStatus = 'NO_POSITION';
      }
      
      // Check if this URL was selected as an opportunity
      const isSelected = selectedOpportunities.some(opp => opp.url === r.url);
      const selectedOpp = selectedOpportunities.find(opp => opp.url === r.url);
      
      return {
        url: r.url,
        serp_position: serpPosition,
        serp_eligibility: eligibilityStatus,
        selected_opportunity: isSelected ? 'YES' : 'NO',
        opportunity_score: score,
        opportunity_rank_all: '', // Will be filled after sorting
        opportunity_rank_selected: selectedOpp?.selected_rank || '',
        technical_check_passed: r.indexable ? 'YES' : 'NO',
        technical_issue_details: r.indexable ? '' : r.blockerDetails, // Only show details if failed
        // Include original CSV data
        ...Object.fromEntries(
          Object.entries(rest).filter(([key]) => !['blockersString', 'blockerDetails', 'serp_position', 'serpPosition', 'ranking'].includes(key))
        ),
      };
    });
    
    // Sort by score descending and assign overall rank
    allUrlsWithScores.sort((a, b) => b.opportunity_score - a.opportunity_score);
    allUrlsWithScores.forEach((item, index) => {
      item.opportunity_rank_all = index + 1;
    });
    
    const allUrlsColumns = Object.keys(allUrlsWithScores[0]);
    writeCsvFile(allUrlsFile, allUrlsWithScores, allUrlsColumns);
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: node src/on-page-seo/test-opportunities.mjs <input.csv> [options]

Options:
  --top N           Select top N opportunities (default: 3)
  --check-all       Run technical checks on ALL URLs in CSV
  --check-selected  Run technical checks only on selected opportunities (default)

Examples:
  node src/on-page-seo/test-opportunities.mjs input/suggestions.csv
  node src/on-page-seo/test-opportunities.mjs input/suggestions.csv --top 5
  node src/on-page-seo/test-opportunities.mjs input/suggestions.csv --check-all
    `);
    process.exit(0);
  }
  
  const { inputFile, topN, checkMode } = parseArgs(args);
  
  if (!inputFile) {
    log.error('Input file is required');
    process.exit(1);
  }
  
  if (!fs.existsSync(inputFile)) {
    log.error(`File not found: ${inputFile}`);
    process.exit(1);
  }
  
  console.log('\n🚀 On-Page SEO Testing Script');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info(`Input file: ${inputFile}`);
  log.info(`Top N opportunities: ${topN}`);
  log.info(`Check mode: ${checkMode}`);
  
  // Read input CSV
  const allRecords = readCsvFile(inputFile);
  
  if (allRecords.length === 0) {
    log.error('No records found in CSV file');
    process.exit(1);
  }
  
  // Validate required columns
  const firstRecord = allRecords[0];
  const hasUrl = 'url' in firstRecord;
  const hasSerpPosition = 'serp_position' in firstRecord || 'serpPosition' in firstRecord || 'ranking' in firstRecord;
  const hasVolume = 'volume_per_month' in firstRecord || 'searchVolume' in firstRecord;
  
  if (!hasUrl) {
    log.error('CSV must have a "url" column');
    process.exit(1);
  }
  
  if (!hasSerpPosition) {
    log.warn('CSV missing SERP position column (serp_position, serpPosition, or ranking)');
  }
  
  if (!hasVolume) {
    log.warn('CSV missing search volume column (volume_per_month or searchVolume)');
  }
  
  // Step 1: Select opportunities
  const selectedOpportunities = selectOpportunities(allRecords, topN);
  
  if (selectedOpportunities.length === 0) {
    log.warn('No opportunities selected based on SERP position criteria');
    return;
  }
  
  // Step 2: Run technical checks
  let technicalResults = [];
  
  if (checkMode === 'all') {
    log.info(`\n🔎 Technical Check Mode: ALL URLs (${allRecords.length})`);
    technicalResults = await runTechnicalChecks(allRecords);
  } else {
    log.info(`\n🔎 Technical Check Mode: SELECTED ONLY (${selectedOpportunities.length})`);
    technicalResults = await runTechnicalChecks(selectedOpportunities);
  }
  
  // Step 3: Generate outputs
  generateOutputs(inputFile, selectedOpportunities, technicalResults, allRecords);
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 Done!\n');
}

// Run
main().catch(error => {
  console.error('\n💥 Fatal error:', error);
  console.error(error.stack);
  process.exit(1);
});

