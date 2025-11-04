#!/usr/bin/env node

/**
 * Structured Data Fix Checker
 * 
 * Compares existing structured data suggestions with current S3 scraped data to identify fixed issues.
 * Uses the SAME validation logic as the structured data handler (getIssuesFromScraper).
 * 
 * Process:
 * 1. Find all OUTDATED structured-data suggestions
 * 2. Fetch current page from S3 scraper bucket
 * 3. Run the SAME audit checks as handler.js (using getIssuesFromScraper)
 * 4. Compare original errors with current issues
 * 5. Categorize as:
 *    - AI_SUGGESTION_IMPLEMENTED: AI's suggested fix was implemented exactly
 *    - FIXED_BY_OTHER_MEANS: Issue no longer detected (fixed differently)
 *    - NOT_FIXED: Issue still exists
 *    - PAGE_NOT_AVAILABLE: Cannot verify
 */

import { program } from 'commander';
import { createDataAccess, Audit } from '@adobe/spacecat-shared-data-access';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { 
  writeStructuredDataCSV,
  writeErrorCSV
} from '../../csv-utils.js';
import { createFixEntityForSuggestion } from '../../create-fix-entity.js';
import dotenv from 'dotenv';

// Import the SAME validation functions as the handler
import { 
  getIssuesFromScraper 
} from '../../../src/structured-data/lib.js';

dotenv.config();

const auditType = Audit.AUDIT_TYPES.STRUCTURED_DATA;

class StructuredDataFixChecker {
  constructor(options = {}) {
    this.options = { siteId: null, verbose: false, limit: null, markFixed: false, dryRun: true, ...options };
    this.log = this.createSimpleLogger(this.options.verbose);
    this.dataAccess = null;
    this.site = null;
    this.errors = [];
    this.s3Client = new S3Client({ region: 'us-east-1' });
    
    // Set default environment variables
    if (!process.env.DYNAMO_TABLE_NAME_DATA) {
      process.env.DYNAMO_TABLE_NAME_DATA = 'spacecat-services-all-sites';
    }
    if (!process.env.S3_SCRAPER_BUCKET_NAME) {
      process.env.S3_SCRAPER_BUCKET_NAME = 'spacecat-prod-scraper';
    }
  }

  createSimpleLogger(verbose = false) {
    return {
      info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
      warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
      error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
      debug: verbose ? (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args) : () => {}
    };
  }

  logError(context, error, suggestionId = null) {
    const errorEntry = {
      context, error: error.message || error, stack: error.stack,
      suggestionId, timestamp: new Date().toISOString()
    };
    this.errors.push(errorEntry);
    this.log.error(`${context}: ${error.message || error}`);
  }

  async initializeDataAccess() {
    try {
      const config = {
        tableNameData: process.env.DYNAMO_TABLE_NAME_DATA,
        indexNameAllByStatus: process.env.DYNAMO_INDEX_ALL_BY_STATUS || 'spacecat-services-all-sites-gsi1pk-gsi1sk-index',
        indexNameAllBySiteId: process.env.DYNAMO_INDEX_ALL_BY_SITE_ID || 'spacecat-services-all-sites-gsi2pk-gsi2sk-index'
      };
      this.dataAccess = createDataAccess(config);
      
      // Load site object (needed for validation context)
      this.site = await this.dataAccess.Site.findById(this.options.siteId);
      if (!this.site) {
        throw new Error(`Site not found in database: ${this.options.siteId}`);
      }
      
      this.log.info(`Loaded site: ${this.site.baseURL} (${this.site.getId()})`);
    } catch (error) {
      this.logError('Data access initialization', error);
      throw error;
    }
  }

