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
 * Simple Meta Tags Fix Checker
 * 
 * Compares existing suggestions with current audit results to identify fixed issues.
 * Outputs results to CSV for easy analysis.
 * 
 * Logic: If existing suggestion issue is NOT in current audit = FIXED
 * 
 * Usage:
 *   node scripts/check-metatags-fixed.mjs --siteId <siteId> [options]
 */

import { program } from 'commander';
import { writeFileSync } from 'fs';
// Simple console logger
import { createDataAccess } from '@adobe/spacecat-shared-data-access';

// Import metatags utilities
import { fetchAndProcessPageObject } from '../src/metatags/handler.js';
import SeoChecks from '../src/metatags/seo-checks.js';
import { S3Client } from '@aws-sdk/client-s3';

// Helper function to transform URL to scrape.json path
function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

class MetaTagsFixChecker {
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
    this.log.debug('Initializing data access for meta-tags audit...');
    
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
      
      // Load site
      this.site = await this.dataAccess.Site.findById(this.options.siteId);
      if (!this.site) {
        throw new Error(`Site not found: ${this.options.siteId}`);
      }
      
      // Setup S3 client
      this.s3Client = new S3Client({ 
        region: process.env.AWS_REGION || 'us-east-1' 
      });
      
      // Setup audit context
      this.context = {
        dataAccess: this.dataAccess,
        site: this.site,
        log: this.log,
        env: process.env,
        s3Client: this.s3Client,
        // Add other required context properties as needed
      };
      
