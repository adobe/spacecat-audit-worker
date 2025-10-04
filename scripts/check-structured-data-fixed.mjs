#!/usr/bin/env node

/**
 * Structured Data Fix Checker
 * 
 * Compares existing structured data suggestions with current S3 scraped data to identify fixed issues.
 * Uses the same logic as the structured data handler for validation.
 */

import { program } from 'commander';
import { createDataAccess, Audit } from '@adobe/spacecat-shared-data-access';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SITES } from './constants.js';
import { 
  writeStructuredDataCSV,
  writeErrorCSV
} from './csv-utils.js';
import dotenv from 'dotenv';

dotenv.config();

const auditType = Audit.AUDIT_TYPES.STRUCTURED_DATA;

class StructuredDataFixChecker {
  constructor(options = {}) {
    this.options = { siteId: null, verbose: false, limit: null, ...options };
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

  validateJsonLD(structuredData) {
    if (!structuredData || typeof structuredData !== 'object') {
      return { valid: false, issues: ['No structured data found'] };
    }

    const issues = [];
    
    // Basic JSON-LD validation
    if (Array.isArray(structuredData)) {
      for (const item of structuredData) {
        if (!item['@type']) issues.push('Missing @type in JSON-LD item');
        if (!item['@context'] && !structuredData.some(i => i['@context'])) {
          issues.push('Missing @context in JSON-LD');
        }
      }
    } else if (structuredData['@graph']) {
      if (!structuredData['@context']) issues.push('Missing @context in JSON-LD graph');
      for (const item of structuredData['@graph']) {
        if (!item['@type']) issues.push('Missing @type in JSON-LD graph item');
      }
    } else {
      if (!structuredData['@type']) issues.push('Missing @type in JSON-LD');
      if (!structuredData['@context']) issues.push('Missing @context in JSON-LD');
    }

    return { valid: issues.length === 0, issues };
  }

  compareWithAISuggestions(currentData, suggestionErrors) {
    if (!currentData || !suggestionErrors || suggestionErrors.length === 0) {
      return {
        isFixed: false, aiSuggestionImplemented: false, fixType: 'NOT_FIXED',
        details: 'No current data or suggestions to compare'
      };
    }

    const validation = this.validateJsonLD(currentData);
    
    if (!validation.valid) {
      return {
        isFixed: false, aiSuggestionImplemented: false, fixType: 'STILL_HAS_ISSUES',
        details: `Validation issues: ${validation.issues.join(', ')}`
      };
    }

    return {
      isFixed: true, aiSuggestionImplemented: false, fixType: 'SCHEMA_FIXED',
      details: 'JSON-LD structure is now valid'
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
        this.log.debug(`Suggestion ${suggestion.getId()} data:`, JSON.stringify(suggestionData, null, 2));
        
        if (!suggestionData?.url) {
          this.logError('Invalid suggestion data', new Error(`Missing URL. Data: ${JSON.stringify(suggestionData)}`), suggestion.getId());
          
          // Create an error result instead of skipping
          results.push({
            siteId: this.options.siteId,
            siteName: this.site?.name || 'Unknown',
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
        const errors = suggestionData.errors || [];
        
        // Get current structured data from S3
        const currentStructuredData = await this.getCurrentStructuredData(pageUrl);
        const comparison = this.compareWithAISuggestions(currentStructuredData, errors);
        
        // Extract AI suggestion details
        let suggestedFix = '', aiRationale = '', confidenceScore = 0, errorDescription = '';
        
        if (errors.length > 0) {
          const firstError = errors[0];
          errorDescription = firstError.errorTitle || 'Structured data issue';
          
          if (firstError.fix) {
            // Extract just the error description, not the full HTML markup
            const fixMatch = firstError.fix.match(/## Issue Detected for (.+?)\n(.+?)(?:\n##|$)/);
            if (fixMatch) {
              suggestedFix = `${fixMatch[1]}: ${fixMatch[2]}`;
            } else {
              // Fallback: take first line of fix description
              const firstLine = firstError.fix.split('\n').find(line => line.trim() && !line.startsWith('#'));
              suggestedFix = firstLine ? firstLine.trim() : 'Schema validation issue';
            }
            
            const rationaleMatch = firstError.fix.match(/AI Rationale:\s*(.+?)(?:\n|$)/);
            if (rationaleMatch) aiRationale = rationaleMatch[1].trim();
            
            const scoreMatch = firstError.fix.match(/Confidence:\s*(\d+)%/);
            if (scoreMatch) confidenceScore = parseInt(scoreMatch[1]);
          }
        }

        const result = {
          siteId: this.options.siteId,
          siteName: this.site?.name || 'Unknown',
          opportunityId: suggestion.getOpportunityId(),
          opportunityStatus: opportunityData.status || 'UNKNOWN',
          suggestionId: suggestion.getId(),
          suggestionType: suggestion.getType(),
          suggestionStatus: suggestion.getStatus(),
          suggestionRank: suggestion.getRank() || 0,
          url: pageUrl,  // Fixed: was pageUrl, should be url
          errorId: errors.length > 0 ? errors[0].id || 'unknown' : 'unknown',  // Fixed: was errorType
          errorTitle: errorDescription,  // Fixed: was errorDescription
          totalJsonLdBlocks: Array.isArray(currentStructuredData) ? currentStructuredData.length : (currentStructuredData ? 1 : 0),  // Added
          validJsonLdBlocks: Array.isArray(currentStructuredData) ? currentStructuredData.filter(item => item && typeof item === 'object').length : (currentStructuredData && typeof currentStructuredData === 'object' ? 1 : 0),  // Added
          schemaTypes: Array.isArray(currentStructuredData) ? currentStructuredData.map(item => item['@type']).filter(Boolean).join(', ') : (currentStructuredData && currentStructuredData['@type'] ? currentStructuredData['@type'] : ''),  // Added
          completenessScore: confidenceScore,  // Fixed: was confidenceScore
          aiSuggestionFix: suggestedFix.substring(0, 500),  // Fixed: was suggestedFix
          bestSimilarity: comparison.similarity || 0,  // Added
          hasValidSchema: Array.isArray(currentStructuredData) ? currentStructuredData.length > 0 : !!currentStructuredData,  // Added
          aiSuggestionImplemented: comparison.aiSuggestionImplemented,
          isFixed: comparison.isFixed,
          fixType: comparison.fixType,
          opportunityCreated: opportunityData.createdAt || '',
          opportunityUpdated: opportunityData.updatedAt || '',
          suggestionCreated: suggestion.getCreatedAt() || '',
          suggestionUpdated: suggestion.getUpdatedAt() || '',
          updatedBy: 'system',
          testDate: new Date().toISOString()
        };

        results.push(result);
        processed++;

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
          siteName: this.site?.name || 'Unknown',
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

  async run() {
    try {
      this.log.info('=== STRUCTURED DATA FIX CHECKER ===');
      
      this.site = SITES.find(s => s.id === this.options.siteId);
      if (!this.site) throw new Error(`Site ID ${this.options.siteId} not found`);

      await this.initializeDataAccess();
      const suggestions = await this.getExistingSuggestions(this.options.siteId);
      
      if (suggestions.length === 0) {
        this.log.info('No structured data suggestions found');
        return;
      }

      const results = await this.checkSuggestionsFixes(suggestions);
      const filename = this.generateCSV(results);
      this.printSummary(results);
      
      this.log.info(`🎉 Complete! Results: ${filename}`);
      
    } catch (error) {
      this.logError('Main execution', error);
      this.log.error('❌ Failed:', error.message);
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
  .option('--limit <number>', 'Limit number of suggestions to process', parseInt);

program.parse();
const options = program.opts();

const site = SITES.find(s => s.id === options.siteId);
if (!site) {
  console.error(`❌ Site ID '${options.siteId}' not found in constants.js`);
  process.exit(1);
}

const checker = new StructuredDataFixChecker(options);
checker.run();