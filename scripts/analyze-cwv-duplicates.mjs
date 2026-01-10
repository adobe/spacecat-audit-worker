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
 * CWV Duplicate Suggestions Analyzer
 * 
 * This script analyzes all CWV suggestions to identify duplicates.
 * It exports all suggestions to CSV with duplicate detection.
 */

import { writeFileSync } from 'fs';
import dotenv from 'dotenv';
import { createDataAccess, Audit, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { Command } from 'commander';
import { SITES } from './constants.js';

// Load environment variables from .env file
dotenv.config();

const auditType = Audit.AUDIT_TYPES.CWV;

/**
 * CWV Duplicate Analyzer Class
 */
class CWVDuplicateAnalyzer {
  constructor(options = {}) {
    this.options = {
      siteId: null,
      verbose: false,
      ...options
    };
    
    this.log = this.createSimpleLogger(this.options.verbose);
    this.dataAccess = null;
    this.allSuggestions = [];
  }

  /**
   * Create simple console logger (same pattern as check-cwv-fixed.mjs)
   */
  createSimpleLogger(verbose) {
    return {
      info: (msg) => console.log(`[INFO] ${msg}`),
      debug: verbose ? (msg) => console.log(`[DEBUG] ${msg}`) : () => {},
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`)
    };
  }

  /**
   * Initialize database connection (same pattern as check-cwv-fixed.mjs)
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
      
      // Initialize data access with configuration (same as check-cwv-fixed.mjs)
      const config = {
        tableNameData: process.env.DYNAMO_TABLE_NAME_DATA,
        indexNameAllByStatus: 'gsi1pk-gsi1sk-index',
        indexNameAllBySiteId: 'gsi2pk-gsi2sk-index'
      };
      
      this.dataAccess = createDataAccess(config);
      this.log.info('✓ Database connection initialized');
      
    } catch (error) {
      this.log.error('Failed to initialize data access:', error.message);
      throw error;
    }
  }

  /**
   * Get all opportunities for a site or all sites
   * Filters by NEW status only (same as check-cwv-fixed.mjs)
   */
  async getOpportunities() {
    this.log.info('Fetching CWV opportunities with NEW status...');
    
    const { Opportunity } = this.dataAccess;
    let opportunities = [];

    if (this.options.siteId) {
      // Get NEW opportunities for specific site
      this.log.debug(`Querying NEW opportunities for site: ${this.options.siteId}`);
      const allOpportunities = await Opportunity.allBySiteIdAndStatus(this.options.siteId, 'NEW');
      opportunities = allOpportunities.filter((oppty) => oppty.getType() === auditType);
      this.log.info(`Found ${opportunities.length} NEW CWV opportunities for site ${this.options.siteId}`);
    } else {
      // Get NEW CWV opportunities across all sites from SITES constant
      this.log.info('Fetching NEW opportunities for all sites from SITES constant...');
      for (const site of SITES) {
        try {
          this.log.debug(`Querying NEW opportunities for site: ${site.name} (${site.id})`);
          const siteOpportunities = await Opportunity.allBySiteIdAndStatus(site.id, 'NEW');
          const cwvOpportunities = siteOpportunities.filter((oppty) => oppty.getType() === auditType);
          opportunities.push(...cwvOpportunities);
          this.log.debug(`Found ${cwvOpportunities.length} NEW CWV opportunities for ${site.name}`);
        } catch (error) {
          this.log.warn(`Failed to fetch opportunities for ${site.name}: ${error.message}`);
        }
      }
      this.log.info(`Found ${opportunities.length} NEW CWV opportunities across ${SITES.length} sites`);
    }

    return opportunities;
  }

  /**
   * Get NEW suggestions only for NEW opportunities
   * Only fetches suggestions with NEW status
   */
  async getAllSuggestions() {
    const opportunities = await this.getOpportunities();
    this.log.info(`Processing ${opportunities.length} NEW opportunities...`);
    
    const { Suggestion } = this.dataAccess;

    for (let i = 0; i < opportunities.length; i++) {
      const opportunity = opportunities[i];
      
      try {
        const opportunityId = opportunity.getId();
        const siteId = opportunity.getSiteId();
        const oppStatus = opportunity.getStatus();
        
        if (!opportunityId) {
          this.log.warn(`Skipping opportunity with missing ID (index ${i})`);
          continue;
        }
        
        this.log.debug(`Fetching NEW suggestions for opportunity ${opportunityId} (site: ${siteId}) [${i + 1}/${opportunities.length}]`);
        
        // Fetch only NEW status suggestions (use uppercase constant)
        // Use fetchAllPages to get ALL suggestions, not just first page
        const suggestions = await Suggestion.allByOpportunityIdAndStatus(
          opportunityId, 
          SuggestionModel.STATUSES.NEW,
          { fetchAllPages: true }
        );
        
        for (const suggestion of suggestions) {
          const data = suggestion.getData ? suggestion.getData() : suggestion.data;
          
          if (!data) {
            this.log.warn(`Skipping suggestion ${suggestion.getId ? suggestion.getId() : 'unknown'} with no data`);
            continue;
          }
          
          const url = data.type === 'url' ? data.url : data.pattern;
          
          this.allSuggestions.push({
            suggestionId: suggestion.getId ? suggestion.getId() : suggestion.id,
            opportunityId,
            siteId,
            opportunityStatus: oppStatus,
            suggestionStatus: suggestion.getStatus ? suggestion.getStatus() : suggestion.status,
            suggestionType: suggestion.getType ? suggestion.getType() : suggestion.type,
            rank: suggestion.getRank ? suggestion.getRank() : suggestion.rank,
            url,
            dataType: data.type,
            pageviews: data.pageviews,
            organic: data.organic,
            createdAt: suggestion.getCreatedAt ? suggestion.getCreatedAt() : suggestion.createdAt,
            updatedAt: suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : suggestion.updatedAt,
            updatedBy: suggestion.getUpdatedBy ? suggestion.getUpdatedBy() : suggestion.updatedBy,
            // Store full data for detailed analysis
            fullData: JSON.stringify(data)
          });
        }
        
        this.log.debug(`Found ${suggestions.length} NEW suggestions for opportunity ${opportunityId}`);
      } catch (error) {
        this.log.error(`Error processing opportunity ${i + 1}: ${error.message}`);
        if (this.options.verbose) {
          this.log.error(error.stack);
        }
      }
    }

    this.log.info(`Total NEW suggestions collected: ${this.allSuggestions.length}`);
    return this.allSuggestions;
  }

  /**
   * Normalize URL for consistent comparison
   * - Remove trailing slashes (except for root domain)
   * - Convert to lowercase
   */
  normalizeUrl(url) {
    if (!url) return url;
    
    try {
      let normalized = url.trim().toLowerCase();
      
      // Remove trailing slash, but keep it for root domain (e.g., https://www.adobe.com/)
      const urlObj = new URL(normalized);
      if (urlObj.pathname !== '/' && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      
      return normalized;
    } catch (error) {
      // If URL parsing fails, return as-is
      this.log.warn(`Failed to normalize URL: ${url}`);
      return url;
    }
  }

  /**
   * Analyze duplicates based on opportunityId + URL (normalized)
   */
  analyzeDuplicates() {
    this.log.info('Analyzing duplicates...');
    
    const duplicateGroups = new Map();
    
    // Group suggestions by opportunityId + normalized URL
    for (const suggestion of this.allSuggestions) {
      const normalizedUrl = this.normalizeUrl(suggestion.url);
      const key = `${suggestion.opportunityId}|||${normalizedUrl}`;
      
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, []);
      }
      
      duplicateGroups.get(key).push(suggestion);
    }
    
    // Find groups with duplicates
    const duplicates = [];
    let totalDuplicates = 0;
    
    for (const [key, suggestions] of duplicateGroups.entries()) {
      if (suggestions.length > 1) {
        const [opportunityId, url] = key.split('|||');
        
        // Sort by creation date (oldest first)
        suggestions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        
        // Debug: log the sorted order for groups with many duplicates
        if (suggestions.length > 5 && this.options.verbose) {
          this.log.debug(`Duplicate group for ${url}:`);
          suggestions.forEach((s, idx) => {
            this.log.debug(`  ${idx + 1}. ${s.createdAt} - ${s.suggestionId}`);
          });
        }
        
        duplicates.push({
          opportunityId,
          url,
          count: suggestions.length,
          suggestions
        });
        
        totalDuplicates += suggestions.length - 1; // Exclude the first one
      }
    }
    
    this.log.info(`Found ${duplicates.length} URLs with duplicates`);
    this.log.info(`Total duplicate suggestions: ${totalDuplicates}`);
    
    return duplicates;
  }

  /**
   * Export JSON files with suggestions to outdate, organized by site and URL
   */
  exportOutdateJSON(duplicates) {
    this.log.info('Generating JSON files for outdating suggestions...');
    
    // Group by site
    const bySite = new Map();
    const bySiteUrlFormat = new Map();
    
    for (const group of duplicates) {
      const siteId = group.suggestions[0].siteId;
      
      if (!bySite.has(siteId)) {
        bySite.set(siteId, []);
        bySiteUrlFormat.set(siteId, {});
      }
      
      // Get all suggestions except the first one (which should be kept)
      const toOutdate = group.suggestions.slice(1).map(s => ({
        id: s.suggestionId,
        status: 'OUTDATED',
        createdAt: s.createdAt
      }));
      
      bySite.get(siteId).push({
        url: group.url,
        opportunityId: group.opportunityId,
        totalCount: group.count,
        toOutdateCount: group.count - 1,
        keepSuggestion: {
          id: group.suggestions[0].suggestionId,
          createdAt: group.suggestions[0].createdAt
        },
        outdateSuggestions: toOutdate
      });
      
      // Create URL-organized format
      const urlFormatted = bySiteUrlFormat.get(siteId);
      urlFormatted[group.url] = {
        opportunityId: group.opportunityId,
        totalDuplicates: group.count,
        keep: {
          id: group.suggestions[0].suggestionId,
          createdAt: group.suggestions[0].createdAt,
          status: 'NEW'
        },
        outdate: toOutdate
      };
    }
    
    // Export files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let totalToOutdate = 0;
    const allSitesData = [];
    
    for (const [siteId, groups] of bySite.entries()) {
      // Create flat array of all suggestions to outdate for this site
      const allToOutdate = [];
      
      for (const group of groups) {
        allToOutdate.push(...group.outdateSuggestions.map(s => ({
          id: s.id,
          status: 'OUTDATED'
        })));
      }
      
      totalToOutdate += allToOutdate.length;
      allSitesData.push(...allToOutdate);
      
      // Write site-specific file with flat format (for bulk update)
      const flatFilename = `kanishka-cwv-outdate-suggestions-${siteId}-${timestamp}.json`;
      writeFileSync(flatFilename, JSON.stringify(allToOutdate, null, 2), 'utf-8');
      this.log.info(`✓ Created ${flatFilename} (${allToOutdate.length} suggestions to outdate)`);
      
      // Write URL-organized file (easy to verify)
      const urlFilename = `kanishka-cwv-outdate-by-url-${siteId}-${timestamp}.json`;
      writeFileSync(urlFilename, JSON.stringify(bySiteUrlFormat.get(siteId), null, 2), 'utf-8');
      this.log.info(`✓ Created ${urlFilename} (organized by URL for verification)`);
      
      // Write detailed file with array format
      const detailedFilename = `kanishka-cwv-outdate-detailed-${siteId}-${timestamp}.json`;
      writeFileSync(detailedFilename, JSON.stringify(groups, null, 2), 'utf-8');
      this.log.info(`✓ Created ${detailedFilename} (detailed array view)`);
    }
    
    // Write combined file for all sites (flat array)
    if (bySite.size > 1) {
      const allSitesFilename = `kanishka-cwv-outdate-suggestions-all-sites-${timestamp}.json`;
      writeFileSync(allSitesFilename, JSON.stringify(allSitesData, null, 2), 'utf-8');
      this.log.info(`✓ Created ${allSitesFilename} (${allSitesData.length} suggestions across all sites)`);
    }
    
    // Write single file organized by site ID
    const bySiteObject = {};
    const bySiteUrlObject = {};
    
    for (const [siteId, groups] of bySite.entries()) {
      const allToOutdate = [];
      for (const group of groups) {
        allToOutdate.push(...group.outdateSuggestions.map(s => ({
          id: s.id,
          status: 'OUTDATED'
        })));
      }
      bySiteObject[siteId] = allToOutdate;
      bySiteUrlObject[siteId] = bySiteUrlFormat.get(siteId);
    }
    
    const bySiteFilename = `kanishka-cwv-outdate-by-site-${timestamp}.json`;
    writeFileSync(bySiteFilename, JSON.stringify(bySiteObject, null, 2), 'utf-8');
    this.log.info(`✓ Created ${bySiteFilename} - Flat format organized by site ID`);
    
    const bySiteUrlFilename = `kanishka-cwv-outdate-by-site-and-url-${timestamp}.json`;
    writeFileSync(bySiteUrlFilename, JSON.stringify(bySiteUrlObject, null, 2), 'utf-8');
    this.log.info(`✓ Created ${bySiteUrlFilename} - URL format organized by site ID (BEST FOR VERIFICATION)`);
    
    this.log.info(`Total suggestions to outdate across all sites: ${totalToOutdate}`);
  }

  /**
   * Export all suggestions to CSV
   */
  exportToCSV(filename) {
    this.log.info(`Exporting to ${filename}...`);
    
    const duplicates = this.analyzeDuplicates();
    
    // Export JSON files for outdating
    this.exportOutdateJSON(duplicates);
    
    const duplicateMap = new Map();
    
    // Create a map of duplicate suggestion IDs
    for (const group of duplicates) {
      for (let i = 0; i < group.suggestions.length; i++) {
        const suggestion = group.suggestions[i];
        duplicateMap.set(suggestion.suggestionId, {
          isDuplicate: i > 0, // First one is not a duplicate, rest are
          duplicateGroup: group.url,
          duplicateCount: group.suggestions.length,
          duplicateIndex: i + 1
        });
      }
    }
    
    // CSV Headers
    const headers = [
      'Suggestion ID',
      'Opportunity ID',
      'Site ID',
      'Opportunity Status',
      'Suggestion Status',
      'Suggestion Type',
      'Rank',
      'URL',
      'Normalized URL',
      'Data Type',
      'Pageviews',
      'Organic Traffic',
      'Created At',
      'Updated At',
      'Updated By',
      'Is First Created',
      'Is Duplicate',
      'Duplicate Group',
      'Duplicate Count',
      'Duplicate Index',
      'Full Data'
    ];
    
    // Build CSV rows - only include duplicates
    const rows = [headers];
    let duplicateSuggestionsCount = 0;
    
    for (const suggestion of this.allSuggestions) {
      const duplicateInfo = duplicateMap.get(suggestion.suggestionId);
      
      // Skip if not a duplicate
      if (!duplicateInfo) {
        continue;
      }
      
      duplicateSuggestionsCount++;
      
      rows.push([
        suggestion.suggestionId,
        suggestion.opportunityId,
        suggestion.siteId,
        suggestion.opportunityStatus,
        suggestion.suggestionStatus,
        suggestion.suggestionType,
        suggestion.rank,
        suggestion.url,
        this.normalizeUrl(suggestion.url),
        suggestion.dataType,
        suggestion.pageviews || '',
        suggestion.organic || '',
        suggestion.createdAt,
        suggestion.updatedAt,
        suggestion.updatedBy || '',
        duplicateInfo.duplicateIndex === 1 ? 'YES' : 'NO', // First created = index 1
        duplicateInfo.isDuplicate ? 'YES' : 'NO',
        duplicateInfo.duplicateGroup,
        duplicateInfo.duplicateCount,
        duplicateInfo.duplicateIndex,
        `"${suggestion.fullData.replace(/"/g, '""')}"` // Escape quotes
      ]);
    }
    
    this.log.info(`Filtered to ${duplicateSuggestionsCount} duplicate suggestions (out of ${this.allSuggestions.length} total)`);
    
    // Write to CSV
    const csvContent = rows.map(row => row.join(',')).join('\n');
    writeFileSync(filename, csvContent, 'utf-8');
    
    this.log.info(`Exported ${duplicateSuggestionsCount} duplicate suggestions to ${filename}`);
    
    // Print duplicate summary
    if (duplicates.length > 0) {
      console.log('\n--- DUPLICATE SUMMARY ---');
      console.log(`URLs with duplicates: ${duplicates.length}`);
      console.log(`Total duplicate suggestions: ${duplicateSuggestionsCount}`);
      console.log('\nTop 20 URLs with most duplicates:');
      
      duplicates
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
        .forEach((group, index) => {
          console.log(`${index + 1}. ${group.url}`);
          console.log(`   Count: ${group.count} suggestions (${group.count - 1} to outdate)`);
          console.log(`   Opportunity: ${group.opportunityId}`);
          console.log(`   Site: ${group.suggestions[0].siteId}`);
          console.log(`   KEEP (First created): ${group.suggestions[0].suggestionId} at ${group.suggestions[0].createdAt.substring(0, 19)}`);
          console.log(`   OUTDATE (Duplicates): ${group.suggestions.slice(1).map(s => s.suggestionId.substring(0, 8)).join(', ')}`);
          console.log(`   All created dates: ${group.suggestions.map(s => s.createdAt.substring(0, 10)).join(' → ')}`);
          console.log('');
        });
    } else {
      console.log('\n--- NO DUPLICATES FOUND ---');
    }
  }

  /**
   * Run the analysis
   */
  async run() {
    try {
      await this.initializeDataAccess();
      await this.getAllSuggestions();
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const siteIdPart = this.options.siteId ? `-${this.options.siteId}` : '-all-sites';
      const filename = `kanishka-cwv-suggestions-analysis${siteIdPart}-${timestamp}.csv`;
      
      this.exportToCSV(filename);
      
      this.log.info('Analysis complete!');
    } catch (error) {
      this.log.error(`Analysis failed: ${error.message}`);
      console.error(error);
      throw error;
    }
  }
}

