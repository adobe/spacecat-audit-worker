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
 * Alt-Text Fix Checker
 * 
 * This script checks if image alt-text issues from existing suggestions have been fixed.
 * It compares AI-suggested alt text with current alt attributes on images to identify implementations.
 * 
 * Features:
 * - Comprehensive 27-column raw data schema
 * - Scrapes current page content from S3
 * - Parses HTML to find images by XPath
 * - Compares current vs suggested alt text using similarity matching
 * - Multi-site processing with consolidation
 * - Efficient database queries (outdated + fixed suggestions)
 */

import { writeFileSync } from 'fs';
// Using simple console logger instead of shared-utils dependency
import { createDataAccess } from '@adobe/spacecat-shared-data-access';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { JSDOM } from 'jsdom';
// Removed fastest-levenshtein dependency - using exact string matching
import { SITES } from './constants.js';
import { writeAltTextCSV, formatAltTextResult, ALT_TEXT_CSV_HEADERS } from './csv-utils.js';
// Using exact string matching for AI suggestion detection

// Helper function to transform URL to scrape.json path
function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

/**
 * Alt-Text Fix Checker Class
 */
class AltTextFixChecker {
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
    this.errors = [];
    this.dataAccess = null;
    this.site = null;
    this.s3Client = null;
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
      
