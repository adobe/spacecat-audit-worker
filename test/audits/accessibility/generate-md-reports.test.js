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

/* eslint-env mocha */

import { expect } from 'chai';
import {
  escapeHtmlTags,
  formatFailureSummary,
  calculateWCAGData,
  processTrafficViolations,
  processQuickWinsData,
  calculateDiffData,
  generateRoadToWCAGSection,
  formatTraffic,
  generateAccessibilityComplianceIssuesVsTrafficSection,
  generateAccessibilityComplianceOverviewSection,
  generateAccessibilityIssuesOverviewSection,
  generateEnhancingAccessibilitySection,
  generateQuickWinsOverviewSection,
  generateQuickWinsPagesSection,
  generateWeekOverWeekSection,
  generateFixedIssuesSection,
  generateNewIssuesSection,
  generateBaseReportMarkdown,
  generateInDepthReportMarkdown,
  generateEnhancedReportMarkdown,
  generateFixedNewReportMarkdown,
} from '../../../src/accessibility/utils/generate-md-reports.js';

describe('generate-md-reports utility functions', () => {
  describe('escapeHtmlTags', () => {
    it('should preserve existing backtick-wrapped content', () => {
      const text = 'This has `<div>` tags and <span>other</span> tags';
      const result = escapeHtmlTags(text);
      // eslint-disable-next-line max-len
      expect(result).to.equal('This has `<div>` tags and `<span>`other`</span>` tags');
    });

    it('should handle empty text', () => {
      const result = escapeHtmlTags('');
      expect(result).to.equal('');
    });

    it('should handle null text', () => {
      const result = escapeHtmlTags(null);
      expect(result).to.equal('');
    });

    it('should handle undefined text', () => {
      const result = escapeHtmlTags(undefined);
      expect(result).to.equal('');
    });
  });

  describe('formatFailureSummary', () => {
    it('should format "Fix any of the following" sections', () => {
      const failureSummary = 'Fix any of the following:\nFirst issue\nSecond issue';
      const result = formatFailureSummary(failureSummary);
      // eslint-disable-next-line max-len
      expect(result).to.include('One or more of the following related issues may also be present:');
      expect(result).to.include('1. First issue');
      expect(result).to.include('2. Second issue');
    });

    it('should format "Fix all of the following" sections', () => {
      const failureSummary = 'Fix all of the following:\nCritical issue\nAnother critical issue';
      const result = formatFailureSummary(failureSummary);
      // eslint-disable-next-line max-len
      expect(result).to.include('The following issue has been identified and must be addressed:');
      expect(result).to.include('1. Critical issue');
      expect(result).to.include('2. Another critical issue');
    });

    it('should handle multiple sections and add previous section to result (lines 53-54)', () => {
      const failureSummary = `Fix any of the following:
First optional issue
Second optional issue
Fix all of the following:
First critical issue
Second critical issue`;
      const result = formatFailureSummary(failureSummary);

      // Should contain both sections
      // eslint-disable-next-line max-len
      expect(result).to.include('One or more of the following related issues may also be present:');
      expect(result).to.include('1. First optional issue');
      expect(result).to.include('2. Second optional issue');
      // eslint-disable-next-line max-len
      expect(result).to.include('The following issue has been identified and must be addressed:');
      expect(result).to.include('1. First critical issue');
      expect(result).to.include('2. Second critical issue');

      // Verify that both sections are present in the result
      // The function adds a newline between sections when processing multiple sections
      expect(result).to.match(/One or more of the following related issues may also be present:[\s\S]*The following issue has been identified and must be addressed:/);
    });

    it('should hit lines 53-54 when "Fix any" comes after another section', () => {
      // This test specifically targets lines 53-54 by having "Fix all" first, then "Fix any"
      // This ensures currentSection is populated when we hit the "Fix any" branch
      const failureSummary = `Fix all of the following:
Critical issue first
Fix any of the following:
Optional issue second`;
      const result = formatFailureSummary(failureSummary);

      // Should contain both sections in the correct order
      // eslint-disable-next-line max-len
      expect(result).to.include('The following issue has been identified and must be addressed:');
      expect(result).to.include('1. Critical issue first');
      // eslint-disable-next-line max-len
      expect(result).to.include('One or more of the following related issues may also be present:');
      expect(result).to.include('1. Optional issue second');

      // Verify the order - "Fix all" section should come first, then "Fix any"
      const criticalIndex = result.indexOf('The following issue has been identified');
      const optionalIndex = result.indexOf('One or more of the following related issues');
      expect(criticalIndex).to.be.lessThan(optionalIndex);
    });
  });

  describe('generateAccessibilityComplianceIssuesVsTrafficSection', () => {
    it('should handle pages with no traffic (line 257)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: null, // This will trigger the line 257 condition
          levelA: ['1 x `color-contrast`'],
          levelAA: ['2 x `focus-visible`'],
        },
        {
          url: 'https://example.com/page2',
          traffic: 1000,
          levelA: ['1 x `aria-label`'],
          levelAA: [],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page1 | - |'); // Should show '-' for null traffic
      expect(result).to.include('| https://example.com/page2 | 1K |'); // Should format traffic
    });
  });

  describe('generateAccessibilityComplianceOverviewSection', () => {
    it('should handle division by zero for previous counts (line 270)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 5 },
            serious: { count: 3 },
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 0 }, // This will trigger division by zero
            serious: { count: 0 }, // This will trigger division by zero
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      expect(result).to.include('0.00%'); // Should handle division by zero gracefully
    });
  });

  describe('generateAccessibilityIssuesOverviewSection', () => {
    it('should return empty string when no issues after filtering (line 299)', () => {
      const issuesOverview = {
        levelA: [
          { rule: 'image-alt', count: 5, level: 'A' }, // Will be filtered out
          { rule: 'role-img-alt', count: 3, level: 'A' }, // Will be filtered out
        ],
        levelAA: [
          { rule: 'svg-img-alt', count: 2, level: 'AA' }, // Will be filtered out
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // eslint-disable-next-line max-len
      expect(result).to.equal(''); // Should return empty string when all issues are filtered
    });

    it('should return empty string when sortedIssues length is 0 (lines 318-319)', () => {
      // Test the specific condition where sortedIssues.length === 0
      const issuesOverview = {
        levelA: [], // Empty array
        levelAA: [], // Empty array
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      expect(result).to.equal(''); // Should return empty string when no issues at all
    });

    it('should return empty string when only filtered issues exist (lines 318-319)', () => {
      // Another way to hit lines 318-319: only image-alt related issues
      const issuesOverview = {
        levelA: [
          { rule: 'image-alt', count: 10, level: 'A' },
          { rule: 'role-img-alt', count: 5, level: 'A' },
        ],
        levelAA: [
          { rule: 'svg-img-alt', count: 3, level: 'AA' },
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      expect(result).to.equal(''); // Should return empty string after filtering
    });

    it('should sort issues by count when levels are equal (lines 318-319)', () => {
      // Test the sorting logic when a.level === b.level
      const issuesOverview = {
        levelA: [
          {
            rule: 'color-contrast',
            count: 5,
            level: 'A',
            description: 'Color contrast issue',
            successCriteriaNumber: '143',
            understandingUrl: 'https://example.com/understanding1',
          },
          {
            rule: 'aria-label',
            count: 10, // Higher count, should come first
            level: 'A',
            description: 'Aria label issue',
            successCriteriaNumber: '412',
            understandingUrl: 'https://example.com/understanding2',
          },
        ],
        levelAA: [],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // Should sort by count descending when levels are equal
      const ariaLabelIndex = result.indexOf('aria-label');
      const colorContrastIndex = result.indexOf('color-contrast');
      expect(ariaLabelIndex).to.be.lessThan(colorContrastIndex);
    });
  });

  describe('generateEnhancingAccessibilitySection', () => {
    it('should handle issues not in issuesLookup (line 320)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `unknown-issue`'], // This issue won't be in issuesLookup
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [], // Empty, so issuesLookup will be empty
        levelAA: [],
      };
      const currentData = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'unknown-issue': {
                  failureSummary: 'Test failure summary',
                },
              },
            },
          },
        },
      };

      // eslint-disable-next-line max-len
      const result = generateEnhancingAccessibilitySection(trafficViolations, issuesOverview, currentData);

      expect(result).to.include('unknown-issue');
    });

    it('should handle missing page data in currentData (line 355)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `test-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'test-issue',
            description: 'Test issue',
            level: 'A',
            successCriteriaNumber: '111',
          },
        ],
        levelAA: [],
      };
      const currentData = {}; // Missing page data

      // eslint-disable-next-line max-len
      const result = generateEnhancingAccessibilitySection(trafficViolations, issuesOverview, currentData);

      expect(result).to.include('test-issue');
      // Should handle missing page data gracefully
    });

    it('should handle missing violations in page data (line 389)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `test-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'test-issue',
            description: 'Test issue',
            level: 'A',
            successCriteriaNumber: '111',
          },
        ],
        levelAA: [],
      };
      const currentData = {
        'https://example.com/page1': {
          // Missing violations property
        },
      };

      // eslint-disable-next-line max-len
      const result = generateEnhancingAccessibilitySection(trafficViolations, issuesOverview, currentData);

      expect(result).to.include('test-issue');
      // Should handle missing violations gracefully
    });

    it('should handle missing page violation items (line 403)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `test-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'test-issue',
            description: 'Test issue',
            level: 'A',
            successCriteriaNumber: '111',
          },
        ],
        levelAA: [],
      };
      const currentData = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                // Missing 'test-issue' item
              },
            },
          },
        },
      };

      // eslint-disable-next-line max-len
      const result = generateEnhancingAccessibilitySection(trafficViolations, issuesOverview, currentData);

      expect(result).to.include('test-issue');
      // Should handle missing violation items gracefully
    });

    it('should handle missing failureSummary in page violation (lines 406-408)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `test-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'test-issue',
            description: 'Test issue',
            level: 'A',
            successCriteriaNumber: '111',
          },
        ],
        levelAA: [],
      };
      const currentData = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'test-issue': {
                  // Missing failureSummary
                },
              },
            },
          },
        },
      };

      // eslint-disable-next-line max-len
      const result = generateEnhancingAccessibilitySection(trafficViolations, issuesOverview, currentData);

      expect(result).to.include('test-issue');
      // Should handle missing failureSummary gracefully
    });

    it('should sort issues by page count when levels are equal (lines 390-391)', () => {
      // Test the sorting logic when a.level === b.level and pagesDiff !== 0
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['2 x `issue-a`', '3 x `issue-b`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/page2',
          traffic: 900,
          levelA: ['1 x `issue-a`'], // issue-a appears on 2 pages
          levelAA: [],
        },
        {
          url: 'https://example.com/page3',
          traffic: 800,
          levelA: ['4 x `issue-b`'], // issue-b appears on 2 pages
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'issue-a',
            description: 'Issue A description',
            level: 'A',
            successCriteriaNumber: '111',
          },
          {
            rule: 'issue-b',
            description: 'Issue B description',
            level: 'A',
            successCriteriaNumber: '112',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      // eslint-disable-next-line max-len
      const result = generateEnhancingAccessibilitySection(trafficViolations, issuesOverview, currentData);

      // Both issues have same level (A) and same number of pages (2),
      // so they should be sorted by total count
      expect(result).to.include('issue-a');
      expect(result).to.include('issue-b');
    });

    it('should sort issues by total count when levels and page counts are equal (lines 392-394)', () => {
      // Test the sorting logic when pagesDiff === 0, so it falls back to total count
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['2 x `issue-low`', '5 x `issue-high`'], // issue-high has higher total count
          levelAA: [],
        },
        {
          url: 'https://example.com/page2',
          traffic: 900,
          levelA: ['1 x `issue-low`', '3 x `issue-high`'], // Both issues appear on 2 pages
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'issue-low',
            description: 'Issue with low count',
            level: 'A',
            successCriteriaNumber: '111',
          },
          {
            rule: 'issue-high',
            description: 'Issue with high count',
            level: 'A',
            successCriteriaNumber: '112',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      // eslint-disable-next-line max-len
      const result = generateEnhancingAccessibilitySection(trafficViolations, issuesOverview, currentData);

      // issue-high should come before issue-low due to higher total count (8 vs 3)
      const issueHighIndex = result.indexOf('Issue with high count');
      const issueLowIndex = result.indexOf('Issue with low count');
      expect(issueHighIndex).to.be.lessThan(issueLowIndex);
    });
  });

  describe('generateQuickWinsOverviewSection', () => {
    it('should return empty string when no groups after filtering (line 464)', () => {
      const quickWinsData = {
        topIssues: [
          { id: 'image-alt', description: 'Image alt', count: 5 }, // Will be filtered out
          { id: 'role-img-alt', description: 'Role img alt', count: 3 }, // Will be filtered out
          { id: 'svg-img-alt', description: 'SVG img alt', count: 2 }, // Will be filtered out
        ],
      };
      const enhancedReportUrl = 'https://example.com/enhanced';

      const result = generateQuickWinsOverviewSection(quickWinsData, enhancedReportUrl);

      // eslint-disable-next-line max-len
      expect(result).to.equal(''); // Should return empty string when all issues are filtered
    });
  });

  describe('generateQuickWinsPagesSection', () => {
    it('should handle missing allViolations property (line 505)', () => {
      const quickWinsData = {
        topIssues: [
          {
            id: 'test-issue',
            description: 'Test issue description',
            count: 5,
          },
        ],
        // Missing allViolations property
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('Test issue description');
      expect(result).to.include('| Test issue description | - |'); // Should show '-' for no pages
    });

    it('should return empty string when no groups after filtering (line 561)', () => {
      const quickWinsData = {
        topIssues: [
          { id: 'image-alt', description: 'Image alt', count: 5 }, // Will be filtered out
          { id: 'role-img-alt', description: 'Role img alt', count: 3 }, // Will be filtered out
        ],
        allViolations: {},
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.equal(''); // Should return empty string when all issues are filtered
    });

    it('should handle empty page info (line 564)', () => {
      const quickWinsData = {
        topIssues: [
          {
            id: 'test-issue',
            description: 'Test issue description',
            count: 5,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: { items: {} }, // No items
              serious: { items: {} },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('| Test issue description | - |'); // Should show '-' for empty page info
    });

    it('should aggregate counts for same issue on same URL (line 514)', () => {
      // Test the line where existingEntry.count += issueData.count
      const quickWinsData = {
        topIssues: [
          {
            id: 'test-issue',
            description: 'Test issue description',
            count: 10,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'test-issue': { count: 3 }, // First occurrence
                },
              },
              serious: {
                items: {
                  'test-issue': { count: 2 }, // Second occurrence - should be aggregated
                },
              },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      // Should aggregate the counts: 3 + 2 = 5
      expect(result).to.include('https://example.com/page1 (5)');
      expect(result).to.include('Test issue description');
    });
  });

  describe('generateWeekOverWeekSection', () => {
    it('should return empty string when all changes are "-" (lines 589-590)', () => {
      const currentData = {
        overall: {
          violations: {
            critical: { items: {} }, // No items
            serious: { items: {} },
          },
        },
      };
      const previousData = {
        overall: {
          violations: {
            critical: { items: {} }, // No items
            serious: { items: {} },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      expect(result).to.equal(''); // Should return empty string when no changes
    });

    it('should return empty string when previousData is null (lines 576-577)', () => {
      const currentData = {
        overall: {
          violations: {
            critical: { items: { 'test-issue': { count: 5 } } },
            serious: { items: {} },
          },
        },
      };
      const previousData = null; // No previous data
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      expect(result).to.equal(''); // Should return empty string when no previous data
    });

    it('should return empty string when previousData has no overall property (lines 576-577)', () => {
      const currentData = {
        overall: {
          violations: {
            critical: { items: { 'test-issue': { count: 5 } } },
            serious: { items: {} },
          },
        },
      };
      const previousData = {}; // Missing overall property
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      expect(result).to.equal(''); // Should return empty string when no overall data
    });

    it('should return empty string when previousData has no violations property (lines 576-577)', () => {
      const currentData = {
        overall: {
          violations: {
            critical: { items: { 'test-issue': { count: 5 } } },
            serious: { items: {} },
          },
        },
      };
      const previousData = {
        overall: {}, // Missing violations property
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      expect(result).to.equal(''); // Should return empty string when no violations data
    });

    it('should handle improved issues with count reduction', () => {
      const currentData = {
        overall: {
          violations: {
            critical: {
              items: {
                'test-issue': { count: 3 }, // Reduced from 5
              },
            },
            serious: { items: {} },
          },
        },
      };
      const previousData = {
        overall: {
          violations: {
            critical: {
              items: {
                'test-issue': { count: 5 }, // Was 5
              },
            },
            serious: { items: {} },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      expect(result).to.include('`test-issue` (2 less)'); // Should show improvement
    });

    it('should handle serious issue improvements with count reduction (lines 629-630)', () => {
      // Test the specific lines that calculate and format serious issue improvements
      const currentData = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: {
              items: {
                'serious-issue-1': { count: 2 }, // Reduced from 7 (5 less)
                'serious-issue-2': { count: 1 }, // Reduced from 4 (3 less)
              },
            },
          },
        },
      };
      const previousData = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: {
              items: {
                'serious-issue-1': { count: 7 }, // Was 7
                'serious-issue-2': { count: 4 }, // Was 4
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // Should show both serious issue improvements with correct reduction calculations
      expect(result).to.include('`serious-issue-1` (5 less)'); // 7 - 2 = 5 less
      expect(result).to.include('`serious-issue-2` (3 less)'); // 4 - 1 = 3 less
      expect(result).to.include('**[Serious]'); // Should be in the Serious row
    });
  });

  describe('generateFixedIssuesSection', () => {
    it('should return empty string when no fixed issues', () => {
      const diffData = {
        fixedIssues: {
          critical: {}, // No fixed critical issues
          serious: {}, // No fixed serious issues
        },
      };

      const result = generateFixedIssuesSection(diffData);

      expect(result).to.equal(''); // Should return empty string
    });

    it('should filter out image-alt related issues', () => {
      const diffData = {
        fixedIssues: {
          critical: {
            'https://example.com/page1': ['image-alt', 'test-issue'], // image-alt should be filtered
          },
          serious: {
            'https://example.com/page2': ['role-img-alt', 'another-issue'], // role-img-alt should be filtered
          },
        },
      };

      const result = generateFixedIssuesSection(diffData);

      expect(result).to.include('`test-issue`');
      expect(result).to.include('`another-issue`');
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
    });

    it('should handle pages with only filtered issues (lines 654-655)', () => {
      // Test the condition where filteredIssues.length > 0 is false
      const diffData = {
        fixedIssues: {
          critical: {
            'https://example.com/page1': ['image-alt', 'role-img-alt'], // All will be filtered out
          },
          serious: {
            'https://example.com/page2': ['svg-img-alt'], // Will be filtered out
          },
        },
      };

      const result = generateFixedIssuesSection(diffData);

      // Should not include any table rows for pages with only filtered issues
      expect(result).to.include('### Fixed Accessibility Issues');
      expect(result).to.include('| Page| Issues |Impact|');
      expect(result).to.not.include('https://example.com/page1');
      expect(result).to.not.include('https://example.com/page2');
    });
  });

  describe('generateNewIssuesSection', () => {
    it('should return empty string when no new issues', () => {
      const diffData = {
        newIssues: {
          critical: {}, // No new critical issues
          serious: {}, // No new serious issues
        },
      };

      const result = generateNewIssuesSection(diffData);

      expect(result).to.equal(''); // Should return empty string
    });

    it('should filter out image-alt related issues', () => {
      const diffData = {
        newIssues: {
          critical: {
            'https://example.com/page1': ['svg-img-alt', 'new-issue'], // svg-img-alt should be filtered
          },
          serious: {
            'https://example.com/page2': ['image-alt', 'serious-new-issue'], // image-alt should be filtered
          },
        },
      };

      const result = generateNewIssuesSection(diffData);

      expect(result).to.include('`new-issue`');
      expect(result).to.include('`serious-new-issue`');
      expect(result).to.not.include('svg-img-alt');
      expect(result).to.not.include('image-alt');
    });

    it('should handle pages with only filtered issues (lines 681-682)', () => {
      // Test the condition where filteredIssues.length > 0 is false
      const diffData = {
        newIssues: {
          critical: {
            'https://example.com/page1': ['image-alt', 'role-img-alt'], // All will be filtered out
          },
          serious: {
            'https://example.com/page2': ['svg-img-alt'], // Will be filtered out
          },
        },
      };

      const result = generateNewIssuesSection(diffData);

      // Should not include any table rows for pages with only filtered issues
      expect(result).to.include('### New Accessibility Issues');
      expect(result).to.include('| Page| Issues |Impact|');
      expect(result).to.not.include('https://example.com/page1');
      expect(result).to.not.include('https://example.com/page2');
    });
  });

  describe('generateFixedNewReportMarkdown', () => {
    it('should return empty string when lastWeek data is missing', () => {
      const mdData = {
        current: {
          overall: { violations: { total: 5 } },
        },
        lastWeek: null, // Missing lastWeek data
      };

      const result = generateFixedNewReportMarkdown(mdData);

      expect(result).to.equal(''); // Should return empty string
    });

    it('should return empty string when lastWeek violations are missing', () => {
      const mdData = {
        current: {
          overall: { violations: { total: 5 } },
        },
        lastWeek: {
          overall: {}, // Missing violations
        },
      };

      const result = generateFixedNewReportMarkdown(mdData);

      expect(result).to.equal(''); // Should return empty string
    });
  });

  describe('formatTraffic', () => {
    it('should format large numbers with K notation', () => {
      expect(formatTraffic(1000)).to.equal('1K');
      expect(formatTraffic(1500)).to.equal('1.5K');
      expect(formatTraffic(999)).to.equal('999');
    });

    it('should format very large numbers with M notation', () => {
      expect(formatTraffic(1000000)).to.equal('1M');
      expect(formatTraffic(1500000)).to.equal('1.5M');
    });
  });

  describe('calculateWCAGData', () => {
    it('should calculate WCAG compliance scores correctly', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: {
              items: {
                issue1: { level: 'A' },
                issue2: { level: 'A' },
              },
            },
            serious: {
              items: {
                issue3: { level: 'AA' },
              },
            },
          },
        },
      };

      const result = calculateWCAGData(currentFile);

      expect(result.failures.A).to.equal(2);
      expect(result.failures.AA).to.equal(1);
      expect(result.passed.A).to.equal(28); // 30 - 2
      expect(result.passed.AA).to.equal(19); // 20 - 1
      expect(result.complianceScores.A).to.be.closeTo(93.33, 0.01);
      expect(result.complianceScores.AA).to.be.closeTo(94, 0.01);
    });
  });

  describe('processTrafficViolations', () => {
    it('should process traffic violations correctly', () => {
      const currentFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': {
          traffic: 1000,
          violations: {
            critical: {
              items: {
                issue1: { count: 2 },
                issue2: { count: 1 },
              },
            },
            serious: {
              items: {
                issue3: { count: 3 },
              },
            },
          },
        },
      };

      const result = processTrafficViolations(currentFile);

      expect(result).to.have.lengthOf(1);
      expect(result[0].url).to.equal('https://example.com/page1');
      expect(result[0].traffic).to.equal(1000);
      expect(result[0].levelA).to.include('2 x `issue1`');
      expect(result[0].levelAA).to.include('3 x `issue3`');
    });
  });

  describe('processQuickWinsData', () => {
    it('should process quick wins data and filter image-alt issues', () => {
      const currentFile = {
        overall: {
          violations: {
            total: 100,
            critical: {
              items: {
                'image-alt': { count: 20 }, // Should be filtered out
                'color-contrast': { count: 15 },
                'aria-label': { count: 10 },
              },
            },
            serious: {
              items: {
                'role-img-alt': { count: 5 }, // Should be filtered out
                'focus-visible': { count: 8 },
              },
            },
          },
        },
      };

      const result = processQuickWinsData(currentFile);

      expect(result.topIssues).to.have.lengthOf(3); // Should exclude image-alt issues
      expect(result.topIssues[0].id).to.equal('color-contrast');
      expect(result.topIssues[0].percentage).to.equal('15.00');
      expect(result.totalPercentage).to.equal('33.00'); // (15+10+8)/100
    });
  });

  describe('calculateDiffData', () => {
    it('should calculate differences between current and last week data', () => {
      const currentFile = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'new-issue': { count: 1 }, // New issue
                'existing-issue': { count: 2 }, // Existing issue
              },
            },
            serious: { items: {} },
          },
        },
      };

      const lastWeekFile = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'existing-issue': { count: 1 }, // Was present
                'fixed-issue': { count: 1 }, // Now fixed
              },
            },
            serious: { items: {} },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result.newIssues.critical['https://example.com/page1']).to.include('new-issue');
      expect(result.fixedIssues.critical['https://example.com/page1']).to.include('fixed-issue');
    });
  });

  describe('generateRoadToWCAGSection', () => {
    it('should generate WCAG compliance sections', () => {
      const wcagData = {
        passed: { A: 25, AA: 18 },
        failures: { A: 5, AA: 2 },
        totals: { A: 30, AA: 20 },
        complianceScores: { A: 83.33, AA: 86.00 },
      };

      const result = generateRoadToWCAGSection(wcagData);

      expect(result).to.include('Road To WCAG 2.2 Level A');
      expect(result).to.include('Road To WCAG 2.2 Level AA');
      expect(result).to.include('83.33%');
      expect(result).to.include('86.00%');
      expect(result).to.include('| 30 | 25 | 5 | 83.33%|');
      expect(result).to.include('| 50 (30 Level A + 20 Level AA) | 43 (25 Level A + 18 Level AA) | 7 (5 Level A + 2 Level AA) | 86.00%|');
    });
  });

  describe('Integration tests for main report functions', () => {
    let mockMdData;

    beforeEach(() => {
      mockMdData = {
        current: {
          overall: {
            violations: {
              critical: {
                count: 5,
                items: {
                  'color-contrast': {
                    count: 3,
                    description: 'Color contrast issue',
                    level: 'A',
                    successCriteriaNumber: '143',
                    understandingUrl: 'https://example.com/understanding',
                  },
                },
              },
              serious: {
                count: 2,
                items: {
                  'focus-visible': {
                    count: 2,
                    description: 'Focus visible issue',
                    level: 'AA',
                    successCriteriaNumber: '241',
                    understandingUrl: 'https://example.com/understanding2',
                  },
                },
              },
            },
          },
          'https://example.com/page1': {
            traffic: 1000,
            violations: {
              critical: {
                items: {
                  'color-contrast': { count: 2 },
                },
              },
              serious: {
                items: {
                  'focus-visible': { count: 1 },
                },
              },
            },
          },
        },
        lastWeek: {
          overall: {
            violations: {
              critical: { count: 3 },
              serious: { count: 4 },
            },
          },
        },
        relatedReportsUrls: {
          inDepthReportUrl: 'https://example.com/in-depth',
          enhancedReportUrl: 'https://example.com/enhanced',
          fixedVsNewReportUrl: 'https://example.com/fixed-vs-new',
        },
      };
    });

    describe('generateBaseReportMarkdown', () => {
      it('should generate complete base report', () => {
        const result = generateBaseReportMarkdown(mockMdData);

        expect(result).to.include('Accessibility Compliance Overview');
        expect(result).to.include('Road To WCAG 2.2 Level A');
        expect(result).to.include('Quick Wins');
        expect(result).to.include('Accessibility Compliance Issues vs Traffic');
      });
    });

    describe('generateInDepthReportMarkdown', () => {
      it('should generate in-depth report', () => {
        const result = generateInDepthReportMarkdown(mockMdData);

        expect(result).to.include('Accessibility Issues Overview');
        expect(result).to.include('color-contrast');
        expect(result).to.include('focus-visible');
      });
    });

    describe('generateEnhancedReportMarkdown', () => {
      it('should generate enhanced report', () => {
        const result = generateEnhancedReportMarkdown(mockMdData);

        expect(result).to.include('Enhancing accessibility for the top 10 most-visited pages');
        expect(result).to.include('Quick Wins Pages Per Issue');
      });
    });

    describe('generateFixedNewReportMarkdown', () => {
      it('should generate fixed vs new report', () => {
        const mdDataWithDiffs = {
          ...mockMdData,
          lastWeek: {
            overall: { violations: { total: 10 } },
            'https://example.com/page1': {
              violations: {
                critical: {
                  items: {
                    'old-issue': { count: 1 }, // This will be "fixed"
                  },
                },
                serious: { items: {} },
              },
            },
          },
        };

        const result = generateFixedNewReportMarkdown(mdDataWithDiffs);

        expect(result).to.include('New Accessibility Issues');
      });
    });
  });
});
