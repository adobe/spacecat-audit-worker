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
import { metatagsAutoDetect } from '../src/metatags/handler.js';
import { getTopPagesForSiteId } from '../src/canonical/handler.js';
import { S3Client } from '@aws-sdk/client-s3';
import { SITES } from './constants.js';
import { writeMetatagsCSV, formatMetatagsResult, METATAGS_CSV_HEADERS, writeErrorCSV } from './csv-utils.js';

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
    this.errors = [];
  }

  createSimpleLogger(verbose) {
    return {
      info: (msg) => console.log(`[INFO] ${msg}`),
      debug: verbose ? (msg) => console.log(`[DEBUG] ${msg}`) : () => {},
      error: (msg) => console.error(`[ERROR] ${msg}`)
    };
  }

  /**
   * Log error to errors array for CSV output
   */
  logError(errorType, errorMessage, errorDetails = '', suggestionId = '', opportunityId = '', url = '', error = null) {
    const errorData = {
      timestamp: new Date().toISOString(),
      scriptName: 'check-metatags-fixed',
      siteId: this.options.siteId,
      siteName: this.site?.getBaseURL() || '',
      errorType,
      errorMessage,
      errorDetails,
      suggestionId,
      opportunityId,
      url,
      stackTrace: error?.stack || ''
    };
    
    this.errors.push(errorData);
    this.log.error(`${errorType}: ${errorMessage}`);
    if (this.options.verbose && errorDetails) {
      this.log.debug(`Details: ${errorDetails}`);
    }
  }

  /**
   * Create a clean error result that matches the exact CSV schema
   * This ensures no column misalignment when errors occur
   */
  createCleanErrorResult(suggestion, error) {
    const suggestionId = suggestion.getId ? suggestion.getId() : suggestion.id || 'ERROR_UNKNOWN_ID';
    const opportunityId = suggestion.getOpportunityId ? suggestion.getOpportunityId() : 'ERROR_UNKNOWN_OPPORTUNITY';
    const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data || {};
    const opportunityData = this.opportunityDataMap[opportunityId] || {};
    
    // Create a complete result object with ALL required fields
    // This matches the exact schema expected by formatMetatagsResult
    return {
      // Core Identity (columns 1-4)
      siteId: this.options.siteId || 'ERROR_NO_SITE_ID',
      siteName: this.site?.getBaseURL() || 'ERROR_NO_SITE_NAME',
      opportunityId: opportunityId,
      suggestionId: suggestionId,
      
      // URL and Content (columns 5-6)
      url: suggestionData.url || 'ERROR_NO_URL',
      tagName: suggestionData.tagName || 'ERROR_NO_TAG_NAME',
      
      // Issue Details (columns 7-9)
      issue: suggestionData.issue || 'ERROR_NO_ISSUE',
      originalContent: suggestionData.tagContent || 'ERROR_NO_ORIGINAL_CONTENT',
      aiSuggestion: suggestionData.aiSuggestion || 'ERROR_NO_AI_SUGGESTION',
      
      // Current State (columns 10-11)
      currentContent: `ERROR: ${error.message}`,
      suggestionMatches: false,
      
      // Fix Detection Results (columns 12-14)
      isFixedOverall: false,
      aiSuggestionImplemented: false,
      fixMethod: 'ERROR_DURING_PROCESSING',
      
      // Opportunity Details (columns 15-19)
      opportunityType: opportunityData.type || 'ERROR_NO_TYPE',
      opportunityStatus: opportunityData.status || 'ERROR_NO_STATUS',
      opportunityTitle: opportunityData.title || 'ERROR_NO_TITLE',
      opportunityCreated: opportunityData.createdAt || 'ERROR_NO_CREATED_DATE',
      opportunityUpdated: opportunityData.updatedAt || 'ERROR_NO_UPDATED_DATE',
      
      // Suggestion Details (columns 20-25)
      suggestionType: suggestionData.type || 'ERROR_NO_SUGGESTION_TYPE',
      suggestionRank: suggestionData.rank || 0,
      suggestionStatus: suggestion.getStatus ? suggestion.getStatus() : 'ERROR_NO_STATUS',
      suggestionCreated: suggestion.getCreatedAt ? suggestion.getCreatedAt() : 'ERROR_NO_CREATED_DATE',
      suggestionUpdated: suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : 'ERROR_NO_UPDATED_DATE',
      updatedBy: suggestion.getUpdatedBy ? suggestion.getUpdatedBy() : 'ERROR_NO_UPDATED_BY',
      
      // Action (column 26)
      recommendedAction: 'INVESTIGATE_ERROR'
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
      this.logError('INITIALIZATION_ERROR', `Failed to initialize data access: ${error.message}`, '', '', '', '', error);
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

      // Step 2: Run current audit
      this.log.info('Step 2: Running current meta-tags audit...');
      const auditResults = await this.getCurrentAuditResults();
      
      if (!auditResults || !auditResults.detectedTags || !auditResults.extractedTags) {
        throw new Error('Failed to get audit results - no data returned');
      }
      
      this.log.info(`Found ${Object.keys(auditResults.detectedTags).length} pages with current issues`);
      this.log.info(`Found ${Object.keys(auditResults.extractedTags).length} pages with current content`);

      // Step 3: Compare and identify fixes
      this.log.info('Step 3: Comparing existing vs current...');
      await this.compareAndIdentifyFixes(existingSuggestions, auditResults);

      // Step 4: Generate CSV
      this.log.info('Step 4: Generating CSV report...');
      this.generateCSV();

      // Step 5: Mark as fixed if requested (TODO)
      if (this.options.markFixed) {
        await this.markFixedSuggestions();
      }

      this.printSummary();

    } catch (error) {
      this.logError('SCRIPT_ERROR', `Script execution failed: ${error.message}`, '', '', '', '', error);
      
      // Write error CSV before exiting
      if (this.errors.length > 0) {
        writeErrorCSV(this.errors, 'metatags', this.options.siteId);
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
      
      // Create opportunity data maps for later use
      this.opportunityStatusMap = {};
      this.opportunityDataMap = {};
      metaTagsOpportunities.forEach(opportunity => {
        const oppId = opportunity.getId();
        this.opportunityStatusMap[oppId] = opportunity.getStatus ? opportunity.getStatus() : 'unknown';
        this.opportunityDataMap[oppId] = {
          status: opportunity.getStatus ? opportunity.getStatus() : (opportunity.status || 'unknown'),
          createdAt: opportunity.getCreatedAt ? opportunity.getCreatedAt() : (opportunity.createdAt || ''),
          updatedAt: opportunity.getUpdatedAt ? opportunity.getUpdatedAt() : (opportunity.updatedAt || '')
        };
      });
      
      // Get outdated AND fixed suggestions directly from database
      const { Suggestion } = this.dataAccess;
      const suggestions = [];
      
      for (const opportunity of metaTagsOpportunities) {
        const opptyId = opportunity.getId();
        
        // Get outdated suggestions
        const outdatedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'outdated');
        suggestions.push(...outdatedSuggestions);
        
        // Get fixed suggestions
        const fixedSuggestions = await Suggestion.allByOpportunityIdAndStatus(opptyId, 'fixed');
        suggestions.push(...fixedSuggestions);
      }
      
      this.log.debug(`Found ${suggestions.length} outdated + fixed suggestions`);
      return suggestions;
      
    } catch (error) {
      this.logError('DATABASE_ERROR', `Failed to fetch suggestions: ${error.message}`, '', '', '', '', error);
      throw error;
    }
  }

  /**
   * Run current meta-tags audit to get current issues
   */
  async getCurrentAuditResults() {
    this.log.debug('Running current meta-tags audit...');
    
    try {
      // Get top pages for the site
      const topPages = await getTopPagesForSiteId(this.dataAccess, this.options.siteId, this.context, this.log);
      const includedURLs = await this.site?.getConfig()?.getIncludedURLs('meta-tags') || [];

      // Transform URLs into scrape.json paths and combine them into a Set
      const topPagePaths = topPages.map((page) => getScrapeJsonPath(page.url, this.options.siteId));
      const includedUrlPaths = includedURLs.map((url) => getScrapeJsonPath(url, this.options.siteId));
      const totalPagesSet = new Set([...topPagePaths, ...includedUrlPaths]);

      this.log.debug(`Processing ${totalPagesSet.size} pages for current audit`);
      this.log.debug(`S3 Bucket: ${this.context.env.S3_SCRAPER_BUCKET_NAME}`);
      this.log.debug(`Site ID: ${this.options.siteId}`);
      this.log.debug(`Sample pages: ${Array.from(totalPagesSet).slice(0, 3).join(', ')}`);

      // Run the actual metatags audit
      this.log.debug('Calling metatagsAutoDetect...');
      const auditResults = await metatagsAutoDetect(this.site, totalPagesSet, this.context);
      this.log.debug('metatagsAutoDetect completed');
      
      this.log.debug(`Current audit found issues on ${Object.keys(auditResults.detectedTags).length} pages`);
      this.log.debug(`Current audit extracted content from ${Object.keys(auditResults.extractedTags).length} pages`);
      return auditResults;

    } catch (error) {
      this.log.error('Failed to run current audit:', error.message);
      return {
        detectedTags: {},
        extractedTags: {},
        seoChecks: null
      };
    }
  }

  /**
   * Compare existing suggestions with current audit results
   */
  async compareAndIdentifyFixes(existingSuggestions, auditResults) {
    this.log.info('Comparing existing suggestions with current audit results...');

    // Apply limit if specified
    const suggestionsToCheck = this.options.limit 
      ? existingSuggestions.slice(0, this.options.limit)
      : existingSuggestions;
      
    this.log.info(`Processing ${suggestionsToCheck.length} suggestions${this.options.limit ? ` (limited from ${existingSuggestions.length})` : ''}`);

    for (const suggestion of suggestionsToCheck) {
      try {
        const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
        const { url, issue, tagName, tagContent, aiSuggestion } = suggestionData;
      
      // Check if AI suggestion was implemented by getting current content
      const currentTagContent = this.getCurrentTagContentFromExtractedTags(url, tagName, auditResults.extractedTags);
      
      // Handle error cases
      let currentContentDisplay;
      let aiSuggestionImplemented = false;
      let hasCurrentIssue = false;
      
      if (currentTagContent && typeof currentTagContent === 'object' && currentTagContent.error) {
        currentContentDisplay = currentTagContent.message;
        aiSuggestionImplemented = false; // Can't compare if there's an error
        // CRITICAL FIX: If page not found in bucket, we cannot verify fix status
        // For duplicate issues, if we can't access the page, we must assume issue persists
        hasCurrentIssue = true; // If we can't get content, assume there's still an issue
      } else {
        // Handle the new H1 format with multiple H1s
        if (tagName === 'h1' && currentTagContent && typeof currentTagContent === 'object' && currentTagContent.allH1s) {
          currentContentDisplay = currentTagContent.displayContent;
          // For duplicate H1 issues, check if the original duplicate content still exists in ANY H1
          if (issue && issue.toLowerCase().includes('duplicate')) {
            const originalContent = tagContent; // This is the original duplicate content
            const stillHasDuplicate = currentTagContent.allH1s.some(h1 => 
              h1.toLowerCase().trim() === originalContent.toLowerCase().trim()
            );
            aiSuggestionImplemented = !stillHasDuplicate && this.checkIfAISuggestionImplemented(currentTagContent.displayContent, aiSuggestion);
            this.log.debug(`Duplicate H1 check: Original "${originalContent}" still present: ${stillHasDuplicate}`);
          } else {
            aiSuggestionImplemented = this.checkIfAISuggestionImplemented(currentTagContent.displayContent, aiSuggestion);
          }
        } else {
          currentContentDisplay = currentTagContent || '(empty)';
          aiSuggestionImplemented = this.checkIfAISuggestionImplemented(currentTagContent, aiSuggestion);
        }
        
        // Check if this URL+tag combination still has issues in current audit
        const normalizedUrl = url.replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '') || '/';
        hasCurrentIssue = auditResults.detectedTags[normalizedUrl] && auditResults.detectedTags[normalizedUrl][tagName];
        
        // Special handling for duplicate issues - these are cross-page issues
        if (issue && issue.toLowerCase().includes('duplicate')) {
          this.log.debug(`Checking duplicate ${tagName} issue for ${normalizedUrl}`);
          this.log.debug(`Current audit detected issues: ${hasCurrentIssue ? 'YES' : 'NO'}`);
          
          // CRITICAL FIX: For duplicate issues, if ANY related page is missing from S3,
          // we cannot reliably determine if the duplicate is fixed
          const pageInExtractedTags = auditResults.extractedTags[normalizedUrl];
          if (!pageInExtractedTags) {
            this.log.debug(`Page ${normalizedUrl} not found in extracted tags - cannot verify duplicate fix`);
            hasCurrentIssue = true; // Force to NOT FIXED if we can't verify
          }
          
          if (hasCurrentIssue) {
            const currentIssueDetails = auditResults.detectedTags[normalizedUrl]?.[tagName];
            if (currentIssueDetails) {
              this.log.debug(`Current issue: ${currentIssueDetails.issue} - ${currentIssueDetails.issueDetails}`);
            }
          }
        }
      }
      
      // Add small delay to avoid overwhelming servers
      await this.delay(100);
      
      // Determine fix status
      const isFixedByAI = aiSuggestionImplemented;
      const isFixedOverall = !hasCurrentIssue; // Fixed if no current issue detected
      
      // Determine fix type with special handling for duplicates
      let fixType = 'NOT_IMPLEMENTED';
      if (isFixedByAI) {
        fixType = 'AI_SUGGESTION_IMPLEMENTED';
      } else if (isFixedOverall) {
        // Check if this was a duplicate issue
        if (issue && issue.toLowerCase().includes('duplicate')) {
          fixType = 'DUPLICATE_RESOLVED';
        } else {
          fixType = 'FIXED_BY_OTHER_MEANS';
        }
      }
      
      // Get opportunity status from our pre-built map (no additional API call!)
      const opportunityId = suggestion.getOpportunityId ? suggestion.getOpportunityId() : 'unknown';
      const opportunityStatus = this.opportunityStatusMap[opportunityId] || 'unknown';
      
      // Extract additional suggestion data for comprehensive schema
      const additionalSuggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
      
      // Get opportunity data from our pre-built map
      const opportunityData = this.opportunityDataMap[opportunityId] || {};
      
      const result = {
        // Core Identity (5 fields)
        siteId: this.options.siteId,
        siteName: this.site.getBaseURL(),
        opportunityId: opportunityId,
        opportunityStatus: opportunityStatus,
        suggestionId: suggestion.getId ? suggestion.getId() : suggestion.id,
        
        // Suggestion Details (6 fields)
        suggestionType: suggestion.getType ? suggestion.getType() : suggestion.type,
        suggestionStatus: suggestion.getStatus ? suggestion.getStatus() : suggestion.status,
        suggestionRank: suggestion.getRank ? suggestion.getRank() : suggestion.rank,
        tagName: tagName,
        issue: issue,
        issueDetails: additionalSuggestionData?.issueDetails || additionalSuggestionData?.seoRecommendation || '',
        
        // Content Analysis (4 fields)
        url: url,
        originalContent: tagContent || '(empty)',
        aiSuggestion: aiSuggestion || '(none)',
        currentContent: currentContentDisplay,
        
        // Fix Detection Results (4 fields)
        aiSuggestionImplemented: aiSuggestionImplemented,
        isFixedOverall: isFixedOverall,
        fixType: fixType,
        // testDate will be added by formatMetatagsResult
        
        // Timestamps and Metadata (6 fields)
        opportunityCreated: opportunityData.createdAt || '',
        opportunityUpdated: opportunityData.updatedAt || '',
        suggestionCreated: suggestion.getCreatedAt ? suggestion.getCreatedAt() : (suggestion.createdAt || ''),
        suggestionUpdated: suggestion.getUpdatedAt ? suggestion.getUpdatedAt() : (suggestion.updatedAt || ''),
        updatedBy: suggestion.getUpdatedBy ? suggestion.getUpdatedBy() : (suggestion.updatedBy || ''),
        recommendedAction: isFixedOverall ? 'MARK AS FIXED' : 'KEEP CURRENT STATUS'
      };

      this.results.push(result);
      
      if (isFixedByAI) {
        this.log.info(`✅ FIXED BY AI: ${tagName} on ${url}`);
        this.log.info(`  AI Suggested: "${aiSuggestion}"`);
        this.log.info(`  Current: "${currentContentDisplay}"`);
      } else if (isFixedOverall) {
        this.log.info(`✅ FIXED BY OTHER: ${tagName} on ${url}`);
        this.log.info(`  Current: "${currentContentDisplay}" (not our AI suggestion)`);
      } else {
        this.log.debug(`❌ NOT FIXED: ${tagName} on ${url}`);
        this.log.debug(`  AI Suggested: "${aiSuggestion}"`);
        this.log.debug(`  Current: "${currentContentDisplay}"`);
      }
      
      } catch (error) {
        const suggestionId = suggestion.getId ? suggestion.getId() : suggestion.id || 'unknown';
        const opportunityId = suggestion.getOpportunityId ? suggestion.getOpportunityId() : 'unknown';
        const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;
        const url = suggestionData?.url || 'unknown';
        
        this.logError(
          'SUGGESTION_PROCESSING_ERROR',
          `Failed to process suggestion ${suggestionId}`,
          error.message,
          suggestionId,
          opportunityId,
          url,
          error
        );
        
        // Create a clean error result row with all required columns properly filled
        const errorResult = this.createCleanErrorResult(suggestion, error);
        this.results.push(errorResult);
        
        // Continue processing other suggestions
        continue;
      }
    }
  }


  /**
   * Get current tag content directly from extractedTags (SIMPLE!)
   */
  getCurrentTagContentFromExtractedTags(url, tagName, extractedTags) {
    // Normalize URL to match extractedTags format (pathname only)
    const normalizedUrl = url.replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '') || '/';
    
    const pageData = extractedTags[normalizedUrl];
    if (!pageData) {
      this.log.debug(`No extracted data found for ${normalizedUrl}`);
      return { error: 'PAGE_NOT_IN_BUCKET', message: `Page not found in S3 bucket: ${normalizedUrl}` };
    }
    
    const tagContent = pageData[tagName];
    if (!tagContent) {
      this.log.debug(`No ${tagName} found for ${normalizedUrl}`);
      return { error: 'TAG_NOT_FOUND', message: `${tagName} tag not found on page` };
    }
    
    // Handle h1 array format
    if (tagName === 'h1' && Array.isArray(tagContent)) {
      if (tagContent.length === 0) {
        return { error: 'TAG_EMPTY', message: `${tagName} tag exists but is empty` };
      }
      
      // For H1s, return ALL H1s found (not just first one)
      // This is important for duplicate detection consistency
      const allH1s = tagContent.filter(h1 => h1 && h1.trim());
      if (allH1s.length === 0) {
        return { error: 'TAG_EMPTY', message: `${tagName} tag exists but is empty` };
      }
      
      // Return all H1s joined for display, but we'll need special handling for duplicates
      const h1Display = allH1s.length === 1 ? allH1s[0] : `[${allH1s.join(', ')}]`;
      this.log.debug(`Found ${allH1s.length} ${tagName}(s) for ${normalizedUrl}: "${h1Display}"`);
      
      // Return the array for duplicate checking, but string for display
      return { allH1s, displayContent: h1Display };
    }
    
    this.log.debug(`Found ${tagName} for ${normalizedUrl}: "${tagContent}"`);
    return tagContent;
  }

  /**
   * Add delay to avoid overwhelming servers
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if AI suggestion was implemented (exact or similar match)
   */
  checkIfAISuggestionImplemented(currentContent, aiSuggestion) {
    if (!currentContent || !aiSuggestion) {
      return false;
    }

    // Normalize strings for comparison (remove extra spaces, case insensitive)
    const normalizedCurrent = currentContent.trim().toLowerCase();
    const normalizedAI = aiSuggestion.trim().toLowerCase();
    
    // Exact match
    if (normalizedCurrent === normalizedAI) {
      return true;
    }
    
    // High similarity match (90% similar)
    const similarity = this.calculateStringSimilarity(normalizedCurrent, normalizedAI);
    return similarity >= 0.9;
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
   * Generate CSV report using clean format
   */
  generateCSV() {
    const filename = writeMetatagsCSV(this.results, this.options.siteId, this.site?.getBaseURL() || 'Unknown Site');
    this.log.info(`✓ Comprehensive metatags CSV report generated: ${filename}`);
    
    // Write error CSV if there are errors
    if (this.errors.length > 0) {
      writeErrorCSV(this.errors, 'metatags', this.options.siteId);
      this.log.info(`⚠️  ${this.errors.length} errors encountered during processing - see error CSV for details`);
    }
    
    return filename;
  }

  /**
   * Mark fixed suggestions in database
   * TODO: Implement actual database updates when ready
   */
  async markFixedSuggestions() {
    const fixedResults = this.results.filter(r => r.isFixedOverall);
    
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
   * Print summary using common utilities
   */
  printSummary() {
    const totalSuggestions = this.results.length;
    const fixedByAI = this.results.filter(r => r.aiSuggestionImplemented).length;
    const fixedOverall = this.results.filter(r => r.isFixedOverall).length;
    
    this.log.info('');
    this.log.info('=== SUMMARY ===');
    this.log.info(`Total suggestions processed: ${totalSuggestions}`);
    this.log.info(`AI Suggestions Taken: ${fixedByAI}`);
    this.log.info(`Fixed overall: ${fixedOverall}`);
    this.log.info(`Not fixed: ${totalSuggestions - fixedOverall}`);
    
    if (fixedOverall > 0) {
      this.log.info('');
      this.log.info('Fixed issues by tag type:');
      const fixedByType = {};
      const fixedDuplicates = {};
      
      this.results.filter(r => r.isFixedOverall).forEach(r => {
        const key = r.tagName;
        fixedByType[key] = (fixedByType[key] || 0) + 1;
        
        // Track duplicate fixes specifically
        if (r.issue && r.issue.toLowerCase().includes('duplicate')) {
          fixedDuplicates[key] = (fixedDuplicates[key] || 0) + 1;
        }
      });
      
      Object.entries(fixedByType).forEach(([type, count]) => {
        this.log.info(`  ${type}: ${count}`);
      });
      
      // Show duplicate-specific summary
      const totalDuplicatesFixed = Object.values(fixedDuplicates).reduce((sum, count) => sum + count, 0);
      if (totalDuplicatesFixed > 0) {
        this.log.info('');
        this.log.info('Fixed duplicate issues:');
        Object.entries(fixedDuplicates).forEach(([type, count]) => {
          this.log.info(`  Duplicate ${type}: ${count} pages`);
        });
        this.log.info(`  Total duplicate issues resolved: ${totalDuplicatesFixed}`);
      }
    }
  }
}

// CLI setup
program
  .name('check-metatags-fixed')
  .description('Check which meta-tags suggestions have been fixed by comparing with current audit')
  .option('--siteId <id>', 'Site ID to check (defaults to test site)')
  .option('--allSites', 'Process all configured sites', false)
  .option('--sites <ids...>', 'Specific site IDs to process (space-separated)')
  .option('--markFixed', 'Mark fixed suggestions in database', false)
  .option('--dryRun', 'Show what would be marked without making changes', false)
  .option('--verbose', 'Detailed logging', false)
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
  // Default site ID for testing
  options.siteId = '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3';
  const defaultSite = SITES.find(s => s.id === options.siteId);
  sitesToProcess = [defaultSite];
  console.log(`[INFO] Using default site ID: ${options.siteId}`);
}

