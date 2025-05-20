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

// import fs from 'fs';
// import path from 'path';
// import { current, lastWeek } from './dev-purposes-constants.js';
import {
  accessibilityIssues, accessibilitySolutions, accessibilitySuggestions, accessibilityUserImpact,
} from './accesibility-standards.js';
import { successCriteriaLinks } from './constants.js';

/**
 * Format traffic numbers to use K for thousands and M for millions
 * @param {number} traffic - Traffic number
 * @returns {string} Formatted traffic value
 */
function formatTraffic(traffic) {
  if (traffic >= 1000000) {
    return `${(traffic / 1000000).toFixed(1)}M`;
  } else if (traffic >= 1000) {
    return `${(traffic / 1000).toFixed(1)}K`;
  }
  return traffic.toString();
}

/**
 * Generate Road to WCAG sections
 * @param {Object} wcagData - WCAG compliance data
 * @returns {string} Road to WCAG sections markdown
 */
function generateRoadToWCAGSection(wcagData) {
  let section = '### Road To WCAG 2.2 Level A\n\n';
  section += '| No of criteria | Passed| Failed| Compliance Score|\n';
  section += '|--------|--------|--------|--------|\n';
  section += `| 30 | ${wcagData.passed.A} | ${wcagData.failures.A} | ${wcagData.complianceScores.A.toFixed(2)}%|\n\n`;

  section += '---\n\n';
  section += '### Road To WCAG 2.2 Level AA\n\n';
  section += '| No of criteria | Passed| Failed| Compliance Score|\n';
  section += '|--------|--------|--------|--------|\n';
  section += `| 50 (30 Level A + 20 Level AA) | ${wcagData.passed.A + wcagData.passed.AA} (${wcagData.passed.A} Level A + ${wcagData.passed.AA} Level AA) | ${wcagData.failures.A + wcagData.failures.AA} (${wcagData.failures.A} Level A + ${wcagData.failures.AA} Level AA) | ${wcagData.complianceScores.AA.toFixed(2)}%|\n\n`;

  section += '---\n\n';
  return section;
}

/**
 * Generate Accessibility Compliance Issues vs Traffic section
 * @param {Array} trafficViolations - Traffic violations data
 * @returns {string} Accessibility Compliance Issues vs Traffic section markdown
 */
function generateAccessibilityComplianceSection(trafficViolations) {
  let section = '### Accessibility Compliance Issues vs Traffic | **[In-Depth Report]()**\n\n';
  section += 'An overview of top 10 pages in terms of traffic with the accessibility issues overview\n\n';
  section += '| Page | Traffic |Total Issues  |Level A |Level AA |\n';
  section += '|--------|--------|--------|--------|--------|\n';

  // Sort by traffic and take top 10
  const sortedByTraffic = [...trafficViolations]
    .sort((a, b) => (b.traffic || 0) - (a.traffic || 0))
    .slice(0, 10);

  sortedByTraffic.forEach((page) => {
    // Filter out 'image-alt' issues from levelA and levelAA
    const filteredLevelA = page.levelA.filter((issue) => !issue.includes('`image-alt`')
      && !issue.includes('`role-img-alt`')
      && !issue.includes('`svg-img-alt`'));
    const filteredLevelAA = page.levelAA.filter((issue) => !issue.includes('`image-alt`')
      && !issue.includes('`role-img-alt`')
      && !issue.includes('`svg-img-alt`'));

    // Recalculate totalIssues after filtering
    const filteredTotalIssues = filteredLevelA.length + filteredLevelAA.length;

    section += `| ${page.url} | ${page.traffic ? formatTraffic(page.traffic) : '-'} | ${filteredTotalIssues} | ${filteredLevelA.length > 0 ? filteredLevelA.join(', ') : '-'} | ${filteredLevelAA.length > 0 ? filteredLevelAA.join(', ') : '-'} |\n`;
  });

  section += '\n---\n\n';
  return section;
}

/**
 * Escape HTML tags in text, but preserve existing backtick-wrapped content
 * @param {string} text - Text that might contain HTML tags
 * @returns {string} Text with HTML tags escaped
 */
function escapeHtmlTags(text) {
  if (!text) return '';

  // First, temporarily replace any existing backtick-wrapped content
  const backtickContent = [];
  let escapedText = text.replace(/`([^`]+)`/g, (match, content) => {
    backtickContent.push(content);
    return '___BACKTICK___';
  });

  // Escape HTML tags
  escapedText = escapedText.replace(/<([^>]+)>/g, '`<$1>`');

  // Restore backtick-wrapped content
  escapedText = escapedText.replace(/___BACKTICK___/g, () => `\`${backtickContent.shift()}\``);

  return escapedText;
}

/**
 * Generate Accessibility Issues Overview section
 * @param {Object} issuesOverview - Issues overview data
 * @returns {string} Accessibility Issues Overview section markdown
 */