      this.log.info(`✓ Data access initialized for site ${this.options.siteId} (${this.site.getBaseURL()})`);
    } catch (error) {
      this.log.error(`Failed to initialize data access: ${error.message}`);
      throw error;
    }
  }

  async run() {
    this.log.info('=== META TAGS FIX CHECKER ===');
    this.log.info(`Site ID: ${this.options.siteId}`);
    this.log.info('');

    try {
      // Initialize data access
      await this.initializeDataAccess();

      // Step 1: Get existing suggestions
      this.log.info('Step 1: Getting existing meta-tags suggestions...');
      const existingSuggestions = await this.getExistingSuggestions();
      this.log.info(`Found ${existingSuggestions.length} existing suggestions`);

      // Step 2: Check each suggestion against S3 single-page content
      this.log.info('Step 2: Checking suggestions using S3 single-page scrape + SEO checks...');
      await this.compareAndIdentifyFixes(existingSuggestions);

      // Step 3: Generate CSV
      this.log.info('Step 3: Generating CSV report...');
      this.generateCSV();

      // Step 5: Mark as fixed if requested (TODO)
      if (this.options.markFixed) {
        await this.markFixedSuggestions();
      }

      this.printSummary();

    } catch (error) {
      this.log.error('Error:', error.message);
      if (this.options.verbose) {
        this.log.error(error.stack);
      }
      process.exit(1);
    }
  }

  /**
   * Get existing suggestions from database
   */
  async getExistingSuggestions() {
    this.log.debug('Fetching existing meta-tags suggestions from database...');
    
    try {
      const { Opportunity } = this.dataAccess;
      
      // Get all opportunities for this site
      const allOpportunities = await Opportunity.allBySiteId(this.options.siteId);
      
      // Filter for meta-tags opportunities  
      const metaTagsOpportunities = allOpportunities.filter(
        (opportunity) => opportunity.getType() === 'meta-tags'
      );
      
      this.log.debug(`Found ${metaTagsOpportunities.length} meta-tags opportunities`);
      
      // Get outdated suggestions directly from database
      const { Suggestion } = this.dataAccess;
      const suggestions = [];
      
      for (const opportunity of metaTagsOpportunities) {
        const opptyId = opportunity.getId();
        const outdatedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'outdated');
        const oppStatus = opportunity.getStatus ? opportunity.getStatus() : (opportunity.status || '');
        const oppCreated = opportunity.getCreatedAt ? opportunity.getCreatedAt() : (opportunity.createdAt || '');
        const oppUpdated = opportunity.getUpdatedAt ? opportunity.getUpdatedAt() : (opportunity.updatedAt || '');
        outdatedSuggestions.forEach((s) => {
          suggestions.push({
            suggestion: s,
            opportunity: {
              id: opptyId,
              status: oppStatus,
              createdAt: oppCreated,
              updatedAt: oppUpdated,
            },
          });
        });
      }
      
      this.log.debug(`Found ${suggestions.length} outdated suggestions`);
      return suggestions;
      
    } catch (error) {
      this.log.error(`Failed to fetch suggestions: ${error.message}`);
      throw error;
    }
  }

  // removed full-audit path; checker now uses single-page S3 content only

  /**
   * Compare existing suggestions using single-page S3 + SEO checks
   */
  async compareAndIdentifyFixes(existingSuggestions) {
    this.log.info('Comparing existing suggestions via single-page S3 + SEO checks...');

    // Apply limit if specified
    const suggestionsToCheck = this.options.limit 
      ? existingSuggestions.slice(0, this.options.limit)
      : existingSuggestions;
      
    this.log.info(`Processing ${suggestionsToCheck.length} suggestions${this.options.limit ? ` (limited from ${existingSuggestions.length})` : ''}`);

    for (const entry of suggestionsToCheck) {
      const suggestion = entry?.suggestion || entry;
      const opportunityMeta = entry?.opportunity || {};
      const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
      const { url, issue, tagName, tagContent, aiSuggestion } = suggestionData;
      const issueDetails = suggestionData.issueDetails || suggestionData.issue_detail || '';
      
      // Try to run SEO checks for this specific URL using S3 single-page object
      const normalizedUrl = url.replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '') || '/';
      let pageWasAudited = false;
      let currentTagContent;
      let singlePageDetectedIssueExists = null; // null = unknown, boolean if we could run checks

      try {
        const bucketName = this.context.env.S3_SCRAPER_BUCKET_NAME;
        const prefix = `scrapes/${this.options.siteId}/`;
        const singleKey = getScrapeJsonPath(url, this.options.siteId);
        const pageObj = await fetchAndProcessPageObject(this.s3Client, bucketName, singleKey, prefix, this.log);
        if (pageObj && pageObj[normalizedUrl]) {
          pageWasAudited = true;
          // Run SEO checks like the audit for this single page
          const seoChecks = new SeoChecks(this.log);
          seoChecks.performChecks(normalizedUrl, pageObj[normalizedUrl]);
          seoChecks.finalChecks();
          const singleDetected = seoChecks.getDetectedTags();
          singlePageDetectedIssueExists = singleDetected[normalizedUrl]?.[tagName] !== undefined;
          // Current tag content from single page extraction
          const pageTags = pageObj[normalizedUrl];
          currentTagContent = Array.isArray(pageTags[tagName]) ? (pageTags[tagName][0] || null) : pageTags[tagName];
        }
      } catch (e) {
        this.log.debug(`Single-page SEO check failed for ${url}: ${e.message}`);
      }

      // If S3 page not found, set legacy "not in S3" behavior
      if (!pageWasAudited) {
        currentTagContent = {
          error: 'PAGE_NOT_IN_BUCKET',
          message: `Page not found in S3 bucket: ${normalizedUrl}`,
        };
      }
      
      // Handle error cases
      let currentContentDisplay;
      let aiSuggestionImplemented = false;
      
      if (currentTagContent && typeof currentTagContent === 'object' && currentTagContent.error) {
        currentContentDisplay = currentTagContent.message;
        aiSuggestionImplemented = false; // Can't compare if there's an error
      } else {
        currentContentDisplay = currentTagContent || '(empty)';
        aiSuggestionImplemented = this.checkIfAISuggestionImplemented(currentTagContent, aiSuggestion);
      }
      
      // Add small delay to avoid overwhelming servers
      await this.delay(100);
      
      // Complete fix logic covering all cases
      let isFixed;
      let fixType;

      if (currentTagContent && typeof currentTagContent === 'object' && currentTagContent.error) {
        // Keep legacy behavior: treat as NOT_IMPLEMENTED when page/tag unavailable
        isFixed = false;
        fixType = 'NOT_IMPLEMENTED';
      } else if (aiSuggestionImplemented) {
        isFixed = true;
        fixType = 'AI_SUGGESTION_IMPLEMENTED';
      } else if (singlePageDetectedIssueExists === false) {
        isFixed = true;
        fixType = 'FIXED_BY_OTHER_MEANS';
      } else {
        isFixed = false;
        fixType = 'NOT_IMPLEMENTED';
      }
      
      const toIso = (v) => (v && typeof v.toISOString === 'function' ? v.toISOString() : (v || ''));
      const result = {
        siteId: this.options.siteId,
        siteName: this.site?.getBaseURL ? this.site.getBaseURL() : '',
        opportunityId: opportunityMeta.id || '',
        opportunityStatus: opportunityMeta.status || '',
        suggestionId: suggestion.getId ? suggestion.getId() : suggestion.id,
        suggestionType: suggestion.getType ? (suggestion.getType() || 'METADATA_UPDATE') : (suggestion.type || 'METADATA_UPDATE'),
        suggestionStatus: suggestion.getStatus ? suggestion.getStatus() : suggestion.status,
        suggestionRank: suggestion.getRank ? suggestion.getRank() : (suggestion.rank || ''),
        tagName: tagName,
        issue: issue,
        issueDetails: issueDetails,
        url: url,
        originalContent: tagContent || '(empty)',
        aiSuggestion: aiSuggestion || '(none)',
        currentContent: currentContentDisplay,
        aiSuggestionImplemented: aiSuggestionImplemented,
        isFixedOverall: isFixed,
        fixType: fixType,
        contentScraped: pageWasAudited ? 'YES' : 'NO',
        testDate: new Date().toISOString(),
        opportunityCreated: toIso(opportunityMeta.createdAt),
        opportunityUpdated: toIso(opportunityMeta.updatedAt),
        suggestionCreated: toIso(suggestion.getCreatedAt ? suggestion.getCreatedAt() : suggestion.createdAt),
        suggestionUpdated: toIso(suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : suggestion.updatedAt),
        updatedBy: suggestion.getUpdatedBy ? (suggestion.getUpdatedBy() || 'MISSING_UPDATED_BY') : (suggestion.updatedBy || 'MISSING_UPDATED_BY'),
        recommendedAction: isFixed ? 'MARK AS FIXED' : 'KEEP CURRENT STATUS'
      };

      this.results.push(result);
      
      if (aiSuggestionImplemented) {
        this.log.info(`✅ FIXED: ${tagName} on ${url}`);
        this.log.info(`  AI Suggested: "${aiSuggestion}"`);
        this.log.info(`  Current: "${currentContentDisplay}"`);
      } else {
        this.log.debug(`❌ NOT IMPLEMENTED: ${tagName} on ${url}`);
        this.log.debug(`  AI Suggested: "${aiSuggestion}"`);
        this.log.debug(`  Current: "${currentContentDisplay}"`);
      }
    }
  }
  // removed extractedTags fallback path

  /**
   * Add delay to avoid overwhelming servers
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if AI suggestion was implemented (exact or optional fuzzy match)
   */
  checkIfAISuggestionImplemented(currentContent, aiSuggestion) {
    if (!currentContent || !aiSuggestion) {
      return false;
    }

    const ignoreCase = !!this.options.ignoreCase;
    const threshold = typeof this.options.similarity === 'number' ? this.options.similarity : 1;

    const normalize = (s) => {
      const t = String(s).trim();
      return ignoreCase ? t.toLowerCase() : t;
    };

    const currentNorm = normalize(currentContent);
    const aiNorm = normalize(aiSuggestion);

    // Exact match
    if (currentNorm === aiNorm) {
      return true;
    }

    // Fuzzy match only if user opts-in by lowering threshold
    if (threshold < 1) {
      const similarity = this.calculateStringSimilarity(currentNorm, aiNorm);
      return similarity >= threshold;
    }

    return false;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  calculateStringSimilarity(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    const maxLen = Math.max(len1, len2);
    return maxLen === 0 ? 1 : (maxLen - matrix[len1][len2]) / maxLen;
  }


  /**
   * Generate CSV report
   */
  generateCSV() {
    const csvHeaders = [
      'Site ID',
      'Site Name',
      'Opportunity ID',
      'Opportunity Status',
      'Suggestion ID',
      'Suggestion Type',
      'Suggestion Status',
      'Suggestion Rank',
      'Tag Name',
      'Issue',
      'Issue Details',
      'URL',
      'Original Content',
      'AI Suggestion',
      'Current Content',
      'AI Suggestion Implemented',
      'Is Fixed Overall',
      'Fix Type',
      'Content Scraped',
      'Test Date',
      'Opportunity Created',
      'Opportunity Updated',
      'Suggestion Created',
      'Suggestion Updated',
      'Updated By',
      'Recommended Action'
    ];

    const csvRows = this.results.map(result => [
      result.siteId,
      result.siteName,
      result.opportunityId,
      result.opportunityStatus,
      result.suggestionId,
      result.suggestionType,
      result.suggestionStatus,
      result.suggestionRank,
      result.tagName,
      result.issue,
      result.issueDetails,
      result.url,
      `"${result.originalContent}"`,
      `"${result.aiSuggestion}"`,
      `"${result.currentContent}"`,
      result.aiSuggestionImplemented ? 'YES' : 'NO',
      result.isFixedOverall ? 'YES' : 'NO',
      result.fixType,
      result.contentScraped,
      result.testDate,
      result.opportunityCreated,
      result.opportunityUpdated,
      result.suggestionCreated,
      result.suggestionUpdated,
      result.updatedBy,
      `"${result.recommendedAction}"`
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.join(','))
    ].join('\n');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
    const filename = `metatags-fix-check-${this.options.siteId}-${timestamp[0]}-${timestamp[1].split('.')[0]}.csv`;
    writeFileSync(filename, csvContent);
    
    this.log.info(`✓ CSV report generated: ${filename}`);
  }

  /**
   * Mark fixed suggestions in database
   * TODO: Implement actual database updates when ready
   */
  async markFixedSuggestions() {
    const fixedResults = this.results.filter(r => r.isFixed);
    
    if (fixedResults.length === 0) {
      this.log.info('No suggestions to mark as fixed');
      return;
    }

    this.log.info(`Found ${fixedResults.length} suggestions that should be marked as FIXED`);
    this.log.info('TODO: Database updates will be implemented in a future iteration');

    for (const result of fixedResults) {
      if (this.options.dryRun) {
        this.log.info(`Would mark ${result.suggestionId} as FIXED (dry run)`);
      } else {
        this.log.info(`TODO: Mark ${result.suggestionId} as FIXED in database`);
        // TODO: Implement when ready to update database
        // const { Suggestion } = this.dataAccess;
        // const suggestion = await Suggestion.findById(result.suggestionId);
        // suggestion.setStatus('FIXED');
        // suggestion.setUpdatedBy('metatags-fix-checker');
        // await suggestion.save();
      }
    }
  }

  /**
   * Print summary
   */
  printSummary() {
    const totalChecked = this.results.length;
    const totalFixed = this.results.filter(r => r.isFixed).length;
    const totalNotImplemented = this.results.filter(r => !r.isFixed).length;

    this.log.info('');
    this.log.info('=== SUMMARY ===');
    this.log.info(`Total suggestions checked: ${totalChecked}`);
    this.log.info(`Issues that were fixed: ${totalFixed}`);
    this.log.info(`Suggestions not implemented: ${totalNotImplemented}`);
    
    if (totalFixed > 0) {
      this.log.info('');
      this.log.info('Fixed issues by type:');
      const fixedByType = {};
      this.results.filter(r => r.isFixed).forEach(r => {
        const key = `${r.tagName}: ${r.issue}`;
        fixedByType[key] = (fixedByType[key] || 0) + 1;
      });
      
      Object.entries(fixedByType).forEach(([type, count]) => {
        this.log.info(`  ${type}: ${count}`);
      });
    }
  }
}