// Process sites
async function processSites() {
  const allResults = [];
  const allErrors = [];
  
  for (let i = 0; i < sitesToProcess.length; i++) {
    const site = sitesToProcess[i];
    
    try {
      console.log(`\n[INFO] Processing site ${i + 1}/${sitesToProcess.length}: ${site.name} (${site.id})`);
      
      // Create checker for this site
      const siteOptions = { ...options, siteId: site.id };
      const checker = new MetaTagsFixChecker(siteOptions);
      
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
        
        // Collect errors from this checker
        if (checker.errors && checker.errors.length > 0) {
          allErrors.push(...checker.errors);
        }
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
      
      // Log site-level error to consolidated error tracking
      const siteError = {
        timestamp: new Date().toISOString(),
        scriptName: 'check-metatags-fixed',
        siteId: site.id,
        siteName: site.name,
        errorType: 'SITE_PROCESSING_ERROR',
        errorMessage: `Failed to process site: ${error.message}`,
        errorDetails: error.stack || '',
        suggestionId: '',
        opportunityId: '',
        url: '',
        stackTrace: error.stack || ''
      };
      
      allErrors.push(siteError);
      continue;
    }
  }
  
  // Generate consolidated CSV if requested
  if (options.consolidate && sitesToProcess.length > 1 && allResults.length > 0) {
    generateConsolidatedCSV(allResults);
  }
  
  // Generate consolidated error CSV if there are errors
  if (allErrors.length > 0) {
    writeErrorCSV(allErrors, 'metatags', 'ALL_SITES');
    console.log(`[ERROR] Total errors across all sites: ${allErrors.length} - see consolidated error CSV for details`);
  }
}

// Generate consolidated CSV for multiple sites
function generateConsolidatedCSV(allResults) {
  if (allResults.length === 0) {
    console.log('📊 No results to consolidate');
    return;
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `consolidated-metatags-all-sites-${timestamp}Z.csv`;
  
  // Generate CSV with proper site info from each result
  // Each result already has the correct siteId and siteName, so just pass them through
  const csvRows = allResults.map(result => formatMetatagsResult(result, result.siteId, result.siteName));
  const csvContent = [
    METATAGS_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
  
  writeFileSync(filename, csvContent);
  console.log(`📊 Consolidated metatags CSV generated: ${filename} (${allResults.length} total results)`);
}

// Run the processing
processSites().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