function generateAccessibilityIssuesOverviewSection(issuesOverview) {
  // First sort by level (A first, then AA), then by count (highest first)
  const sortedIssues = [...issuesOverview.levelA, ...issuesOverview.levelAA]
    .filter((issue) => issue.rule !== 'image-alt' && issue.rule !== 'role-img-alt' && issue.rule !== 'svg-img-alt')
    .sort((a, b) => {
      if (a.level === b.level) {
        return b.count - a.count;
      }
      return a.level === 'A' ? -1 : 1;
    });

  // If no issues, return empty string
  if (sortedIssues.length === 0) {
    return '';
  }

  let section = '\n### Accessibility Issues Overview\n\n';
  section += '| Issue | WCAG Success Criterion | Count| Level |Impact| Description | WCAG Docs Link |\n';
  section += '|-------|-------|-------------|-------------|-------------|-------------|-------------|\n';

  sortedIssues.forEach((issue) => {
    // Find the issue in accessibilityIssues to get the standardized impact
    let impact = 'Serious'; // Default impact
    for (const category of ['easy', 'medium', 'hard']) {
      const foundIssue = accessibilityIssues[category].find((i) => i.issue === issue.rule);
      if (foundIssue) {
        impact = foundIssue.impact;
        break;
      }
    }

    section += `| ${issue.rule} | [${issue.successCriteriaNumber.split('').join('.')} ${escapeHtmlTags(successCriteriaLinks[issue.successCriteriaNumber]?.name)}](${successCriteriaLinks[issue.successCriteriaNumber]?.successCriterionUrl}) |${issue.count} | ${issue.level} | ${impact} | ${escapeHtmlTags(issue.description)} | ${issue.understandingUrl} |\n`;
  });

  section += '\n---\n\n';
  return section;
}

/**
 * Generate Enhancing Accessibility section for top 10 most-visited pages
 * @param {Array} trafficViolations - Traffic violations data
 * @param {Object} issuesOverview - Issues overview data
 * @returns {string} Enhancing accessibility section markdown
 */
function generateEnhancingAccessibilitySection(trafficViolations, issuesOverview) {
  // Create lookup of issues with descriptions
  const issuesLookup = {};
  [...issuesOverview.levelA, ...issuesOverview.levelAA].forEach((issue) => {
    // Skip image-alt issues
    if (issue.rule === 'image-alt' || issue.rule === 'role-img-alt' || issue.rule === 'svg-img-alt') return;

    issuesLookup[issue.rule] = {
      description: escapeHtmlTags(issue.description),
      level: issue.level,
      impact: escapeHtmlTags(issue.impact),
      criterionName: escapeHtmlTags(successCriteriaLinks[issue.successCriteriaNumber]?.name),
      criterionUrl: successCriteriaLinks[issue.successCriteriaNumber]?.successCriterionUrl,
      successCriteriaNumber: issue.successCriteriaNumber,
    };
  });

  // Sort pages by traffic and take top 10
  const topPages = [...trafficViolations]
    .sort((a, b) => (b.traffic || 0) - (a.traffic || 0))
    .slice(0, 10);

  // Get the most common issues across top pages
  const commonIssues = {};

  topPages.forEach((page) => {
    // Process Level A issues
    page.levelA.forEach((issueText) => {
      // Extract the issue name from format like "13 x `aria-hidden-focus`"
      const match = issueText.match(/(\d+) x `([^`]+)`/);
      if (match) {
        const count = parseInt(match[1], 10);
        const issueName = match[2];

        // Skip image-alt issues
        if (issueName === 'image-alt' || issueName === 'role-img-alt' || issueName === 'svg-img-alt') return;

        if (!commonIssues[issueName]) {
          commonIssues[issueName] = {
            name: issueName,
            level: 'A',
            pages: [],
          };
        }

        commonIssues[issueName].pages.push({
          url: page.url,
          count,
        });
      }
    });

    // Process Level AA issues (if any)
    page.levelAA.forEach((issueText) => {
      // Extract the issue name from format like "2 x `color-contrast`"
      const match = issueText.match(/(\d+) x `([^`]+)`/);
      if (match) {
        const count = parseInt(match[1], 10);
        const issueName = match[2];

        if (!commonIssues[issueName]) {
          commonIssues[issueName] = {
            name: issueName,
            level: 'AA',
            pages: [],
          };
        }

        commonIssues[issueName].pages.push({
          url: page.url,
          count,
        });
      }
    });
  });

  // Sort issues by level (A first, then AA) and then by number of affected pages
  const sortedIssues = Object.values(commonIssues)
    .sort((a, b) => {
      // First sort by level (A first, then AA)
      if (a.level !== b.level) {
        return a.level === 'A' ? -1 : 1;
      }

      // Then sort by number of affected pages
      const pagesDiff = b.pages.length - a.pages.length;
      if (pagesDiff !== 0) return pagesDiff;

      // Then by total occurrences across all pages
      const aTotal = a.pages.reduce((sum, p) => sum + p.count, 0);
      const bTotal = b.pages.reduce((sum, p) => sum + p.count, 0);
      return bTotal - aTotal;
    });

  // Generate the markdown table
  let section = '### Enhancing accessibility for the top 10 most-visited pages\n\n';
  section += '| Issue | WCAG Success Criterion | Level| Pages |Description| How is the user affected | Suggestion | Solution Example |\n';
  section += '|-------|-------|-------------|-------------|-------------|-------------|-------------|-------------|\n';

  // Add all issues from top 10 pages
  sortedIssues.forEach((issue) => {
    // Format pages list - using original URLs without modification
    const pagesText = issue.pages.map((p) => `${p.url} (${p.count})`).join(', ');

    // Get issue description
    const description = issuesLookup[issue.name] ? issuesLookup[issue.name].description : '';

    // Get user impact description from the accessibilityUserImpact module
    const userImpact = escapeHtmlTags(accessibilityUserImpact[issue.name] || '');

    // Get suggestion from the accessibilitySuggestions module
    const suggestion = escapeHtmlTags(accessibilitySuggestions[issue.name] || '');

    const successCriteriaNumber = issuesLookup[issue.name] ? issuesLookup[issue.name].successCriteriaNumber : '';
    const criterionName = issuesLookup[issue.name] ? issuesLookup[issue.name].criterionName : '';
    const criterionUrl = issuesLookup[issue.name] ? issuesLookup[issue.name].criterionUrl : '';

    // Add row with user impact, suggestion, and failure summary
    section += `| ${issue.name} | [${successCriteriaNumber.split('').join('.')} ${criterionName}](${criterionUrl}) | ${issue.level} | ${pagesText} | ${description} | ${userImpact} | ${suggestion} |\n`;
  });

  section += '\n---\n\n'; // Add table end marker
  return section;
}

