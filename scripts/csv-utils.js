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

import { writeFileSync } from 'fs';

/**
 * Common CSV utilities for all audit fix checkers
 */

/**
 * Comprehensive Metatags Raw Data CSV headers (25 columns)
 */
export const METATAGS_CSV_HEADERS = [
  // Core Identity (5 columns)
  'Site ID',
  'Site Name',
  'Opportunity ID',
  'Opportunity Status',
  'Suggestion ID',
  
  // Suggestion Details (6 columns)
  'Suggestion Type',
  'Suggestion Status',
  'Suggestion Rank',
  'Tag Name',
  'Issue',
  'Issue Details',
  
  // Content Analysis (4 columns)
  'URL',
  'Original Content',
  'AI Suggestion',
  'Current Content',
  
  // Fix Detection Results (4 columns)
  'AI Suggestion Implemented',
  'Is Fixed Overall',
  'Fix Type',
  'Test Date',
  
  // Timestamps and Metadata (6 columns)
  'Opportunity Created',
  'Opportunity Updated',
  'Suggestion Created',
  'Suggestion Updated',
  'Updated By',
  'Recommended Action'
];

/**
 * Sitemap CSV headers (with status codes)
 */
export const SITEMAP_CSV_HEADERS = [
  'Site ID',
  'Site Name',
  'Opportunity ID',
  'Opportunity Status',
  'Suggestion ID',
  'Suggestion Type',
  'Suggestion Status',
  'Suggestion Rank',
  'Sitemap URL',
  'Page URL',
  'Original Status Code',
  'Current Status Code',
  'Suggested URLs',
  'Recommended Action',
  'AI Suggestion Implemented',
  'Is Fixed Overall',
  'Fix Type',
  'Test Date',
  'Opportunity Created',
  'Opportunity Updated',
  'Suggestion Created',
  'Suggestion Updated',
  'Updated By'
];

/**
 * Internal Links CSV headers (20 columns)
 */
export const INTERNAL_LINKS_CSV_HEADERS = [
  // Core Identity (5 columns)
  'Site ID',
  'Site Name',
  'Opportunity ID',
  'Opportunity Status',
  'Suggestion ID',
  
  // Suggestion Details (3 columns)
  'Suggestion Type',
  'Suggestion Status',
  'URL From',
  'URL To',
  
  // AI Recommendations (1 column)
  'URLs Suggested',
  
  // Fix Detection Results (4 columns)
  'Link Fixed',
  'AI Suggestion Implemented',
  'Fix Type',
  'Current Status Code',
  
  // Timestamps and Metadata (6 columns)
  'Opportunity Created',
  'Opportunity Updated',
  'Suggestion Created',
  'Suggestion Updated',
  'Updated By',
  'Test Date'
];

/**
 * CWV CSV headers (26 columns)
 */
export const CWV_CSV_HEADERS = [
  // Core Identity (5 columns)
  'Site ID',
  'Site Name',
  'Opportunity ID',
  'Opportunity Status',
  'Suggestion ID',
  
  // Suggestion Details (6 columns)
  'Suggestion Type',
  'Suggestion Status',
  'Suggestion Rank',
  'Entry Type',
  'URL or Pattern',
  'Pageviews',
  
  // Historical CWV Metrics (3 columns)
  'Old LCP (ms)',
  'Old CLS',
  'Old INP (ms)',
  
  // Current CWV Metrics (3 columns)
  'Current LCP (ms)',
  'Current CLS',
  'Current INP (ms)',
  
  // Performance Analysis (3 columns)
  'Metrics Improved',
  'Is Fixed',
  'Fix Type',
  
  // Timestamps and Metadata (6 columns)
  'Opportunity Created',
  'Opportunity Updated',
  'Suggestion Created',
  'Suggestion Updated',
  'Updated By',
  'Test Date'
];

/**
 * Alt-Text CSV headers (27 columns)
 */