/**
 * CLI setup (same pattern as check-cwv-fixed.mjs)
 */
const program = new Command();
program
  .name('analyze-cwv-duplicates')
  .description('Analyze CWV suggestions to identify and report duplicates')
  .option('--siteId <siteId>', 'Site ID to analyze (default: all sites)')
  .option('--verbose', 'Enable verbose logging', false)
  .option('--allSites', 'Process all sites from constants.js', false)
  .option('--sites <siteIds>', 'Comma-separated list of site IDs to process');

program.parse();
const options = program.opts();

// Validate options (same pattern as check-cwv-fixed.mjs)
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
  if (site) {
    sitesToProcess = [site];
  } else {
    sitesToProcess = [{ id: options.siteId, name: 'Custom Site' }];
  }
} else {
  // Process all sites by default
  console.log('[INFO] No site specified, analyzing all sites');
  sitesToProcess = [{ id: null, name: 'All Sites' }];
}

/**
 * Process sites (same pattern as check-cwv-fixed.mjs)
 */
async function processSites() {
  const allResults = [];
  
  for (let i = 0; i < sitesToProcess.length; i++) {
    const site = sitesToProcess[i];
    
    try {
      if (site.id) {
        console.log(`\n[INFO] Processing site ${i + 1}/${sitesToProcess.length}: ${site.name} (${site.id})`);
      } else {
        console.log(`\n[INFO] Processing all sites`);
      }
      
      // Create analyzer for this site
      const siteOptions = { ...options, siteId: site.id };
      const analyzer = new CWVDuplicateAnalyzer(siteOptions);
      
      await analyzer.run();
      
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
}

// Run the processing (same pattern as check-cwv-fixed.mjs)
processSites().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});

export { CWVDuplicateAnalyzer };

