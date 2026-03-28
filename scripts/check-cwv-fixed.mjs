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
 * Core Web Vitals Fix Checker
 * 
 * This script checks if Core Web Vitals performance issues from existing suggestions have been fixed.
 * It compares historical CWV metrics with current performance data to identify improvements.
 * 
 * Features:
 * - Comprehensive 26-column raw data schema
 * - Compares current vs historical CWV metrics (LCP, CLS, INP)
 * - Identifies performance improvements and regressions
 * - Multi-site processing with consolidation
 * - Efficient database queries (outdated + fixed suggestions)
 */

import { writeFileSync } from 'fs';
import dotenv from 'dotenv';
// Using simple console logger instead of shared-utils dependency
import { createDataAccess, Audit } from '@adobe/spacecat-shared-data-access';

// Load environment variables from .env file
dotenv.config();
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { SITES } from './constants.js';
import { writeCWVCSV, formatCWVResult, CWV_CSV_HEADERS } from './csv-utils.js';

// CWV Thresholds (from handler)
const THRESHOLDS = {
  lcp: 2500,  // ms
  cls: 0.1,   // score
  inp: 200,   // ms
};

const INTERVAL = 7; // days
const DAILY_THRESHOLD = 100;
const auditType = Audit.AUDIT_TYPES.CWV;

/**
 * Core Web Vitals Fix Checker Class
 */
class CWVFixChecker {
  constructor(options = {}) {
    this.options = {
      siteId: null,
      verbose: false,
      limit: null,
      markFixed: false,
      dryRun: true,
      ...options
    };
    
    this.log = this.createSimpleLogger(this.options.verbose);
    
    this.results = [];
    this.dataAccess = null;
    this.site = null;
    this.rumAPIClient = null;
    this.opportunityStatusMap = {};
    this.opportunityDataMap = {};
  }

  /**
   * Create simple console logger
   */
  createSimpleLogger(verbose) {
    return {
      info: (msg) => console.log(`[INFO] ${msg}`),
      debug: verbose ? (msg) => console.log(`[DEBUG] ${msg}`) : () => {},
      error: (msg) => console.error(`[ERROR] ${msg}`)
    };
  }

  /**
   * Initialize data access and validate site
   */
  async initializeDataAccess() {
    this.log.info('Initializing data access...');
    
    try {
      // Set up required environment variables for data access
      if (!process.env.DYNAMO_TABLE_NAME_DATA) {
        process.env.DYNAMO_TABLE_NAME_DATA = 'spacecat-services-data';
        this.log.debug('Set default DYNAMO_TABLE_NAME_DATA');
      }
      
      if (!process.env.S3_SCRAPER_BUCKET_NAME) {
        process.env.S3_SCRAPER_BUCKET_NAME = 'spacecat-prod-scraper';
        this.log.debug('Set default S3_SCRAPER_BUCKET_NAME');
      }
      
      // Check for required RUM API environment variables
      if (!process.env.RUM_DOMAIN_KEY) {
        this.log.error('❌ Missing required environment variable: RUM_DOMAIN_KEY');
        this.log.error('   This is needed for RUM API access to fetch current CWV data');
      }
      
      // Initialize data access with configuration
      const config = {
        tableNameData: process.env.DYNAMO_TABLE_NAME_DATA,
        indexNameAllByStatus: 'gsi1pk-gsi1sk-index',
        indexNameAllBySiteId: 'gsi2pk-gsi2sk-index'
      };
      
      this.dataAccess = createDataAccess(config);
      const { Site } = this.dataAccess;
      
      this.site = await Site.findById(this.options.siteId);
      if (!this.site) {
        throw new Error(`Site not found: ${this.options.siteId}`);
      }
      
      this.log.info(`✓ Site found: ${this.site.getBaseURL()}`);
      
    } catch (error) {
      this.log.error('Failed to initialize data access:', error.message);
      throw error;
    }
  }

