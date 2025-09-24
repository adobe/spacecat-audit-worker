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
 * Sitemap Fix Checker
 * 
 * Checks if broken URLs from sitemap suggestions are now fixed.
 * Tests HTTP status codes to identify resolved issues.
 * 
 * Logic: 
 * - If broken URL (404/301/302) now returns 200 OK = FIXED
 * - If suggested redirect was implemented = FIXED
 * - Otherwise = NOT FIXED
 * 
 * Usage:
 *   node scripts/check-sitemap-fixed.mjs --siteId <siteId> [options]
 */

import { program } from 'commander';
import { createDataAccess } from '@adobe/spacecat-shared-data-access';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { writeFileSync } from 'fs';
import { SITES } from './constants.js';
import { writeSitemapCSV, generateSitemapCSV, formatSitemapResult, SITEMAP_CSV_HEADERS } from './csv-utils.js';

class SitemapFixChecker {
  constructor(options) {
    this.options = options;
    this.log = this.createSimpleLogger(options.verbose);
    this.results = [];
  }

  createSimpleLogger(verbose) {
    return {
      info: (msg) => console.log(`[INFO] ${msg}`),
      debug: verbose ? (msg) => console.log(`[DEBUG] ${msg}`) : () => {},
      error: (msg) => console.error(`[ERROR] ${msg}`)
    };
  }

