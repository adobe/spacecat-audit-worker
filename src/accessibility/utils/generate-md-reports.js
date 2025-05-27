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

import {
  successCriteriaLinks,
  accessibilityIssuesImpact,
  accessibilitySolutions,
  accessibilitySuggestions,
  accessibilityUserImpact,
} from './constants.js';

/**
 * Escape HTML tags in text, but preserve existing backtick-wrapped content
 * @param {string} text - Text that might contain HTML tags
 * @returns {string} Text with HTML tags escaped
 */
function escapeHtmlTags(text) {
  if (!text) return '';
  const backtickContent = [];
  let escapedText = text.replace(/`([^`]+)`/g, (match, content) => {
    backtickContent.push(content);
    return '___BACKTICK___';
  });
  escapedText = escapedText.replace(/<([^>]+)>/g, '`<$1>`');
  return escapedText.replace(/___BACKTICK___/g, () => `\`${backtickContent.shift()}\``);
}

/**
 * Format failure summary text by replacing section headers and numbering items
 * @param {string} failureSummary - Raw failure summary text
 * @returns {string} Formatted failure summary
 */
function formatFailureSummary(failureSummary) {
  // Split into main sections
  const mainSections = failureSummary.split(/(?=Fix (?:any|all) of the following:)/);

  let result = '';
  let currentSection = '';

  mainSections.forEach((section) => {
    if (section.startsWith('Fix any of the following:')) {
      // If we have a previous section, add it to the result
      if (currentSection) {
        result += `${currentSection}\n`;
      }
      // Start new section
      const lines = section.split('\n').filter((line) => line.trim());
      let counter = 0; // Start from 0 since we'll pre-increment
      currentSection = lines.map((line, index) => {
        if (index === 0) {
          return 'One or more of the following related issues may also be present:';
        }
        counter += 1;
        return `${counter}. ${line.trim()}`;
      }).join('\n');
    } else if (section.startsWith('Fix all of the following:')) {
      // If we have a previous section, add it to the result
      if (currentSection) {
        result += `${currentSection}\n`;
      }
      // Start new section
      const lines = section.split('\n').filter((line) => line.trim());
      let counter = 0; // Start from 0 since we'll pre-increment
      currentSection = lines.map((line, index) => {
        if (index === 0) {
          return 'The following issue has been identified and must be addressed:';
        }
        counter += 1;
        return `${counter}. ${line.trim()}`;
      }).join('\n');
    }
  });
  // Add the last section
  if (currentSection) {
    result += currentSection;
  }

  return result.trim();
}
// =============================================
// Data Processing Functions
// =============================================

/**
 * Calculate WCAG compliance data
 * @param {Object} currentFile - Current week's data
 * @returns {Object} WCAG compliance data
 */
function calculateWCAGData(currentFile) {
  const criticalItems = currentFile.overall.violations.critical.items || {};
  const seriousItems = currentFile.overall.violations.serious.items || {};
  const violationsByLevel = { A: 0, AA: 0 };

  Object.values(criticalItems).forEach((item) => {
    if (item.level) violationsByLevel[item.level] += 1;
  });
  Object.values(seriousItems).forEach((item) => {
    if (item.level) violationsByLevel[item.level] += 1;
  });

  const levelATotal = 30;
  const levelAA = 20;
  const levelAATotal = levelATotal + levelAA;
  const levelASuccessTotal = levelATotal - violationsByLevel.A;
  const levelAASuccessTotal = levelAA - violationsByLevel.AA;

  return {
    passed: { A: levelASuccessTotal, AA: levelAASuccessTotal },
    failures: { A: violationsByLevel.A, AA: violationsByLevel.AA },
    totals: { A: levelATotal, AA: levelAA },
    complianceScores: {
      A: (levelASuccessTotal / levelATotal) * 100,
      AA: ((levelASuccessTotal + levelAASuccessTotal) / levelAATotal) * 100,
    },
  };
}