  /**
   * Main execution method
   */
  async run() {
    try {
      await this.initializeDataAccess();
      
      const existingSuggestions = await this.getExistingSuggestions();
      if (existingSuggestions.length === 0) {
        this.log.info('No CWV suggestions found for this site');
        return;
      }
      
      // Get current CWV data for comparison
      const currentCWVData = await this.getCurrentCWVData();
      
      await this.checkSuggestionsFixes(existingSuggestions, currentCWVData);
      
      if (this.results.length > 0) {
        this.generateCSV();
        this.printSummary();
        
        if (this.options.markFixed && !this.options.dryRun) {
          await this.markFixedSuggestions();
        }
      } else {
        this.log.info('No results to report');
      }
      
    } catch (error) {
      this.log.error('Failed to run CWV fix checker:', error.message);
      throw error;
    }
  }

  /**
   * Get existing CWV suggestions from database
   */
  async getExistingSuggestions() {
    this.log.debug('Fetching existing CWV suggestions...');
    
    const { Opportunity } = this.dataAccess;
    const allOpportunities = await Opportunity.allBySiteId(this.options.siteId);
    
    // Debug: Log all opportunity types found
    if (this.options.verbose) {
      const opportunityTypes = [...new Set(allOpportunities.map(opp => opp.getType()))];
      this.log.debug(`All opportunity types found: ${opportunityTypes.join(', ')}`);
    }
    
    // Filter for CWV opportunities
    const cwvOpportunities = allOpportunities.filter((opportunity) => 
      opportunity.getType() === 'cwv'
    );
    
    this.log.debug(`Found ${cwvOpportunities.length} CWV opportunities`);
    
    // Create opportunity data map for later use
    this.opportunityStatusMap = {};
    this.opportunityDataMap = {};
    cwvOpportunities.forEach(opportunity => {
      const oppId = opportunity.getId();
      this.opportunityStatusMap[oppId] = opportunity.getStatus ? opportunity.getStatus() : (opportunity.status || 'unknown');
      this.opportunityDataMap[oppId] = {
        status: opportunity.getStatus ? opportunity.getStatus() : (opportunity.status || 'unknown'),
        createdAt: opportunity.getCreatedAt ? opportunity.getCreatedAt() : (opportunity.createdAt || ''),
        updatedAt: opportunity.getUpdatedAt ? opportunity.getUpdatedAt() : (opportunity.updatedAt || '')
      };
    });
    
    // Get outdated AND fixed suggestions directly from database
    const { Suggestion } = this.dataAccess;
    const suggestions = [];
    
    for (const opportunity of cwvOpportunities) {
      const opptyId = opportunity.getId();
      
      // Get outdated suggestions
      const outdatedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'outdated');
      suggestions.push(...outdatedSuggestions);
      
      // Get fixed suggestions
      const fixedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'fixed');
      suggestions.push(...fixedSuggestions);
    }
    
    this.log.debug(`Found ${suggestions.length} outdated + fixed CWV suggestions`);
    return suggestions;
  }

  /**
   * Get current CWV data from RUM API (optimized for fix checker)
   */
  async getCurrentCWVData() {
    this.log.info('Fetching current CWV data from RUM API (optimized query)...');
    try {
      // Create proper context object for RUM API client (same as handler)
      const context = {
        log: this.log,
        env: process.env
      };
      
      this.rumAPIClient = RUMAPIClient.createFrom(context);
      
      // Debug: Check if RUM_DOMAIN_KEY is available
      if (!process.env.RUM_DOMAIN_KEY) {
        throw new Error('RUM_DOMAIN_KEY environment variable is required but not set');
      }
      
      this.log.debug(`Using RUM_DOMAIN_KEY: ${process.env.RUM_DOMAIN_KEY.substring(0, 8)}...`);
      
      // Use exact same logic as CWV handler with fallback to cdn-analysis
      let groupedURLs = this.site.getConfig().getGroupedURLs(auditType);
      
      // Fallback to cdn-analysis grouped URLs if CWV-specific ones don't exist
      if (!groupedURLs) {
        groupedURLs = this.site.getConfig().getGroupedURLs('cdn-analysis');
        this.log.debug(`CWV grouped URLs not found, using cdn-analysis fallback: ${groupedURLs ? groupedURLs.length + ' patterns' : 'none'}`);
      } else {
        this.log.debug(`Using CWV-specific grouped URLs: ${groupedURLs.length} patterns`);
      }
      
      // Use the same domain format as the handler - use wwwUrlResolver like the handler does
      const { wwwUrlResolver } = await import('../src/common/index.js');
      const auditUrl = await wwwUrlResolver(this.site, { log: this.log, env: process.env });
      this.log.debug(`Resolved audit URL: ${auditUrl} (vs base URL: ${this.site.getBaseURL()})`);
      
      const options = {
        domain: auditUrl,
        interval: INTERVAL,
        granularity: 'hourly',
        groupedURLs,
      };
      
      this.log.debug(`RUM API query options: ${JSON.stringify(options, null, 2)}`);
      
      this.log.debug('Starting RUM API query...');
      
      
      let cwvData;
      try {
        this.log.debug(`Calling rumAPIClient.query with auditType "${auditType}"...`);
        cwvData = await this.rumAPIClient.query(auditType, options);
        this.log.debug(`Raw CWV data received: ${cwvData ? cwvData.length : 'null'} entries`);
      } catch (rumError) {
        this.log.error('RUM API query failed:', rumError.message);
        throw rumError;
      }
      
      // No filtering - we want all data for fix checking
      this.log.info(`✓ Retrieved ${cwvData.length} current CWV entries (no pageview filtering)`);
      
      // Create lookup map for easy comparison (same buildKey logic as handler)
      const cwvMap = {};
      cwvData.forEach(entry => {
        const key = entry.type === 'url' ? entry.url : entry.pattern; // Same buildKey logic
        cwvMap[key] = entry;
      });
      
      return cwvMap;
      
    } catch (error) {
      this.log.error('Failed to fetch current CWV data:', error.message);
      this.log.error('Error stack:', error.stack);
      if (error.response) {
        this.log.error('Response status:', error.response.status);
        this.log.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      if (error.config) {
        this.log.error('Request config:', JSON.stringify(error.config, null, 2));
      }
      return {};
    }
  }

  /**
   * Check if CWV suggestions are fixed by comparing metrics
   */
  async checkSuggestionsFixes(existingSuggestions, currentCWVData) {
    this.log.info('Checking if CWV suggestions are fixed...');
    
    const suggestionsToCheck = this.options.limit 
      ? existingSuggestions.slice(0, this.options.limit) 
      : existingSuggestions;
    
    this.log.info(`Analyzing ${suggestionsToCheck.length} suggestions`);
    
    for (let i = 0; i < suggestionsToCheck.length; i++) {
      const suggestion = suggestionsToCheck[i];
      const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
      
      if (!suggestionData) {
        this.log.debug(`Skipping invalid suggestion: ${suggestion.getId ? suggestion.getId() : 'unknown'}`);
        continue;
      }
      
      // Extract CWV data from the suggestion data object (same structure as handler stores)
      const { type, url, pattern, pageviews, metrics } = suggestionData;
      
      // Calculate weighted average CWV metrics from the historical metrics array
      let oldLCP = 0, oldCLS = 0, oldINP = 0;
      let totalPageviews = 0;
      
      if (metrics && Array.isArray(metrics)) {
        let lcpSum = 0, clsSum = 0, inpSum = 0;
        let lcpWeight = 0, clsWeight = 0, inpWeight = 0;
        
        metrics.forEach(metric => {
          const weight = metric.pageviews || 0;
          totalPageviews += weight;
          
          if (metric.lcp !== null && metric.lcp !== undefined) {
            lcpSum += metric.lcp * weight;
            lcpWeight += weight;
          }
          if (metric.cls !== null && metric.cls !== undefined) {
            clsSum += metric.cls * weight;
            clsWeight += weight;
          }
          if (metric.inp !== null && metric.inp !== undefined) {
            inpSum += metric.inp * weight;
            inpWeight += weight;
          }
        });
        
        oldLCP = lcpWeight > 0 ? lcpSum / lcpWeight : 0;
        oldCLS = clsWeight > 0 ? clsSum / clsWeight : 0;
        oldINP = inpWeight > 0 ? inpSum / inpWeight : 0;
        
        if (this.options.verbose && i < 3) {
          this.log.debug(`Historical metrics: LCP=${oldLCP.toFixed(2)}ms, CLS=${oldCLS.toFixed(4)}, INP=${oldINP.toFixed(2)}ms (${metrics.length} devices)`);
        }
      } else {
        if (this.options.verbose && i < 3) {
          this.log.debug(`No metrics array found in suggestion data for ${type === 'url' ? url : pattern}`);
        }
      }
      
      this.log.debug(`Analyzing ${i + 1}/${suggestionsToCheck.length}: ${type === 'url' ? url : pattern}`);
      
      // Find current data for comparison
      const key = type === 'url' ? url : pattern;
      const currentData = currentCWVData[key];
      
      let isFixed = false;
      let fixType = 'NOT_IMPROVED';
      let metricsImproved = [];
      let currentLCP = null, currentCLS = null, currentINP = null;
      
      if (currentData) {
        // Calculate weighted average CWV metrics from current data metrics array
        if (currentData.metrics && Array.isArray(currentData.metrics)) {
          let lcpSum = 0, clsSum = 0, inpSum = 0;
          let lcpWeight = 0, clsWeight = 0, inpWeight = 0;
          
          currentData.metrics.forEach(metric => {
            const weight = metric.pageviews || 0;
            
            if (metric.lcp !== null && metric.lcp !== undefined) {
              lcpSum += metric.lcp * weight;
              lcpWeight += weight;
            }
            if (metric.cls !== null && metric.cls !== undefined) {
              clsSum += metric.cls * weight;
              clsWeight += weight;
            }
            if (metric.inp !== null && metric.inp !== undefined) {
              inpSum += metric.inp * weight;
              inpWeight += weight;
            }
          });
          
          currentLCP = lcpWeight > 0 ? lcpSum / lcpWeight : null;
          currentCLS = clsWeight > 0 ? clsSum / clsWeight : null;
          currentINP = inpWeight > 0 ? inpSum / inpWeight : null;
        }
        
        // Identify which metrics were originally problematic (above threshold)
        const problemMetrics = [];
        const wasLCPBad = oldLCP > 0 && oldLCP > THRESHOLDS.lcp;
        const wasCLSBad = oldCLS > 0 && oldCLS > THRESHOLDS.cls;
        const wasINPBad = oldINP > 0 && oldINP > THRESHOLDS.inp;
        
        if (wasLCPBad) problemMetrics.push('LCP');
        if (wasCLSBad) problemMetrics.push('CLS');
        if (wasINPBad) problemMetrics.push('INP');
        
        // Check if each problematic metric is now fixed (improved to "good" threshold)
        const lcpFixed = !wasLCPBad || (currentLCP !== null && currentLCP <= THRESHOLDS.lcp);
        const clsFixed = !wasCLSBad || (currentCLS !== null && currentCLS <= THRESHOLDS.cls);
        const inpFixed = !wasINPBad || (currentINP !== null && currentINP <= THRESHOLDS.inp);
        
        // Track which metrics improved
        if (wasLCPBad && currentLCP !== null && currentLCP <= THRESHOLDS.lcp) {
          metricsImproved.push('LCP');
        }
        if (wasCLSBad && currentCLS !== null && currentCLS <= THRESHOLDS.cls) {
          metricsImproved.push('CLS');
        }
        if (wasINPBad && currentINP !== null && currentINP <= THRESHOLDS.inp) {
          metricsImproved.push('INP');
        }
        
        // Only mark as fixed if ALL originally problematic metrics are now good
        if (problemMetrics.length > 0 && lcpFixed && clsFixed && inpFixed) {
          isFixed = true;
          if (metricsImproved.length === problemMetrics.length) {
            fixType = `ALL_FIXED_${metricsImproved.join('_')}`;
          } else {
            // Some metrics improved, but we need to check if all problems are resolved
            fixType = metricsImproved.length > 0 ? `PARTIALLY_FIXED_${metricsImproved.join('_')}` : 'FIXED_NO_CURRENT_DATA';
          }
        } else if (problemMetrics.length > 0) {
          // Not all problems are fixed yet
          const stillBad = [];
          if (wasLCPBad && !lcpFixed) stillBad.push('LCP');
          if (wasCLSBad && !clsFixed) stillBad.push('CLS');
          if (wasINPBad && !inpFixed) stillBad.push('INP');
          fixType = `STILL_BAD_${stillBad.join('_')}`;
        }
      } else {
        // No current data - might be low traffic or removed
        fixType = 'NO_CURRENT_DATA';
      }
      
      // Get opportunity data from our pre-built map
      const opportunityId = suggestion.getOpportunityId ? suggestion.getOpportunityId() : 'unknown';
      const opportunityData = this.opportunityDataMap[opportunityId] || {};
      
      // Store result with all required fields for 26-column schema
      this.results.push({
        // Core Identity (5 columns)
        siteId: this.options.siteId,
        siteName: this.site.getBaseURL(),
        opportunityId: opportunityId,
        opportunityStatus: opportunityData.status || 'unknown',
        suggestionId: suggestion.getId ? suggestion.getId() : 'unknown',
        
        // Suggestion Details (6 columns)
        suggestionType: suggestion.getType ? suggestion.getType() : suggestion.type,
        suggestionStatus: suggestion.getStatus ? suggestion.getStatus() : suggestion.status,
        suggestionRank: suggestion.getRank ? suggestion.getRank() : suggestion.rank,
        entryType: type,
        urlOrPattern: key,
        pageviews: pageviews || totalPageviews || 0,
        
        // Historical CWV Metrics (3 columns)
        oldLCP: oldLCP || 0,
        oldCLS: oldCLS || 0,
        oldINP: oldINP || 0,
        
        // Current CWV Metrics (3 columns)
        currentLCP: currentLCP || 0,
        currentCLS: currentCLS || 0,
        currentINP: currentINP || 0,
        
        // Performance Analysis (3 columns)
        metricsImproved: metricsImproved.join(', '),
        isFixed: isFixed,
        fixType: fixType,
        
        // Timestamps and Metadata (6 columns)
        opportunityCreated: opportunityData.createdAt || '',
        opportunityUpdated: opportunityData.updatedAt || '',
        suggestionCreated: suggestion.getCreatedAt ? suggestion.getCreatedAt() : (suggestion.createdAt || ''),
        suggestionUpdated: suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : (suggestion.updatedAt || ''),
        updatedBy: suggestion.getUpdatedBy ? suggestion.getUpdatedBy() : (suggestion.updatedBy || ''),
        testDate: new Date().toISOString(),
        
        recommendedAction: isFixed ? 'MARK AS FIXED' : 'CONTINUE OPTIMIZATION'
      });
      
      if (isFixed) {
        this.log.info(`✅ IMPROVED: ${key} (${fixType})`);
      } else {
        this.log.debug(`❌ NOT IMPROVED: ${key} (${fixType})`);
      }
    }
  }

  /**
   * Generate CSV report
   */
  generateCSV() {
    const filename = writeCWVCSV(this.results, this.options.siteId, this.site?.getBaseURL() || 'Unknown Site');
    this.log.info(`📊 Comprehensive CWV CSV report generated: ${filename}`);
    return filename;
  }

  /**
   * Mark fixed suggestions in database
   */
  async markFixedSuggestions() {
    const fixedResults = this.results.filter(r => r.isFixed);
    
    if (fixedResults.length === 0) {
      this.log.info('No suggestions to mark as fixed');
      return;
    }

    this.log.info(`Marking ${fixedResults.length} suggestions as fixed...`);
    
    if (this.options.dryRun) {
      this.log.info('[DRY RUN] Would mark the following suggestions as fixed:');
      fixedResults.forEach(r => {
        this.log.info(`  - ${r.suggestionId}: ${r.urlOrPattern} (${r.fixType})`);
      });
      return;
    }

    // Database update functionality will be implemented in future version
    this.log.warn('Database update functionality not yet implemented');
  }

  /**
   * Print summary statistics
   */
  printSummary() {
    const totalSuggestions = this.results.length;
    const improved = this.results.filter(r => r.isFixed).length;
    const allGood = this.results.filter(r => r.fixType === 'ALL_METRICS_GOOD').length;
    
    this.log.info('');
    this.log.info('=== CWV SUMMARY ===');
    this.log.info(`Total suggestions processed: ${totalSuggestions}`);
    this.log.info(`Performance improved: ${improved}`);
    this.log.info(`All metrics good: ${allGood}`);
    this.log.info(`Still needs work: ${totalSuggestions - improved}`);
    
    if (improved > 0) {
      this.log.info('');
      this.log.info('Improvements by metric:');
      const metricCounts = { LCP: 0, CLS: 0, INP: 0 };
      
      this.results.filter(r => r.isFixed).forEach(r => {
        if (r.metricsImproved.includes('LCP')) metricCounts.LCP++;
        if (r.metricsImproved.includes('CLS')) metricCounts.CLS++;
        if (r.metricsImproved.includes('INP')) metricCounts.INP++;
      });
      
      Object.entries(metricCounts).forEach(([metric, count]) => {
        if (count > 0) {
          this.log.info(`  ${metric}: ${count} improvements`);
        }
      });
    }
  }
}

