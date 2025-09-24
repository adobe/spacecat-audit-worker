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
 * Internal Links Fix Checker
 * 
 * This script checks if broken internal links from existing suggestions have been fixed.
 * It tests the current status of broken URLs and determines if fixes have been implemented.
 * 
 * Features:
 * - Comprehensive 24-column raw data schema
 * - Tests current URL status (200 OK, redirects, etc.)
 * - Checks if AI-suggested URLs were implemented
 * - Multi-site processing with consolidation
 * - Efficient database queries (outdated + fixed suggestions)
 */

import { writeFileSync } from 'fs';
// Using simple console logger instead of shared-utils dependency
import { createDataAccess } from '@adobe/spacecat-shared-data-access';
import { SITES } from './constants.js';
import { writeInternalLinksCSV, formatInternalLinksResult, INTERNAL_LINKS_CSV_HEADERS } from './csv-utils.js';

/**
 * Internal Links Fix Checker Class
 */
class InternalLinksFixChecker {
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
        this.log.info('No internal links suggestions found for this site');
        return;
      }
      
      await this.checkSuggestionsFixes(existingSuggestions);
      
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
      this.log.error('Failed to run internal links fix checker:', error.message);
      throw error;
    }
  }

  /**
   * Get existing internal links suggestions from database
   */
  async getExistingSuggestions() {
    this.log.debug('Fetching existing internal links suggestions...');
    
    const { Opportunity } = this.dataAccess;
    const allOpportunities = await Opportunity.allBySiteId(this.options.siteId);
    
    // Debug: Log all opportunity types found
    if (this.options.verbose) {
      const opportunityTypes = [...new Set(allOpportunities.map(opp => opp.getType()))];
      this.log.debug(`All opportunity types found: ${opportunityTypes.join(', ')}`);
    }
    
    // Filter for internal links opportunities
    const internalLinksOpportunities = allOpportunities.filter((opportunity) => 
      opportunity.getType() === 'broken-internal-links'
    );
    
    this.log.debug(`Found ${internalLinksOpportunities.length} internal links opportunities`);
    
    // Create opportunity data map for later use
    this.opportunityStatusMap = {};
    this.opportunityDataMap = {};
    internalLinksOpportunities.forEach(opportunity => {
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
    
    for (const opportunity of internalLinksOpportunities) {
      const opptyId = opportunity.getId();
      
      // Get outdated suggestions
      const outdatedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'outdated');
      suggestions.push(...outdatedSuggestions);
      
      // Get fixed suggestions
      const fixedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'fixed');
      suggestions.push(...fixedSuggestions);
    }
    
    this.log.debug(`Found ${suggestions.length} outdated + fixed internal links suggestions`);
    return suggestions;
  }

  /**
   * Check if internal links suggestions are fixed
   */
  async checkSuggestionsFixes(existingSuggestions) {
    this.log.info('Checking if internal links suggestions are fixed...');
    
    const suggestionsToCheck = this.options.limit 
      ? existingSuggestions.slice(0, this.options.limit) 
      : existingSuggestions;
    
    this.log.info(`Testing ${suggestionsToCheck.length} suggestions`);
    
    for (let i = 0; i < suggestionsToCheck.length; i++) {
      const suggestion = suggestionsToCheck[i];
      const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
      
      if (!suggestionData || !suggestionData.urlFrom || !suggestionData.urlTo) {
        this.log.debug(`Skipping invalid suggestion: ${suggestion.getId ? suggestion.getId() : 'unknown'}`);
        continue;
      }
      
      const { urlFrom, urlTo, urlsSuggested, aiRationale, trafficDomain } = suggestionData;
      
      this.log.debug(`Testing ${i + 1}/${suggestionsToCheck.length}: ${urlTo}`);
      
      // Test current status of the broken URL
      const currentStatus = await this.testUrlStatus(urlTo);
      await this.delay(100); // Rate limiting
      
      let isFixed = false;
      let fixType = 'NOT_FIXED';
      let currentStatusDisplay = currentStatus.success ? currentStatus.statusCode : 'ERROR';
      let aiSuggestionImplemented = false;
      
      if (currentStatus.success) {
        // Check if URL is now accessible (same logic as internal links handler)
        if (currentStatus.isAccessible) {
          isFixed = true;
          fixType = 'URL_NOW_WORKS';
        }
        // Check if redirect was implemented to suggested URL (for redirects)
        else if (urlsSuggested && Array.isArray(urlsSuggested) && (currentStatus.statusCode === 301 || currentStatus.statusCode === 302)) {
          aiSuggestionImplemented = await this.checkRedirectToSuggested(urlTo, urlsSuggested);
          if (aiSuggestionImplemented) {
            isFixed = true;
            fixType = 'AI_SUGGESTION_IMPLEMENTED';
          }
        }
      } else {
        // If we couldn't test the URL, it's still broken
        isFixed = false;
        fixType = 'STILL_BROKEN';
      }
      
      // Get opportunity data from our pre-built map (no additional API call!)
      const opportunityId = suggestion.getOpportunityId ? suggestion.getOpportunityId() : 'unknown';
      const opportunityData = this.opportunityDataMap[opportunityId] || {};
      
      // Store result with all required fields for 24-column schema
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
        urlFrom: urlFrom,
        urlTo: urlTo,
        trafficDomain: trafficDomain || 0,
        
        // AI Recommendations (3 columns)
        urlsSuggested: Array.isArray(urlsSuggested) ? urlsSuggested.join(', ') : (urlsSuggested || ''),
        aiRationale: aiRationale || '',
        recommendedAction: isFixed ? 'MARK AS FIXED' : 'KEEP CURRENT STATUS',
        
        // Fix Detection Results (4 columns)
        linkFixed: isFixed,
        aiSuggestionImplemented: aiSuggestionImplemented,
        fixType: fixType,
        currentStatusCode: currentStatusDisplay,
        
        // Timestamps and Metadata (6 columns)
        opportunityCreated: opportunityData.createdAt || '',
        opportunityUpdated: opportunityData.updatedAt || '',
        suggestionCreated: suggestion.getCreatedAt ? suggestion.getCreatedAt() : (suggestion.createdAt || ''),
        suggestionUpdated: suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : (suggestion.updatedAt || ''),
        updatedBy: suggestion.getUpdatedBy ? suggestion.getUpdatedBy() : (suggestion.updatedBy || ''),
        testDate: new Date().toISOString()
      });
      
      if (isFixed) {
        this.log.info(`✅ FIXED: ${urlTo} (${fixType})`);
      } else {
        this.log.debug(`❌ NOT FIXED: ${urlTo} (still ${currentStatusDisplay})`);
      }
    }
  }

  /**
   * Test URL status
   */
  /**
   * Test URL accessibility using the same logic as internal links handler
   * A URL is considered accessible if status < 400, otherwise it's broken
   */
  async testUrlStatus(url) {
    try {
      // Use same timeout as internal links handler (3000ms)
      const response = await fetch(url, { timeout: 3000 });
      const { status } = response;
      
      // Log non-404, non-200 status codes (same as handler)
      if (status >= 400 && status < 500 && status !== 404) {
        this.log.debug(`Warning: ${url} returned client error: ${status}`);
      }
      
      return {
        success: true,
        statusCode: status,
        redirectLocation: response.headers.get('location'),
        isAccessible: status < 400  // Same logic as handler: < 400 = accessible
      };
    } catch (error) {
      this.log.debug(`Error checking ${url}: ${error.code === 'ETIMEOUT' ? `Request timed out after 3000ms` : error.message}`);
      return {
        success: false,
        error: error.message,
        isAccessible: false  // Any error means URL is inaccessible
      };
    }
  }

  /**
   * Check if redirect points to any of the suggested URLs
   */
  async checkRedirectToSuggested(originalUrl, suggestedUrls) {
    try {
      const response = await fetch(originalUrl, {
        method: 'HEAD',
        redirect: 'manual',
        timeout: 10000
      });
      
      const redirectLocation = response.headers.get('location');
      if (!redirectLocation) return false;
      
      // Normalize URLs for comparison
      const normalizedRedirect = new URL(redirectLocation, originalUrl).href;
      
      return suggestedUrls.some(suggestedUrl => {
        try {
          const normalizedSuggested = new URL(suggestedUrl, originalUrl).href;
          return normalizedRedirect === normalizedSuggested;
        } catch {
          return false;
        }
      });
    } catch (error) {
      this.log.debug(`Error checking redirect for ${originalUrl}: ${error.message}`);
      return false;
    }
  }

  /**
   * Add delay to avoid overwhelming servers
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate CSV report
   */
  generateCSV() {
    const filename = writeInternalLinksCSV(this.results, this.options.siteId, this.site?.getBaseURL() || 'Unknown Site');
    this.log.info(`📊 Comprehensive internal links CSV report generated: ${filename}`);
    return filename;
  }

  /**
   * Mark fixed suggestions in database
   */
  async markFixedSuggestions() {
    const fixedResults = this.results.filter(r => r.linkFixed);
    
    if (fixedResults.length === 0) {
      this.log.info('No suggestions to mark as fixed');
      return;
    }

    this.log.info(`Marking ${fixedResults.length} suggestions as fixed...`);
    
    if (this.options.dryRun) {
      this.log.info('[DRY RUN] Would mark the following suggestions as fixed:');
      fixedResults.forEach(r => {
        this.log.info(`  - ${r.suggestionId}: ${r.urlTo}`);
      });
      return;
    }

    // TODO: Implement actual database updates when ready
    this.log.warn('Database update functionality not yet implemented');
  }

  /**
   * Print summary statistics
   */
  printSummary() {
    const totalSuggestions = this.results.length;
    const fixedByAI = this.results.filter(r => r.aiSuggestionImplemented).length;
    const fixedOverall = this.results.filter(r => r.linkFixed).length;
    
    this.log.info('');
    this.log.info('=== INTERNAL LINKS SUMMARY ===');
    this.log.info(`Total suggestions processed: ${totalSuggestions}`);
    this.log.info(`AI Suggestions Implemented: ${fixedByAI}`);
    this.log.info(`Fixed overall: ${fixedOverall}`);
    this.log.info(`Not fixed: ${totalSuggestions - fixedOverall}`);
    
    if (fixedOverall > 0) {
      this.log.info('');
      this.log.info('Fixed links by type:');
      const fixedByType = {};
      this.results.filter(r => r.linkFixed).forEach(r => {
        const key = r.fixType;
        fixedByType[key] = (fixedByType[key] || 0) + 1;
      });
      
      Object.entries(fixedByType).forEach(([type, count]) => {
        this.log.info(`  ${type}: ${count}`);
      });
    }
  }
}

// CLI setup
import { Command } from 'commander';

const program = new Command();
program
  .name('check-internal-links-fixed')
  .description('Check if broken internal links from suggestions have been fixed')
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
      const checker = new InternalLinksFixChecker(siteOptions);
      
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
  const filename = `consolidated-internal-links-all-sites-${timestamp}Z.csv`;
  
  // Generate CSV with proper site info from each result
  const csvRows = allResults.map(result => formatInternalLinksResult(result, result.siteId, result.siteName));
  const csvContent = [
    INTERNAL_LINKS_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
  
  writeFileSync(filename, csvContent);
  console.log(`📊 Consolidated internal links CSV generated: ${filename} (${allResults.length} total results)`);
}

// Run the processing
processSites().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