/**
 * Process traffic violations data
 * @param {Object} currentFile - Current week's data
 * @returns {Array} Processed traffic violations
 */
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

/**
 * Process quick wins data
 * @param {Object} currentFile - Current week's data
 * @returns {Object} Processed quick wins data
 */
function processQuickWinsData(currentFile) {
  const issueMap = new Map();
  const totalViolations = currentFile.overall.violations.total;

  Object.entries(currentFile.overall.violations.critical.items).forEach(([id, data]) => {
    if (id !== 'image-alt' && id !== 'role-img-alt' && id !== 'svg-img-alt') {
      // eslint-disable-next-line max-len
      issueMap.set(id, { id, ...data, percentage: ((data.count / totalViolations) * 100).toFixed(2) });
    }
  });

  Object.entries(currentFile.overall.violations.serious.items).forEach(([id, data]) => {
    if (id !== 'image-alt' && id !== 'role-img-alt' && id !== 'svg-img-alt' && !issueMap.has(id)) {
      // eslint-disable-next-line max-len
      issueMap.set(id, { id, ...data, percentage: ((data.count / totalViolations) * 100).toFixed(2) });
    }
  });

  const allIssues = Array.from(issueMap.values()).sort((a, b) => b.count - a.count);
  const topIssues = allIssues.slice(0, 3);
  // eslint-disable-next-line max-len
  const totalPercentage = topIssues.reduce((sum, issue) => sum + parseFloat(issue.percentage), 0).toFixed(2);

  return { topIssues: allIssues, totalPercentage, allViolations: currentFile };
}

/**
 * Calculate diff data between current and previous week
 * @param {Object} currentFile - Current week's data
 * @param {Object} lastWeekFile - Last week's data
 * @returns {Object} Diff data
 */
function calculateDiffData(currentFile, lastWeekFile) {
  const diffData = {
    fixedIssues: { critical: {}, serious: {} },
    newIssues: { critical: {}, serious: {} },
  };

  Object.entries(currentFile).forEach(([url, data]) => {
    if (url === 'overall') return;
    const prevData = lastWeekFile[url];

    ['critical', 'serious'].forEach((level) => {
      Object.entries(data.violations[level].items || {}).forEach(([issue]) => {
        if (issue === 'image-alt' || issue === 'role-img-alt' || issue === 'svg-img-alt') return;
        if (!prevData || !prevData.violations[level].items[issue]) {
          if (!diffData.newIssues[level][url]) diffData.newIssues[level][url] = [];
          diffData.newIssues[level][url].push(issue);
        }
      });
    });
  });

  Object.entries(lastWeekFile).forEach(([url, data]) => {
    if (url === 'overall') return;
    const currentPageData = currentFile[url];

    ['critical', 'serious'].forEach((level) => {
      Object.entries(data.violations[level].items || {}).forEach(([issue]) => {
        if (issue === 'image-alt' || issue === 'role-img-alt' || issue === 'svg-img-alt') return;
        if (!currentPageData || !currentPageData.violations[level].items[issue]) {
          if (!diffData.fixedIssues[level][url]) diffData.fixedIssues[level][url] = [];
          diffData.fixedIssues[level][url].push(issue);
        }
      });
    });
  });

  return diffData;
}

// =============================================
// Section Generation Functions
// =============================================

// WCAG Compliance Sections
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
 * Format traffic numbers to use K for thousands and M for millions
 * @param {number} traffic - Traffic number
 * @returns {string} Formatted traffic value
 */
function formatTraffic(traffic) {
  return Intl.NumberFormat('en', { notation: 'compact' }).format(traffic);
}