  /**
   * Initialize data access connections
   */
  async initializeDataAccess() {
    this.log.debug('Initializing data access for sitemap audit...');
    
    try {
      // Set up required environment variables
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
      
      // Load site
      this.site = await this.dataAccess.Site.findById(this.options.siteId);
      if (!this.site) {
        throw new Error(`Site not found: ${this.options.siteId}`);
      }
      
      this.log.info(`Initialized data access for site: ${this.site.getBaseURL()}`);
      
    } catch (error) {
      this.log.error(`Failed to initialize data access: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get existing sitemap suggestions from database
   */
  async getExistingSuggestions() {
    this.log.debug('Fetching existing sitemap suggestions...');
    
    const { Opportunity } = this.dataAccess;
    const allOpportunities = await Opportunity.allBySiteId(this.options.siteId);
    
    // Debug: Log all opportunity types found
    if (this.options.verbose) {
      const opportunityTypes = [...new Set(allOpportunities.map(opp => opp.getType()))];
      this.log.debug(`All opportunity types found: ${opportunityTypes.join(', ')}`);
    }
    
    // Filter for sitemap opportunities
    const sitemapOpportunities = allOpportunities.filter((opportunity) => 
      opportunity.getType() === 'sitemap'
    );
    
    this.log.debug(`Found ${sitemapOpportunities.length} sitemap opportunities`);
    
    // Create opportunity data map for later use
    this.opportunityDataMap = {};
    sitemapOpportunities.forEach(opportunity => {
      this.opportunityDataMap[opportunity.getId()] = {
        status: opportunity.getStatus ? opportunity.getStatus() : (opportunity.status || 'unknown'),
        createdAt: opportunity.getCreatedAt ? opportunity.getCreatedAt() : (opportunity.createdAt || ''),
        updatedAt: opportunity.getUpdatedAt ? opportunity.getUpdatedAt() : (opportunity.updatedAt || '')
      };
    });
    
    // Get outdated AND fixed suggestions directly from database using efficient API
    const { Suggestion } = this.dataAccess;
    const suggestions = [];
    
    for (const opportunity of sitemapOpportunities) {
      const opptyId = opportunity.getId();
      
      // Get outdated suggestions
      const outdatedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'outdated');
      suggestions.push(...outdatedSuggestions);
      
      // Get fixed suggestions  
      const fixedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'fixed');
      suggestions.push(...fixedSuggestions);
    }
    
    this.log.info(`Found ${suggestions.length} outdated + fixed sitemap suggestions`);
    return suggestions;
  }

  /**
   * Test URL status with HTTP request
   * Uses same fetchWithHeadFallback logic as sitemap handler
   */
  async testUrlStatus(url) {
    const TIMEOUT = 5000;
    
    try {
      // Try HEAD request first (same as handler)
      const headResponse = await fetch(url, {
        method: 'HEAD',
        timeout: TIMEOUT,
        redirect: 'manual'
      });

      // If HEAD returns 404, try GET as fallback (same as handler)
      if (headResponse.status === 404) {
        try {
          const getResponse = await fetch(url, {
            method: 'GET',
            timeout: TIMEOUT,
            redirect: 'manual'
          });
          
          return {
            statusCode: getResponse.status,
            location: getResponse.headers.get('location'),
            success: true
          };
        } catch {
          // If GET also fails, return the original HEAD response (same as handler)
          return {
            statusCode: headResponse.status,
            location: headResponse.headers.get('location'),
            success: true
          };
        }
      }

      return {
        statusCode: headResponse.status,
        location: headResponse.headers.get('location'),
        success: true
      };
      
    } catch (error) {
      this.log.debug(`Error testing URL ${url}: ${error.message}`);
      return {
        statusCode: 0,
        error: error.message,
        success: false
      };
    }
  }

  /**
   * Check if URL redirects to suggested URL
   */
  async checkRedirectImplemented(originalUrl, suggestedUrl) {
    try {
      const response = await fetch(originalUrl, {
        method: 'HEAD',
        timeout: 5000,
        redirect: 'follow' // Follow redirects to see final destination
      });
      
      // Check if final URL matches suggested URL
      const finalUrl = response.url || originalUrl;
      const normalizedFinal = this.normalizeUrl(finalUrl);
      const normalizedSuggested = this.normalizeUrl(suggestedUrl);
      
      return normalizedFinal === normalizedSuggested;
    } catch (error) {
      this.log.debug(`Error checking redirect for ${originalUrl}: ${error.message}`);
      return false;
    }
  }

  /**
   * Normalize URL for comparison
   */
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Remove trailing slash and convert to lowercase
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.replace(/\/$/, '')}${urlObj.search}`.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  /**
   * Check if sitemap suggestions are fixed
   */
  async checkSuggestionsFixes(existingSuggestions) {
    this.log.info('Checking if sitemap suggestions are fixed...');
    
    const suggestionsToCheck = this.options.limit 
      ? existingSuggestions.slice(0, this.options.limit) 
      : existingSuggestions;
    
    this.log.info(`Testing ${suggestionsToCheck.length} suggestions`);
    
    for (let i = 0; i < suggestionsToCheck.length; i++) {
      const suggestion = suggestionsToCheck[i];
      const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
      
      if (!suggestionData || suggestionData.type !== 'url') {
        this.log.debug(`Skipping non-URL suggestion: ${suggestion.getId ? suggestion.getId() : 'unknown'}`);
        continue;
      }
      
      const { sitemapUrl, pageUrl, statusCode: originalStatusCode, urlsSuggested } = suggestionData;
      
      this.log.debug(`Testing ${i + 1}/${suggestionsToCheck.length}: ${pageUrl}`);
      
      // Test current status of the URL
      const currentStatus = await this.testUrlStatus(pageUrl);
      await this.delay(100); // Rate limiting
      
      let isFixed = false;
      let fixType = 'NOT_FIXED';
      let currentStatusDisplay = currentStatus.success ? currentStatus.statusCode : 'ERROR';
      let redirectImplemented = false;
      
      if (currentStatus.success) {
        // Check if URL is now working (200 OK)
        if (currentStatus.statusCode === 200) {
          isFixed = true;
          fixType = 'URL_NOW_WORKS';
        }
        // Check if redirect was implemented (any working redirect = fixed)
        else if (currentStatus.statusCode === 301 || currentStatus.statusCode === 302) {
          // Any redirect means the broken URL is now fixed
          isFixed = true;
          fixType = 'REDIRECT_IMPLEMENTED';
          
          // Check if they used our specific suggestion
          if (urlsSuggested) {
            const suggestedUrls = Array.isArray(urlsSuggested) ? urlsSuggested : [urlsSuggested];
            
            for (const suggestedUrl of suggestedUrls) {
              redirectImplemented = await this.checkRedirectImplemented(pageUrl, suggestedUrl);
              if (redirectImplemented) {
                break; // Found a match to our suggestion
              }
            }
          }
        }
      }
      
      // Get opportunity data from our pre-built map (no additional API call!)
      const opportunityId = suggestion.getOpportunityId ? suggestion.getOpportunityId() : 'unknown';
      const opportunityData = this.opportunityDataMap[opportunityId] || {};
      
      // Extract additional suggestion data for schema
      const additionalSuggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
      
      // Store result with all required fields
      this.results.push({
        // Core identity
        opportunityId: opportunityId,
        opportunityStatus: opportunityData.status || 'unknown',
        suggestionId: suggestion.getId ? suggestion.getId() : 'unknown',
        
        // Suggestion info
        suggestionType: suggestion.getType ? suggestion.getType() : suggestion.type,
        suggestionStatus: suggestion.getStatus ? suggestion.getStatus() : suggestion.status,
        suggestionRank: suggestion.getRank ? suggestion.getRank() : suggestion.rank,
        
        // URL data
        sitemapUrl,
        pageUrl,
        originalStatusCode,
        currentStatusCode: currentStatusDisplay,
        urlsSuggested: urlsSuggested || '',
        recommendedAction: additionalSuggestionData?.recommendedAction || '',
        
        // Our test results
        redirectImplemented,
        isFixed,
        fixType,
        
        // Timestamps
        opportunityCreated: opportunityData.createdAt || '',
        opportunityUpdated: opportunityData.updatedAt || '',
        suggestionCreated: suggestion.getCreatedAt ? suggestion.getCreatedAt() : (suggestion.createdAt || ''),
        suggestionUpdated: suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : (suggestion.updatedAt || ''),
        updatedBy: suggestion.getUpdatedBy ? suggestion.getUpdatedBy() : (suggestion.updatedBy || '')
      });
      
      if (isFixed) {
        this.log.info(`✅ FIXED: ${pageUrl} (${fixType})`);
      } else {
        this.log.debug(`❌ NOT FIXED: ${pageUrl} (still ${currentStatusDisplay})`);
      }
    }
  }

  /**
   * Generate CSV report using common utilities
   */
  generateCSV() {
    const filename = writeSitemapCSV(this.results, this.options.siteId, this.site?.getBaseURL() || 'Unknown Site');
    this.log.info(`📊 CSV report generated: ${filename}`);
    return filename;
  }

  /**
   * Print summary using common utilities
   */
  printSummary() {
    const totalSuggestions = this.results.length;
    const fixed = this.results.filter(r => r.isFixed).length;
    const redirectsImplemented = this.results.filter(r => r.redirectImplemented).length;
    
    this.log.info('');
    this.log.info('=== SUMMARY ===');
    this.log.info(`Total suggestions processed: ${totalSuggestions}`);
    this.log.info(`Fixed overall: ${fixed}`);
    this.log.info(`Redirects implemented: ${redirectsImplemented}`);
    this.log.info(`Not fixed: ${totalSuggestions - fixed}`);
  }

  /**
   * Mark suggestions as fixed (placeholder for future implementation)
   */
  async markFixedSuggestions() {
    if (!this.options.markFixed) {
      this.log.debug('Skipping database updates (--markFixed not specified)');
      return;
    }
    
    const fixedSuggestions = this.results.filter(r => r.isFixed);
    this.log.info(`TODO: Mark ${fixedSuggestions.length} suggestions as FIXED in database`);
    
    // TODO: Implement actual database updates
    // for (const result of fixedSuggestions) {
    //   await suggestion.setStatus('FIXED');
    //   await suggestion.save();
    // }
  }

  /**
   * Rate limiting delay
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Main execution flow
   */
  async run() {
    try {
      this.log.info('🗺️ Starting Sitemap Fix Checker...');
      
      await this.initializeDataAccess();
      const existingSuggestions = await this.getExistingSuggestions();
      
      if (existingSuggestions.length === 0) {
        this.log.info('No unfixed sitemap suggestions found');
        return;
      }
      
      await this.checkSuggestionsFixes(existingSuggestions);
      
      if (this.results.length > 0) {
        this.generateCSV();
        this.printSummary();
        await this.markFixedSuggestions();
      } else {
        this.log.info('No results to report');
      }
      
      this.log.info('✅ Sitemap fix check completed');
      
    } catch (error) {
      this.log.error(`Failed to run sitemap fix checker: ${error.message}`);
      if (this.options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }
}

// CLI Configuration
program
  .name('check-sitemap-fixed')
  .description('Check if sitemap suggestions are fixed by testing URL status codes')
  .option('--siteId <id>', 'Site ID to check', '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3')
  .option('--allSites', 'Process all configured sites', false)
  .option('--sites <ids...>', 'Specific site IDs to process (space-separated)')
  .option('--markFixed', 'Mark fixed suggestions in database', false)
  .option('--dryRun', 'Run without making changes', false)
  .option('--verbose', 'Enable verbose logging', false)
  .option('--limit <number>', 'Limit number of suggestions to check (for testing)', parseInt)
  .option('--consolidate', 'Generate consolidated CSV for multiple sites', false)
  .parse();

const options = program.opts();

// Determine which sites to process
let sitesToProcess = [];

if (options.allSites) {
  sitesToProcess = SITES;
  console.log(`[INFO] Processing all ${SITES.length} configured sites`);
} else if (options.sites) {
  sitesToProcess = SITES.filter(site => options.sites.includes(site.id));
  console.log(`[INFO] Processing ${sitesToProcess.length} specified sites`);
} else if (options.siteId) {
  const site = SITES.find(s => s.id === options.siteId);
  if (site) {
    sitesToProcess = [site];
  } else {
    // Custom site ID not in the list
    sitesToProcess = [{ id: options.siteId, name: 'Custom Site' }];
  }
} else {
  // Default site ID
  const defaultSite = SITES.find(s => s.id === '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3');
  sitesToProcess = [defaultSite];
  console.log(`[INFO] Using default site ID: 9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3`);
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
      const checker = new SitemapFixChecker(siteOptions);
      
      await checker.run();
      
      // Collect results if consolidating
      if (options.consolidate) {
        // Add site info to each result for consolidation
        const resultsWithSiteInfo = checker.results.map(result => ({
          ...result,
          siteId: site.id,
          siteName: site.name
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
  if (options.consolidate && allResults.length > 0) {
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
  const filename = `consolidated-sitemap-all-sites-${timestamp}Z.csv`;
  
  // Generate CSV with proper site info from each result
  const csvRows = allResults.map(result => formatSitemapResult(result, result.siteId, result.siteName));
  const csvContent = [
    SITEMAP_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
  
  writeFileSync(filename, csvContent);
  console.log(`📊 Consolidated CSV generated: ${filename} (${allResults.length} total results)`);
}

// Run the processing
processSites().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