/**
 * Generate the Quick Wins Pages Per Issue section
 * @param {Array} sortedIssues - Sorted list of issues
 * @param {Object} issuePageMap - Map of issues to pages
 * @returns {string} Quick Wins Pages Per Issue section markdown
 */
function generateQuickWinsPagesSection(sortedIssues, issuePageMap) {
  if (sortedIssues.length === 0) {
    return '';
  }
  let section = '\n### Quick Wins Pages Per Issue\n\n';
  section += 'Below is a detailed breakdown of all pages affected by each quick win issue.\n\n';
  section += '| Issue | Pages |\n';
  section += '|--------|--------|\n';

  sortedIssues.forEach((issue) => {
    // Get page information for this issue
    const pageInfo = issuePageMap[issue.id] || [];
    // Format pages list with issue counts
    const pagesText = pageInfo.length > 0
      ? pageInfo.map((p) => `${p.url} (${p.count})`).join(', ')
      : '-';

    section += `| ${escapeHtmlTags(issue.description)} | ${pagesText} |\n`;
  });

  section += '\n---\n\n';
  return section;
}

/**
 * Generate Quick Wins section
 * @param {Object} quickWinsData - Data from generateQuickWins function
 * @returns {string} Quick Wins section markdown
 */
function generateQuickWinsSection(quickWinsData) {
  // Create a lookup for issue occurrences on pages
  const issuePageMap = {};

  // Process violations data
  if (quickWinsData.allViolations) {
    Object.entries(quickWinsData.allViolations).forEach(([url, data]) => {
      if (url === 'overall') return; // Skip overall data

      // Process critical violations
      Object.entries(data.violations.critical.items || {}).forEach(([issueName, issueData]) => {
        // Skip image-alt issues
        if (issueName === 'image-alt' || issueName === 'role-img-alt' || issueName === 'svg-img-alt') return;

        if (!issuePageMap[issueName]) {
          issuePageMap[issueName] = [];
        }

        // Track issue counts per page
        const existingEntry = issuePageMap[issueName].find((entry) => entry.url === url);
        if (existingEntry) {
          existingEntry.count += issueData.count;
        } else {
          issuePageMap[issueName].push({
            url,
            count: issueData.count,
          });
        }
      });

      // Process serious violations
      Object.entries(data.violations.serious.items || {}).forEach(([issueName, issueData]) => {
        // Skip image-alt issues
        if (issueName === 'image-alt' || issueName === 'role-img-alt' || issueName === 'svg-img-alt') return;

        if (!issuePageMap[issueName]) {
          issuePageMap[issueName] = [];
        }

        // Track issue counts per page
        const existingEntry = issuePageMap[issueName].find((entry) => entry.url === url);
        if (existingEntry) {
          existingEntry.count += issueData.count;
        } else {
          issuePageMap[issueName].push({
            url,
            count: issueData.count,
          });
        }
      });
    });
  }

  // Group issues by description
  const groupedIssues = new Map();
  quickWinsData.topIssues.forEach((issue) => {
    if (issue.id === 'image-alt' || issue.id === 'role-img-alt' || issue.id === 'svg-img-alt') return;

    const descriptionKey = issue.description;
    if (!groupedIssues.has(descriptionKey)) {
      groupedIssues.set(descriptionKey, {
        description: descriptionKey,
        successCriteriaNumber: issue.successCriteriaNumber,
        level: issue.level,
        count: 0,
        issues: [],
      });
    }

    const group = groupedIssues.get(descriptionKey);
    group.count += issue.count;
    group.issues.push(issue);
  });

  // Convert to array and calculate percentages
  // eslint-disable-next-line max-len
  const totalIssues = Array.from(groupedIssues.values()).reduce((sum, group) => sum + group.count, 0);
  const sortedGroups = Array.from(groupedIssues.values())
    .map((group) => ({
      ...group,
      percentage: ((group.count / totalIssues) * 100).toFixed(2),
    }))
    .sort((a, b) => {
      // First sort by percentage (highest first)
      const percentageDiff = parseFloat(b.percentage) - parseFloat(a.percentage);
      if (percentageDiff !== 0) return percentageDiff;

      // If percentages are equal, sort by level (A first, then AA)
      return a.level === 'A' ? -1 : 1;
    })
    .slice(0, 3); // Take top 3 groups

  // If no issues, return empty string
  if (sortedGroups.length === 0) {
    return { mainSection: '', pagesSection: '' };
  }

  // Calculate total percentage for the top 3 groups
  // eslint-disable-next-line max-len
  const totalPercentage = sortedGroups.reduce((sum, group) => sum + parseFloat(group.percentage), 0).toFixed(2);

  // Generate the main Quick Wins section
  let section = '\n### Quick Wins | **[In-depth details at the bottom of the page]()**\n\n';
  section += 'Here is a list of accessibility issues that can be resolved site-wide, having a significant impact with minimal effort, as the changes may be required in only a few places.\n\n';
  section += `Solving the below issues could decrease accessibility issues by ${totalPercentage}%.\n\n`;
  section += '| Issue | WCAG Success Criterion | % of Total |Level|Impact|How To Solve|\n';
  section += '|--------|--------|--------|--------|--------|--------|\n';

  // Add each group to the table
  sortedGroups.forEach((group) => {
    // Use the first issue in the group for impact and how to solve
    const firstIssue = group.issues[0];
    const howToSolve = escapeHtmlTags(accessibilitySolutions[firstIssue.id] || 'Review and fix according to WCAG guidelines.');

    // Find the issue in accessibilityIssues to get the standardized impact
    let impact = 'Serious'; // Default impact
    for (const category of ['easy', 'medium', 'hard']) {
      const foundIssue = accessibilityIssues[category].find((i) => i.issue === firstIssue.id);
      if (foundIssue) {
        impact = foundIssue.impact;
        break;
      }
    }

    section += `| ${escapeHtmlTags(group.description)} | [${group.successCriteriaNumber.split('').join('.')} ${escapeHtmlTags(successCriteriaLinks[group.successCriteriaNumber]?.name)}](${successCriteriaLinks[group.successCriteriaNumber]?.successCriterionUrl}) | ${group.percentage}% | ${group.level} | ${impact} | ${howToSolve} |\n`;
  });

  section += '\n---\n\n'; // Add table end marker

  // Generate the pages section
  // eslint-disable-next-line max-len
  const pagesSection = generateQuickWinsPagesSection(sortedGroups.flatMap((group) => group.issues), issuePageMap);

  return {
    mainSection: section,
    pagesSection,
  };
}

