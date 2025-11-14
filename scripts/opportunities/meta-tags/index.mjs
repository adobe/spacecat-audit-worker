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
 * Meta Tags Fix Checker
 * 
 * Compares existing suggestions with current audit results to identify fixed issues.
 * Outputs results to CSV for easy analysis.
 * 
 * Supported Issue Types:
 * ✅ Missing Tags: Missing Title, Missing Description, Missing H1
 * ✅ Length Issues: Too short, too long, empty (for Title, Description, H1)
 * ✅ Duplicate Tags: Duplicate Title, Duplicate Description, Duplicate H1
 * ✅ Structural Issues: Multiple H1 tags on a single page
 * 
 * Detection Logic:
 * 1. AI_SUGGESTION_IMPLEMENTED: Exact match with AI suggestion
 * 2. FIXED_BY_OTHER_MEANS: Issue no longer detected by SEO checks
 * 3. DUPLICATE_CONTENT_CHANGED: Duplicate issue with changed content
 * 4. NOT_IMPLEMENTED: Issue still exists
 * 5. PAGE_NOT_AVAILABLE: Cannot verify (page not in S3)
 * 
 * Features:
 * - Validates suggestion data before processing
 * - Special handling for duplicate issues (requires cross-page comparison)
 * - Manual check for Multiple H1 issues (disabled in SeoChecks)
 * - Proper CSV escaping for quotes, newlines, and commas
 * - Comprehensive fix type reporting
 * 
 * Usage:
 *   node scripts/check-metatags-fixed.mjs --siteId <siteId> [options]
 *   
 * Options:
 *   --siteId <id>       Site ID to check (required)
 *   --markFixed         Mark fixed suggestions in database (TODO: not yet implemented)
 *   --dryRun            Show what would be marked without making changes
 *   --verbose           Detailed logging
 *   --limit <number>    Limit number of suggestions to check (for testing)
 */

import { program } from 'commander';
import { writeFileSync } from 'fs';
// Simple console logger
import { createDataAccess } from '@adobe/spacecat-shared-data-access';
import { createFixEntityForSuggestions } from '../../create-fix-entity.js';

// Import metatags utilities
import { fetchAndProcessPageObject } from '../../../src/metatags/handler.js';
import SeoChecks from '../../../src/metatags/seo-checks.js';
import { S3Client } from '@aws-sdk/client-s3';

// Transform URL to scrape.json path - same as handler
function getScrapeJsonPath(url, siteId) {
  try {
    // If URL doesn't have a protocol, assume https://
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const pathname = new URL(fullUrl).pathname.replace(/\/$/, '');
    return `scrapes/${siteId}${pathname}/scrape.json`;
  } catch (error) {
    return null;
  }
}

class MetaTagsFixChecker {
  constructor(options) {
    this.options = options;
    this.log = this.createSimpleLogger(options.verbose);
    this.results = [];
    this.skippedCount = 0;
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
        process.env.S3_SCRAPER_BUCKET_NAME = 'spacecat-dev-scraper';
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
      
      // Get outdated and fixed suggestions directly from database
      const { Suggestion } = this.dataAccess;
      const suggestions = [];

      for (const opportunity of metaTagsOpportunities) {
        const opptyId = opportunity.getId();
        const oppStatus = opportunity.getStatus ? opportunity.getStatus() : (opportunity.status || '');
        const oppCreated = opportunity.getCreatedAt ? opportunity.getCreatedAt() : (opportunity.createdAt || '');
        const oppUpdated = opportunity.getUpdatedAt ? opportunity.getUpdatedAt() : (opportunity.updatedAt || '');

        const outdatedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'OUTDATED');

        const pushWithMeta = (s) => {
          suggestions.push({
            suggestion: s,
            opportunity: {
              id: opptyId,
              status: oppStatus,
              createdAt: oppCreated,
              updatedAt: oppUpdated,
            },
          });
        };

        outdatedSuggestions.forEach(pushWithMeta);
      }

      this.log.debug(`Found ${suggestions.length} outdated + fixed suggestions`);
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

    const suggestionsToCheck = this.options.limit 
      ? existingSuggestions.slice(0, this.options.limit)
      : existingSuggestions;
      
    this.log.info(`Processing ${suggestionsToCheck.length} suggestions`);

    const bucketName = this.context.env.S3_SCRAPER_BUCKET_NAME;