// CLI setup
import { Command } from 'commander';

const program = new Command();
program
  .name('check-cwv-fixed')
  .description('Check if Core Web Vitals performance issues from suggestions have been fixed')
  .option('--siteId <siteId>', 'Site ID to check')
  .option('--verbose', 'Enable verbose logging', false)
  .option('--limit <number>', 'Limit number of suggestions to check', parseInt)
  .option('--markFixed', 'Mark fixed suggestions in database', false)
  .option('--dryRun', 'Dry run mode (default: true)', true)
  .option('--allSites', 'Process all sites from constants.js', false)
  .option('--sites <siteIds>', 'Comma-separated list of site IDs to process')
  .option('--consolidate', 'Generate consolidated CSV for multiple sites', false);

program.parse();
const options = program.opts();

// Validate options
let sitesToProcess = [];

if (options.allSites) {
  sitesToProcess = SITES;
  console.log(`[INFO] Processing all ${sitesToProcess.length} sites`);
} else if (options.sites) {
  const siteIds = options.sites.split(',');
  sitesToProcess = SITES.filter(site => siteIds.includes(site.id));
  console.log(`[INFO] Processing ${sitesToProcess.length} specified sites`);
} else if (options.siteId) {
  const site = SITES.find(s => s.id === options.siteId);
  if (!site) {
    console.error(`[ERROR] Site ID not found in constants: ${options.siteId}`);
    process.exit(1);
  } else {
    sitesToProcess = [{ id: options.siteId, name: 'Custom Site' }];
  }
} else {
  // Default site ID for testing
  options.siteId = '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3';
  const defaultSite = SITES.find(s => s.id === options.siteId);
  sitesToProcess = [defaultSite];
  console.log(`[INFO] Using default site ID: ${options.siteId}`);
}