      // Initialize S3 client for scraping data
      this.s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1'
      });
      
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
        this.log.info('No alt-text suggestions found for this site');
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
      this.log.error('Failed to run alt-text fix checker:', error.message);
      throw error;
    }
  }

  /**
   * Get existing alt-text suggestions from database
   */
  async getExistingSuggestions() {
    this.log.debug('Fetching existing alt-text suggestions...');
    
    const { Opportunity } = this.dataAccess;
    const allOpportunities = await Opportunity.allBySiteId(this.options.siteId);
    
    // Debug: Log all opportunity types found
    if (this.options.verbose) {
      const opportunityTypes = [...new Set(allOpportunities.map(opp => opp.getType()))];
      this.log.debug(`All opportunity types found: ${opportunityTypes.join(', ')}`);
    }
    
    // Filter for alt-text opportunities
    const altTextOpportunities = allOpportunities.filter((opportunity) => 
      opportunity.getType() === 'alt-text'
    );
    
    this.log.debug(`Found ${altTextOpportunities.length} alt-text opportunities`);
    
    // Create opportunity data map for later use
    this.opportunityStatusMap = {};
    this.opportunityDataMap = {};
    altTextOpportunities.forEach(opportunity => {
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
    
    for (const opportunity of altTextOpportunities) {
      const opptyId = opportunity.getId();
      
      // Get outdated suggestions
      const outdatedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'outdated');
      suggestions.push(...outdatedSuggestions);
      
      // Get fixed suggestions
      const fixedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'fixed');
      suggestions.push(...fixedSuggestions);
    }
    
    this.log.debug(`Found ${suggestions.length} outdated + fixed alt-text suggestions`);
    return suggestions;
  }

  /**
   * Get current page content from S3
   */
  async getCurrentPageContent(pageUrl) {
    try {
      const scrapeJsonPath = getScrapeJsonPath(pageUrl, this.options.siteId);
      const bucketName = 'spacecat-prod-scraper';
      
      this.log.debug(`Fetching content from S3: ${scrapeJsonPath}`);
      
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: scrapeJsonPath
      });
      
      const response = await this.s3Client.send(command);
      const content = await response.Body.transformToString();
      const scrapeData = JSON.parse(content);
      
      // S3 scrape data structure: scrapeResult.rawBody contains the HTML content
      // This matches the pattern used by metatags handler and other audit handlers
      return scrapeData.scrapeResult?.rawBody || scrapeData.content || '';
      
    } catch (error) {
      this.log.debug(`Failed to fetch content for ${pageUrl}: ${error.message}`);
      return null;
    }
  }

  /**
   * Find image by XPath (most reliable method)
   */
  findImageByXPath(document, xpath) {
    try {
      // Use proper XPath evaluation
      const result = document.evaluate(
        xpath,
        document,
        null,
        document.defaultView.XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      
      const imageElement = result.singleNodeValue;
      if (imageElement && imageElement.tagName === 'IMG') {
        return imageElement;
      }
      
      return null;
    } catch (error) {
      this.log.debug(`XPath evaluation failed for ${xpath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Find image by URL (fallback method)
   */
  findImageByUrl(document, imageUrl) {
    try {
      const images = document.querySelectorAll('img');
      
      for (const img of images) {
        // Try exact URL match first
        if (img.src === imageUrl) {
          return img;
        }
        
        // Try partial URL match (filename)
        const imageFilename = imageUrl.split('/').pop();
        if (imageFilename && img.src.includes(imageFilename)) {
          return img;
        }
        
        // Try srcset attribute for responsive images
        if (img.srcset?.includes(imageUrl)) {
          return img;
        }
      }
      
      return null;
    } catch (error) {
      this.log.debug(`Error finding image by URL ${imageUrl}: ${error.message}`);
      return null;
    }
  }

  /**
   * Find image alt text using XPath first, URL fallback
   */
  findImageAltText(htmlContent, xpath, imageUrl) {
    try {
      const dom = new JSDOM(htmlContent);
      const document = dom.window.document;
      
      let imageElement = null;
      let matchMethod = 'NOT_FOUND';
      
      // Strategy 1: Try XPath first (most reliable)
      if (xpath) {
        imageElement = this.findImageByXPath(document, xpath);
        if (imageElement) {
          matchMethod = 'XPATH';
        }
      }
      
      // Strategy 2: Fallback to URL matching if XPath fails
      if (!imageElement && imageUrl) {
        imageElement = this.findImageByUrl(document, imageUrl);
        if (imageElement) {
          matchMethod = 'URL';
        }
      }
      
      if (imageElement) {
        const altText = imageElement.getAttribute('alt') || '';
        this.log.debug(`Found image via ${matchMethod}: alt="${altText}"`);
        return { altText, matchMethod };
      }
      
      this.log.debug(`Image not found: xpath=${xpath}, imageUrl=${imageUrl}`);
      return { altText: null, matchMethod: 'NOT_FOUND' };
      
    } catch (error) {
      this.log.debug(`Error finding image alt text: ${error.message}`);
      return { altText: null, matchMethod: 'ERROR' };
    }
  }

  /**
   * Check if two strings match exactly (case-insensitive)
   */
  isExactMatch(str1, str2) {
    if (!str1 || !str2) return false;
    return str1.toLowerCase().trim() === str2.toLowerCase().trim();
  }

  /**
   * Check if alt-text suggestions are fixed by comparing current alt attributes
   */
  async checkSuggestionsFixes(existingSuggestions) {
    this.log.info('Checking if alt-text suggestions are fixed...');
    
    const suggestionsToCheck = this.options.limit 
      ? existingSuggestions.slice(0, this.options.limit) 
      : existingSuggestions;
    
    this.log.info(`Analyzing ${suggestionsToCheck.length} suggestions`);
    
    for (let i = 0; i < suggestionsToCheck.length; i++) {
      const suggestion = suggestionsToCheck[i];
      const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
      
      if (!suggestionData || !suggestionData.recommendations || suggestionData.recommendations.length === 0) {
        this.log.debug(`Skipping invalid suggestion: ${suggestion.getId ? suggestion.getId() : 'unknown'}`);
        continue;
      }
      
      const recommendation = suggestionData.recommendations[0];
      const { 
        id: imageId, 
        pageUrl, 
        imageUrl, 
        altText: suggestedAltText, 
        isAppropriate, 
        isDecorative, 
        xpath, 
        language 
      } = recommendation;
      
      this.log.debug(`Analyzing ${i + 1}/${suggestionsToCheck.length}: ${pageUrl} - ${imageId}`);
      
      // Get current page content
      const currentContent = await this.getCurrentPageContent(pageUrl);
      let currentAltText = null;
      let isFixed = false;
      let aiSuggestionImplemented = false;
      let fixType = 'NOT_FIXED';
      let similarity = 0;
      let matchMethod = 'NOT_FOUND';
      
      if (currentContent) {
        const imageResult = this.findImageAltText(currentContent, xpath, imageUrl);
        currentAltText = imageResult.altText;
        matchMethod = imageResult.matchMethod;
        
        if (currentAltText !== null) {
          // Check if alt text was added (previously empty)
          if (currentAltText.trim() !== '') {
            isFixed = true;
            fixType = 'ALT_TEXT_ADDED';
            
            // Check if AI suggestion was implemented (exact match)
            if (suggestedAltText) {
              if (this.isExactMatch(currentAltText, suggestedAltText)) {
                aiSuggestionImplemented = true;
                fixType = 'AI_SUGGESTION_IMPLEMENTED';
                similarity = 1.0; // Perfect match
              }
            }
          }
        } else {
          fixType = 'IMAGE_NOT_FOUND';
        }
      } else {
        fixType = 'PAGE_NOT_FOUND';
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
        suggestionStatus: suggestion.getStatus?.() || suggestion.status,
        suggestionRank: suggestion.getRank ? suggestion.getRank() : suggestion.rank,
        imageId: imageId || '',
        pageUrl: pageUrl || '',
        imageUrl: imageUrl || '',
        
        // Image Analysis (5 columns)
        xpath: xpath || '',
        matchMethod: matchMethod || 'NOT_FOUND',
        isDecorative: isDecorative ? 'YES' : 'NO',
        isAppropriate: isAppropriate ? 'YES' : 'NO',
        language: language || '',
        
        // Alt Text Comparison (4 columns)
        suggestedAltText: suggestedAltText || '',
        currentAltText: currentAltText || '',
        similarity: Math.round(similarity * 100) / 100,
        aiSuggestionImplemented: aiSuggestionImplemented,
        
        // Fix Detection Results (2 columns)
        isFixed: isFixed,
        fixType: fixType,
        
        // Timestamps and Metadata (4 columns)
        opportunityCreated: opportunityData.createdAt || '',
        opportunityUpdated: opportunityData.updatedAt || '',
        suggestionCreated: suggestion.getCreatedAt ? suggestion.getCreatedAt() : (suggestion.createdAt || ''),
        suggestionUpdated: suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : (suggestion.updatedAt || ''),
        
        updatedBy: suggestion.getUpdatedBy ? suggestion.getUpdatedBy() : (suggestion.updatedBy || ''),
        testDate: new Date().toISOString()
      });
      
      if (isFixed) {
        this.log.info(`✅ FIXED: ${pageUrl} - ${imageId} (${fixType})`);
      } else {
        this.log.debug(`❌ NOT FIXED: ${pageUrl} - ${imageId} (${fixType})`);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Generate CSV report
   */
  generateCSV() {
    const filename = writeAltTextCSV(this.results, this.options.siteId, this.site?.getBaseURL() || 'Unknown Site');
    this.log.info(`📊 Comprehensive alt-text CSV report generated: ${filename}`);
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
        this.log.info(`  - ${r.suggestionId}: ${r.pageUrl} - ${r.imageId} (${r.fixType})`);
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
    const aiImplemented = this.results.filter(r => r.aiSuggestionImplemented).length;
    const decorativeImages = this.results.filter(r => r.isDecorative === 'YES').length;
    
    this.log.info('');
    this.log.info('=== ALT-TEXT SUMMARY ===');
    this.log.info(`Total suggestions processed: ${totalSuggestions}`);
    this.log.info(`Alt text added: ${fixed}`);
    this.log.info(`AI suggestions implemented: ${aiImplemented}`);
    this.log.info(`Decorative images: ${decorativeImages}`);
    this.log.info(`Still missing alt text: ${totalSuggestions - fixed}`);
    
    if (fixed > 0) {
      this.log.info('');
      this.log.info('Fix types:');
      const fixTypes = {};
      this.results.filter(r => r.isFixed).forEach(r => {
        fixTypes[r.fixType] = (fixTypes[r.fixType] || 0) + 1;
      });
      
      Object.entries(fixTypes).forEach(([type, count]) => {
        this.log.info(`  ${type}: ${count} images`);
      });
    }
  }
}

// CLI setup
import { Command } from 'commander';

const program = new Command();
program
  .name('check-alt-text-fixed')
  .description('Check if image alt-text issues from suggestions have been fixed')
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
      const checker = new AltTextFixChecker(siteOptions);
      
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
  const filename = `consolidated-alt-text-all-sites-${timestamp}Z.csv`;
  
  // Generate CSV with proper site info from each result
  const csvRows = allResults.map(result => formatAltTextResult(result, result.siteId, result.siteName));
  const csvContent = [
    ALT_TEXT_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
  
  writeFileSync(filename, csvContent);
  console.log(`📊 Consolidated alt-text CSV generated: ${filename} (${allResults.length} total results)`);
}

// Run the processing
processSites().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