/**
 * Generate Diff section
 * @param {Object} diffData - Data from compareIssues function
 * @returns {string} Diff section markdown
 */
function generateDiffSection(diffData) {
  let section = '';
  let hasFixedIssues = false;
  let hasNewIssues = false;

  // Check for fixed issues
  Object.entries(diffData.fixedIssues.critical).forEach(([, issues]) => {
    const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
    if (filteredIssues.length > 0) {
      hasFixedIssues = true;
    }
  });
  Object.entries(diffData.fixedIssues.serious).forEach(([, issues]) => {
    const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
    if (filteredIssues.length > 0) {
      hasFixedIssues = true;
    }
  });

  // Check for new issues
  Object.entries(diffData.newIssues.critical).forEach(([, issues]) => {
    const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
    if (filteredIssues.length > 0) {
      hasNewIssues = true;
    }
  });
  Object.entries(diffData.newIssues.serious).forEach(([, issues]) => {
    const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
    if (filteredIssues.length > 0) {
      hasNewIssues = true;
    }
  });

  // If no issues at all, return empty string
  if (!hasFixedIssues && !hasNewIssues) {
    return '';
  }

  if (hasFixedIssues) {
    section += '\n### Fixed Accessibility Issues\n\n';
    section += 'Here is a breakdown of fixed accessibility issues Week Over Week for first 100 pages traffic wise.\n\n';
    section += '| Page| Issues |Impact|\n';
    section += '|--------|--------|--------|\n';

    Object.entries(diffData.fixedIssues.critical).forEach(([page, issues]) => {
      const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
      if (filteredIssues.length > 0) {
        section += `| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | Critical |\n`;
      }
    });
    Object.entries(diffData.fixedIssues.serious).forEach(([page, issues]) => {
      const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
      if (filteredIssues.length > 0) {
        section += `| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | Serious |\n`;
      }
    });
    section += '\n---\n';
  }

  if (hasNewIssues) {
    section += '\n### New Accessibility Issues\n\n';
    section += 'Here is a breakdown of new accessibility issues Week Over Week for first 100 pages traffic wise.\n\n';
    section += '| Page| Issues |Impact|\n';
    section += '|--------|--------|--------|\n';

    Object.entries(diffData.newIssues.critical).forEach(([page, issues]) => {
      const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
      if (filteredIssues.length > 0) {
        section += `| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | Critical |\n`;
      }
    });
    Object.entries(diffData.newIssues.serious).forEach(([page, issues]) => {
      const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
      if (filteredIssues.length > 0) {
        section += `| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | Serious |\n`;
      }
    });
    section += '\n---\n';
  }

  return section;
}