// Process sites
async function processSites() {
  const allResults = [];
  
  for (let i = 0; i < sitesToProcess.length; i++) {
    const site = sitesToProcess[i];
    
    try {
      console.log(`\n[INFO] Processing site ${i + 1}/${sitesToProcess.length}: ${site.name} (${site.id})`);
      
      // Create checker for this site
      const siteOptions = { ...options, siteId: site.id };
      const checker = new CWVFixChecker(siteOptions);
      
      await checker.run();
      
      // Collect results if consolidating
      if (options.consolidate && sitesToProcess.length > 1) {
        // Add site info to each result for consolidation using SITES constant names
        const resultsWithSiteInfo = checker.results.map(result => ({
          ...result,
          siteId: site.id,
          siteName: site.name  // Use the friendly name from SITES constant
        }));
        allResults.push(...resultsWithSiteInfo);
      }
      
      // Add delay between sites to avoid overwhelming servers
      if (i < sitesToProcess.length - 1) {
        console.log(`[INFO] Waiting 2 seconds before next site...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } catch (error) {
      console.error(`[ERROR] Failed to process ${site.name}: ${error.message}`);
      if (options.verbose) {
        console.error(error.stack);
      }
      continue;
    }
  }
  
  // Generate consolidated CSV if requested
  if (options.consolidate && sitesToProcess.length > 1 && allResults.length > 0) {
    generateConsolidatedCSV(allResults);
  }
}

// Generate consolidated CSV for multiple sites
function generateConsolidatedCSV(allResults) {
  if (allResults.length === 0) {
    console.log('📊 No results to consolidate');
    return;
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `consolidated-cwv-all-sites-${timestamp}Z.csv`;
  
  // Generate CSV with proper site info from each result
  const csvRows = allResults.map(result => formatCWVResult(result, result.siteId, result.siteName));
  const csvContent = [
    CWV_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
  
  writeFileSync(filename, csvContent);
  console.log(`📊 Consolidated CWV CSV generated: ${filename} (${allResults.length} total results)`);
}

// Run the processing
processSites().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