  async getExistingSuggestions(siteId) {
    try {
      const { Opportunity, Suggestion } = this.dataAccess;
      
      // Get all opportunities for this site
      const allOpportunities = await Opportunity.allBySiteId(siteId);
      
      // Filter for structured-data opportunities  
      const opportunities = allOpportunities.filter(
        (opportunity) => opportunity.getType() === 'structured-data'
      );
      
      this.log.info(`Found ${opportunities.length} structured-data opportunities for site ${siteId}`);
      
      if (opportunities.length === 0) return [];

      // Build opportunity data map
      const opportunityDataMap = {};
      for (const opportunity of opportunities) {
        opportunityDataMap[opportunity.getId()] = {
          status: opportunity.getStatus(),
          createdAt: opportunity.getCreatedAt(),
          updatedAt: opportunity.getUpdatedAt()
        };
      }
      this.opportunityDataMap = opportunityDataMap;

      // Get all suggestions (outdated + fixed)
      const allSuggestions = [];
      for (const opportunity of opportunities) {
        const opptyId = opportunity.getId();
        const [outdatedSuggestions, fixedSuggestions] = await Promise.all([
          Suggestion.allByOpportunityIdAndStatus(opptyId, 'outdated'),
          Suggestion.allByOpportunityIdAndStatus(opptyId, 'fixed')
        ]);
        allSuggestions.push(...outdatedSuggestions, ...fixedSuggestions);
      }

      this.log.info(`Found ${allSuggestions.length} structured data suggestions`);
      return allSuggestions;
      
    } catch (error) {
      this.logError('Fetching existing suggestions', error);
      throw error;
    }
  }

  async getCurrentStructuredData(pageUrl) {
    try {
      const scrapeJsonPath = this.getScrapeJsonPath(pageUrl);
      const command = new GetObjectCommand({
        Bucket: 'spacecat-prod-scraper',
        Key: scrapeJsonPath
      });
      
      const response = await this.s3Client.send(command);
      const content = await response.Body.transformToString();
      const scrapeData = JSON.parse(content);
      
      // Structured data is in scrapeResult.structuredData
      return scrapeData.scrapeResult?.structuredData || null;
      
    } catch (error) {
      this.log.debug(`Failed to fetch structured data for ${pageUrl}: ${error.message}`);
      return null;
    }
  }

  getScrapeJsonPath(url) {
    const pathname = new URL(url).pathname.replace(/\/$/, '');
    return `scrapes/${this.options.siteId}${pathname}/scrape.json`;
  }