/**
 * Generate Week Over Week report section
 * @param {Object} currentData - Current week's data
 * @param {Object} previousData - Previous week's data
 * @returns {string} Week Over Week report section markdown
 */
function generateWeekOverWeekSection(currentData, previousData) {
  let section = 'A Week Over Week breadown of fixed and new accessibility issues for the first 100 pages traffic wise.\n\n';
  section += '| | Fixed | Improved | New |\n';
  section += '|--------|--------|--------|--------|\n';

  // Helper function to filter out image-alt related issues
  const filterImageAlt = (issue) => issue !== 'image-alt'
    && issue !== 'role-img-alt'
    && issue !== 'svg-img-alt';

  // Get current and previous overall counts with null checks
  const currentCritical = currentData?.overall?.violations?.critical?.items || {};
  const currentSerious = currentData?.overall?.violations?.serious?.items || {};
  const previousCritical = previousData?.overall?.violations?.critical?.items || {};
  const previousSerious = previousData?.overall?.violations?.serious?.items || {};

  // Process critical issues
  const criticalNew = Object.entries(currentCritical)
    .filter(([issue]) => !previousCritical[issue] && filterImageAlt(issue))
    .map(([issue]) => `\`${issue}\``)
    .join(', ') || '-';

  const criticalImproved = Object.entries(currentCritical)
    .filter(([issue, data]) => previousCritical[issue]
      && data.count < previousCritical[issue].count
      && filterImageAlt(issue))
    .map(([issue, data]) => {
      const reduction = previousCritical[issue].count - data.count;
      return `\`${issue}\` (${reduction} less)`;
    })
    .join(', ') || '-';

  const criticalFixed = Object.entries(previousCritical)
    .filter(([issue]) => !currentCritical[issue] && filterImageAlt(issue))
    .map(([issue]) => `\`${issue}\``)
    .join(', ') || '-';

  // Process serious issues
  const seriousNew = Object.entries(currentSerious)
    .filter(([issue]) => !previousSerious[issue] && filterImageAlt(issue))
    .map(([issue]) => `\`${issue}\``)
    .join(', ') || '-';

  const seriousImproved = Object.entries(currentSerious)
    .filter(([issue, data]) => previousSerious[issue]
      && data.count < previousSerious[issue].count
      && filterImageAlt(issue))
    .map(([issue, data]) => {
      const reduction = previousSerious[issue].count - data.count;
      return `\`${issue}\` (${reduction} less)`;
    })
    .join(', ') || '-';

  const seriousFixed = Object.entries(previousSerious)
    .filter(([issue]) => !currentSerious[issue] && filterImageAlt(issue))
    .map(([issue]) => `\`${issue}\``)
    .join(', ') || '-';

  // Add rows to the table with proper formatting
  section += `| **[Critical]()** | ${criticalFixed} | ${criticalImproved} | ${criticalNew} |\n`;
  section += `| **[Serious]()** | ${seriousFixed} | ${seriousImproved} | ${seriousNew} |\n`;

  section += '\n---\n\n';
  return section;
}

// =============================================
// Helper Functions
// =============================================

function calculateWCAGData(currentFile) {
  const criticalItems = currentFile.overall.violations.critical.items || {};
  const seriousItems = currentFile.overall.violations.serious.items || {};

  const violationsByLevel = {
    A: 0,
    AA: 0,
  };

  Object.values(criticalItems).forEach((item) => {
    if (item.level) {
      violationsByLevel[item.level] += 1;
    }
  });

  Object.values(seriousItems).forEach((item) => {
    if (item.level) {
      violationsByLevel[item.level] += 1;
    }
  });

  const levelATotal = 30;
  const levelAA = 20;
  const levelAATotal = levelATotal + levelAA;

  const levelASuccessTotal = levelATotal - violationsByLevel.A;
  const levelAASuccessTotal = levelAA - violationsByLevel.AA;

  return {
    passed: {
      A: levelASuccessTotal,
      AA: levelAASuccessTotal,
    },
    failures: {
      A: violationsByLevel.A,
      AA: violationsByLevel.AA,
    },
    totals: {
      A: levelATotal,
      AA: levelAA,
    },
    complianceScores: {
      A: (levelASuccessTotal / levelATotal) * 100,
      AA: ((levelASuccessTotal + levelAASuccessTotal) / levelAATotal) * 100,
    },
  };
}

