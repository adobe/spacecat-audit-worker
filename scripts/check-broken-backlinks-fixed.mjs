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
 * Broken Backlinks Fix Checker
 * 
 * This script checks if broken backlink issues from existing suggestions have been fixed.
 * It tests broken URLs to see if redirects have been implemented to working pages.
 * 
 * Features:
 * - Comprehensive 24-column raw data schema
 * - Tests broken URLs using content analysis (detects soft 404s)
 * - Validates redirect targets and content
 * - Compares redirects with AI-suggested URLs
 * - Multi-site processing with consolidation
 * - Efficient database queries (outdated + fixed suggestions)
 */

import { writeFileSync } from 'fs';
// Using simple console logger instead of shared-utils dependency
import { createDataAccess } from '@adobe/spacecat-shared-data-access';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { SITES } from './constants.js';
import { writeBrokenBacklinksCSV, formatBrokenBacklinksResult, BROKEN_BACKLINKS_CSV_HEADERS } from './csv-utils.js';

// HTTP timeout for URL testing (same as handler)
const TIMEOUT = 3000;

/**
 * Broken Backlinks Fix Checker Class
 */
class BrokenBacklinksFixChecker {
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
        this.log.info('No broken backlinks suggestions found for this site');
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
      this.log.error('Failed to run broken backlinks fix checker:', error.message);
      throw error;
    }
  }

  /**
   * Get existing broken backlinks suggestions from database
   */
  async getExistingSuggestions() {
    this.log.debug('Fetching existing broken backlinks suggestions...');
    
    const { Opportunity } = this.dataAccess;
    const allOpportunities = await Opportunity.allBySiteId(this.options.siteId);
    
    // Debug: Log all opportunity types found
    if (this.options.verbose) {
      const opportunityTypes = [...new Set(allOpportunities.map(opp => opp.getType()))];
      this.log.debug(`All opportunity types found: ${opportunityTypes.join(', ')}`);
    }
    
    // Filter for broken-backlinks opportunities
    const brokenBacklinksOpportunities = allOpportunities.filter((opportunity) => 
      opportunity.getType() === 'broken-backlinks'
    );
    
    this.log.debug(`Found ${brokenBacklinksOpportunities.length} broken-backlinks opportunities`);
    
    // Create opportunity data map for later use
    this.opportunityStatusMap = {};
    this.opportunityDataMap = {};
    brokenBacklinksOpportunities.forEach(opportunity => {
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
    
    for (const opportunity of brokenBacklinksOpportunities) {
      const opptyId = opportunity.getId();
      
      // Get outdated suggestions
      const outdatedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'outdated');
      suggestions.push(...outdatedSuggestions);
      
      // Get fixed suggestions
      const fixedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'fixed');
      suggestions.push(...fixedSuggestions);
    }
    
    this.log.debug(`Found ${suggestions.length} outdated + fixed broken backlinks suggestions`);
    return suggestions;
  }

  /**
   * Test if URL is still broken (same logic as handler)
   */
  async isStillBrokenBacklink(url) {
    try {
      const response = await fetch(url, { timeout: TIMEOUT });
      
      if (!response.ok && response.status !== 404 && response.status >= 400 && response.status < 500) {
        this.log.debug(`Backlink ${url} returned status ${response.status}`);
      }
      
      // Check for soft 404s - many sites return 200 for "page not found" content
      if (response.ok) {
        const content = await response.text();
        const lowerContent = content.toLowerCase();
        
        // Common indicators of soft 404 pages
        const soft404Indicators = [
          'page not found',
          'that page could not be found',
          '404',
          'page does not exist',
          'page is not available',
          'sorry, we couldn\'t find that page',
          'the page you requested was not found',
          'this page doesn\'t exist'
        ];
        
        // Check if content suggests this is actually a 404 page
        const isSoft404 = soft404Indicators.some(indicator => lowerContent.includes(indicator));
        
        if (isSoft404) {
          this.log.debug(`Soft 404 detected for ${url} - returns 200 but shows error content`);
          return true; // Still broken despite 200 status
        }
        
        // Additional check: very short content might indicate error page
        if (content.trim().length < 500) {
          this.log.debug(`Suspiciously short content for ${url} (${content.length} chars) - might be error page`);
          return true; // Likely still broken
        }
        
        return false; // Genuinely working page
      }
      
      return !response.ok; // Traditional HTTP error codes = broken
      
    } catch (error) {
      if (error.code === 'ETIMEOUT') {
        this.log.debug(`Request to ${url} timed out after ${TIMEOUT}ms`);
      } else {
        this.log.debug(`Request to ${url} failed with error: ${error.message}`);
      }
      return true; // Network errors = still broken
    }
  }

  /**
   * Test URL status and redirects (for fix detection)
   */
  async testUrlStatus(url) {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        timeout: TIMEOUT,
        redirect: 'manual' // Don't follow redirects automatically
      });
      
      return {
        success: true,
        statusCode: response.status,
        redirectLocation: response.headers.get('location'),
        finalUrl: url
      };
      
    } catch (error) {
      this.log.debug(`Failed to test URL ${url}: ${error.message}`);
      return {
        success: false,
        statusCode: null,
        redirectLocation: null,
        finalUrl: url,
        error: error.message
      };
    }
  }

  /**
   * Follow redirect chain to final destination
   */
  async followRedirectChain(url, maxRedirects = 5) {
    let currentUrl = url;
    let redirectCount = 0;
    const redirectChain = [];
    
    while (redirectCount < maxRedirects) {
      const result = await this.testUrlStatus(currentUrl);
      redirectChain.push({
        url: currentUrl,
        statusCode: result.statusCode,
        redirectLocation: result.redirectLocation
      });
      
      if (!result.success) {
        return {
          success: false,
          finalUrl: currentUrl,
          finalStatusCode: null,
          redirectChain,
          error: result.error
        };
      }
      
      // Check if it's a redirect
      if (result.statusCode === 301 || result.statusCode === 302) {
        if (result.redirectLocation) {
          currentUrl = new URL(result.redirectLocation, currentUrl).href;
          redirectCount++;
        } else {
          break;
        }
      } else {
        // Final destination reached
        return {
          success: true,
          finalUrl: currentUrl,
          finalStatusCode: result.statusCode,
          redirectChain,
          isRedirect: redirectCount > 0
        };
      }
    }
    
    return {
      success: false,
      finalUrl: currentUrl,
      finalStatusCode: null,
      redirectChain,
      error: 'Too many redirects'
    };
  }

  /**
   * Check if redirect matches suggested URLs
   */
  checkRedirectMatchesSuggestions(finalUrl, urlsSuggested) {
    if (!urlsSuggested || urlsSuggested.length === 0) {
      return false;
    }
    
    return urlsSuggested.some(suggestedUrl => {
      // Normalize URLs for comparison
      try {
        const finalUrlObj = new URL(finalUrl);
        const suggestedUrlObj = new URL(suggestedUrl);
        
        // Compare pathname and search params, ignore hash
        return finalUrlObj.pathname === suggestedUrlObj.pathname &&
               finalUrlObj.search === suggestedUrlObj.search;
      } catch (error) {
        // Fallback to string comparison
        return finalUrl === suggestedUrl;
      }
    });
  }

  /**
   * Check if broken backlinks suggestions are fixed by testing redirects
   */
  async checkSuggestionsFixes(existingSuggestions) {
    this.log.info('Checking if broken backlinks suggestions are fixed...');
    
    const suggestionsToCheck = this.options.limit 
      ? existingSuggestions.slice(0, this.options.limit) 
      : existingSuggestions;
    
    this.log.info(`Testing ${suggestionsToCheck.length} suggestions`);
    
    for (let i = 0; i < suggestionsToCheck.length; i++) {
      const suggestion = suggestionsToCheck[i];
      const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
      
      if (!suggestionData) {
        this.log.debug(`Skipping invalid suggestion: ${suggestion.getId ? suggestion.getId() : 'unknown'}`);
        continue;
      }
      
      const { 
        title, 
        url_from: urlFrom, 
        url_to: urlTo, 
        traffic_domain: trafficDomain,
        urlsSuggested 
      } = suggestionData;
      
      this.log.debug(`Testing ${i + 1}/${suggestionsToCheck.length}: ${urlTo}`);
      
      // First, check if URL is still broken using handler logic
      const isStillBroken = await this.isStillBrokenBacklink(urlTo);
      
      let isFixed = false;
      let redirectImplemented = false;
      let aiSuggestionImplemented = false;
      let fixType = 'NOT_FIXED';
      let finalUrl = urlTo;
      
      if (!isStillBroken) {
        // URL is no longer broken - analyze how it was fixed
        const redirectResult = await this.followRedirectChain(urlTo);
        
        if (redirectResult.success) {
          finalUrl = redirectResult.finalUrl;
          
          if (redirectResult.isRedirect) {
            redirectImplemented = true;
            isFixed = true;
            fixType = 'REDIRECT_TO_WORKING_PAGE';
            
            // Check if redirect matches AI suggestions
            if (this.checkRedirectMatchesSuggestions(finalUrl, urlsSuggested)) {
              aiSuggestionImplemented = true;
              fixType = 'AI_SUGGESTED_REDIRECT_IMPLEMENTED';
            }
          } else {
            // URL now works directly (no redirect needed)
            isFixed = true;
            fixType = 'URL_NOW_WORKS';
          }
        }
      } else {
        // Still broken
        fixType = 'STILL_BROKEN';
      }
      
      // Get opportunity data from our pre-built map
      const opportunityId = suggestion.getOpportunityId ? suggestion.getOpportunityId() : 'unknown';
      const opportunityData = this.opportunityDataMap[opportunityId] || {};
      
      // Store result with all required fields for 24-column schema (removed Final Status Code)
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
        title: title || '',
        urlFrom: urlFrom || '',
        urlTo: urlTo || '',
        
        // Traffic Analysis (2 columns)
        trafficDomain: trafficDomain || 0,
        urlsSuggested: Array.isArray(urlsSuggested) ? urlsSuggested.join(', ') : (urlsSuggested || ''),
        
        // Fix Detection Results (4 columns)
        redirectImplemented: redirectImplemented,
        aiSuggestionImplemented: aiSuggestionImplemented,
        isFixed: isFixed,
        fixType: fixType,
        
        // Current Status (1 column)
        finalUrl: finalUrl || '',
        
        // Timestamps and Metadata (6 columns)
        opportunityCreated: opportunityData.createdAt || '',
        opportunityUpdated: opportunityData.updatedAt || '',
        suggestionCreated: suggestion.getCreatedAt ? suggestion.getCreatedAt() : (suggestion.createdAt || ''),
        suggestionUpdated: suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : (suggestion.updatedAt || ''),
        updatedBy: suggestion.getUpdatedBy ? suggestion.getUpdatedBy() : (suggestion.updatedBy || ''),
        testDate: new Date().toISOString()
      });
      
      if (isFixed) {
        this.log.info(`✅ FIXED: ${urlTo} → ${finalUrl} (${fixType})`);
      } else {
        this.log.debug(`❌ NOT FIXED: ${urlTo} (${fixType})`);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  /**
   * Generate CSV report
   */
  generateCSV() {
    const filename = writeBrokenBacklinksCSV(this.results, this.options.siteId, this.site?.getBaseURL() || 'Unknown Site');
    this.log.info(`📊 Comprehensive broken backlinks CSV report generated: ${filename}`);
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
        this.log.info(`  - ${r.suggestionId}: ${r.urlTo} → ${r.finalUrl} (${r.fixType})`);
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
    const fixed = this.results.filter(r => r.isFixed).length;
    const redirectsImplemented = this.results.filter(r => r.redirectImplemented).length;
    const aiSuggestionsImplemented = this.results.filter(r => r.aiSuggestionImplemented).length;
    const totalTrafficDomain = this.results.reduce((sum, r) => sum + (r.trafficDomain || 0), 0);
    const recoveredTrafficDomain = this.results.filter(r => r.isFixed).reduce((sum, r) => sum + (r.trafficDomain || 0), 0);
    
    this.log.info('');
    this.log.info('=== BROKEN BACKLINKS SUMMARY ===');
    this.log.info(`Total suggestions processed: ${totalSuggestions}`);
    this.log.info(`Backlinks fixed: ${fixed}`);
    this.log.info(`Redirects implemented: ${redirectsImplemented}`);
    this.log.info(`AI suggestions implemented: ${aiSuggestionsImplemented}`);
    this.log.info(`Total traffic domain: ${totalTrafficDomain}`);
    this.log.info(`Recovered traffic domain: ${recoveredTrafficDomain}`);
    this.log.info(`Still broken: ${totalSuggestions - fixed}`);
    
    if (fixed > 0) {
      this.log.info('');
      this.log.info('Fix types:');
      const fixTypes = {};
      this.results.filter(r => r.isFixed).forEach(r => {
        fixTypes[r.fixType] = (fixTypes[r.fixType] || 0) + 1;
      });
      
      Object.entries(fixTypes).forEach(([type, count]) => {
        this.log.info(`  ${type}: ${count} backlinks`);
      });
    }
  }
}

// CLI setup
import { Command } from 'commander';

const program = new Command();
program
  .name('check-broken-backlinks-fixed')
  .description('Check if broken backlink issues from suggestions have been fixed')
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
      const checker = new BrokenBacklinksFixChecker(siteOptions);
      
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
  const filename = `consolidated-broken-backlinks-all-sites-${timestamp}Z.csv`;
  
  // Generate CSV with proper site info from each result
  const csvRows = allResults.map(result => formatBrokenBacklinksResult(result, result.siteId, result.siteName));
  const csvContent = [
    BROKEN_BACKLINKS_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
  
  writeFileSync(filename, csvContent);
  console.log(`📊 Consolidated broken backlinks CSV generated: ${filename} (${allResults.length} total results)`);
}

// Run the processing
processSites().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