// CLI setup
program
  .name('check-metatags-fixed')
  .description('Check which meta-tags suggestions have been fixed by comparing S3 single-page content')
  .option('--siteId <id>', 'Site ID to check (defaults to test site)')
  .option('--markFixed', 'Mark fixed suggestions in database', false)
  .option('--dryRun', 'Show what would be marked without making changes', false)
  .option('--verbose', 'Detailed logging', false)
  .option('--limit <number>', 'Limit number of suggestions to check (for testing)', parseInt)
  .option('--ignoreCase', 'Case-insensitive string match for AI suggestion', false)
  .option('--similarity <number>', '0-1 threshold for fuzzy match; 1 means exact only', parseFloat)
  .parse();

const options = program.opts();

// Default similarity to exact match unless overridden
if (options.similarity === undefined || Number.isNaN(options.similarity)) {
  options.similarity = 1;
}

// Default site ID for testing
if (!options.siteId) {
  options.siteId = '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3';
  console.log(`[INFO] Using default site ID: ${options.siteId}`);
}

// Default limit for testing (removed - now processes all suggestions by default)
// if (!options.limit) {
//   options.limit = 10;
//   console.log(`[INFO] Using default limit: ${options.limit} suggestions`);
// }

// Run the checker
const checker = new MetaTagsFixChecker(options);
checker.run().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