function processTrafficViolations(currentFile) {
  return Object.entries(currentFile)
    .filter(([url]) => url !== 'overall')
    .map(([url, data]) => ({
      url,
      traffic: data.traffic,
      levelA: Object.entries(data.violations.critical.items).map(([issue, issueData]) => `${issueData.count} x \`${issue}\``),
      levelAA: Object.entries(data.violations.serious.items).map(([issue, issueData]) => `${issueData.count} x \`${issue}\``),
    }));
}

function processQuickWinsData(currentFile) {
  const issueMap = new Map();

  Object.entries(currentFile.overall.violations.critical.items).forEach(([id, data]) => {
    if (id !== 'image-alt' && id !== 'role-img-alt' && id !== 'svg-img-alt') {
      issueMap.set(id, {
        id,
        ...data,
        percentage: ((data.count / currentFile.overall.violations.total) * 100).toFixed(2),
      });
    }
  });

  Object.entries(currentFile.overall.violations.serious.items).forEach(([id, data]) => {
    if (id !== 'image-alt' && id !== 'role-img-alt' && id !== 'svg-img-alt' && !issueMap.has(id)) {
      issueMap.set(id, {
        id,
        ...data,
        percentage: ((data.count / currentFile.overall.violations.total) * 100).toFixed(2),
      });
    }
  });

  const allIssues = Array.from(issueMap.values()).sort((a, b) => b.count - a.count);
  const topIssues = allIssues.slice(0, 3);
  // eslint-disable-next-line max-len
  const totalPercentage = topIssues.reduce((sum, issue) => sum + parseFloat(issue.percentage), 0).toFixed(2);

  return {
    topIssues: allIssues,
    totalPercentage,
    allViolations: currentFile,
  };
}

function calculateDiffData(currentFile, lastWeekFile) {
  const diffData = {
    fixedIssues: {
      critical: {},
      serious: {},
    },
    newIssues: {
      critical: {},
      serious: {},
    },
  };

  // Process each page in current data
  Object.entries(currentFile).forEach(([url, data]) => {
    if (url === 'overall') return;

    // Check for new critical issues
    Object.entries(data.violations.critical.items || {}).forEach(([issue]) => {
      if (issue === 'image-alt' || issue === 'role-img-alt' || issue === 'svg-img-alt') return;

      const prevData = lastWeekFile[url];
      if (!prevData || !prevData.violations.critical.items[issue]) {
        if (!diffData.newIssues.critical[url]) {
          diffData.newIssues.critical[url] = [];
        }
        diffData.newIssues.critical[url].push(issue);
      }
    });

    // Check for new serious issues
    Object.entries(data.violations.serious.items || {}).forEach(([issue]) => {
      if (issue === 'image-alt' || issue === 'role-img-alt' || issue === 'svg-img-alt') return;

      const prevData = lastWeekFile[url];
      if (!prevData || !prevData.violations.serious.items[issue]) {
        if (!diffData.newIssues.serious[url]) {
          diffData.newIssues.serious[url] = [];
        }
        diffData.newIssues.serious[url].push(issue);
      }
    });
  });

  // Process each page in previous data
  Object.entries(lastWeekFile).forEach(([url, data]) => {
    if (url === 'overall') return;

    // Check for fixed critical issues
    Object.entries(data.violations.critical.items || {}).forEach(([issue]) => {
      if (issue === 'image-alt' || issue === 'role-img-alt' || issue === 'svg-img-alt') return;

      const currentPageData = currentFile[url];
      if (!currentPageData || !currentPageData.violations.critical.items[issue]) {
        if (!diffData.fixedIssues.critical[url]) {
          diffData.fixedIssues.critical[url] = [];
        }
        diffData.fixedIssues.critical[url].push(issue);
      }
    });

    // Check for fixed serious issues
    Object.entries(data.violations.serious.items || {}).forEach(([issue]) => {
      if (issue === 'image-alt' || issue === 'role-img-alt' || issue === 'svg-img-alt') return;

      const currentPageData = currentFile[url];
      if (!currentPageData || !currentPageData.violations.serious.items[issue]) {
        if (!diffData.fixedIssues.serious[url]) {
          diffData.fixedIssues.serious[url] = [];
        }
        diffData.fixedIssues.serious[url].push(issue);
      }
    });
  });

  return diffData;
}

// =============================================
// Report Generation Functions
// =============================================

/**
 * Generate in-depth overview markdown report
 * @param {Object} currentFile - Current week's data
 * @param {Object} lastWeekFile - Last week's data
 * @returns {string} Path to the generated report file
 */
