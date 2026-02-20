#!/usr/bin/env node

/**
 * On-Page SEO Testing Script
 * 
 * Processes upstream CSV suggestions, applies opportunity selection logic,
 * runs technical SEO checks, and outputs filtered results for analysis.
 * 
 * Features:
 * - SERP position filtering (4-30 range)
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

/**
 * Fetch sitemap and extract lastmod dates for URLs.
 * Tries the sitemap URL from robots.txt first, then common defaults.
 */
async function fetchSitemapLastmod(urls) {
  if (urls.length === 0) return {};

  // Extract domain from first URL
  const firstUrl = new URL(urls[0]);
  const baseUrl = `${firstUrl.protocol}//${firstUrl.hostname}`;

  // Try to find sitemap URL from robots.txt
  let sitemapUrls = [];
  try {
    const robotsResp = await fetch(`${baseUrl}/robots.txt`);
    if (robotsResp.ok) {
      const robotsTxt = await robotsResp.text();
      const sitemapMatches = robotsTxt.match(/^Sitemap:\s*(.+)$/gmi);
      if (sitemapMatches) {
        sitemapUrls = sitemapMatches.map(m => m.replace(/^Sitemap:\s*/i, '').trim());
      }
    }
  } catch (e) {
    // Ignore robots.txt fetch errors
  }

  // Fallback to common sitemap locations
  if (sitemapUrls.length === 0) {
    sitemapUrls = [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`];
  }

  const lastmodMap = {};
  // Build a lookup that maps normalized sitemap URLs back to original input URLs
  // Try both exact match and without .html extension
  const urlLookup = new Map(); // sitemapNormalized -> inputNormalized
  for (const u of urls) {
    const norm = u.toLowerCase().replace(/\/$/, '');
    urlLookup.set(norm, norm);
    // Also map the version without .html so sitemap entries without .html can match
    if (norm.endsWith('.html')) {
      urlLookup.set(norm.replace(/\.html$/, ''), norm);
    }
  }

  const sitemapUrlSet = new Set(); // track all URLs found in sitemap (normalized)

  for (const sitemapUrl of sitemapUrls) {
    try {
      await parseSitemap(sitemapUrl, lastmodMap, urlLookup, sitemapUrlSet);
    } catch (e) {
      // Ignore individual sitemap fetch errors
    }
  }

  // Also build an in_sitemap map: true if found in sitemap (exact or without .html)
  const inSitemapMap = {};
  for (const u of urls) {
    const norm = u.toLowerCase().replace(/\/$/, '');
    const withoutHtml = norm.endsWith('.html') ? norm.replace(/\.html$/, '') : null;
    const exactMatch = sitemapUrlSet.has(norm);
    const noHtmlMatch = withoutHtml ? sitemapUrlSet.has(withoutHtml) : false;
    if (exactMatch) {
      inSitemapMap[norm] = 'YES';
    } else if (noHtmlMatch) {
      inSitemapMap[norm] = 'URL_MISMATCH';
    } else {
      inSitemapMap[norm] = 'NO';
    }
  }

  return { lastmodMap, inSitemapMap };
}

/**
 * Parse a sitemap (or sitemap index) and populate lastmodMap
 */
async function parseSitemap(sitemapUrl, lastmodMap, urlLookup, sitemapUrlSet) {
  const resp = await fetch(sitemapUrl);
  if (!resp.ok) return;

  const xml = await resp.text();

  // Check if this is a sitemap index
  if (xml.includes('<sitemapindex')) {
    const sitemapLocs = [...xml.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
    for (const childUrl of sitemapLocs) {
      try {
        await parseSitemap(childUrl, lastmodMap, urlLookup, sitemapUrlSet);
      } catch (e) {
        // Ignore child sitemap errors
      }
    }
    return;
  }

  // Parse regular sitemap - extract url/lastmod pairs
  const urlBlocks = xml.split('<url>').slice(1);
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (locMatch) {
      const loc = locMatch[1].trim().toLowerCase().replace(/\/$/, '');
      sitemapUrlSet.add(loc); // Track all sitemap URLs
      // Look up if this sitemap URL matches any input URL (exact or without .html)
      const inputUrl = urlLookup.get(loc);
      if (inputUrl) {
        lastmodMap[inputUrl] = lastmodMatch ? lastmodMatch[1].trim() : '';
      }
    }
  }
}

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
  fs.writeFileSync(filePath, '\ufeff' + csv, 'utf-8');
  log.info(`Saved: ${filePath} (${records.length} rows)`);
}

/**
 * Determines if a page is eligible for optimization based on SERP position.
 * 
 * Business Rules (from handler.js):
 * - Positions 1-3: Exclude (already performing well)
 * - Positions 4-30: Include (optimization opportunity range)
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
    return true; // Extended range (21-30)
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
 * 1. Filter by SERP position (4-30)
 * 2. Calculate opportunity scores
 * 3. Sort by score descending
 * 4. Select top N
 */
function selectOpportunities(records, topN) {
  log.info(`\n📊 Opportunity Selection:`);
  log.info(`   Total URLs in CSV: ${records.length}`);
  
  // Step 1: Filter eligible opportunities by SERP position (4-30)
  const eligibleOpportunities = records.filter((record) => {
    const serpPosition = record.serp_position || record.serpPosition || record.ranking;
    return isEligibleForOptimization(serpPosition, true);
  });
  
  log.info(`   Eligible (positions 4-30): ${eligibleOpportunities.length}`);
  
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
    if (result.checks.httpStatus.blockerType === 'googlebot-blocked') {
      blockerDetails = `Googlebot Blocked: ${result.checks.httpStatus.warning || 'Critical SEO issue - Googlebot cannot access page'}`;
    } else {
      blockerDetails = `HTTP ${result.checks.httpStatus.statusCode}`;
    }
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
  log.info(`   Checking ${urls.length} URLs (3 concurrent requests to avoid rate limiting)...\n`);
  
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
function generateOutputs(inputFile, selectedOpportunities, technicalResults, allRecords, lastmodMap = {}, inSitemapMap = {}) {
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
      
      const normalizedUrl = opp.url.toLowerCase().replace(/\/$/, '');
      const lastmod = lastmodMap[normalizedUrl] || '';

      if (technicalResult) {
        return {
          ...opp,
          technical_check_passed: technicalResult.indexable ? 'YES' : 'NO',
          technical_issue_details: technicalResult.indexable ? '' : technicalResult.blockerDetails,
          in_sitemap: inSitemapMap[normalizedUrl] || 'NO',
          sitemap_lastmod: lastmod,
        };
      }

      // If no technical check was run for this URL, mark as not checked
      return {
        ...opp,
        technical_check_passed: 'NOT_CHECKED',
        technical_issue_details: '',
        in_sitemap: inSitemapMap[normalizedUrl] || 'NO',
        sitemap_lastmod: lastmod,
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
      
      // IMPORTANT: Merge with original CSV record to get all data
      const originalRecord = allRecords.find(rec => rec.url === r.url) || {};
      const mergedData = { ...originalRecord, ...rest };
      
      // Calculate score and eligibility for this URL
      const serpPosition = parseFloat(mergedData.serp_position || mergedData.serpPosition || mergedData.ranking || 99);
      const searchVolume = parseSearchVolume(mergedData.volume_per_month || mergedData.searchVolume || 0);
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
      
      const normalizedUrl = r.url.toLowerCase().replace(/\/$/, '');
      const lastmod = lastmodMap[normalizedUrl] || '';

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
        in_sitemap: inSitemapMap[normalizedUrl] || 'NO',
        sitemap_lastmod: lastmod,
        // Include original CSV data (using mergedData to preserve all columns)
        ...Object.fromEntries(
          Object.entries(mergedData).filter(([key]) => !['blockersString', 'blockerDetails', 'serp_position', 'serpPosition', 'ranking', 'url'].includes(key))
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
  
  // Step 2: Fetch sitemap lastmod dates
  log.info(`\n📅 Fetching sitemap lastmod dates...`);
  const allUrls = allRecords.map(r => r.url);
  const { lastmodMap, inSitemapMap } = await fetchSitemapLastmod(allUrls);
  const foundCount = Object.keys(lastmodMap).length;
  const mismatchCount = Object.values(inSitemapMap).filter(v => v === 'URL_MISMATCH').length;
  log.info(`   Found lastmod for ${foundCount}/${allUrls.length} URLs`);
  if (mismatchCount > 0) {
    log.warn(`   ⚠️  ${mismatchCount} URLs found in sitemap without .html extension (URL mismatch)`);
  }

  // Step 3: Run technical checks
  let technicalResults = [];
  
  if (checkMode === 'all') {
    log.info(`\n🔎 Technical Check Mode: ALL URLs (${allRecords.length})`);
    technicalResults = await runTechnicalChecks(allRecords);
  } else {
    log.info(`\n🔎 Technical Check Mode: SELECTED ONLY (${selectedOpportunities.length})`);
    technicalResults = await runTechnicalChecks(selectedOpportunities);
  }
  
  // Step 4: Generate outputs
  generateOutputs(inputFile, selectedOpportunities, technicalResults, allRecords, lastmodMap, inSitemapMap);
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 Done!\n');
}

// Run
main().catch(error => {
  console.error('\n💥 Fatal error:', error);
  console.error(error.stack);
  process.exit(1);
});

