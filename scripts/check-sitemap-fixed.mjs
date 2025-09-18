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
import { writeFileSync } from 'fs';
import { createDataAccess } from '@adobe/spacecat-shared-data-access';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

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
    
    // Filter for sitemap opportunities
    const sitemapOpportunities = allOpportunities.filter((opportunity) => 
      opportunity.getType() === 'sitemap'
    );
    
    this.log.debug(`Found ${sitemapOpportunities.length} sitemap opportunities`);
    
    // Get all suggestions from sitemap opportunities
    const allSuggestions = [];
    for (const opportunity of sitemapOpportunities) {
      const oppSuggestions = await opportunity.getSuggestions();
      allSuggestions.push(...oppSuggestions);
    }
    
    // Filter out already fixed suggestions
    const unfixedSuggestions = allSuggestions.filter(suggestion => {
      const status = suggestion.getStatus ? suggestion.getStatus() : suggestion.status;
      return status !== 'FIXED';
    });
    
    this.log.info(`Found ${unfixedSuggestions.length} unfixed sitemap suggestions`);
    return unfixedSuggestions;
  }

  /**
   * Test URL status with HTTP request
   */
  async testUrlStatus(url) {
    try {
      const response = await fetch(url, {
        method: 'HEAD', // Use HEAD for faster requests
        timeout: 5000,
        redirect: 'manual' // Don't follow redirects automatically
      });
      
      return {
        statusCode: response.status,
        location: response.headers.get('location'),
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
        // Check if redirect was implemented to suggested URL
        else if (urlsSuggested && (currentStatus.statusCode === 301 || currentStatus.statusCode === 302)) {
          redirectImplemented = await this.checkRedirectImplemented(pageUrl, urlsSuggested);
          if (redirectImplemented) {
            isFixed = true;
            fixType = 'REDIRECT_IMPLEMENTED';
          }
        }
      }
      
      // Store result
      this.results.push({
        suggestionId: suggestion.getId ? suggestion.getId() : 'unknown',
        sitemapUrl,
        pageUrl,
        originalStatusCode,
        currentStatusCode: currentStatusDisplay,
        urlsSuggested: urlsSuggested || '',
        redirectImplemented,
        isFixed,
        fixType,
        status: suggestion.getStatus ? suggestion.getStatus() : suggestion.status,
        createdAt: suggestion.getCreatedAt ? suggestion.getCreatedAt() : suggestion.createdAt,
        updatedAt: suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : suggestion.updatedAt
      });
      
      if (isFixed) {
        this.log.info(`✅ FIXED: ${pageUrl} (${fixType})`);
      } else {
        this.log.debug(`❌ NOT FIXED: ${pageUrl} (still ${currentStatusDisplay})`);
      }
    }
  }

  /**
   * Generate CSV report
   */
  generateCSV() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `sitemap-fix-check-${this.options.siteId}-${timestamp}.csv`;
    
    const headers = [
      'Suggestion ID',
      'Sitemap URL',
      'Page URL',
      'Original Status Code',
      'Current Status Code',
      'Suggested URL',
      'Redirect Implemented',
      'Is Fixed',
      'Fix Type',
      'Current Status',
      'Created At',
      'Updated At'
    ];
    
    const csvContent = [
      headers.join(','),
      ...this.results.map(result => [
        result.suggestionId,
        `"${result.sitemapUrl}"`,
        `"${result.pageUrl}"`,
        result.originalStatusCode,
        result.currentStatusCode,
        `"${result.urlsSuggested}"`,
        result.redirectImplemented,
        result.isFixed,
        result.fixType,
        result.status,
        result.createdAt,
        result.updatedAt
      ].join(','))
    ].join('\n');
    
    writeFileSync(filename, csvContent);
    this.log.info(`📊 CSV report generated: ${filename}`);
    
    return filename;
  }

  /**
   * Print summary
   */
  printSummary() {
    const total = this.results.length;
    const fixed = this.results.filter(r => r.isFixed).length;
    const urlNowWorks = this.results.filter(r => r.fixType === 'URL_NOW_WORKS').length;
    const redirectImplemented = this.results.filter(r => r.fixType === 'REDIRECT_IMPLEMENTED').length;
    
    console.log('\n📈 SITEMAP FIX SUMMARY:');
    console.log(`Total suggestions checked: ${total}`);
    console.log(`Fixed suggestions: ${fixed} (${((fixed/total)*100).toFixed(1)}%)`);
    console.log(`  - URLs now working (200 OK): ${urlNowWorks}`);
    console.log(`  - Redirects implemented: ${redirectImplemented}`);
    console.log(`Not fixed: ${total - fixed} (${(((total-fixed)/total)*100).toFixed(1)}%)`);
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
  .option('--markFixed', 'Mark fixed suggestions in database', false)
  .option('--dryRun', 'Run without making changes', false)
  .option('--verbose', 'Enable verbose logging', false)
  .option('--limit <number>', 'Limit number of suggestions to check (for testing)', parseInt)
  .parse();

const options = program.opts();

// Run the checker
const checker = new SitemapFixChecker(options);
checker.run();