function generateInDepthOverviewMarkdown(currentFile, lastWeekFile) {
  // Process current week's data
  const currentData = currentFile;
  const previousData = lastWeekFile;

  // Calculate compliance overview
  const critical = currentData.overall.violations.critical.count;
  const serious = currentData.overall.violations.serious.count;

  let criticalChange = '-%';
  let seriousChange = '-%';
  let criticalEmoji = '🟢';
  let seriousEmoji = '🟢';

  // Only calculate changes if we have previous data and it has the required structure
  if (previousData && previousData.overall && previousData.overall.violations) {
    const prevCritical = previousData.overall.violations.critical.count;
    const prevSerious = previousData.overall.violations.serious.count;

    // eslint-disable-next-line max-len
    const criticalPercentage = prevCritical > 0 ? ((critical - prevCritical) / prevCritical) * 100 : 0;
    const seriousPercentage = prevSerious > 0 ? ((serious - prevSerious) / prevSerious) * 100 : 0;

    criticalChange = `${criticalPercentage.toFixed(2)}%`;
    seriousChange = `${seriousPercentage.toFixed(2)}%`;

    criticalEmoji = criticalPercentage > 0 ? '🔴' : '🟢';
    seriousEmoji = seriousPercentage > 0 ? '🔴' : '🟢';
  }

  // Generate the report sections
  let report = '### Accessibility Compliance Overview\n\n';
  report += 'A breakdown of accessibility issues found as a result of audits for the **first 100 pages** traffic wise.\n\n';
  report += '| | Current |Week Over Week |\n';
  report += '|--------|--------|--------|\n';
  report += `| **[Critical]()**| ${critical} | ${criticalChange} ${criticalEmoji}|\n`;
  report += `| **[Serious]()**| ${serious} | ${seriousChange} ${seriousEmoji}|\n\n`;

  // Add Week Over Week report section
  report += generateWeekOverWeekSection(currentData, previousData);

  // Calculate WCAG compliance data
  const wcagData = calculateWCAGData(currentData);

  // Add Road to WCAG sections
  report += generateRoadToWCAGSection(wcagData);

  // Add traffic violations section
  const trafficViolations = processTrafficViolations(currentData);
  report += generateAccessibilityComplianceSection(trafficViolations);

  // Add issues overview section
  const issuesOverview = {
    levelA: Object.entries(currentData.overall.violations.critical.items).map(([rule, data]) => ({
      rule,
      ...data,
    })),
    levelAA: Object.entries(currentData.overall.violations.serious.items).map(([rule, data]) => ({
      rule,
      ...data,
    })),
  };

  report += generateAccessibilityIssuesOverviewSection(issuesOverview);

  // Add quick wins section
  const quickWinsData = processQuickWinsData(currentData);
  const quickWinsSection = generateQuickWinsSection(quickWinsData, trafficViolations);
  report += quickWinsSection.mainSection;

  // Add enhancing accessibility section
  const enhancingSection = generateEnhancingAccessibilitySection(trafficViolations, issuesOverview);
  report += enhancingSection;

  // Add quick wins pages section after enhancing accessibility
  report += quickWinsSection.pagesSection;

  // Add Fixed and New Accessibility Issues sections
  const diffData = calculateDiffData(currentData, previousData);
  report += generateDiffSection(diffData);

  return report;
}

/**
 * Generate Base Report in markdown format
 * @param {Object} currentFile - Current week's data
 * @param {Object} lastWeekFile - Last week's data
 * @returns {string} Base report markdown
 */
function generateBaseReportMarkdown(currentFile, lastWeekFile) {
  let report = '';

  // Generate Accessibility Compliance Overview
  const critical = currentFile.overall.violations.critical.count;
  const serious = currentFile.overall.violations.serious.count;

  let criticalChange = '-%';
  let seriousChange = '-%';
  let criticalEmoji = '🟢';
  let seriousEmoji = '🟢';

  if (lastWeekFile && lastWeekFile.overall && lastWeekFile.overall.violations) {
    const prevCritical = lastWeekFile.overall.violations.critical.count;
    const prevSerious = lastWeekFile.overall.violations.serious.count;

    // eslint-disable-next-line max-len
    const criticalPercentage = prevCritical > 0 ? ((critical - prevCritical) / prevCritical) * 100 : 0;
    const seriousPercentage = prevSerious > 0 ? ((serious - prevSerious) / prevSerious) * 100 : 0;

    criticalChange = `${criticalPercentage.toFixed(2)}%`;
    seriousChange = `${seriousPercentage.toFixed(2)}%`;

    criticalEmoji = criticalPercentage > 0 ? '🔴' : '🟢';
    seriousEmoji = seriousPercentage > 0 ? '🔴' : '🟢';
  }

  report += '### Accessibility Compliance Overview\n\n';
  report += 'A breakdown of accessibility issues found as a result of audits for the **first 100 pages** traffic wise.\n\n';
  report += '| | Current |Week Over Week |\n';
  report += '|--------|--------|--------|\n';
  report += `| **[Critical]()**| ${critical} | ${criticalChange} ${criticalEmoji}|\n`;
  report += `| **[Serious]()**| ${serious} | ${seriousChange} ${seriousEmoji}|\n\n`;

  // Generate Road to WCAG sections
  const wcagData = calculateWCAGData(currentFile);
  report += generateRoadToWCAGSection(wcagData);

  // Generate Quick Wins section
  const trafficViolations = processTrafficViolations(currentFile);
  const quickWinsData = processQuickWinsData(currentFile);
  const quickWinsSection = generateQuickWinsSection(quickWinsData, trafficViolations);
  report += quickWinsSection.mainSection;

  // Generate Accessibility Compliance Issues vs Traffic section
  report += generateAccessibilityComplianceSection(trafficViolations);

  return report;
}