export const ALT_TEXT_CSV_HEADERS = [
  // Core Identity (5 columns)
  'Site ID',
  'Site Name',
  'Opportunity ID',
  'Opportunity Status',
  'Suggestion ID',
  
  // Suggestion Details (6 columns)
  'Suggestion Type',
  'Suggestion Status',
  'Suggestion Rank',
  'Image ID',
  'Page URL',
  'Image URL',
  
  // Image Analysis (5 columns)
  'XPath',
  'Match Method',
  'Is Decorative',
  'Is Appropriate',
  'Language',
  
  // Alt Text Comparison (4 columns)
  'Suggested Alt Text',
  'Current Alt Text',
  'Similarity',
  'AI Suggestion Implemented',
  
  // Fix Detection Results (2 columns)
  'Is Fixed',
  'Fix Type',
  
  // Timestamps and Metadata (4 columns)
  'Opportunity Created',
  'Opportunity Updated',
  'Suggestion Created',
  'Suggestion Updated',
  'Updated By',
  'Test Date'
];

/**
 * Broken Backlinks CSV headers (24 columns - removed Final Status Code)
 */
export const BROKEN_BACKLINKS_CSV_HEADERS = [
  // Core Identity (5 columns)
  'Site ID',
  'Site Name',
  'Opportunity ID',
  'Opportunity Status',
  'Suggestion ID',
  
  // Suggestion Details (6 columns)
  'Suggestion Type',
  'Suggestion Status',
  'Suggestion Rank',
  'Title',
  'URL From',
  'URL To',
  
  // Traffic Analysis (2 columns)
  'Traffic Domain',
  'URLs Suggested',
  
  // Fix Detection Results (4 columns)
  'Redirect Implemented',
  'AI Suggestion Implemented',
  'Is Fixed',
  'Fix Type',
  
  // Current Status (1 column - removed Final Status Code)
  'Final URL',
  
  // Timestamps and Metadata (6 columns)
  'Opportunity Created',
  'Opportunity Updated',
  'Suggestion Created',
  'Suggestion Updated',
  'Updated By',
  'Test Date'
];

/**
 * Structured Data CSV headers (27 columns)
 */
export const STRUCTURED_DATA_CSV_HEADERS = [
  // Core Identity (5 columns)
  'Site ID',
  'Site Name',
  'Opportunity ID',
  'Opportunity Status',
  'Suggestion ID',
  
  // Suggestion Details (6 columns)
  'Suggestion Type',
  'Suggestion Status',
  'Suggestion Rank',
  'URL',
  'Error ID',
  'Error Title',
  
  // Schema Analysis (6 columns)
  'Total JSON-LD Blocks',
  'Valid JSON-LD Blocks',
  'Schema Types',
  'Completeness Score',
  'AI Suggestion Fix',
  'Best Similarity',
  
  // Fix Detection Results (4 columns)
  'Has Valid Schema',
  'AI Suggestion Implemented',
  'Is Fixed',
  'Fix Type',
  
  // Timestamps and Metadata (6 columns)
  'Opportunity Created',
  'Opportunity Updated',
  'Suggestion Created',
  'Suggestion Updated',
  'Updated By',
  'Test Date'
];

/**
 * Format metatags result for comprehensive raw data CSV (25 columns)
 */
export function formatMetatagsResult(result, siteId, siteName) {
  const testDate = new Date().toISOString();
  
  return [
    // Core Identity (5 columns) - SAFE DEFAULTS TO PREVENT COLUMN MISALIGNMENT
    siteId || result.siteId || 'MISSING_SITE_ID',
    `"${siteName || result.siteName || 'MISSING_SITE_NAME'}"`,
    result.opportunityId || 'MISSING_OPPORTUNITY_ID',
    result.opportunityStatus || 'MISSING_OPPORTUNITY_STATUS',
    result.suggestionId || 'MISSING_SUGGESTION_ID',
    
    // Suggestion Details (6 columns) - SAFE DEFAULTS
    result.suggestionType || 'MISSING_SUGGESTION_TYPE',
    result.suggestionStatus || 'MISSING_SUGGESTION_STATUS',
    result.suggestionRank !== undefined ? result.suggestionRank : 'MISSING_RANK',
    result.tagName || 'MISSING_TAG_NAME',
    `"${result.issue || 'MISSING_ISSUE'}"`,
    `"${result.issueDetails || result.issue || 'MISSING_ISSUE_DETAILS'}"`,
    
    // Content Analysis (4 columns) - SAFE DEFAULTS
    result.url || 'MISSING_URL',
    `"${result.originalContent || 'MISSING_ORIGINAL_CONTENT'}"`,
    `"${result.aiSuggestion || 'MISSING_AI_SUGGESTION'}"`,
    `"${result.currentContent || 'MISSING_CURRENT_CONTENT'}"`,
    
    // Fix Detection Results (4 columns) - SAFE BOOLEAN HANDLING
    result.aiSuggestionImplemented !== undefined ? (result.aiSuggestionImplemented ? 'YES' : 'NO') : 'UNKNOWN',
    result.isFixedOverall !== undefined ? (result.isFixedOverall ? 'YES' : 'NO') : 'UNKNOWN',
    result.fixType || result.fixMethod || 'MISSING_FIX_TYPE',
    testDate,
    
    // Timestamps and Metadata (6 columns) - SAFE DEFAULTS
    result.opportunityCreated || 'MISSING_OPPORTUNITY_CREATED',
    result.opportunityUpdated || 'MISSING_OPPORTUNITY_UPDATED',
    result.suggestionCreated || 'MISSING_SUGGESTION_CREATED',
    result.suggestionUpdated || 'MISSING_SUGGESTION_UPDATED',
    result.updatedBy || 'MISSING_UPDATED_BY',
    `"${result.recommendedAction || 'MISSING_RECOMMENDED_ACTION'}"`
  ];
}

