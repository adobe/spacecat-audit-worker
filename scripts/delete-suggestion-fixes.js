#!/usr/bin/env node

/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { readFile, writeFile, appendFile } from 'fs/promises';
import { resolve } from 'path';
import { fetch } from '@adobe/fetch';

const BASE_URL = 'https://spacecat.experiencecloud.live/api/v1';
const API_KEY = process.env.SPACECAT_API_KEY || '';
const LOG_FILE = resolve('./delete-fixes.log');

/**
 * Log to both console and file
 */
async function log(message) {
  console.log(message);
  const timestamp = new Date().toISOString();
  await appendFile(LOG_FILE, `[${timestamp}] ${message}\n`).catch(() => {});
}

/**
 * Update suggestions status to OUTDATED
 */
async function updateSuggestionsStatus(siteId, opportunityId, suggestionIds) {
  const url = `${BASE_URL}/sites/${siteId}/opportunities/${opportunityId}/suggestions/status`;
  const payload = suggestionIds.map((id) => ({ id: id, status: 'OUTDATED' }));

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await log(`Failed to update suggestions status: ${response.status}`);
      return false;
    }

    await log(`✓ Updated ${suggestionIds.length} suggestions to OUTDATED for opportunity ${opportunityId.slice(0, 8)}...`);
    return true;
  } catch (error) {
    await log(`Error updating suggestions status: ${error.message}`);
    return false;
  }
}

/**
 * Fetch fixes for a suggestion
 */
async function fetchFixes(siteId, opportunityId, suggestionId) {
  const url = `${BASE_URL}/sites/${siteId}/opportunities/${opportunityId}/suggestions/${suggestionId}/fixes`;

  try {
    const response = await fetch(url, {
      headers: { 'x-api-key': API_KEY },
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch fixes for ${suggestionId}: ${response.status}`);
      return [];
    }
    
    const result = await response.json();
    console.log(`Response for ${suggestionId.slice(0, 8)}...:`, result);
    
    // API returns { "data": [...] }
    const fixes = result?.data || result || [];
    
    // Ensure it's always an array
    if (!Array.isArray(fixes)) {
      console.warn(`Unexpected response format for ${suggestionId}, got:`, typeof fixes);
      return [];
    }
    
    return fixes;
  } catch (error) {
    console.error(`Error fetching fixes for ${suggestionId}:`, error.message);
    return [];
  }
}

/**
 * Delete a fix
 */
async function deleteFix(siteId, opportunityId, fixId) {
  const url = `${BASE_URL}/sites/${siteId}/opportunities/${opportunityId}/fixes/${fixId}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'x-api-key': API_KEY },
    });
    if (!response.ok) {
      await log(`Failed to delete fix ${fixId.slice(0, 8)}...: ${response.status}`);
      return false;
    }
    await log(`  ✓ Deleted fix: ${fixId}`);
    return true;
  } catch (error) {
    await log(`Error deleting fix ${fixId.slice(0, 8)}...: ${error.message}`);
    return false;
  }
}

/**
 * Process suggestions: update status and delete fixes
 */
async function processSuggestions(siteId, opportunityId, suggestionIds) {
  await log(`\n[${siteId.slice(0, 8)}...] Processing ${suggestionIds.length} suggestions for opportunity ${opportunityId.slice(0, 8)}...`);

  // Step 1: Update status to OUTDATED
  await updateSuggestionsStatus(siteId, opportunityId, suggestionIds);

  // Step 2: Delete fixes
  let totalFixes = 0;
  let deletedFixes = 0;

  for (const suggestionId of suggestionIds) {
    const fixes = await fetchFixes(siteId, opportunityId, suggestionId);
    console.log(`Fetched ${fixes.length} fixes for ${suggestionId}`);
    
    if (fixes.length === 0) continue;

    await log(`  Found ${fixes.length} fix(es) for suggestion ${suggestionId.slice(0, 8)}...`);
    totalFixes += fixes.length;

    for (const fix of fixes) {
      const fixId = fix.id || fix._id;
      if (fixId && await deleteFix(siteId, opportunityId, fixId)) {
        deletedFixes++;
      }
    }
  }

  if (totalFixes > 0) {
    await log(`✓ Summary: Deleted ${deletedFixes}/${totalFixes} fixes`);
  } else {
    await log(`  No fixes found for any suggestion`);
  }
}

/**
 * Main function
 */
async function main() {
  // Clear/initialize log file
  await writeFile(LOG_FILE, '').catch(() => {});
  
  await log('Mark Suggestions OUTDATED and Delete Fixes');
  await log('==========================================\n');

  // Validate API key
  if (!API_KEY) {
    await log('Error: SPACECAT_API_KEY environment variable is not set');
    await log('Usage: SPACECAT_API_KEY=your-key node delete-suggestion-fixes.js');
    process.exit(1);
  }

  // Read data.json
  const dataPath = resolve('./data.json');
  const rawData = await readFile(dataPath, 'utf-8');
  const suggestions = JSON.parse(rawData);

  await log(`Loaded ${suggestions.length} suggestions from data.json`);

  // Group by siteId + opportunityId
  const groups = suggestions.reduce((acc, item) => {
    const key = `${item.siteId}:${item.opportunityId}`;
    if (!acc[key]) {
      acc[key] = { siteId: item.siteId, opportunityId: item.opportunityId, suggestionIds: [] };
    }
    acc[key].suggestionIds.push(item.suggestionId);
    return acc;
  }, {});

  await log(`Grouped into ${Object.keys(groups).length} site/opportunity pairs\n`);

  // Track totals
  let totalSuggestionsUpdated = 0;
  let totalFixesDeleted = 0;

  // Process each group
  for (const group of Object.values(groups)) {
    await processSuggestions(group.siteId, group.opportunityId, group.suggestionIds);
    totalSuggestionsUpdated += group.suggestionIds.length;
  }

  await log('\n==========================================');
  await log(`✓ FINAL SUMMARY:`);
  await log(`  - Total suggestions processed: ${totalSuggestionsUpdated}`);
  await log(`  - Log file: ${LOG_FILE}`);
  await log('==========================================\n');
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
