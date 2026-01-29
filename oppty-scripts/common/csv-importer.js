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

import { readFile } from 'fs/promises';

/**
 * Parse CSV line respecting quoted fields
 * @param {string} line - CSV line to parse
 * @returns {Array<string>} Array of field values
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      // Escaped quote
      current += '"';
      i += 2; // Skip next quote
    } else if (char === '"') {
      // Toggle quote mode
      inQuotes = !inQuotes;
      i += 1;
    } else if (char === ',' && !inQuotes) {
      // Field separator
      result.push(current);
      current = '';
      i += 1;
    } else {
      current += char;
      i += 1;
    }
  }

  // Add last field
  result.push(current);

  return result;
}

/**
 * Parse CSV content into array of objects
 * @param {string} csvContent - CSV file content
 * @returns {Array<object>} Array of row objects
 */
function parseCSV(csvContent) {
  const lines = csvContent.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    return [];
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);

  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCSVLine(lines[i]);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    rows.push(row);
  }

  return rows;
}

/**
 * Import results from CSV file
 * @param {string} csvPath - Path to CSV file
 * @param {object} log - Logger instance
 * @returns {Promise<Array<object>>} Array of result objects
 */
export async function importFromCSV(csvPath, log) {
  try {
    log.info(`Reading CSV file: ${csvPath}`);
    const csvContent = await readFile(csvPath, 'utf-8');

    const rows = parseCSV(csvContent);
    log.info(`Parsed ${rows.length} rows from CSV`);

    // Convert CSV rows to result objects
    const results = rows.map((row) => {
      // Normalize boolean fields
      const isFixedViaAI = row['Is Fixed Via AI']?.toUpperCase() === 'YES';
      const isFixedManually = row['Is Fixed Manually']?.toUpperCase() === 'YES';
      const scrapeFailed = row['Scrape Failed']?.toUpperCase() === 'YES';

      return {
        suggestionId: row['Suggestion ID'],
        opportunityId: row['Opportunity ID'],
        url: row.URL || row['Page URL'] || '',
        status: row.Status,
        isFixedViaAI,
        isFixedManually,
        scrapeFailed,
        reason: row.Reason || '',
        fixDetails: {}, // Empty fix details for CSV import
      };
    });

    // Filter out invalid rows (missing required fields)
    const validResults = results.filter((r) => r.suggestionId && r.opportunityId);

    if (validResults.length < results.length) {
      log.warn(`Filtered out ${results.length - validResults.length} rows with missing Suggestion ID or Opportunity ID`);
    }

    log.info(`Loaded ${validResults.length} valid results from CSV`);

    return validResults;
  } catch (error) {
    log.error('Failed to import CSV file', { error: error.message, path: csvPath });
    throw new Error(`Failed to import CSV file: ${error.message}`);
  }
}

export default importFromCSV;