  /**
   * Use the SAME validation logic as handler.js
   * This runs getIssuesFromScraper on the current page data
   */
  async getCurrentIssues(pageUrl, currentStructuredData) {
    try {
      // Create a mock scrape cache with the current data
      let { pathname } = new URL(pageUrl);
      if (pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      
      const scrapeCache = new Map();
      scrapeCache.set(pathname, Promise.resolve({
        scrapeResult: {
          structuredData: currentStructuredData
        }
      }));

      // Create context matching handler requirements
      const mockContext = {
        log: this.log,
        site: this.site,
      };

      // Run the SAME validation as handler.js
      const issues = await getIssuesFromScraper(
        mockContext,
        [{ url: pageUrl }],
        scrapeCache
      );

      return issues;
      
    } catch (error) {
      this.log.debug(`Error running validation for ${pageUrl}: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if AI's suggested fix was implemented
   * Compares the AI's correctedMarkup with current structured data
   */
  checkAISuggestionImplemented(originalErrors, currentStructuredData) {
    if (!originalErrors || originalErrors.length === 0 || !currentStructuredData) {
      return false;
    }

    // Check each original error for AI suggestion
    for (const error of originalErrors) {
      if (!error.fix) continue;
      
      // Extract AI suggestion details from the fix markdown
      const correctedMarkupMatch = error.fix.match(/```json\n([\s\S]+?)\n```/);
      if (!correctedMarkupMatch) continue;
      
      try {
        const aiSuggestedMarkup = JSON.parse(correctedMarkupMatch[1]);
        
        // Deep comparison of AI suggestion with current data
        const currentDataNormalized = JSON.stringify(currentStructuredData, null, 2);
        const aiSuggestionNormalized = JSON.stringify(aiSuggestedMarkup, null, 2);
        
        if (currentDataNormalized === aiSuggestionNormalized) {
          return true;
        }
      } catch (e) {
        // Continue checking other errors if parsing fails
        continue;
      }
    }
    
    return false;
  }

  /**
   * Compare original suggestion errors with current issues
   * Returns fix status and type
   */
  async compareWithOriginalErrors(pageUrl, originalErrors, currentStructuredData) {
    if (!originalErrors || originalErrors.length === 0) {
      return {
        isFixed: false,
        aiSuggestionImplemented: false,
        fixType: 'NO_ORIGINAL_ERRORS',
        details: 'No original errors to compare'
      };
    }

    // If no current structured data, issue cannot be fixed
    if (!currentStructuredData) {
      return {
        isFixed: false,
        aiSuggestionImplemented: false,
        fixType: 'NO_STRUCTURED_DATA',
        details: 'No structured data found on page'
      };
    }

    // Run the SAME validation as handler.js
    const currentIssues = await this.getCurrentIssues(pageUrl, currentStructuredData);
    
    // Check if AI suggestion was implemented exactly
    const aiImplemented = this.checkAISuggestionImplemented(originalErrors, currentStructuredData);
    
    if (aiImplemented) {
      return {
        isFixed: true,
        aiSuggestionImplemented: true,
        fixType: 'AI_SUGGESTION_IMPLEMENTED',
        details: 'AI suggested markup matches current structured data'
      };
    }

    // Check if original errors still exist
    const stillHasIssues = originalErrors.some(originalError => {
      const errorTitle = originalError.errorTitle || '';
      
      return currentIssues.some(currentIssue => {
        // Match based on error message and root type
        const issueMessage = currentIssue.issueMessage || '';
        const rootTypeMatch = originalError.errorTitle?.includes(currentIssue.rootType);
        
        return errorTitle.includes(issueMessage) || rootTypeMatch;
      });
    });

    if (!stillHasIssues && currentIssues.length === 0) {
      // No issues found - fixed by some means
      return {
        isFixed: true,
        aiSuggestionImplemented: false,
        fixType: 'FIXED_BY_OTHER_MEANS',
        details: 'Original issue no longer detected by validation'
      };
    }

    // Issues still exist
    return {
      isFixed: false,
      aiSuggestionImplemented: false,
      fixType: 'NOT_FIXED',
      details: `Still has ${currentIssues.length} validation issue(s)`
    };
  }

  async checkSuggestionsFixes(suggestions) {
    const results = [];
    let processed = 0;

    for (const suggestion of suggestions) {
      try {
        const suggestionData = suggestion.getData();
        const opportunityData = this.opportunityDataMap[suggestion.getOpportunityId()] || {};
        
        // Debug: Log the actual suggestion data structure
        this.log.debug(`Processing suggestion ${suggestion.getId()}`);
        
        if (!suggestionData?.url) {
          this.logError('Invalid suggestion data', new Error(`Missing URL. Data: ${JSON.stringify(suggestionData)}`), suggestion.getId());
          
          // Create an error result instead of skipping
          results.push({
            siteId: this.options.siteId,
            siteName: this.site?.baseURL || 'Unknown',
            opportunityId: suggestion.getOpportunityId(),
            opportunityStatus: opportunityData.status || 'UNKNOWN',
            suggestionId: suggestion.getId(),
            suggestionType: suggestion.getType(),
            suggestionStatus: suggestion.getStatus(),
            suggestionRank: suggestion.getRank() || 0,
            url: 'ERROR: Missing URL',
            errorId: 'missing-url',
            errorTitle: 'Missing URL in suggestion data',
            totalJsonLdBlocks: 0,
            validJsonLdBlocks: 0,
            schemaTypes: '',
            currentJsonLdContent: 'ERROR: Cannot fetch without URL',
            completenessScore: 0,
            aiSuggestionFix: 'ERROR: Cannot process without URL',
            bestSimilarity: 0,
            hasValidSchema: false,
            aiSuggestionImplemented: false,
            isFixed: false,
            fixType: 'ERROR_MISSING_URL',
            opportunityCreated: opportunityData.createdAt || '',
            opportunityUpdated: opportunityData.updatedAt || '',
            suggestionCreated: suggestion.getCreatedAt?.() || suggestion.createdAt || '',
            suggestionUpdated: suggestion.getUpdatedAt?.() || suggestion.updatedAt || '',
            updatedBy: suggestion.getUpdatedBy?.() || suggestion.updatedBy || '',
            testDate: new Date().toISOString()
          });
          continue;
        }

        const pageUrl = suggestionData.url;
        const originalErrors = suggestionData.errors || [];
        
        // Get current structured data from S3
        const currentStructuredData = await this.getCurrentStructuredData(pageUrl);
        
        // Use the SAME validation logic as handler.js
        const comparison = await this.compareWithOriginalErrors(pageUrl, originalErrors, currentStructuredData);
        
        // Extract original error details for reporting
        let errorDescription = '', suggestedFix = '', confidenceScore = 0;
        
        if (originalErrors.length > 0) {
          const firstError = originalErrors[0];
          errorDescription = firstError.errorTitle || 'Structured data issue';
          
          if (firstError.fix) {
            // Extract error description
            const issueMatch = firstError.fix.match(/## Issue Detected for (.+?)\n(.+?)(?:\n##|$)/);
            if (issueMatch) {
              suggestedFix = `${issueMatch[1]}: ${issueMatch[2]}`;
            } else {
              // Extract from corrected markup section
              const firstLine = firstError.fix.split('\n').find(line => line.trim() && !line.startsWith('#'));
              suggestedFix = firstLine ? firstLine.trim() : 'Schema validation issue';
            }
            
            // Extract confidence score if available
            const scoreMatch = firstError.fix.match(/Confidence score:\s*(\d+)%/);
            if (scoreMatch) confidenceScore = parseInt(scoreMatch[1]);
          }
        }

        // Extract schema types from current data
        let schemaTypes = '';
        if (currentStructuredData) {
          if (Array.isArray(currentStructuredData)) {
            schemaTypes = currentStructuredData.map(item => item?.['@type']).filter(Boolean).join(', ');
          } else if (currentStructuredData['@type']) {
            schemaTypes = currentStructuredData['@type'];
          } else if (currentStructuredData.jsonld) {
            // Handle new scraper format
            const jsonldData = Object.values(currentStructuredData.jsonld || {}).flat();
            schemaTypes = jsonldData.map(item => item?.['@type']).filter(Boolean).join(', ');
          }
        }

        const result = {
          siteId: this.options.siteId,
          siteName: this.site?.baseURL || 'Unknown',
          opportunityId: suggestion.getOpportunityId(),
          opportunityStatus: opportunityData.status || 'UNKNOWN',
          suggestionId: suggestion.getId(),
          suggestionType: suggestion.getType(),
          suggestionStatus: suggestion.getStatus(),
          suggestionRank: suggestion.getRank() || 0,
          url: pageUrl,
          errorId: originalErrors.length > 0 ? originalErrors[0].id || 'unknown' : 'unknown',
          errorTitle: errorDescription,
          totalJsonLdBlocks: Array.isArray(currentStructuredData) ? currentStructuredData.length : (currentStructuredData ? 1 : 0),
          validJsonLdBlocks: Array.isArray(currentStructuredData) ? currentStructuredData.filter(item => item && typeof item === 'object').length : (currentStructuredData && typeof currentStructuredData === 'object' ? 1 : 0),
          schemaTypes: schemaTypes,
          currentJsonLdContent: currentStructuredData ? JSON.stringify(currentStructuredData).substring(0, 1000) : 'No structured data found',
          completenessScore: confidenceScore,
          aiSuggestionFix: suggestedFix.substring(0, 500),
          bestSimilarity: 0, // Not used for structured data
          hasValidSchema: !!currentStructuredData,
          aiSuggestionImplemented: comparison.aiSuggestionImplemented,
          isFixed: comparison.isFixed,
          fixType: comparison.fixType,
          opportunityCreated: opportunityData.createdAt || '',
          opportunityUpdated: opportunityData.updatedAt || '',
          suggestionCreated: suggestion.getCreatedAt() || '',
          suggestionUpdated: suggestion.getUpdatedAt() || '',
          updatedBy: 'system',
          testDate: new Date().toISOString(),
          suggestion: suggestion // Store suggestion reference for fix entity creation
        };

        results.push(result);
        processed++;
        
        // Log progress
        if (comparison.isFixed) {
          if (comparison.aiSuggestionImplemented) {
            this.log.info(`✅ AI_SUGGESTION_IMPLEMENTED: ${pageUrl}`);
          } else {
            this.log.info(`✅ FIXED_BY_OTHER_MEANS: ${pageUrl}`);
          }
        } else {
          this.log.debug(`❌ ${comparison.fixType}: ${pageUrl}`);
        }

        if (this.options.limit && processed >= this.options.limit) {
          this.log.info(`Reached limit of ${this.options.limit} suggestions`);
          break;
        }

      } catch (error) {
        this.logError(`Processing suggestion ${suggestion.getId()}`, error, suggestion.getId());
        
        // Create an error result instead of skipping
        const opportunityData = this.opportunityDataMap[suggestion.getOpportunityId()] || {};
        results.push({
          siteId: this.options.siteId,
          siteName: this.site?.baseURL || 'Unknown',
          opportunityId: suggestion.getOpportunityId(),
          opportunityStatus: opportunityData.status || 'UNKNOWN',
          suggestionId: suggestion.getId(),
          suggestionType: suggestion.getType(),
          suggestionStatus: suggestion.getStatus(),
          suggestionRank: suggestion.getRank() || 0,
          url: 'ERROR: Processing failed',
          errorId: 'processing-error',
          errorTitle: `Processing error: ${error.message}`,
          totalJsonLdBlocks: 0,
          validJsonLdBlocks: 0,
          schemaTypes: '',
          completenessScore: 0,
          aiSuggestionFix: `ERROR: ${error.message}`,
          bestSimilarity: 0,
          hasValidSchema: false,
          aiSuggestionImplemented: false,
          isFixed: false,
          fixType: 'ERROR_PROCESSING',
          opportunityCreated: opportunityData.createdAt || '',
          opportunityUpdated: opportunityData.updatedAt || '',
          suggestionCreated: suggestion.getCreatedAt?.() || suggestion.createdAt || '',
          suggestionUpdated: suggestion.getUpdatedAt?.() || suggestion.updatedAt || '',
          updatedBy: suggestion.getUpdatedBy?.() || suggestion.updatedBy || '',
          testDate: new Date().toISOString()
        });
      }
    }

    return results;
  }

  generateCSV(results) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    const filename = writeStructuredDataCSV(results, this.options.siteId, this.site?.name || 'Unknown');
    
    if (this.errors.length > 0) {
      writeErrorCSV(this.errors, 'structured-data', this.options.siteId);
    }
    
    return filename;
  }

  printSummary(results) {
    const summary = results.reduce((acc, result) => {
      acc.total++;
      if (result.isFixed) acc.fixed++;
      if (result.aiSuggestionImplemented) acc.aiImplemented++;
      acc.fixTypes[result.fixType] = (acc.fixTypes[result.fixType] || 0) + 1;
      return acc;
    }, { total: 0, fixed: 0, aiImplemented: 0, fixTypes: {} });

    this.log.info('\n=== STRUCTURED DATA FIX SUMMARY ===');
    this.log.info(`📊 Total: ${summary.total}, ✅ Fixed: ${summary.fixed}, 🤖 AI: ${summary.aiImplemented}`);
    this.log.info('Fix Types:', summary.fixTypes);
  }

  async markFixedSuggestions() {
    const fixedResults = this.results.filter(r => r.isFixed);
    
    if (fixedResults.length === 0) {
      this.log.info('No suggestions to mark as fixed');
      return;
    }

    this.log.info(`Creating fix entities for ${fixedResults.length} fixed suggestions`);

    for (const result of fixedResults) {
      if (this.options.dryRun) {
        this.log.info(`Would create fix entity for ${result.suggestionId} (dry run)`);
      } else {
        try {
          // await createFixEntityForSuggestion(this.dataAccess, result.suggestion, { logger: this.log });
        } catch (error) {
          this.log.error(`Failed to create fix entity for ${result.suggestionId}: ${error.message}`);
        }
      }
    }
  }

  async run() {
    try {
      this.log.info('=== STRUCTURED DATA FIX CHECKER ===');
      this.log.info(`Site ID: ${this.options.siteId}`);
      
      await this.initializeDataAccess();
      const suggestions = await this.getExistingSuggestions(this.options.siteId);
      
      if (suggestions.length === 0) {
        this.log.info('No structured data suggestions found');
        return;
      }

      this.log.info(`Checking ${suggestions.length} suggestions using handler validation logic...`);
      const results = await this.checkSuggestionsFixes(suggestions);
      this.results = results; // Store results for markFixedSuggestions
      const filename = this.generateCSV(results);
      this.printSummary(results);
      
      if (this.options.markFixed && !this.options.dryRun) {
        await this.markFixedSuggestions();
      }
      
      this.log.info(`🎉 Complete! Results: ${filename}`);
      
    } catch (error) {
      this.logError('Main execution', error);
      this.log.error('❌ Failed:', error.message);
      if (this.options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }
}

// CLI Configuration
program
  .name('check-structured-data-fixed')
  .description('Check if structured data suggestions have been fixed')
  .requiredOption('--siteId <siteId>', 'Site ID to check')
  .option('--verbose', 'Enable verbose logging', false)
  .option('--limit <number>', 'Limit number of suggestions to process', parseInt)
  .option('--markFixed', 'Mark fixed suggestions in database', false)
  .option('--dryRun', 'Dry run mode (default: true)', true);

program.parse();
const options = program.opts();

// Validate required options
if (!options.siteId) {
  console.error('❌ Error: --siteId is required');
  process.exit(1);
}

const checker = new StructuredDataFixChecker(options);
checker.run();