/**
 * Format sitemap result for clean CSV (with status codes)
 */
export function formatSitemapResult(result, siteId, siteName) {
  const testDate = new Date().toISOString();
  
  return [
    siteId || '',
    `"${siteName || ''}"`,
    result.opportunityId || '',
    result.opportunityStatus || '',
    result.suggestionId || '',
    result.suggestionType || '',
    result.suggestionStatus || '',
    result.suggestionRank || '',
    `"${result.sitemapUrl || ''}"`,
    result.pageUrl || '',
    result.originalStatusCode || '',
    result.currentStatusCode || '',
    `"${result.urlsSuggested || ''}"`,
    `"${result.recommendedAction || ''}"`,
    result.redirectImplemented ? 'YES' : 'NO',
    result.isFixed ? 'YES' : 'NO',
    result.fixType || '',
    testDate,
    result.opportunityCreated || '',
    result.opportunityUpdated || '',
    result.suggestionCreated || '',
    result.suggestionUpdated || '',
    result.updatedBy || ''
  ];
}

/**
 * Format internal links result for comprehensive raw data CSV (20 columns)
 */
export function formatInternalLinksResult(result, siteId, siteName) {
  return [
    // Core Identity (5 columns)
    siteId || '',
    `"${siteName || ''}"`,
    result.opportunityId || '',
    result.opportunityStatus || '',
    result.suggestionId || '',
    
    // Suggestion Details (3 columns)
    result.suggestionType || '',
    result.suggestionStatus || '',
    result.urlFrom || '',
    result.urlTo || '',
    
    // AI Recommendations (1 column)
    `"${result.urlsSuggested || ''}"`,
    
    // Fix Detection Results (4 columns)
    result.linkFixed ? 'YES' : 'NO',
    result.aiSuggestionImplemented ? 'YES' : 'NO',
    result.fixType || '',
    result.currentStatusCode || '',
    
    // Timestamps and Metadata (6 columns)
    result.opportunityCreated || '',
    result.opportunityUpdated || '',
    result.suggestionCreated || '',
    result.suggestionUpdated || '',
    result.updatedBy || '',
    result.testDate || ''
  ];
}

/**
 * Format structured data result for comprehensive raw data CSV (27 columns)
 */
export function formatStructuredDataResult(result, siteId, siteName) {
  return [
    // Core Identity (5 columns)
    siteId || '',
    `"${siteName || ''}"`,
    result.opportunityId || '',
    result.opportunityStatus || '',
    result.suggestionId || '',
    
    // Suggestion Details (6 columns)
    result.suggestionType || '',
    result.suggestionStatus || '',
    result.suggestionRank || '',
    result.url || '',
    `"${(result.errorId || '').replace(/"/g, '""')}"`,
    `"${(result.errorTitle || '').replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`,
    
    // Schema Analysis (6 columns)
    result.totalJsonLdBlocks || '',
    result.validJsonLdBlocks || '',
    `"${result.schemaTypes || ''}"`,
    result.completenessScore || '',
    `"${(result.aiSuggestionFix || '').replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`,
    result.bestSimilarity || '',
    
    // Fix Detection Results (4 columns)
    result.hasValidSchema || '',
    result.aiSuggestionImplemented ? 'YES' : 'NO',
    result.isFixed ? 'YES' : 'NO',
    result.fixType || '',
    
    // Timestamps and Metadata (6 columns)
    result.opportunityCreated || '',
    result.opportunityUpdated || '',
    result.suggestionCreated || '',
    result.suggestionUpdated || '',
    result.updatedBy || '',
    result.testDate || ''
  ];
}