    for (const entry of suggestionsToCheck) {
      const suggestion = entry?.suggestion || entry;
      const opportunityMeta = entry?.opportunity || {};
      const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
      
      // Validate suggestion data
      if (!suggestionData) {
        this.log.error('Skipping suggestion with no data');
        this.skippedCount++;
        continue;
      }
      
      const { url, issue, tagName, tagContent, aiSuggestion } = suggestionData;
      
      // Validate required fields
      if (!url) {
        this.log.error('Skipping suggestion with missing URL');
        this.skippedCount++;
        continue;
      }
      
      if (!tagName || !['title', 'description', 'h1'].includes(tagName)) {
        this.log.error(`Skipping suggestion with invalid tagName: ${tagName}`);
        this.skippedCount++;
        continue;
      }
      
      const issueDetails = suggestionData.issueDetails || suggestionData.issue_detail || '';
      const isDuplicateIssue = issue && issue.toLowerCase().includes('duplicate');
      const isMultipleH1Issue = issue && issue.toLowerCase().includes('multiple h1');
      
      let pageWasAudited = false;
      let currentTagContent;
      let singlePageDetectedIssueExists = null;

      // Build S3 key from URL
      const s3Key = getScrapeJsonPath(url, this.options.siteId);
      if (!s3Key) {
        this.log.debug(`Invalid URL: ${url}`);
        currentTagContent = {
          error: 'INVALID_URL',
          message: `Invalid URL: ${url}`,
        };
      } else {
        // Log the S3 key being fetched
        this.log.debug(`Fetching S3 key: ${s3Key} for URL: ${url} in the bucket : ${bucketName}`);
        
        // Fetch page object from S3
        const pageObj = await fetchAndProcessPageObject(this.s3Client, bucketName, url, s3Key, this.log);
        
        if (pageObj) {
          // Get normalized path for matching
          const urlPath = url.startsWith('http') ? new URL(url).pathname : new URL(`https://${url}`).pathname;
          const normalizedPath = urlPath.replace(/\/$/, '') || '/';
          
          // Find matching page in object (use normalizedPath or first available)
          const pageKey = pageObj[normalizedPath] ? normalizedPath : Object.keys(pageObj)[0];
          
          if (pageObj[pageKey]) {
            pageWasAudited = true;
            
            // Ensure h1 is always an array to prevent SeoChecks from crashing
            const pageTags = pageObj[pageKey];
            if (!Array.isArray(pageTags.h1)) {
              pageTags.h1 = pageTags.h1 ? [pageTags.h1] : [];
            }
            
            // For duplicate issues, we can't reliably check with single-page audit
            // because duplicates require cross-page comparison
            if (isDuplicateIssue) {
              this.log.debug(`Duplicate issue detected - skipping single-page SEO check for ${tagName} on ${url}`);
              singlePageDetectedIssueExists = null; // Mark as unable to verify
            } else if (isMultipleH1Issue) {
              // Multiple H1 check is disabled in SeoChecks, but we can manually check
              this.log.debug(`Multiple H1 issue detected - performing manual check for ${url}`);
              const h1Count = Array.isArray(pageTags.h1) ? pageTags.h1.length : (pageTags.h1 ? 1 : 0);
              singlePageDetectedIssueExists = h1Count > 1;
              this.log.debug(`  H1 count: ${h1Count}, issue still exists: ${singlePageDetectedIssueExists}`);
            } else {
              // Run SEO checks for non-duplicate issues
              const seoChecks = new SeoChecks(this.log);
              seoChecks.performChecks(pageKey, pageTags);
              seoChecks.finalChecks();
              
              // Check if issue still exists
              const detectedTags = seoChecks.getDetectedTags();
              singlePageDetectedIssueExists = detectedTags[pageKey]?.[tagName] !== undefined;
            }
            
            // Extract current tag content
            // For Multiple H1 issues, show all H1s to help verify the fix
            if (isMultipleH1Issue && Array.isArray(pageTags.h1)) {
              currentTagContent = `[${pageTags.h1.length} H1s: ${pageTags.h1.join(', ')}]`;
            } else {
              currentTagContent = Array.isArray(pageTags[tagName]) 
                ? (pageTags[tagName][0] || null) 
                : pageTags[tagName];
            }
          }
        }
        
        if (!pageWasAudited) {
          currentTagContent = {
            error: 'PAGE_NOT_IN_BUCKET',
            message: `Page not found in S3: ${s3Key}`,
          };
        }
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
        // Page/tag unavailable - cannot verify
        isFixed = false;
        fixType = currentTagContent.error === 'INVALID_URL' ? 'INVALID_URL' : 'PAGE_NOT_AVAILABLE';
      } else if (aiSuggestionImplemented) {
        // Best case: AI suggestion was implemented exactly
        isFixed = true;
        fixType = 'AI_SUGGESTION_IMPLEMENTED';
      } else if (isDuplicateIssue) {
        // For duplicate issues, if content changed from original, consider it potentially fixed
        // since we can't verify duplicates with single-page checks
        const normalizeContent = (content) => {
          if (content === null || content === undefined) return '';
          return String(content).trim();
        };
        
        const currentNormalized = normalizeContent(currentTagContent);
        const originalNormalized = normalizeContent(tagContent);
        const contentChanged = currentNormalized !== originalNormalized && currentNormalized !== '';
        
        if (contentChanged) {
          isFixed = true;
          fixType = 'DUPLICATE_CONTENT_CHANGED';
        } else {
          isFixed = false;
          fixType = 'DUPLICATE_UNCHANGED';
        }
      } else if (singlePageDetectedIssueExists === false) {
        // Issue no longer detected by SEO checks
        isFixed = true;
        fixType = 'FIXED_BY_OTHER_MEANS';
      } else if (singlePageDetectedIssueExists === null) {
        // Unable to determine (shouldn't happen for non-duplicate issues)
        isFixed = false;
        fixType = 'UNABLE_TO_VERIFY';
      } else {
        // Issue still exists
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
        suggestion: suggestion, // Store suggestion reference for fix entity creation
        aiSuggestionImplemented: aiSuggestionImplemented,
        isFixed: isFixed,
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
        this.log.info(`✅ FIXED (AI_SUGGESTION_IMPLEMENTED): ${tagName} on ${url}`);
        this.log.info(`  AI Suggested: "${aiSuggestion}"`);
        this.log.info(`  Current: "${currentContentDisplay}"`);
      } else if (isFixed && fixType === 'FIXED_BY_OTHER_MEANS') {
        this.log.info(`✅ FIXED (FIXED_BY_OTHER_MEANS): ${tagName} on ${url} - issue no longer detected`);
        this.log.debug(`  AI Suggested: "${aiSuggestion}"`);
        this.log.debug(`  Current: "${currentContentDisplay}"`);
      } else if (isFixed && fixType === 'DUPLICATE_CONTENT_CHANGED') {
        this.log.info(`✅ FIXED (DUPLICATE_CONTENT_CHANGED): ${tagName} on ${url} - duplicate content was changed`);
        this.log.debug(`  Original: "${tagContent}"`);
        this.log.debug(`  Current: "${currentContentDisplay}"`);
      } else if (fixType === 'PAGE_NOT_AVAILABLE' || fixType === 'INVALID_URL') {
        this.log.debug(`⚠️  ${fixType}: ${tagName} on ${url} - cannot verify`);
      } else if (fixType === 'DUPLICATE_UNCHANGED') {
        this.log.debug(`❌ DUPLICATE_UNCHANGED: ${tagName} on ${url} - duplicate content unchanged`);
        this.log.debug(`  Content: "${currentContentDisplay}"`);
      } else if (!aiSuggestion || aiSuggestion === 'undefined') {
        this.log.debug(`⚠️  NO AI SUGGESTION: ${tagName} on ${url} - cannot verify if implemented`);
        this.log.debug(`  Current: "${currentContentDisplay}"`);
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
   * Check if AI suggestion was implemented (exact, case-sensitive)
   */
  checkIfAISuggestionImplemented(currentContent, aiSuggestion) {
    if (currentContent === undefined || currentContent === null || aiSuggestion === undefined || aiSuggestion === null) {
      return false;
    }
    const currentNorm = String(currentContent).trim();
    const aiNorm = String(aiSuggestion).trim();
    return currentNorm === aiNorm;
  }

  /**
   * Properly escape CSV field values
   * Handles quotes, newlines, and commas per RFC 4180
   */
  escapeCsvField(value) {
    if (value === null || value === undefined) {
      return '';
    }
    
    const stringValue = String(value);
    
    // If field contains quotes, newlines, or commas, it must be quoted
    // and internal quotes must be doubled
    if (stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r') || stringValue.includes(',')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    // Otherwise, just wrap in quotes for safety
    return `"${stringValue}"`;
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
      'Is Fixed',
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
      this.escapeCsvField(result.siteId),
      this.escapeCsvField(result.siteName),
      this.escapeCsvField(result.opportunityId),
      this.escapeCsvField(result.opportunityStatus),
      this.escapeCsvField(result.suggestionId),
      this.escapeCsvField(result.suggestionType),
      this.escapeCsvField(result.suggestionStatus),
      this.escapeCsvField(result.suggestionRank),
      this.escapeCsvField(result.tagName),
      this.escapeCsvField(result.issue),
      this.escapeCsvField(result.issueDetails),
      this.escapeCsvField(result.url),
      this.escapeCsvField(result.originalContent),
      this.escapeCsvField(result.aiSuggestion),
      this.escapeCsvField(result.currentContent),
      this.escapeCsvField(result.aiSuggestionImplemented ? 'YES' : 'NO'),
      this.escapeCsvField(result.isFixed ? 'YES' : 'NO'),
      this.escapeCsvField(result.fixType),
      this.escapeCsvField(result.contentScraped),
      this.escapeCsvField(result.testDate),
      this.escapeCsvField(result.opportunityCreated),
      this.escapeCsvField(result.opportunityUpdated),
      this.escapeCsvField(result.suggestionCreated),
      this.escapeCsvField(result.suggestionUpdated),
      this.escapeCsvField(result.updatedBy),
      this.escapeCsvField(result.recommendedAction)
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
   */
  async markFixedSuggestions() {
    const fixedResults = this.results.filter(r => r.aiSuggestionImplemented);
    
    if (fixedResults.length === 0) {
      this.log.info('No suggestions to mark as fixed');
      return;
    }

    this.log.info(`Creating fix entities for ${fixedResults.length} fixed suggestions`);

    // Group suggestions by opportunityId for batch API calls
    const suggestionsByOpportunity = {};
    
    for (const result of fixedResults) {
      const opportunityId = result.opportunityId;
      if (!suggestionsByOpportunity[opportunityId]) {
        suggestionsByOpportunity[opportunityId] = [];
      }
      suggestionsByOpportunity[opportunityId].push(result.suggestionId);
    }

    // Process each opportunity group
    for (const [opportunityId, suggestionIds] of Object.entries(suggestionsByOpportunity)) {
      if (this.options.dryRun) {
        this.log.info(`Would create fix entity for opportunity ${opportunityId} with ${suggestionIds.length} suggestion(s) (dry run)`);
      } else {
        try {
          // const result = await createFixEntityForSuggestions(
          //   this.options.siteId,
          //   opportunityId,
          //   suggestionIds,
          //   {
          //     apiBaseUrl: process.env.SPACECAT_API_BASE_URL || 'https://spacecat.experiencecloud.live/api/v1',
          //     apiKey: process.env.SPACECAT_API_KEY,
          //     logger: this.log
          //   }
          // );
          this.log.info(`✓ Created fix entity for opportunity ${opportunityId}: ${result.success}`);
        } catch (error) {
          this.log.error(`Failed to create fix entity for opportunity ${opportunityId}: ${error.message}`);
        }
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
    if (this.skippedCount > 0) {
      this.log.info(`Skipped (validation errors): ${this.skippedCount}`);
    }
    this.log.info(`Issues that were fixed: ${totalFixed}`);
    this.log.info(`Suggestions not implemented: ${totalNotImplemented}`);
    
    // Break down by fix type
    if (this.results.length > 0) {
      this.log.info('');
      this.log.info('Results by fix type:');
      const byFixType = {};
      this.results.forEach(r => {
        byFixType[r.fixType] = (byFixType[r.fixType] || 0) + 1;
      });
      
      Object.entries(byFixType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
        const icon = ['AI_SUGGESTION_IMPLEMENTED', 'FIXED_BY_OTHER_MEANS', 'DUPLICATE_CONTENT_CHANGED'].includes(type) ? '✅' : '❌';
        this.log.info(`  ${icon} ${type}: ${count}`);
      });
    }
    
    if (totalFixed > 0) {
      this.log.info('');
      this.log.info('Fixed issues by tag and issue type:');
      const fixedByType = {};
      this.results.filter(r => r.isFixed).forEach(r => {
        const key = `${r.tagName}: ${r.issue}`;
        fixedByType[key] = (fixedByType[key] || 0) + 1;
      });
      
      Object.entries(fixedByType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
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
  .parse();

const options = program.opts();


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