// eslint-disable-next-line max-len
function generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl) {
  let section = `### Accessibility Compliance Issues vs Traffic | **[In-Depth Report](${enhancedReportUrl})**\n\n`;
  section += 'An overview of top 10 pages in terms of traffic with the accessibility issues overview\n\n';
  section += '| Page | Traffic |Total Issues  |Level A |Level AA |\n';
  section += '|--------|--------|--------|--------|--------|\n';

  const sortedByTraffic = [...trafficViolations]
    .sort((a, b) => (b.traffic || 0) - (a.traffic || 0))
    .slice(0, 10);

  sortedByTraffic.forEach((page) => {
    const filteredLevelA = page.levelA.filter((issue) => !issue.includes('`image-alt`')
      && !issue.includes('`role-img-alt`')
      && !issue.includes('`svg-img-alt`'));
    const filteredLevelAA = page.levelAA.filter((issue) => !issue.includes('`image-alt`')
      && !issue.includes('`role-img-alt`')
      && !issue.includes('`svg-img-alt`'));

    const filteredTotalIssues = filteredLevelA.length + filteredLevelAA.length;

    section += `| ${page.url} | ${page.traffic ? formatTraffic(page.traffic) : '-'} | ${filteredTotalIssues} | ${filteredLevelA.length > 0 ? filteredLevelA.join(', ') : '-'} | ${filteredLevelAA.length > 0 ? filteredLevelAA.join(', ') : '-'} |\n`;
  });

  section += '\n---\n\n';
  return section;
}

// eslint-disable-next-line max-len
function generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl) {
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

  let section = '### Accessibility Compliance Overview\n\n';
  section += 'A breakdown of accessibility issues found as a result of audits for the **first 100 pages** traffic wise.\n\n';
  section += '| | Current |Week Over Week |\n';
  section += '|--------|--------|--------|\n';
  section += `| **[Critical](${inDepthReportUrl})**| ${critical} | ${criticalChange} ${criticalEmoji}|\n`;
  section += `| **[Serious](${inDepthReportUrl})**| ${serious} | ${seriousChange} ${seriousEmoji}|\n\n`;

  return section;
}

// Issues Overview Sections
function generateAccessibilityIssuesOverviewSection(issuesOverview) {
  const sortedIssues = [...issuesOverview.levelA, ...issuesOverview.levelAA]
    .filter((issue) => issue.rule !== 'image-alt' && issue.rule !== 'role-img-alt' && issue.rule !== 'svg-img-alt')
    .sort((a, b) => {
      if (a.level === b.level) {
        return b.count - a.count;
      }
      return a.level === 'A' ? -1 : 1;
    });

  if (sortedIssues.length === 0) return '';

  let section = '\n### Accessibility Issues Overview\n\n';
  section += '| Issue | WCAG Success Criterion | Count| Level |Impact| Description | WCAG Docs Link |\n';
  section += '|-------|-------|-------------|-------------|-------------|-------------|-------------|\n';

  sortedIssues.forEach((issue) => {
    const impact = accessibilityIssuesImpact[issue.rule] || '';

    section += `| ${issue.rule} | [${issue.successCriteriaNumber.split('').join('.')} ${escapeHtmlTags(successCriteriaLinks[issue.successCriteriaNumber]?.name)}](${successCriteriaLinks[issue.successCriteriaNumber]?.successCriterionUrl}) |${issue.count} | ${issue.level} | ${impact} | ${escapeHtmlTags(issue.description)} | ${issue.understandingUrl} |\n`;
  });

  section += '\n---\n\n';
  return section;
}

