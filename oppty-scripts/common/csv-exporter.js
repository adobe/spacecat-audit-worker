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

import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/* eslint-disable no-underscore-dangle */
// Get current directory for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/* eslint-enable no-underscore-dangle */

/**
 * Escape CSV field value
 * @param {*} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // If contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Convert array of objects to CSV string
 * @param {Array<object>} data - Array of data objects
 * @param {Array<string>} headers - Column headers
 * @returns {string} CSV content
 */
function convertToCSV(data, headers) {
  if (!data || data.length === 0) {
    return `${headers.join(',')}\n`;
  }

  // Create header row
  const headerRow = headers.map(escapeCsvField).join(',');

  // Create data rows
  const dataRows = data.map((row) => headers.map((header) => {
    let value = row[header];

    // Convert objects and arrays to JSON strings
    if (typeof value === 'object' && value !== null) {
      value = JSON.stringify(value);
    }

    return escapeCsvField(value);
  }).join(','));

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Get CSV headers and formatter based on opportunity type
 * @param {string} opportunityType - Opportunity type
 * @returns {object} Headers and formatter function
 */
function getCSVConfig(opportunityType) {
  const baseHeaders = [
    'Suggestion ID',
    'Opportunity ID',
    'URL',
    'Status',
    'Is Fixed Via AI',
    'Is Fixed Manually',
    'Scrape Failed',
    'Reason',
  ];

  const configs = {
    'alt-text': {
      headers: [
        ...baseHeaders,
        'Image URL',
        'Current Alt Text',
        'Suggested Alt Text',
        'AI Generated Text',
        'Is Edited',
        'Link Text',
        'Parent Tag',
        'Parent Class',
        'Parent ID',
        'Element Context',
        'Fix Details',
        'Timestamp',
      ],
      formatter: (result) => ({
        'Suggestion ID': result.suggestionId || '',
        'Opportunity ID': result.opportunityId || '',
        URL: result.url || '',
        Status: result.status || '',
        'Is Fixed Via AI': result.isFixedViaAI ? 'YES' : 'NO',
        'Is Fixed Manually': result.isFixedManually ? 'YES' : 'NO',
        'Scrape Failed': result.scrapeFailed ? 'YES' : 'NO',
        Reason: result.reason || '',
        'Image URL': result.fixDetails?.imageUrl || '',
        'Current Alt Text': result.fixDetails?.altText || '',
        'Suggested Alt Text': result.fixDetails?.suggestedAltText || '',
        'AI Generated Text': result.fixDetails?.improvedText || result.fixDetails?.aiSuggestion || '',
        'Is Edited': result.fixDetails?.isEdited ? 'YES' : 'NO',
        'Link Text': result.fixDetails?.linkText || '',
        'Parent Tag': result.fixDetails?.parentTag || '',
        'Parent Class': result.fixDetails?.parentClass || '',
        'Parent ID': result.fixDetails?.parentId || '',
        'Element Context': result.fixDetails?.elementContext || '',
        'Fix Details': result.fixDetails ? JSON.stringify(result.fixDetails) : '',
        Timestamp: new Date().toISOString(),
      }),
    },
    'broken-backlinks': {
      headers: [
        ...baseHeaders,
        'Broken URL',
        'Final URL',
        'Status Code',
        'Suggested URLs',
        'Matched URL',
        'Is Edited',
        'Edited URL',
        'Details',
        'Timestamp',
      ],
      formatter: (result) => {
        const fixDetails = result.fixDetails || {};
        // Format suggested URLs as semicolon-separated list (consistent with internal-links)
        const suggestedUrls = Array.isArray(fixDetails.suggestedUrls)
          ? fixDetails.suggestedUrls.join('; ')
          : (fixDetails.suggestedUrls || '');

        // Determine status code value, handling both undefined and null cases
        let statusCodeValue = '';
        if (fixDetails.statusCode !== undefined) {
          statusCodeValue = fixDetails.statusCode;
        }

        return {
          'Suggestion ID': result.suggestionId || '',
          'Opportunity ID': result.opportunityId || '',
          URL: result.url || '',
          Status: result.status || '',
          'Is Fixed Via AI': result.isFixedViaAI ? 'YES' : 'NO',
          'Is Fixed Manually': result.isFixedManually ? 'YES' : 'NO',
          'Scrape Failed': result.scrapeFailed ? 'YES' : 'NO',
          Reason: result.reason || '',
          'Broken URL': fixDetails.urlTo || '',
          'Final URL': fixDetails.finalUrl || '',
          'Status Code': statusCodeValue,
          'Suggested URLs': suggestedUrls,
          'Matched URL': fixDetails.matchedUrl || '',
          'Is Edited': fixDetails.isEdited ? 'YES' : 'NO',
          'Edited URL': fixDetails.urlEdited || '',
          Details: result.fixDetails ? JSON.stringify(result.fixDetails) : '',
          Timestamp: new Date().toISOString(),
        };
      },
    },
    'broken-internal-links': {
      headers: [
        ...baseHeaders,
        'Source URL',
        'Broken URL',
        'Suggested URLs',
        'Is Edited',
        'Edited URL',
        'Final URL',
        'Status Code',
        'Matched URL',
        'Timestamp',
      ],
      formatter: (result) => {
        const fixDetails = result.fixDetails || {};
        // Format suggested URLs as comma-separated list
        const suggestedUrls = Array.isArray(fixDetails.urlsSuggested)
          ? fixDetails.urlsSuggested.join('; ')
          : (fixDetails.urlsSuggested || '');

        // Determine status code value, handling both undefined and null cases
        let statusCodeValue = '';
        if (fixDetails.statusCode !== undefined) {
          statusCodeValue = fixDetails.statusCode;
        }

        return {
          'Suggestion ID': result.suggestionId || '',
          'Opportunity ID': result.opportunityId || '',
          URL: result.url || '',
          Status: result.status || '',
          'Is Fixed Via AI': result.isFixedViaAI ? 'YES' : 'NO',
          'Is Fixed Manually': result.isFixedManually ? 'YES' : 'NO',
          'Scrape Failed': result.scrapeFailed ? 'YES' : 'NO',
          Reason: result.reason || '',
          'Source URL': fixDetails.urlFrom || '',
          'Broken URL': fixDetails.urlTo || '',
          'Suggested URLs': suggestedUrls,
          'Is Edited': fixDetails.isEdited ? 'YES' : 'NO',
          'Edited URL': fixDetails.urlEdited || '',
          'Final URL': fixDetails.finalUrl || '',
          'Status Code': statusCodeValue,
          'Matched URL': fixDetails.matchedUrl || '',
          Timestamp: new Date().toISOString(),
        };
      },
    },
    sitemap: {
      headers: [
        ...baseHeaders,
        'Page URL',
        'Sitemap URL',
        'Original Status Code',
        'Current Status Code',
        'Suggested URL',
        'Fix Method',
        'Issue Type',
        'Still In Sitemap',
        'Timestamp',
      ],
      formatter: (result) => ({
        'Suggestion ID': result.suggestionId || '',
        'Opportunity ID': result.opportunityId || '',
        URL: result.pageUrl || result.url || '',
        Status: result.status || '',
        'Is Fixed Via AI': result.isFixedViaAI ? 'YES' : 'NO',
        'Is Fixed Manually': result.isFixedManually ? 'YES' : 'NO',
        'Scrape Failed': result.scrapeFailed ? 'YES' : 'NO',
        Reason: result.reason || '',
        'Page URL': result.pageUrl || '',
        'Sitemap URL': result.sitemapUrl || '',
        'Original Status Code': result.originalStatusCode || '',
        // Handle undefined separately from null for currentStatusCode
        'Current Status Code': result.currentStatusCode !== null
          && result.currentStatusCode !== undefined
          ? result.currentStatusCode : '',
        'Suggested URL': result.suggestedUrl || '',
        'Fix Method': result.fixMethod || '',
        'Issue Type': result.issueType || '',
        'Still In Sitemap': (() => {
          if (result.stillInSitemap !== undefined) {
            return result.stillInSitemap ? 'YES' : 'NO';
          }
          return '';
        })(),
        Timestamp: new Date().toISOString(),
      }),
    },
    'meta-tags': {
      headers: [
        ...baseHeaders,
        'Tag Name',
        'Issue',
        'Current Tag Value',
        'AI Suggested Value',
        'Original Tag Content',
        'Current Length',
        'Is Edited',
        'Edited Tag Content',
        'AI Rationale',
        'Details',
        'Timestamp',
      ],
      formatter: (result) => {
        const fixDetails = result.fixDetails || {};
        const { currentValue } = fixDetails;
        // Handle arrays (for H1 tags) - join with | separator
        let currentValueDisplay;
        if (Array.isArray(currentValue)) {
          currentValueDisplay = currentValue.join(' | ');
        } else if (currentValue) {
          currentValueDisplay = String(currentValue);
        } else {
          currentValueDisplay = '';
        }

        return {
          'Suggestion ID': result.suggestionId || '',
          'Opportunity ID': result.opportunityId || '',
          URL: result.url || '',
          Status: result.status || '',
          'Is Fixed Via AI': result.isFixedViaAI ? 'YES' : 'NO',
          'Is Fixed Manually': result.isFixedManually ? 'YES' : 'NO',
          'Scrape Failed': result.scrapeFailed ? 'YES' : 'NO',
          Reason: result.reason || '',
          'Tag Name': fixDetails.tagName || '',
          Issue: fixDetails.issue || '',
          'Current Tag Value': currentValueDisplay,
          'AI Suggested Value': fixDetails.aiSuggestion || '',
          'Original Tag Content': fixDetails.originalContent || '',
          'Current Length': fixDetails.currentLength !== undefined ? fixDetails.currentLength : '',
          'Is Edited': fixDetails.isEdited === true ? 'YES' : 'NO',
          'Edited Tag Content': fixDetails.editedTagContent || '',
          'AI Rationale': fixDetails.aiRationale || '',
          Details: result.fixDetails ? JSON.stringify(result.fixDetails) : '',
          Timestamp: new Date().toISOString(),
        };
      },
    },
  };

  // Return config or default to generic config
  return configs[opportunityType] || {
    headers: [...baseHeaders, 'Details', 'Timestamp'],
    formatter: (result) => ({
      'Suggestion ID': result.suggestionId || '',
      'Opportunity ID': result.opportunityId || '',
      URL: result.url || '',
      Status: result.status || '',
      'Is Fixed Via AI': result.isFixedViaAI ? 'YES' : 'NO',
      'Is Fixed Manually': result.isFixedManually ? 'YES' : 'NO',
      'Scrape Failed': result.scrapeFailed ? 'YES' : 'NO',
      Reason: result.reason || '',
      Details: JSON.stringify(result),
      Timestamp: new Date().toISOString(),
    }),
  };
}

/**
 * Export results to CSV file
 * @param {object} params - Export parameters
 * @param {Array<object>} params.results - Array of result objects
 * @param {string} params.siteId - Site ID for filename
 * @param {string} params.opportunityType - Opportunity type for filename
 * @param {string} [params.outputDir] - Output directory (defaults to oppty-scripts/data)
 * @param {object} params.log - Logger instance
 * @returns {Promise<string>} Path to created CSV file
 */
export async function exportToCSV({
  results,
  siteId,
  opportunityType,
  outputDir,
  log,
}) {
  if (!results || !Array.isArray(results)) {
    throw new Error('results must be an array');
  }

  if (!siteId || !opportunityType) {
    throw new Error('siteId and opportunityType are required');
  }

  // Default output directory
  const defaultOutputDir = join(__dirname, '..', 'data');
  const finalOutputDir = outputDir || defaultOutputDir;

  // Ensure output directory exists
  try {
    await mkdir(finalOutputDir, { recursive: true });
  } catch (error) {
    log.error('Failed to create output directory', { error: error.message });
    throw new Error(`Failed to create output directory: ${error.message}`);
  }

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const filename = `${siteId}-${opportunityType}-${timestamp}.csv`;
  const filepath = join(finalOutputDir, filename);

  // Get CSV config for this opportunity type
  const { headers, formatter } = getCSVConfig(opportunityType);

  // Format results for CSV
  const formattedResults = results.map(formatter);

  // Convert to CSV
  const csvContent = convertToCSV(formattedResults, headers);

  // Write to file
  try {
    await writeFile(filepath, csvContent, 'utf-8');
    log.info(`CSV exported successfully to: ${filepath}`);
    log.info(`Total rows: ${results.length}`);

    // Also export scrape failures separately if any exist
    const scrapeFailures = results.filter((r) => r.scrapeFailed);
    if (scrapeFailures.length > 0) {
      const failuresFilename = `${siteId}-${opportunityType}-scrape-failures-${timestamp}.csv`;
      const failuresFilepath = join(finalOutputDir, failuresFilename);

      const failuresFormatted = scrapeFailures.map(formatter);

      const failuresCsvContent = convertToCSV(failuresFormatted, headers);
      await writeFile(failuresFilepath, failuresCsvContent, 'utf-8');
      log.warn(`Scrape failures exported separately to: ${failuresFilepath}`);
      log.warn(`Total scrape failures: ${scrapeFailures.length}`);
    }

    return filepath;
  } catch (error) {
    log.error('Failed to write CSV file', { error: error.message, filepath });
    throw new Error(`Failed to write CSV file: ${error.message}`);
  }
}

/**
 * Export summary statistics to console and text file
 * @param {Array<object>} results - Array of result objects
 * @param {string} siteId - Site ID for filename
 * @param {string} opportunityType - Opportunity type
 * @param {string} [outputDir] - Output directory (defaults to oppty-scripts/data)
 * @param {object} log - Logger instance
 * @returns {Promise<string|null>} Path to summary file or null if failed
 */
export async function exportSummary(results, siteId, opportunityType, outputDir, log) {
  const total = results.length;
  const fixedViaAI = results.filter((r) => r.isFixedViaAI).length;
  const fixedManually = results.filter((r) => r.isFixedManually).length;
  const scrapeFailed = results.filter((r) => r.scrapeFailed).length;
  const notFixed = total - fixedViaAI - fixedManually - scrapeFailed;

  const percentageFixed = total > 0 ? (((fixedViaAI + fixedManually) / total) * 100).toFixed(2) : '0.00';
  const percentageAI = total > 0 ? ((fixedViaAI / total) * 100).toFixed(2) : '0.00';
  const percentageManual = total > 0 ? ((fixedManually / total) * 100).toFixed(2) : '0.00';
  const percentageFailed = total > 0 ? ((scrapeFailed / total) * 100).toFixed(2) : '0.00';

  const summaryData = {
    'Total Suggestions': total,
    'Fixed Via AI': `${fixedViaAI} (${percentageAI}%)`,
    'Fixed Manually': `${fixedManually} (${percentageManual}%)`,
    'Scrape Failed': `${scrapeFailed} (${percentageFailed}%)`,
    'Not Fixed': notFixed,
    'Total Fixed': `${fixedViaAI + fixedManually} (${percentageFixed}%)`,
  };

  // Log to console
  log.summary('Results Summary', summaryData);

  // Save to text file if siteId and opportunityType are provided
  if (siteId && opportunityType) {
    try {
      const defaultOutputDir = join(__dirname, '..', 'data');
      const finalOutputDir = outputDir || defaultOutputDir;

      // Ensure output directory exists
      await mkdir(finalOutputDir, { recursive: true });

      const summaryFilename = `${siteId}-summary.txt`;
      const summaryFilepath = join(finalOutputDir, summaryFilename);

      // Format summary text
      const timestamp = new Date().toISOString();
      const summaryText = `
${'='.repeat(80)}
SUMMARY REPORT
Opportunity Type: ${opportunityType}
Generated: ${timestamp}
${'='.repeat(80)}

Total Suggestions:   ${total}
Fixed Via AI:        ${fixedViaAI} (${percentageAI}%)
Fixed Manually:      ${fixedManually} (${percentageManual}%)
Scrape Failed:       ${scrapeFailed} (${percentageFailed}%)
Not Fixed:           ${notFixed}
Total Fixed:         ${fixedViaAI + fixedManually} (${percentageFixed}%)

${'='.repeat(80)}

`;

      // Append to file (create if doesn't exist)
      const { appendFile } = await import('fs/promises');
      await appendFile(summaryFilepath, summaryText, 'utf-8');

      log.info(`Summary appended to: ${summaryFilepath}`);
      return summaryFilepath;
    } catch (error) {
      log.error('Failed to write summary file', { error: error.message });
      return null;
    }
  }

  return null;
}

export default exportToCSV;
