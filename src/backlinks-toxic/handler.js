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

import fs from 'fs';

const AHREFS_BACKLINKS_DATA_FILE = '/Users/rpapani/Desktop/code/spacecat/spacecat-audit-worker/src/backlinks-toxic/www.krisshop.com-backlinks-path_2025-12-02_00-05-07.csv';

/**
 * Calculate toxicity score for a backlink based on multiple indicators
 * @param {Object} row - Parsed CSV row object
 * @returns {number} - Toxicity score
 */
function calculateToxicityScore(row) {
  let score = 0;

  const dr = parseFloat(row['Domain rating']) || 0;
  const domainTraffic = parseFloat(row['Domain traffic']) || 0;
  const linkedDomains = parseFloat(row['Linked domains']) || 0;
  const pageTraffic = parseFloat(row['Page traffic']) || 0;
  const ur = parseFloat(row.UR) || 0;

  // 1. Domain Rating (DR) scoring
  if (dr >= 0 && dr <= 1) {
    score += 30;
  } else if (dr >= 2 && dr <= 3) {
    score += 20;
  } else if (dr >= 4 && dr <= 10) {
    score += 10;
  }

  // 2. Domain traffic scoring
  if (domainTraffic === 0) {
    score += 30;
  } else if (domainTraffic < 100) {
    score += 15;
  }

  // 3. Linked domains scoring
  if (linkedDomains >= 500) {
    score += 20;
  } else if (linkedDomains >= 200 && linkedDomains < 500) {
    score += 15;
  } else if (linkedDomains >= 50 && linkedDomains < 200) {
    score += 5;
  }

  // 4. Page traffic scoring
  if (pageTraffic === 0) {
    score += 10;
  }

  // 5. URL Rating (UR) scoring
  if (ur >= 0 && ur <= 2) {
    score += 10;
  } else if (ur >= 3 && ur <= 5) {
    score += 5;
  }

  return score;
}

/**
 * Parse CSV file and find toxic backlinks
 * @param {string} filePath - Path to the CSV file
 * @returns {Array} - Array of toxic backlinks with toxicity scores > 90
 */
export function findToxicBacklinks(filePath) {
  try {
    // Read the CSV file with UTF-16 LE encoding (Ahrefs export format)
    const fileContent = fs.readFileSync(filePath, 'utf16le');
    const lines = fileContent.split('\n');

    if (lines.length < 2) {
      return [];
    }

    // Parse header (tab-delimited) and remove BOM if present
    const headers = lines[0]
      .replace(/^\uFEFF/, '') // Remove BOM
      .split('\t')
      .map((h) => h.replace(/^"|"$/g, '').trim());

    const toxicBacklinks = [];

    // Process each row
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line) {
        // Split by tab and remove surrounding quotes
        const values = line.split('\t').map((v) => v.replace(/^"|"$/g, '').trim());

        // Create row object
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });

        // Calculate toxicity score
        const toxicityScore = calculateToxicityScore(row);

        // Add toxicity score to the row
        row['Toxicity Score'] = toxicityScore;

        // Only include rows with toxicity score > 90
        if (toxicityScore > 90) {
          toxicBacklinks.push(row);
        }
      }
    }

    return toxicBacklinks;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error processing backlinks file:', error);
    throw error;
  }
}

/**
 * Truncate URL for display while keeping it readable
 * @param {string} url - Full URL
 * @param {number} maxLength - Maximum length for display
 * @returns {string} - Truncated URL
 */