function generateEnhancingAccessibilitySection(trafficViolations, issuesOverview, currentData) {
  const issuesLookup = {};
  [...issuesOverview.levelA, ...issuesOverview.levelAA].forEach((issue) => {
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

  const topPages = [...trafficViolations]
    .sort((a, b) => (b.traffic || 0) - (a.traffic || 0))
    .slice(0, 10);

  const commonIssues = {};

  topPages.forEach((page) => {
    ['levelA', 'levelAA'].forEach((level) => {
      page[level].forEach((issueText) => {
        const match = issueText.match(/(\d+) x `([^`]+)`/);
        if (match) {
          const count = parseInt(match[1], 10);
          const issueName = match[2];

          if (issueName === 'image-alt' || issueName === 'role-img-alt' || issueName === 'svg-img-alt') return;

          if (!commonIssues[issueName]) {
            commonIssues[issueName] = {
              name: issueName,
              level: level === 'levelA' ? 'A' : 'AA',
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
  });

  const sortedIssues = Object.values(commonIssues)
    .sort((a, b) => {
      if (a.level !== b.level) return a.level === 'A' ? -1 : 1;
      const pagesDiff = b.pages.length - a.pages.length;
      if (pagesDiff !== 0) return pagesDiff;
      const aTotal = a.pages.reduce((sum, p) => sum + p.count, 0);
      const bTotal = b.pages.reduce((sum, p) => sum + p.count, 0);
      return bTotal - aTotal;
    });

  let section = '### Enhancing accessibility for the top 10 most-visited pages\n\n';
  section += '| Issue | WCAG Success Criterion | Level| Pages |Description| How is the user affected | Suggestion | Solution Example |\n';
  section += '|-------|-------|-------------|-------------|-------------|-------------|-------------|-------------|\n';

  sortedIssues.forEach((issue) => {
    const pagesText = issue.pages.map((p) => `${p.url} (${p.count})`).join(', ');
    const description = issuesLookup[issue.name] ? issuesLookup[issue.name].description : '';
    const userImpact = escapeHtmlTags(accessibilityUserImpact[issue.name] || '');
    const suggestion = escapeHtmlTags(accessibilitySuggestions[issue.name] || '');
    const successCriteriaNumber = issuesLookup[issue.name] ? issuesLookup[issue.name].successCriteriaNumber : '';
    const criterionName = issuesLookup[issue.name] ? issuesLookup[issue.name].criterionName : '';
    const criterionUrl = issuesLookup[issue.name] ? issuesLookup[issue.name].criterionUrl : '';

    let failureSummary = '';
    const level = issue.level === 'A' ? 'critical' : 'serious';
    if (issue.pages && issue.pages.length > 0) {
      const firstPage = issue.pages[0];
      const pageData = currentData[firstPage.url];
      if (pageData && pageData.violations) {
        const pageViolation = pageData.violations[level]?.items?.[issue.name];
        if (pageViolation && pageViolation.failureSummary) {
          failureSummary = escapeHtmlTags(formatFailureSummary(pageViolation.failureSummary))
            .replace(/\n/g, '<br>')
            .replace(/\|/g, '&#124;');
        }
      }
    }

    section += `| ${issue.name} | [${successCriteriaNumber.split('').join('.')} ${criterionName}](${criterionUrl}) | ${issue.level} | ${pagesText} | ${description} | ${userImpact} | ${suggestion} | ${failureSummary} |\n`;
  });

  section += '\n---\n\n';
  return section;
}

// Quick Wins Sections
function generateQuickWinsOverviewSection(quickWinsData, enhancedReportUrl) {
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

  // eslint-disable-next-line max-len
  const totalIssues = Array.from(groupedIssues.values()).reduce((sum, group) => sum + group.count, 0);
  const sortedGroups = Array.from(groupedIssues.values())
    .map((group) => ({
      ...group,
      percentage: ((group.count / totalIssues) * 100).toFixed(2),
    }))
    .sort((a, b) => {
      const percentageDiff = parseFloat(b.percentage) - parseFloat(a.percentage);
      if (percentageDiff !== 0) return percentageDiff;
      return a.level === 'A' ? -1 : 1;
    })
    .slice(0, 3);

  if (sortedGroups.length === 0) {
    return '';
  }

  // eslint-disable-next-line max-len
  const totalPercentage = sortedGroups.reduce((sum, group) => sum + parseFloat(group.percentage), 0).toFixed(2);

  const sections = [
    `### Quick Wins | **[In-depth details at the bottom of the page](${enhancedReportUrl})**\n\n`,
    'Here is a list of accessibility issues that can be resolved site-wide, having a significant impact with minimal effort, as the changes may be required in only a few places.\n\n',
    `Solving the below issues could decrease accessibility issues by ${totalPercentage}%.\n\n`,
    '| Issue | WCAG Success Criterion | % of Total |Level|Impact|How To Solve|\n',
    '|--------|--------|--------|--------|--------|--------|\n',
  ];

  sortedGroups.forEach((group) => {
    const firstIssue = group.issues[0];
    const howToSolve = escapeHtmlTags(accessibilitySolutions[firstIssue.id] || 'Review and fix according to WCAG guidelines.');

    const impact = accessibilityIssuesImpact[firstIssue.id] || '';

    // eslint-disable-next-line max-len
    sections.push(`| ${escapeHtmlTags(group.description)} | [${group.successCriteriaNumber.split('').join('.')} ${escapeHtmlTags(successCriteriaLinks[group.successCriteriaNumber]?.name)}](${successCriteriaLinks[group.successCriteriaNumber]?.successCriterionUrl}) | ${group.percentage}% | ${group.level} | ${impact} | ${howToSolve} |\n`);
  });

  sections.push('\n---\n\n');
  return sections.join('');
}

function generateQuickWinsPagesSection(quickWinsData) {
  const issuePageMap = {};

  if (quickWinsData.allViolations) {
    Object.entries(quickWinsData.allViolations).forEach(([url, data]) => {
      if (url === 'overall') return;

      ['critical', 'serious'].forEach((level) => {
        Object.entries(data.violations[level].items || {}).forEach(([issueName, issueData]) => {
          if (issueName === 'image-alt' || issueName === 'role-img-alt' || issueName === 'svg-img-alt') return;

          if (!issuePageMap[issueName]) {
            issuePageMap[issueName] = [];
          }

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
    });
  }

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

  const sortedGroups = Array.from(groupedIssues.values())
    .sort((a, b) => b.count - a.count);

  if (sortedGroups.length === 0) {
    return '';
  }

  const sections = [
    '### Quick Wins Pages Per Issue\n\n',
    'Below is a detailed breakdown of all pages affected by each quick win issue.\n\n',
    '| Issue | Pages |\n',
    '|--------|--------|\n',
  ];

  sortedGroups.forEach((group) => {
    const pageInfo = issuePageMap[group.issues[0].id] || [];
    const pagesText = pageInfo.length > 0
      ? pageInfo.map((p) => `${p.url} (${p.count})`).join(', ')
      : '-';

    sections.push(`| ${escapeHtmlTags(group.description)} | ${pagesText} |\n`);
  });

  sections.push('\n---\n\n');
  return sections.join('');
}

// Week Over Week Sections
function generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl) {
  if (!previousData?.overall?.violations) {
    return '';
  }

  const sections = [
    'A Week Over Week breadown of fixed and new accessibility issues for the first 100 pages traffic wise.\n\n',
    '| | Fixed | Improved | New |\n',
    '|--------|--------|--------|--------|\n',
  ];

  const filterImageAlt = (issue) => issue !== 'image-alt'
    && issue !== 'role-img-alt'
    && issue !== 'svg-img-alt';

  const currentCritical = currentData?.overall?.violations?.critical?.items || {};
  const currentSerious = currentData?.overall?.violations?.serious?.items || {};
  const previousCritical = previousData?.overall?.violations?.critical?.items || {};
  const previousSerious = previousData?.overall?.violations?.serious?.items || {};

  // eslint-disable-next-line max-len
  const criticalNew = Object.entries(currentCritical)
    .filter(([issue]) => !previousCritical[issue] && filterImageAlt(issue))
    .map(([issue]) => `\`${issue}\``)
    .join(', ') || '-';

  // eslint-disable-next-line max-len
  const criticalImproved = Object.entries(currentCritical)
    .filter(([issue, data]) => previousCritical[issue]
      && data.count < previousCritical[issue].count
      && filterImageAlt(issue))
    .map(([issue, data]) => {
      const reduction = previousCritical[issue].count - data.count;
      return `\`${issue}\` (${reduction} less)`;
    })
    .join(', ') || '-';

  // eslint-disable-next-line max-len
  const criticalFixed = Object.entries(previousCritical)
    .filter(([issue]) => !currentCritical[issue] && filterImageAlt(issue))
    .map(([issue]) => `\`${issue}\``)
    .join(', ') || '-';

  // eslint-disable-next-line max-len
  const seriousNew = Object.entries(currentSerious)
    .filter(([issue]) => !previousSerious[issue] && filterImageAlt(issue))
    .map(([issue]) => `\`${issue}\``)
    .join(', ') || '-';

  // eslint-disable-next-line max-len
  const seriousImproved = Object.entries(currentSerious)
    .filter(([issue, data]) => previousSerious[issue]
      && data.count < previousSerious[issue].count
      && filterImageAlt(issue))
    .map(([issue, data]) => {
      const reduction = previousSerious[issue].count - data.count;
      return `\`${issue}\` (${reduction} less)`;
    })
    .join(', ') || '-';

  // eslint-disable-next-line max-len
  const seriousFixed = Object.entries(previousSerious)
    .filter(([issue]) => !currentSerious[issue] && filterImageAlt(issue))
    .map(([issue]) => `\`${issue}\``)
    .join(', ') || '-';

  if (criticalFixed === '-' && criticalImproved === '-' && criticalNew === '-' && seriousFixed === '-' && seriousImproved === '-' && seriousNew === '-') return '';

  sections.push(
    `| **[Critical](${fixedVsNewReportUrl})** | ${criticalFixed} | ${criticalImproved} | ${criticalNew} |\n`,
    `| **[Serious](${fixedVsNewReportUrl})** | ${seriousFixed} | ${seriousImproved} | ${seriousNew} |\n`,
    '\n---\n\n',
  );

  return sections.join('');
}

function generateFixedIssuesSection(diffData) {
  // eslint-disable-next-line max-len
  if (Object.keys(diffData.fixedIssues.critical).length === 0 && Object.keys(diffData.fixedIssues.serious).length === 0) {
    return '';
  }

  const sections = [
    '### Fixed Accessibility Issues\n\n',
    'Here is a breakdown of fixed accessibility issues Week Over Week for first 100 pages traffic wise.\n\n',
    '| Page| Issues |Impact|\n',
    '|--------|--------|--------|\n',
  ];

  ['critical', 'serious'].forEach((level) => {
    Object.entries(diffData.fixedIssues[level]).forEach(([page, issues]) => {
      const filteredIssues = issues.filter((i) => !['image-alt', 'role-img-alt', 'svg-img-alt'].includes(i));
      if (filteredIssues.length > 0) {
        // eslint-disable-next-line max-len
        sections.push(`| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | ${level.charAt(0).toUpperCase() + level.slice(1)} |\n`);
      }
    });
  });

  sections.push('\n---\n\n');
  return sections.join('');
}

function generateNewIssuesSection(diffData) {
  // eslint-disable-next-line max-len
  if (Object.keys(diffData.newIssues.critical).length === 0 && Object.keys(diffData.newIssues.serious).length === 0) {
    return '';
  }

  const sections = [
    '### New Accessibility Issues\n\n',
    'Here is a breakdown of new accessibility issues Week Over Week for first 100 pages traffic wise.\n\n',
    '| Page| Issues |Impact|\n',
    '|--------|--------|--------|\n',
  ];

  ['critical', 'serious'].forEach((level) => {
    Object.entries(diffData.newIssues[level]).forEach(([page, issues]) => {
      const filteredIssues = issues.filter((i) => !['image-alt', 'role-img-alt', 'svg-img-alt'].includes(i));
      if (filteredIssues.length > 0) {
        // eslint-disable-next-line max-len
        sections.push(`| ${escapeHtmlTags(page)} | ${filteredIssues.map((i) => `\`${i}\``).join(', ')} | ${level.charAt(0).toUpperCase() + level.slice(1)} |\n`);
      }
    });
  });

  sections.push('\n---\n\n');
  return sections.join('');
}

// =============================================
// Main Report Generation Functions
// =============================================

/**
 * Generate Base Report in markdown format
 * @param {Object} currentFile - Current week's data
 * @param {Object} lastWeekFile - Last week's data
 * @returns {string} Base report markdown
 */
function generateBaseReportMarkdown(mdData) {
  const { currentFile, lastWeekFile, relatedReportsUrls } = mdData;
  const {
    inDepthReportUrl,
    enhancedReportUrl,
    fixedVsNewReportUrl,
  } = relatedReportsUrls;

  const wcagData = calculateWCAGData(currentFile);
  const trafficViolations = processTrafficViolations(currentFile);
  const quickWinsData = processQuickWinsData(currentFile);

  return [
    generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl),
    generateWeekOverWeekSection(currentFile, lastWeekFile, fixedVsNewReportUrl),
    generateRoadToWCAGSection(wcagData),
    generateQuickWinsOverviewSection(quickWinsData, enhancedReportUrl),
    generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl),
  ].join('');
}

/**
 * Generate In-Depth Report in markdown format
 * @param {Object} currentFile - Current week's data
 * @returns {string} In-depth report markdown
 */
function generateInDepthReportMarkdown(mdData) {
  const { currentFile } = mdData;
  const issuesOverview = {
    // eslint-disable-next-line max-len
    levelA: Object.entries(currentFile.overall.violations.critical.items).map(([rule, data]) => ({ rule, ...data })),
    // eslint-disable-next-line max-len
    levelAA: Object.entries(currentFile.overall.violations.serious.items).map(([rule, data]) => ({ rule, ...data })),
  };
  return generateAccessibilityIssuesOverviewSection(issuesOverview);
}

/**
 * Generate Enhanced Report in markdown format
 * @param {Object} currentFile - Current week's data
 * @returns {string} Enhanced report markdown
 */
function generateEnhancedReportMarkdown(mdData) {
  const { currentFile } = mdData;
  const trafficViolations = processTrafficViolations(currentFile);
  const issuesOverview = {
    // eslint-disable-next-line max-len
    levelA: Object.entries(currentFile.overall.violations.critical.items).map(([rule, data]) => ({ rule, ...data })),
    // eslint-disable-next-line max-len
    levelAA: Object.entries(currentFile.overall.violations.serious.items).map(([rule, data]) => ({ rule, ...data })),
  };
  const quickWinsData = processQuickWinsData(currentFile);

  return [
    generateEnhancingAccessibilitySection(trafficViolations, issuesOverview, currentFile),
    generateQuickWinsPagesSection(quickWinsData, ''),
  ].join('');
}

/**
 * Generate Fixed-New Report in markdown format
 * @param {Object} currentFile - Current week's data
 * @param {Object} lastWeekFile - Last week's data
 * @returns {string} Fixed-New report markdown
 */
function generateFixedNewReportMarkdown(mdData) {
  const { currentFile, lastWeekFile } = mdData;
  if (!lastWeekFile?.overall?.violations) return '';

  const diffData = calculateDiffData(currentFile, lastWeekFile);
  const sections = [];

  // Fixed Issues Section
  const fixedIssuesSection = generateFixedIssuesSection(diffData);
  if (fixedIssuesSection) {
    sections.push(fixedIssuesSection);
  }

  // New Issues Section
  const newIssuesSection = generateNewIssuesSection(diffData);
  if (newIssuesSection) {
    sections.push(newIssuesSection);
  }

  return sections.join('');
}

// Export all report generation functions
export {
  generateBaseReportMarkdown,
  generateInDepthReportMarkdown,
  generateEnhancedReportMarkdown,
  generateFixedNewReportMarkdown,
};