/**
 * Format broken backlinks result for comprehensive raw data CSV (24 columns - removed Final Status Code)
 */
export function formatBrokenBacklinksResult(result, siteId, siteName) {
  return [
    // Core Identity (5 columns)
    siteId || '',
    `"${siteName || ''}"`,
    result.opportunityId || '',
    result.opportunityStatus || '',
    result.suggestionId || '',
    
    // Suggestion Details (6 columns)
    result.suggestionType || '',
    result.suggestionStatus || '',
    result.suggestionRank || '',
    `"${result.title || ''}"`,
    result.urlFrom || '',
    result.urlTo || '',
    
    // Traffic Analysis (2 columns)
    result.trafficDomain || '',
    `"${result.urlsSuggested || ''}"`,
    
    // Fix Detection Results (4 columns)
    result.redirectImplemented ? 'YES' : 'NO',
    result.aiSuggestionImplemented ? 'YES' : 'NO',
    result.isFixed ? 'YES' : 'NO',
    result.fixType || '',
    
    // Current Status (1 column - removed Final Status Code)
    result.finalUrl || '',
    
    // Timestamps and Metadata (6 columns)
    result.opportunityCreated || '',
    result.opportunityUpdated || '',
    result.suggestionCreated || '',
    result.suggestionUpdated || '',
    result.updatedBy || '',
    result.testDate || ''
  ];
}

/**
 * Format alt-text result for comprehensive raw data CSV (27 columns)
 */
export function formatAltTextResult(result, siteId, siteName) {
  return [
    // Core Identity (5 columns)
    siteId || '',
    `"${siteName || ''}"`,
    result.opportunityId || '',
    result.opportunityStatus || '',
    result.suggestionId || '',
    
    // Suggestion Details (6 columns)
    result.suggestionType || '',
    result.suggestionStatus || '',
    result.suggestionRank || '',
    `"${result.imageId || ''}"`,
    result.pageUrl || '',
    result.imageUrl || '',
    
    // Image Analysis (5 columns)
    `"${result.xpath || ''}"`,
    result.matchMethod || '',
    result.isDecorative || '',
    result.isAppropriate || '',
    result.language || '',
    
    // Alt Text Comparison (4 columns)
    `"${result.suggestedAltText || ''}"`,
    `"${result.currentAltText || ''}"`,
    result.similarity || '',
    result.aiSuggestionImplemented ? 'YES' : 'NO',
    
    // Fix Detection Results (2 columns)
    result.isFixed ? 'YES' : 'NO',
    result.fixType || '',
    
    // Timestamps and Metadata (6 columns)
    result.opportunityCreated || '',
    result.opportunityUpdated || '',
    result.suggestionCreated || '',
    result.suggestionUpdated || '',
    result.updatedBy || '',
    result.testDate || ''
  ];
}

/**
 * Format CWV result for comprehensive raw data CSV (26 columns)
 */
export function formatCWVResult(result, siteId, siteName) {
  return [
    // Core Identity (5 columns)
    siteId || '',
    `"${siteName || ''}"`,
    result.opportunityId || '',
    result.opportunityStatus || '',
    result.suggestionId || '',
    
    // Suggestion Details (6 columns)
    result.suggestionType || '',
    result.suggestionStatus || '',
    result.suggestionRank || '',
    result.entryType || '',
    result.urlOrPattern || '',
    result.pageviews || '',
    
    // Historical CWV Metrics (3 columns)
    result.oldLCP || '',
    result.oldCLS || '',
    result.oldINP || '',
    
    // Current CWV Metrics (3 columns)
    result.currentLCP || '',
    result.currentCLS || '',
    result.currentINP || '',
    
    // Performance Analysis (3 columns)
    `"${result.metricsImproved || ''}"`,
    result.isFixed ? 'YES' : 'NO',
    result.fixType || '',
    
    // Timestamps and Metadata (6 columns)
    result.opportunityCreated || '',
    result.opportunityUpdated || '',
    result.suggestionCreated || '',
    result.suggestionUpdated || '',
    result.updatedBy || '',
    result.testDate || ''
  ];
}