/**
 * Generate In-Depth Report in markdown format
 * @param {Object} currentFile - Current week's data
 * @returns {string} In-depth report markdown
 */
function generateInDepthReportMarkdown(currentFile) {
  let report = '';

  // Generate Accessibility Issues Overview section
  const issuesOverview = {
    levelA: Object.entries(currentFile.overall.violations.critical.items).map(([rule, data]) => ({
      rule,
      ...data,
    })),
    levelAA: Object.entries(currentFile.overall.violations.serious.items).map(([rule, data]) => ({
      rule,
      ...data,
    })),
  };

  report += generateAccessibilityIssuesOverviewSection(issuesOverview);

  return report;
}

/**
 * Generate Enhanced Report in markdown format
 * @param {Object} currentFile - Current week's data
 * @returns {string} Enhanced report markdown
 */
function generateEnhancedReportMarkdown(currentFile) {
  let report = '';

  // Process data for both sections
  const trafficViolations = processTrafficViolations(currentFile);
  const issuesOverview = {
    levelA: Object.entries(currentFile.overall.violations.critical.items).map(([rule, data]) => ({
      rule,
      ...data,
    })),
    levelAA: Object.entries(currentFile.overall.violations.serious.items).map(([rule, data]) => ({
      rule,
      ...data,
    })),
  };

  // Generate Enhancing accessibility section
  report += generateEnhancingAccessibilitySection(trafficViolations, issuesOverview);

  // Generate Quick Wins Pages section
  const quickWinsData = processQuickWinsData(currentFile);
  const quickWinsSection = generateQuickWinsSection(quickWinsData, trafficViolations);
  report += quickWinsSection.pagesSection;

  return report;
}

/**
 * Generate Fixed-New Report in markdown format
 * @param {Object} currentFile - Current week's data
 * @param {Object} lastWeekFile - Last week's data
 * @returns {string} Fixed-New report markdown
 */
function generateFixedNewReportMarkdown(currentFile, lastWeekFile) {
  // Return empty string if lastWeekFile is not provided or is invalid
  if (!lastWeekFile || !lastWeekFile.overall || !lastWeekFile.overall.violations) {
    return '';
  }

  let report = '';

  // Calculate diff data
  const diffData = calculateDiffData(currentFile, lastWeekFile);

  // Generate Fixed Accessibility Issues section
  report += '### Fixed Accessibility Issues\n\n';
  report += 'Here is a breakdown of fixed accessibility issues Week Over Week for first 100 pages traffic wise.\n\n';
  report += '| Page| Issues |Impact|\n';
  report += '|--------|--------|--------|\n';

  Object.entries(diffData.fixedIssues.critical).forEach(([page, issues]) => {
    const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
    if (filteredIssues.length > 0) {
      report += `| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | Critical |\n`;
    }
  });
  Object.entries(diffData.fixedIssues.serious).forEach(([page, issues]) => {
    const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
    if (filteredIssues.length > 0) {
      report += `| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | Serious |\n`;
    }
  });

  report += '\n---\n\n';

  // Generate New Accessibility Issues section
  report += '### New Accessibility Issues\n\n';
  report += 'Here is a breakdown of new accessibility issues Week Over Week for first 100 pages traffic wise.\n\n';
  report += '| Page| Issues |Impact|\n';
  report += '|--------|--------|--------|\n';

  Object.entries(diffData.newIssues.critical).forEach(([page, issues]) => {
    const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
    if (filteredIssues.length > 0) {
      report += `| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | Critical |\n`;
    }
  });
  Object.entries(diffData.newIssues.serious).forEach(([page, issues]) => {
    const filteredIssues = issues.filter((i) => i !== 'image-alt' && i !== 'role-img-alt' && i !== 'svg-img-alt');
    if (filteredIssues.length > 0) {
      report += `| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | Serious |\n`;
    }
  });

  report += '\n---\n\n';

  return report;
}

// Export all report generation functions
export {
  generateInDepthOverviewMarkdown,
  generateBaseReportMarkdown,
  generateInDepthReportMarkdown,
  generateEnhancedReportMarkdown,
  generateFixedNewReportMarkdown,
};