function truncateUrl(url, maxLength = 50) {
  if (url.length <= maxLength) {
    return url;
  }

  // Try to truncate intelligently
  const protocol = url.match(/^https?:\/\//)?.[0] || '';
  const urlWithoutProtocol = url.replace(/^https?:\/\//, '');

  if (urlWithoutProtocol.length <= maxLength - 3) {
    return url;
  }

  // Keep the beginning and show ellipsis
  const truncated = `${urlWithoutProtocol.substring(0, maxLength - 3)}...`;
  return `${protocol}${truncated}`;
}

/**
 * Generate markdown table with toxic backlinks
 * @param {Array} backlinks - Array of toxic backlinks
 * @returns {string} - Markdown content
 */
function generateMarkdownTable(backlinks) {
  let markdown = '# Toxic Backlinks Report\n\n';
  markdown += `**Total toxic backlinks found:** ${backlinks.length}\n\n`;
  markdown += '## ⚠️ DISCLAIMER\n\n';
  markdown += '**PROCEED WITH CAUTION:** Disavowing backlinks can have significant impacts on your search engine optimization and should not be done hastily.\n\n';
  markdown += '---\n\n';
  markdown += '## Toxic Backlinks Details\n\n';

  // Table header
  markdown += '| **#** | **Referring Page URL** | **Domain Rating** | **URL Rating** | **Domain Traffic** | **Page Traffic** | **Linked Domains** | **Toxicity Score** |\n';
  markdown += '|---|---|---|---|---|---|---|---|\n';

  // Table rows
  backlinks.forEach((backlink, index) => {
    const rowNumber = index + 1;
    const fullUrl = backlink['Referring page URL'] || 'N/A';
    const truncatedUrl = fullUrl === 'N/A' ? 'N/A' : truncateUrl(fullUrl, 50);
    const clickableUrl = fullUrl === 'N/A' ? 'N/A' : `[${truncatedUrl}](${fullUrl})`;

    const dr = backlink['Domain rating'] || '0';
    const ur = backlink.UR || '0';
    const domainTraffic = backlink['Domain traffic'] || '0';
    const pageTraffic = backlink['Page traffic'] || '0';
    const linkedDomains = backlink['Linked domains'] || '0';
    const toxicityScore = backlink['Toxicity Score'] || '0';

    markdown += `| ${rowNumber} | ${clickableUrl} | ${dr} | ${ur} | ${domainTraffic} | ${pageTraffic} | ${linkedDomains} | **${toxicityScore}** |\n`;
  });

  return markdown;
}

// Main execution
const toxicBacklinks = findToxicBacklinks(AHREFS_BACKLINKS_DATA_FILE);

// eslint-disable-next-line no-console
console.log(`Found ${toxicBacklinks.length} toxic backlinks with score > 90`);

// Sort by toxicity score (highest first)
toxicBacklinks.sort((a, b) => b['Toxicity Score'] - a['Toxicity Score']);

// Generate markdown file
const markdownContent = generateMarkdownTable(toxicBacklinks);
const outputFilePath = '/Users/rpapani/Desktop/code/spacecat/spacecat-audit-worker/src/backlinks-toxic/toxic-backlinks-report.md';
fs.writeFileSync(outputFilePath, markdownContent, 'utf-8');

// eslint-disable-next-line no-console
console.log(`\nMarkdown report saved to: ${outputFilePath}`);

// Display summary statistics
const scoreDistribution = {};
toxicBacklinks.forEach((backlink) => {
  const score = backlink['Toxicity Score'];
  scoreDistribution[score] = (scoreDistribution[score] || 0) + 1;
});

// eslint-disable-next-line no-console
console.log('\nScore distribution:');
Object.keys(scoreDistribution)
  .sort((a, b) => b - a)
  .forEach((score) => {
    // eslint-disable-next-line no-console
    console.log(`  Score ${score}: ${scoreDistribution[score]} backlinks`);
  });

// Display top 10 toxic backlinks
// eslint-disable-next-line no-console
console.log('\nTop 10 most toxic backlinks:');
toxicBacklinks.slice(0, 10).forEach((backlink, index) => {
  // eslint-disable-next-line no-console
  console.log(`\n${index + 1}. Toxicity Score: ${backlink['Toxicity Score']}`);
  // eslint-disable-next-line no-console
  console.log(`   URL: ${backlink['Referring page URL']}`);
  // eslint-disable-next-line no-console
  console.log(`   Domain Rating: ${backlink['Domain rating']}`);
  // eslint-disable-next-line no-console
  console.log(`   URL Rating: ${backlink.UR}`);
  // eslint-disable-next-line no-console
  console.log(`   Domain Traffic: ${backlink['Domain traffic']}`);
  // eslint-disable-next-line no-console
  console.log(`   Page Traffic: ${backlink['Page traffic']}`);
  // eslint-disable-next-line no-console
  console.log(`   Linked Domains: ${backlink['Linked domains']}`);
});