/**
 * Generate comprehensive metatags CSV content
 */
export function generateMetatagsCSV(results, siteId, siteName) {
  const csvRows = results.map(result => formatMetatagsResult(result, siteId, siteName));
  return [
    METATAGS_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Generate comprehensive internal links CSV content
 */
export function generateInternalLinksCSV(results, siteId, siteName) {
  const csvRows = results.map(result => formatInternalLinksResult(result, siteId, siteName));
  return [
    INTERNAL_LINKS_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Generate comprehensive structured data CSV content
 */
export function generateStructuredDataCSV(results, siteId, siteName) {
  const csvRows = results.map(result => formatStructuredDataResult(result, siteId, siteName));
  return [
    STRUCTURED_DATA_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Generate comprehensive broken backlinks CSV content
 */
export function generateBrokenBacklinksCSV(results, siteId, siteName) {
  const csvRows = results.map(result => formatBrokenBacklinksResult(result, siteId, siteName));
  return [
    BROKEN_BACKLINKS_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Generate comprehensive alt-text CSV content
 */
export function generateAltTextCSV(results, siteId, siteName) {
  const csvRows = results.map(result => formatAltTextResult(result, siteId, siteName));
  return [
    ALT_TEXT_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Generate comprehensive CWV CSV content
 */
export function generateCWVCSV(results, siteId, siteName) {
  const csvRows = results.map(result => formatCWVResult(result, siteId, siteName));
  return [
    CWV_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Generate clean sitemap CSV content
 */
export function generateSitemapCSV(results, siteId, siteName) {
  const csvRows = results.map(result => formatSitemapResult(result, siteId, siteName));
  return [
    SITEMAP_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Generate CSV content from normalized results (legacy)
 */
export function generateCSVContent(normalizedResults) {
  const csvRows = normalizedResults.map(result => [
    result.siteId,
    `"${result.siteName}"`,
    result.auditType,
    result.opportunityId,
    result.opportunityStatus,
    result.suggestionId,
    result.suggestionStatus,
    result.url,
    result.issueType,
    `"${result.issueDescription}"`,
    result.createdAt,
    result.updatedAt,
    `"${result.originalContent}"`,
    result.originalStatusCode,
    `"${result.originalError}"`,
    `"${result.aiSuggestion}"`,
    result.autofix,
    `"${result.currentContent}"`,
    result.currentStatusCode,
    `"${result.currentError}"`,
    result.isFixedOverall,
    result.fixType,
    result.fixMethod,
    result.redirectImplemented,
    `"${result.redirectTarget}"`,
    `"${result.recommendedAction}"`
  ]);

  return [
    COMMON_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Generate timestamped filename
 */
export function generateFilename(auditType, siteInfo = null) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
  const dateStr = timestamp[0];
  const timeStr = timestamp[1].split('.')[0];
  
  if (siteInfo) {
    return `${auditType}-fix-check-${siteInfo}-${dateStr}-${timeStr}.csv`;
  } else {
    return `${auditType}-fix-check-ALL-SITES-${dateStr}-${timeStr}.csv`;
  }
}

/**
 * Write comprehensive metatags CSV file (25 columns)
 */
export function writeMetatagsCSV(results, siteId, siteName) {
  const filename = generateFilename('metatags', siteId);
  
  try {
    // Use safe CSV generation with column validation
    const csvContent = generateSafeCSV(METATAGS_CSV_HEADERS, results, formatMetatagsResult, siteId, siteName);
    writeFileSync(filename, csvContent, 'utf8');
    
    console.log(`[INFO] ✓ Clean metatags CSV written: ${filename} (${results.length} rows, ${METATAGS_CSV_HEADERS.length} columns)`);
    return filename;
    
  } catch (error) {
    console.error(`[ERROR] Failed to write metatags CSV: ${error.message}`);
    
    // Fallback: write basic error CSV with correct column count
    const errorRow = new Array(METATAGS_CSV_HEADERS.length).fill('ERROR_CSV_GENERATION_FAILED');
    errorRow[0] = siteId || 'ERROR_SITE_ID';
    errorRow[1] = `"${siteName || 'ERROR_SITE_NAME'}"`;
    errorRow[9] = `"CSV_GENERATION_ERROR: ${error.message}"`;
    
    const errorContent = [
      METATAGS_CSV_HEADERS.join(','),
      errorRow.join(',')
    ].join('\n') + '\n';
    
    writeFileSync(filename, errorContent, 'utf8');
    console.log(`[ERROR] ⚠️  Fallback error CSV written: ${filename}`);
    return filename;
  }
}

/**
 * Write comprehensive internal links CSV file (24 columns)
 */
export function writeInternalLinksCSV(results, siteId, siteName) {
  const csvContent = generateInternalLinksCSV(results, siteId, siteName);
  const filename = generateFilename('internal-links', siteId);
  
  writeFileSync(filename, csvContent);
  console.log(`[INFO] Comprehensive internal links CSV written: ${filename}`);
  
  return filename;
}

/**
 * Write comprehensive structured data CSV file (27 columns)
 */
export function writeStructuredDataCSV(results, siteId, siteName) {
  const csvContent = generateStructuredDataCSV(results, siteId, siteName);
  const filename = generateFilename('structured-data', siteId);
  
  writeFileSync(filename, csvContent);
  console.log(`[INFO] Comprehensive structured data CSV written: ${filename}`);
  
  return filename;
}

/**
 * Write comprehensive broken backlinks CSV file (25 columns)
 */
export function writeBrokenBacklinksCSV(results, siteId, siteName) {
  const csvContent = generateBrokenBacklinksCSV(results, siteId, siteName);
  const filename = generateFilename('broken-backlinks', siteId);
  
  writeFileSync(filename, csvContent);
  console.log(`[INFO] Comprehensive broken backlinks CSV written: ${filename}`);
  
  return filename;
}

/**
 * Write comprehensive alt-text CSV file (26 columns)
 */
export function writeAltTextCSV(results, siteId, siteName) {
  const csvContent = generateAltTextCSV(results, siteId, siteName);
  const filename = generateFilename('alt-text', siteId);
  
  writeFileSync(filename, csvContent);
  console.log(`[INFO] Comprehensive alt-text CSV written: ${filename}`);
  
  return filename;
}

/**
 * Write comprehensive CWV CSV file (26 columns)
 */
export function writeCWVCSV(results, siteId, siteName) {
  const csvContent = generateCWVCSV(results, siteId, siteName);
  const filename = generateFilename('cwv', siteId);
  
  writeFileSync(filename, csvContent);
  console.log(`[INFO] Comprehensive CWV CSV written: ${filename}`);
  
  return filename;
}

/**
 * Write clean sitemap CSV file (with status codes)
 */
export function writeSitemapCSV(results, siteId, siteName) {
  const csvContent = generateSitemapCSV(results, siteId, siteName);
  const filename = generateFilename('sitemap', siteId);
  
  writeFileSync(filename, csvContent);
  console.log(`[INFO] Clean sitemap CSV written: ${filename}`);
  
  return filename;
}

/**
 * Write consolidated CSV file with mixed audit types
 */
export function writeConsolidatedCSV(allResults, auditTypes) {
  const normalizedResults = [];
  
  for (const auditType of auditTypes) {
    const auditResults = allResults[auditType] || [];
    
    if (auditType === 'metatags') {
      normalizedResults.push(...auditResults.map(normalizeMetatagsResult));
    } else if (auditType === 'sitemap') {
      normalizedResults.push(...auditResults.map(result => normalizeSitemapResult(result, result.siteId, result.siteName)));
    }
  }
  
  const csvContent = generateCSVContent(normalizedResults);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
  const filename = `ALL-AUDITS-fix-check-ALL-SITES-${timestamp[0]}-${timestamp[1].split('.')[0]}.csv`;
  
  writeFileSync(filename, csvContent);
  return { filename, totalResults: normalizedResults.length };
}

/**
 * Generate summary statistics for any audit type
 */
export function generateSummaryStats(normalizedResults, auditType) {
  const total = normalizedResults.length;
  const fixedOverall = normalizedResults.filter(r => r.isFixedOverall === 'YES').length;
  const fixedByAI = normalizedResults.filter(r => r.isFixedByAI === 'YES').length;
  const fixedByOther = fixedOverall - fixedByAI;
  
  const stats = {
    auditType,
    total,
    fixedOverall,
    fixedByAI,
    fixedByOther,
    notFixed: total - fixedOverall,
    overallFixRate: total > 0 ? ((fixedOverall / total) * 100).toFixed(1) : '0.0',
    aiSuccessRate: total > 0 ? ((fixedByAI / total) * 100).toFixed(1) : '0.0'
  };
  
  // Add audit-specific stats
  if (auditType === 'sitemap') {
    const urlsFixed = normalizedResults.filter(r => r.fixMethod === 'URL_FIXED').length;
    const redirectsAdded = normalizedResults.filter(r => r.fixMethod === 'REDIRECT_ADDED').length;
    stats.urlsFixed = urlsFixed;
    stats.redirectsAdded = redirectsAdded;
  }
  
  return stats;
}

/**
 * Print summary statistics
 */
export function printSummary(stats, sitesProcessed = 1) {
  console.log(`\n=== ${stats.auditType.toUpperCase()} SUMMARY ===`);
  if (sitesProcessed > 1) {
    console.log(`Total sites processed: ${sitesProcessed}`);
  }
  console.log(`Total suggestions analyzed: ${stats.total}`);
  
  if (stats.auditType === 'metatags') {
    console.log(`Fixed by AI suggestions: ${stats.fixedByAI}`);
    console.log(`Fixed by other means: ${stats.fixedByOther}`);
    console.log(`AI suggestion success rate: ${stats.aiSuccessRate}%`);
  } else if (stats.auditType === 'sitemap') {
    console.log(`URLs now working (200 OK): ${stats.urlsFixed || 0}`);
    console.log(`Redirects implemented: ${stats.redirectsAdded || 0}`);
  }
  
  console.log(`Total fixed (any method): ${stats.fixedOverall}`);
  console.log(`Overall fix rate: ${stats.overallFixRate}%`);
  console.log(`Still not fixed: ${stats.notFixed}`);
}

/**
 * Site Summary CSV Headers (16 columns) - Optimized for Site Leads
 */
export const SITE_SUMMARY_CSV_HEADERS = [
  // Core Identity & Context (5 columns)
  'Site ID',
  'Site Name', 
  'Opportunity ID',
  'Opportunity Type',
  'Suggestion ID',
  
  // Actionable Information (6 columns)
  'Suggestion Status',
  'Priority Score',
  'Action Required',
  'Rank',
  'Days Old',
  'Fix Status',
  
  // Content Details (5 columns)
  'URL',
  'Issue Description',
  'AI Suggestion',
  'Created Date',
  'Updated Date'
];

/**
 * Format site summary result for CSV (16 columns)
 */
export function formatSiteSummaryResult(result) {
  return [
    result.siteId || 'MISSING_SITE_ID',
    `"${result.siteName || 'MISSING_SITE_NAME'}"`,
    result.opportunityId || 'MISSING_OPPORTUNITY_ID',
    result.opportunityType || 'MISSING_OPPORTUNITY_TYPE',
    result.suggestionId || 'MISSING_SUGGESTION_ID',
    result.suggestionStatus || 'MISSING_STATUS',
    result.priorityScore || 0,
    result.actionRequired || 'MONITOR',
    result.rank || 'N/A',
    result.daysOld || 'N/A',
    result.fixStatus || 'UNKNOWN',
    result.url || 'MISSING_URL',
    `"${result.issueDescription || 'MISSING_ISSUE'}"`,
    `"${result.aiSuggestion || 'MISSING_AI_SUGGESTION'}"`,
    result.createdDate || 'MISSING_CREATED_DATE',
    result.updatedDate || 'MISSING_UPDATED_DATE'
  ];
}

/**
 * Generate site summary CSV content
 */
export function generateSiteSummaryCSV(results, siteId, siteName) {
  const csvRows = results.map(result => formatSiteSummaryResult(result));
  return [
    SITE_SUMMARY_CSV_HEADERS.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Write site summary CSV file
 */
export function writeSiteSummaryCSV(results, siteId, siteName) {
  const csvContent = generateSiteSummaryCSV(results, siteId, siteName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `site-summary-${siteId}-${timestamp}.csv`;
  
  writeFileSync(filename, csvContent, 'utf8');
  console.log(`[INFO] ✓ Site summary CSV written: ${filename} (${results.length} suggestions)`);
  
  return filename;
}

// Error CSV Headers
export const ERROR_CSV_HEADERS = [
  'Timestamp',
  'Script Name',
  'Site ID',
  'Site Name',
  'Error Type',
  'Error Message',
  'Error Details',
  'Suggestion ID',
  'Opportunity ID',
  'URL',
  'Stack Trace'
];

/**
 * Format error result for CSV
 */
export function formatErrorResult(errorData) {
  return [
    errorData.timestamp || new Date().toISOString(),
    errorData.scriptName || '',
    errorData.siteId || '',
    errorData.siteName || '',
    errorData.errorType || 'UNKNOWN_ERROR',
    errorData.errorMessage || '',
    errorData.errorDetails || '',
    errorData.suggestionId || '',
    errorData.opportunityId || '',
    errorData.url || '',
    errorData.stackTrace || ''
  ];
}

/**
 * Generate error CSV content
 */
export function generateErrorCSV(errors) {
  if (!errors || errors.length === 0) {
    return ERROR_CSV_HEADERS.join(',') + '\n';
  }
  
  const csvContent = [ERROR_CSV_HEADERS.join(',')];
  
  errors.forEach(error => {
    const formattedRow = formatErrorResult(error);
    const csvRow = formattedRow.map(field => {
      if (field === null || field === undefined) return '';
      const stringField = String(field);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
        return `"${stringField.replace(/"/g, '""')}"`;
      }
      return stringField;
    }).join(',');
    csvContent.push(csvRow);
  });
  
  return csvContent.join('\n') + '\n';
}

/**
 * Write error CSV file
 */
export function writeErrorCSV(errors, scriptName, siteId = 'ALL_SITES') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `error-report-${scriptName}-${siteId}-${timestamp}.csv`;
  
  const csvContent = generateErrorCSV(errors);
  writeFileSync(filename, csvContent, 'utf8');
  
  console.log(`[ERROR] Error report written to: ${filename}`);
  return filename;
}

/**
 * Validate CSV row has correct number of columns
 */
export function validateCSVRow(row, expectedColumns, rowType = 'data') {
  if (!Array.isArray(row)) {
    throw new Error(`${rowType} row must be an array, got ${typeof row}`);
  }
  
  if (row.length !== expectedColumns) {
    throw new Error(`${rowType} row has ${row.length} columns, expected ${expectedColumns}. Row: ${JSON.stringify(row.slice(0, 5))}...`);
  }
  
  return true;
}

/**
 * Safe CSV generation with column validation
 */
export function generateSafeCSV(headers, results, formatFunction, siteId, siteName) {
  const expectedColumns = headers.length;
  
  // Validate headers
  validateCSVRow(headers, expectedColumns, 'header');
  
  const csvContent = [headers.join(',')];
  
  results.forEach((result, index) => {
    try {
      const formattedRow = formatFunction(result, siteId, siteName);
      
      // Validate each row has correct number of columns
      validateCSVRow(formattedRow, expectedColumns, `row ${index + 1}`);
      
      // Escape and join
      const csvRow = formattedRow.map(field => {
        if (field === null || field === undefined) return '';
        const stringField = String(field);
        // Already quoted fields don't need re-quoting
        if (stringField.startsWith('"') && stringField.endsWith('"')) {
          return stringField;
        }
        // Quote fields with commas, quotes, or newlines
        if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
          return `"${stringField.replace(/"/g, '""')}"`;
        }
        return stringField;
      }).join(',');
      
      csvContent.push(csvRow);
      
    } catch (error) {
      console.error(`[ERROR] Failed to format row ${index + 1}: ${error.message}`);
      
      // Create error placeholder row with correct number of columns
      const errorRow = new Array(expectedColumns).fill('ERROR_FORMATTING_FAILED');
      errorRow[0] = siteId || 'ERROR_SITE_ID';
      errorRow[1] = `"ERROR: ${error.message}"`;
      csvContent.push(errorRow.join(','));
    }
  });
  
  return csvContent.join('\n') + '\n';
}
