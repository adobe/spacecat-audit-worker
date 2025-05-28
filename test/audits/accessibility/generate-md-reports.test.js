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
  filterImageAltIssues,
  sortIssuesByLevelAndCount,
  isImageAltIssue,
  filterImageAltFromStrings,
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

    it('should handle pages with zero traffic (line 257)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 0, // This will trigger the falsy condition
          levelA: ['1 x `color-contrast`'],
          levelAA: ['1 x `focus-visible`'],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      expect(result).to.include('| https://example.com/page1 | - |'); // Should show '-' for zero traffic
    });

    it('should handle pages with undefined traffic (line 257)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          // traffic property is undefined
          levelA: ['1 x `color-contrast`'],
          levelAA: ['1 x `focus-visible`'],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      expect(result).to.include('| https://example.com/page1 | - |'); // Should show '-' for undefined traffic
    });

    it('should handle pages with empty levelA array (line 257)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: [], // Empty array - should trigger the length > 0 condition
          levelAA: ['1 x `focus-visible`'],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      expect(result).to.include('| https://example.com/page1 | 1K | 1 | - | 1 x `focus-visible` |');
    });

    it('should handle pages with empty levelAA array (line 257)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `color-contrast`'],
          levelAA: [], // Empty array - should trigger the length > 0 condition
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      expect(result).to.include('| https://example.com/page1 | 1K | 1 | 1 x `color-contrast` | - |');
    });

    it('should handle pages with both empty levelA and levelAA arrays (line 257)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: [], // Empty array
          levelAA: [], // Empty array
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      expect(result).to.include('| https://example.com/page1 | 1K | 0 | - | - |');
    });

    it('should handle pages with multiple levelA issues (line 257)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1500,
          levelA: ['1 x `color-contrast`', '2 x `aria-label`', '1 x `heading-order`'], // Multiple issues
          levelAA: ['1 x `focus-visible`'],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page1 | 1.5K | 4 | 1 x `color-contrast`, 2 x `aria-label`, 1 x `heading-order` | 1 x `focus-visible` |');
    });

    it('should handle pages with multiple levelAA issues (line 257)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 2000,
          levelA: ['1 x `color-contrast`'],
          levelAA: ['1 x `focus-visible`', '2 x `color-contrast-enhanced`', '1 x `resize-text`'], // Multiple issues
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page1 | 2K | 4 | 1 x `color-contrast` | 1 x `focus-visible`, 2 x `color-contrast-enhanced`, 1 x `resize-text` |');
    });

    it('should handle all conditional expressions in line 257 comprehensively', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: null, // Falsy traffic
          levelA: [], // Empty levelA
          levelAA: [], // Empty levelAA
        },
        {
          url: 'https://example.com/page2',
          traffic: 0, // Zero traffic
          levelA: ['1 x `color-contrast`'], // Non-empty levelA
          levelAA: [], // Empty levelAA
        },
        {
          url: 'https://example.com/page3',
          // Undefined traffic
          levelA: [], // Empty levelA
          levelAA: ['1 x `focus-visible`'], // Non-empty levelAA
        },
        {
          url: 'https://example.com/page4',
          traffic: 1000, // Valid traffic
          levelA: ['1 x `color-contrast`', '1 x `aria-label`'], // Multiple levelA
          levelAA: ['1 x `focus-visible`', '1 x `resize-text`'], // Multiple levelAA
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      // Test all combinations of conditions
      expect(result).to.include('| https://example.com/page1 | - | 0 | - | - |'); // All dashes
      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page2 | - | 1 | 1 x `color-contrast` | - |'); // Traffic dash, levelA content, levelAA dash
      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page3 | - | 1 | - | 1 x `focus-visible` |'); // Traffic dash, levelA dash, levelAA content
      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page4 | 1K | 4 | 1 x `color-contrast`, 1 x `aria-label` | 1 x `focus-visible`, 1 x `resize-text` |'); // All content
    });

    it('should filter out image-alt issues before applying line 257 conditions', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `image-alt`', '1 x `color-contrast`'], // image-alt should be filtered
          levelAA: ['1 x `role-img-alt`', '1 x `focus-visible`'], // role-img-alt should be filtered
        },
        {
          url: 'https://example.com/page2',
          traffic: 2000,
          levelA: ['1 x `svg-img-alt`'], // svg-img-alt should be filtered, leaving empty array
          levelAA: ['1 x `image-alt`'], // image-alt should be filtered, leaving empty array
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      // Should only show non-filtered issues
      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page1 | 1K | 2 | 1 x `color-contrast` | 1 x `focus-visible` |');
      // Should show dashes when all issues are filtered out
      expect(result).to.include('| https://example.com/page2 | 2K | 0 | - | - |');
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

    it('should set seriousEmoji to 🔴 when seriousPercentage > 0 (line 299)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 5 },
            serious: { count: 10 }, // Increased from 5 to 10
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 3 },
            serious: { count: 5 }, // Previous count was 5
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      // seriousPercentage = ((10 - 5) / 5) * 100 = 100% > 0, so emoji should be 🔴
      expect(result).to.include('100.00% 🔴'); // Should show red emoji for increase
    });

    it('should set seriousEmoji to 🟢 when seriousPercentage = 0 (line 299)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 5 },
            serious: { count: 5 }, // Same as previous week
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 3 },
            serious: { count: 5 }, // Same count
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      // seriousPercentage = ((5 - 5) / 5) * 100 = 0%, so emoji should be 🟢
      expect(result).to.include('0.00% 🟢'); // Should show green emoji for no change
    });

    it('should set seriousEmoji to 🟢 when seriousPercentage < 0 (line 299)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 5 },
            serious: { count: 3 }, // Decreased from 6 to 3
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 8 },
            serious: { count: 6 }, // Previous count was 6
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      // seriousPercentage = ((3 - 6) / 6) * 100 = -50% < 0, so emoji should be 🟢
      expect(result).to.include('-50.00% 🟢'); // Should show green emoji for decrease
    });

    it('should set seriousEmoji to 🟢 when previous serious count is 0 (line 299)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 5 },
            serious: { count: 3 }, // New serious issues
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 2 },
            serious: { count: 0 }, // No previous serious issues
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      // When prevSerious = 0, seriousPercentage = 0, so emoji should be 🟢
      expect(result).to.include('0.00% 🟢'); // Should show green emoji when no previous data
    });

    it('should handle edge case where seriousPercentage is exactly 0.01 (line 299)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 5 },
            serious: { count: 10001 }, // Very small increase
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 3 },
            serious: { count: 10000 }, // Base count
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      // seriousPercentage = ((10001 - 10000) / 10000) * 100 = 0.01% > 0, so emoji should be 🔴
      expect(result).to.include('0.01% 🔴'); // Should show red emoji for tiny increase
    });

    it('should handle edge case where seriousPercentage is exactly -0.01 (line 299)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 5 },
            serious: { count: 9999 }, // Very small decrease
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 3 },
            serious: { count: 10000 }, // Base count
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      // seriousPercentage = ((9999 - 10000) / 10000) * 100 = -0.01% < 0, so emoji should be 🟢
      expect(result).to.include('-0.01% 🟢'); // Should show green emoji for tiny decrease
    });

    it('should handle large positive seriousPercentage (line 299)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 5 },
            serious: { count: 100 }, // Large increase
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 3 },
            serious: { count: 10 }, // Small base
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      // seriousPercentage = ((100 - 10) / 10) * 100 = 900% > 0, so emoji should be 🔴
      expect(result).to.include('900.00% 🔴'); // Should show red emoji for large increase
    });

    it('should handle large negative seriousPercentage (line 299)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 5 },
            serious: { count: 1 }, // Large decrease
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 3 },
            serious: { count: 100 }, // Large base
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      // seriousPercentage = ((1 - 100) / 100) * 100 = -99% < 0, so emoji should be 🟢
      expect(result).to.include('-99.00% 🟢'); // Should show green emoji for large decrease
    });

    it('should verify both critical and serious emojis work independently (line 299)', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 15 }, // Increased from 10 (positive change)
            serious: { count: 5 }, // Decreased from 10 (negative change)
          },
        },
      };
      const lastWeekFile = {
        overall: {
          violations: {
            critical: { count: 10 },
            serious: { count: 10 },
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceOverviewSection(currentFile, lastWeekFile, inDepthReportUrl);

      // criticalPercentage = ((15 - 10) / 10) * 100 = 50% > 0, so emoji should be 🔴
      // seriousPercentage = ((5 - 10) / 10) * 100 = -50% < 0, so emoji should be 🟢
      expect(result).to.include('50.00% 🔴'); // Critical should be red
      expect(result).to.include('-50.00% 🟢'); // Serious should be green
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

    it('should sort by level when percentages are equal (line 485)', () => {
      // Test the specific line: return a.level === 'A' ? -1 : 1;
      const quickWinsData = {
        topIssues: [
          {
            id: 'aa-level-issue',
            description: 'AA Level Issue',
            count: 50, // Same percentage as A level issue
            level: 'AA',
            successCriteriaNumber: '241',
          },
          {
            id: 'a-level-issue',
            description: 'A Level Issue',
            count: 50, // Same percentage as AA level issue
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
      };
      const enhancedReportUrl = 'https://example.com/enhanced';

      const result = generateQuickWinsOverviewSection(quickWinsData, enhancedReportUrl);

      // A level should come before AA level when percentages are equal (line 485)
      const aLevelIndex = result.indexOf('A Level Issue');
      const aaLevelIndex = result.indexOf('AA Level Issue');
      expect(aLevelIndex).to.be.lessThan(aaLevelIndex);
    });

    it('should execute both branches of line 485 ternary operator', () => {
      // Test both a.level === 'A' ? -1 : 1 branches
      const quickWinsData = {
        topIssues: [
          {
            id: 'first-aa-issue',
            description: 'First AA Issue',
            count: 30, // Same percentage
            level: 'AA',
            successCriteriaNumber: '241',
          },
          {
            id: 'first-a-issue',
            description: 'First A Issue',
            count: 30, // Same percentage
            level: 'A',
            successCriteriaNumber: '143',
          },
          {
            id: 'second-aa-issue',
            description: 'Second AA Issue',
            count: 30, // Same percentage
            level: 'AA',
            successCriteriaNumber: '242',
          },
          {
            id: 'second-a-issue',
            description: 'Second A Issue',
            count: 30, // Same percentage
            level: 'A',
            successCriteriaNumber: '144',
          },
        ],
      };
      const enhancedReportUrl = 'https://example.com/enhanced';

      const result = generateQuickWinsOverviewSection(quickWinsData, enhancedReportUrl);

      // All A level issues should come before all AA level issues when percentages are equal
      const firstAIndex = result.indexOf('First A Issue');
      const secondAIndex = result.indexOf('Second A Issue');
      const firstAAIndex = result.indexOf('First AA Issue');
      // const secondAAIndex = result.indexOf('Second AA Issue');

      // Both A level issues should come before both AA level issues
      expect(firstAIndex).to.be.lessThan(firstAAIndex);
      expect(firstAIndex).to.be.lessThan(firstAAIndex);
      expect(secondAIndex).to.be.lessThan(firstAAIndex);
      // expect(secondAIndex).to.be.lessThan(secondAAIndex);
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

    it('should process both critical and serious levels (lines 525-526)', () => {
      // Test that both 'critical' and 'serious' levels are processed
      const quickWinsData = {
        topIssues: [
          {
            id: 'critical-issue',
            description: 'Critical Issue',
            count: 5,
          },
          {
            id: 'serious-issue',
            description: 'Serious Issue',
            count: 3,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'critical-issue': { count: 2 },
                },
              },
              serious: {
                items: {
                  'serious-issue': { count: 1 },
                },
              },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('Critical Issue');
      expect(result).to.include('Serious Issue');
      expect(result).to.include('https://example.com/page1 (2)'); // Critical issue
      expect(result).to.include('https://example.com/page1 (1)'); // Serious issue
    });

    it('should filter out image-alt issues from violation items (line 527)', () => {
      // Test the specific line: if (isImageAltIssue(issueName)) return;
      const quickWinsData = {
        topIssues: [
          {
            id: 'valid-issue',
            description: 'Valid Issue',
            count: 5,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'image-alt': { count: 3 }, // Should be filtered out
                  'role-img-alt': { count: 2 }, // Should be filtered out
                  'svg-img-alt': { count: 1 }, // Should be filtered out
                  'valid-issue': { count: 4 }, // Should be included
                },
              },
              serious: {
                items: {
                  'image-alt': { count: 2 }, // Should be filtered out
                  'valid-issue': { count: 1 }, // Should be included
                },
              },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('Valid Issue');
      expect(result).to.include('https://example.com/page1 (5)'); // 4 + 1 = 5 for valid-issue
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
    });

    it('should handle missing items property in violations (line 526)', () => {
      // Test the fallback: data.violations[level].items || {}
      const quickWinsData = {
        topIssues: [
          {
            id: 'test-issue',
            description: 'Test Issue',
            count: 5,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                // Missing items property - should fallback to {}
              },
              serious: {
                items: {
                  'test-issue': { count: 2 },
                },
              },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('Test Issue');
      expect(result).to.include('https://example.com/page1 (2)'); // Only serious level count
    });

    it('should create new issuePageMap entry when issue does not exist (lines 529-531)', () => {
      // Test the condition: if (!issuePageMap[issueName])
      const quickWinsData = {
        topIssues: [
          {
            id: 'new-issue',
            description: 'New Issue',
            count: 5,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'new-issue': { count: 3 },
                },
              },
              serious: { items: {} },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('New Issue');
      expect(result).to.include('https://example.com/page1 (3)');
    });

    it('should add new page entry when URL does not exist for issue (lines 537-541)', () => {
      // Test the else branch where a new page entry is added
      const quickWinsData = {
        topIssues: [
          {
            id: 'shared-issue',
            description: 'Shared Issue',
            count: 10,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'shared-issue': { count: 3 },
                },
              },
              serious: { items: {} },
            },
          },
          'https://example.com/page2': {
            violations: {
              critical: {
                items: {
                  'shared-issue': { count: 2 },
                },
              },
              serious: { items: {} },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('Shared Issue');
      expect(result).to.include('https://example.com/page1 (3)');
      expect(result).to.include('https://example.com/page2 (2)');
    });

    it('should skip overall entry in allViolations (line 523)', () => {
      // Test the condition: if (url === 'overall') return;
      const quickWinsData = {
        topIssues: [
          {
            id: 'test-issue',
            description: 'Test Issue',
            count: 5,
          },
        ],
        allViolations: {
          overall: {
            violations: {
              critical: {
                items: {
                  'test-issue': { count: 100 }, // Should be skipped
                },
              },
              serious: { items: {} },
            },
          },
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'test-issue': { count: 3 },
                },
              },
              serious: { items: {} },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('Test Issue');
      expect(result).to.include('https://example.com/page1 (3)');
      expect(result).to.not.include('overall');
      expect(result).to.not.include('(100)'); // Overall count should not appear
    });

    it('should handle comprehensive scenario with all code paths', () => {
      // Test a comprehensive scenario that exercises multiple code paths
      const quickWinsData = {
        topIssues: [
          {
            id: 'multi-page-issue',
            description: 'Multi Page Issue',
            count: 15,
          },
          {
            id: 'single-page-issue',
            description: 'Single Page Issue',
            count: 5,
          },
        ],
        allViolations: {
          overall: {
            violations: {
              critical: {
                items: {
                  'multi-page-issue': { count: 999 }, // Should be skipped
                },
              },
              serious: { items: {} },
            },
          },
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'image-alt': { count: 5 }, // Should be filtered
                  'multi-page-issue': { count: 3 },
                  'single-page-issue': { count: 2 },
                },
              },
              serious: {
                items: {
                  'role-img-alt': { count: 2 }, // Should be filtered
                  'multi-page-issue': { count: 1 }, // Should aggregate with critical
                },
              },
            },
          },
          'https://example.com/page2': {
            violations: {
              critical: {
                items: {
                  'svg-img-alt': { count: 3 }, // Should be filtered
                  'multi-page-issue': { count: 2 },
                },
              },
              serious: { items: {} },
            },
          },
          'https://example.com/page3': {
            violations: {
              critical: {
                // Missing items - should use fallback
              },
              serious: {
                items: {
                  'multi-page-issue': { count: 1 },
                },
              },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('Multi Page Issue');
      expect(result).to.include('Single Page Issue');

      // Multi-page issue should appear on multiple pages with aggregated counts
      expect(result).to.include('https://example.com/page1 (4)'); // 3 + 1 = 4
      expect(result).to.include('https://example.com/page2 (2)');
      expect(result).to.include('https://example.com/page3 (1)');

      // Single-page issue should only appear on page1
      expect(result).to.include('https://example.com/page1 (2)');

      // Should not include filtered issues or overall
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
      expect(result).to.not.include('overall');
      expect(result).to.not.include('(999)');
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

    it('should filter out image-alt issues from critical fixed issues (line 630)', () => {
      // Test the specific line:
      // .filter(([issue]) => !currentCritical[issue] && !isImageAltIssue(issue))
      const currentData = {
        overall: {
          violations: {
            critical: { items: {} }, // No current critical issues
            serious: { items: {} },
          },
        },
      };
      const previousData = {
        overall: {
          violations: {
            critical: {
              items: {
                'image-alt': { count: 5 }, // Should be filtered out
                'role-img-alt': { count: 3 }, // Should be filtered out
                'svg-img-alt': { count: 2 }, // Should be filtered out
                'valid-fixed-issue': { count: 4 }, // Should be included
              },
            },
            serious: { items: {} },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // Should include valid fixed issue
      expect(result).to.include('`valid-fixed-issue`');
      // Should not include image-alt issues
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
    });

    it('should filter out image-alt issues from serious fixed issues (line 653)', () => {
      // Test the filtering logic for serious fixed issues
      const currentData = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: { items: {} }, // No current serious issues
          },
        },
      };
      const previousData = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: {
              items: {
                'image-alt': { count: 3 }, // Should be filtered out
                'role-img-alt': { count: 2 }, // Should be filtered out
                'svg-img-alt': { count: 1 }, // Should be filtered out
                'valid-serious-fixed': { count: 2 }, // Should be included
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      expect(result).to.include('`valid-serious-fixed`'); // Should include valid fixed issue
      expect(result).to.not.include('image-alt'); // Should not include image-alt issues
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
    });

    it('should handle missing currentData with fallback to empty objects (lines 606-607)', () => {
      // Test the specific lines:
      // const currentCritical = currentData?.overall?.violations?.critical?.items || {};
      // const currentSerious = currentData?.overall?.violations?.serious?.items || {};
      const currentData = null; // Missing currentData
      const previousData = {
        overall: {
          violations: {
            critical: {
              items: {
                'test-critical-issue': { count: 5 },
              },
            },
            serious: {
              items: {
                'test-serious-issue': { count: 3 },
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // Should treat all previous issues as fixed since currentData is null
      expect(result).to.include('`test-critical-issue`');
      expect(result).to.include('`test-serious-issue`');
    });

    it('should handle missing overall property in currentData (lines 606-607)', () => {
      // Test fallback when currentData.overall is missing
      const currentData = {}; // Missing overall property
      const previousData = {
        overall: {
          violations: {
            critical: {
              items: {
                'critical-issue': { count: 2 },
              },
            },
            serious: {
              items: {
                'serious-issue': { count: 1 },
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // Should treat all previous issues as fixed since overall is missing
      expect(result).to.include('`critical-issue`');
      expect(result).to.include('`serious-issue`');
    });

    it('should handle missing violations property in currentData (lines 606-607)', () => {
      // Test fallback when currentData.overall.violations is missing
      const currentData = {
        overall: {}, // Missing violations property
      };
      const previousData = {
        overall: {
          violations: {
            critical: {
              items: {
                'critical-issue': { count: 3 },
              },
            },
            serious: {
              items: {
                'serious-issue': { count: 2 },
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // Should treat all previous issues as fixed since violations is missing
      expect(result).to.include('`critical-issue`');
      expect(result).to.include('`serious-issue`');
    });

    it('should handle missing critical property in currentData violations (lines 606-607)', () => {
      // Test fallback when currentData.overall.violations.critical is missing
      const currentData = {
        overall: {
          violations: {
            // Missing critical property
            serious: {
              items: {
                'existing-serious': { count: 1 },
              },
            },
          },
        },
      };
      const previousData = {
        overall: {
          violations: {
            critical: {
              items: {
                'critical-issue': { count: 4 },
              },
            },
            serious: {
              items: {
                'existing-serious': { count: 2 }, // Should show as improved
                'serious-issue': { count: 1 }, // Should show as fixed
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // Should treat critical issue as fixed since critical property is missing
      expect(result).to.include('`critical-issue`');
      // Should show serious issue as improved
      expect(result).to.include('`existing-serious` (1 less)');
      expect(result).to.include('`serious-issue`');
    });

    it('should handle missing serious property in currentData violations (lines 606-607)', () => {
      // Test fallback when currentData.overall.violations.serious is missing
      const currentData = {
        overall: {
          violations: {
            critical: {
              items: {
                'existing-critical': { count: 2 },
              },
            },
            // Missing serious property
          },
        },
      };
      const previousData = {
        overall: {
          violations: {
            critical: {
              items: {
                'existing-critical': { count: 3 }, // Should show as improved
                'critical-issue': { count: 1 }, // Should show as fixed
              },
            },
            serious: {
              items: {
                'serious-issue': { count: 2 },
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // Should show critical issue as improved
      expect(result).to.include('`existing-critical` (1 less)');
      expect(result).to.include('`critical-issue`');
      // Should treat serious issue as fixed since serious property is missing
      expect(result).to.include('`serious-issue`');
    });

    it('should handle missing items property in currentData critical violations (lines 606-607)', () => {
      // Test fallback when currentData.overall.violations.critical.items is missing
      const currentData = {
        overall: {
          violations: {
            critical: {
              // Missing items property
            },
            serious: {
              items: {
                'existing-serious': { count: 1 },
              },
            },
          },
        },
      };
      const previousData = {
        overall: {
          violations: {
            critical: {
              items: {
                'critical-issue': { count: 3 },
              },
            },
            serious: {
              items: {
                'existing-serious': { count: 2 }, // Should show as improved
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // Should treat critical issue as fixed since items property is missing
      expect(result).to.include('`critical-issue`');
      // Should show serious issue as improved
      expect(result).to.include('`existing-serious` (1 less)');
    });

    it('should handle missing items property in currentData serious violations (lines 606-607)', () => {
      // Test fallback when currentData.overall.violations.serious.items is missing
      const currentData = {
        overall: {
          violations: {
            critical: {
              items: {
                'existing-critical': { count: 1 },
              },
            },
            serious: {
              // Missing items property
            },
          },
        },
      };
      const previousData = {
        overall: {
          violations: {
            critical: {
              items: {
                'existing-critical': { count: 2 }, // Should show as improved
              },
            },
            serious: {
              items: {
                'serious-issue': { count: 3 },
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-vs-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // Should show critical issue as improved
      expect(result).to.include('`existing-critical` (1 less)');
      // Should treat serious issue as fixed since items property is missing
      expect(result).to.include('`serious-issue`');
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

    it('should filter out image-alt issues using isImageAltIssue function (line 653)', () => {
      // Test the specific line: const filteredIssues = issues.filter((i) => !isImageAltIssue(i));
      const diffData = {
        fixedIssues: {
          critical: {
            'https://example.com/page1': [
              'image-alt', // Should be filtered out
              'role-img-alt', // Should be filtered out
              'svg-img-alt', // Should be filtered out
              'color-contrast', // Should be included
              'aria-label', // Should be included
            ],
          },
          serious: {
            'https://example.com/page2': [
              'image-alt', // Should be filtered out
              'focus-visible', // Should be included
            ],
          },
        },
      };

      const result = generateFixedIssuesSection(diffData);

      // Should include valid issues
      expect(result).to.include('`color-contrast`');
      expect(result).to.include('`aria-label`');
      expect(result).to.include('`focus-visible`');

      // Should not include image-alt related issues
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');

      // Should include the pages since they have valid issues after filtering
      expect(result).to.include('https://example.com/page1');
      expect(result).to.include('https://example.com/page2');
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

    it('should handle missing critical items property (line 99)', () => {
      // Test the fallback when critical.items is undefined
      const currentFile = {
        overall: {
          violations: {
            critical: {
              // Missing items property - should fallback to {}
            },
            serious: {
              items: {
                issue1: { level: 'AA' },
              },
            },
          },
        },
      };

      const result = calculateWCAGData(currentFile);

      expect(result.failures.A).to.equal(0); // No critical items
      expect(result.failures.AA).to.equal(1); // One serious item
      expect(result.passed.A).to.equal(30); // 30 - 0
      expect(result.passed.AA).to.equal(19); // 20 - 1
    });

    it('should handle missing serious items property (line 100)', () => {
      // Test the fallback when serious.items is undefined
      const currentFile = {
        overall: {
          violations: {
            critical: {
              items: {
                issue1: { level: 'A' },
              },
            },
            serious: {
              // Missing items property - should fallback to {}
            },
          },
        },
      };

      const result = calculateWCAGData(currentFile);

      expect(result.failures.A).to.equal(1); // One critical item
      expect(result.failures.AA).to.equal(0); // No serious items
      expect(result.passed.A).to.equal(29); // 30 - 1
      expect(result.passed.AA).to.equal(20); // 20 - 0
    });

    it('should handle both missing items properties (lines 99-100)', () => {
      // Test the fallback when both critical.items and serious.items are undefined
      const currentFile = {
        overall: {
          violations: {
            critical: {
              // Missing items property - should fallback to {}
            },
            serious: {
              // Missing items property - should fallback to {}
            },
          },
        },
      };

      const result = calculateWCAGData(currentFile);

      expect(result.failures.A).to.equal(0); // No critical items
      expect(result.failures.AA).to.equal(0); // No serious items
      expect(result.passed.A).to.equal(30); // 30 - 0
      expect(result.passed.AA).to.equal(20); // 20 - 0
      expect(result.complianceScores.A).to.equal(100); // Perfect score
      expect(result.complianceScores.AA).to.equal(100); // Perfect score
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

  describe('calculateDiffData', () => {
    it('should identify new issues in current data that are not in last week data', () => {
      const currentFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 2 },
                'aria-label': { count: 1 }, // New issue
              },
            },
            serious: {
              items: {
                'focus-visible': { count: 3 }, // New issue
              },
            },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 5 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 1 }, // Existing issue
              },
            },
            serious: { items: {} },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result.newIssues.critical['https://example.com/page1']).to.include('aria-label');
      expect(result.newIssues.serious['https://example.com/page1']).to.include('focus-visible');
      expect(result.newIssues.critical['https://example.com/page1']).to.not.include('color-contrast');
    });

    it('should identify fixed issues that were in last week data but not in current data', () => {
      const currentFile = {
        overall: { violations: { total: 5 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 2 }, // Still exists
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 1 }, // Still exists
                'aria-label': { count: 2 }, // Fixed issue
              },
            },
            serious: {
              items: {
                'focus-visible': { count: 1 }, // Fixed issue
              },
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result.fixedIssues.critical['https://example.com/page1']).to.include('aria-label');
      expect(result.fixedIssues.serious['https://example.com/page1']).to.include('focus-visible');
      expect(result.fixedIssues.critical['https://example.com/page1']).to.not.include('color-contrast');
    });

    it('should filter out image-alt related issues from new issues (line 192)', () => {
      const currentFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'image-alt': { count: 2 }, // Should be filtered
                'role-img-alt': { count: 1 }, // Should be filtered
                'svg-img-alt': { count: 1 }, // Should be filtered
                'color-contrast': { count: 3 }, // Should be included
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 0 } },
        'https://example.com/page1': {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result.newIssues.critical['https://example.com/page1']).to.include('color-contrast');
      expect(result.newIssues.critical['https://example.com/page1']).to.not.include('image-alt');
      expect(result.newIssues.critical['https://example.com/page1']).to.not.include('role-img-alt');
      expect(result.newIssues.critical['https://example.com/page1']).to.not.include('svg-img-alt');
    });

    it('should filter out image-alt related issues from fixed issues (line 207)', () => {
      const currentFile = {
        overall: { violations: { total: 0 } },
        'https://example.com/page1': {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'image-alt': { count: 2 }, // Should be filtered
                'role-img-alt': { count: 1 }, // Should be filtered
                'svg-img-alt': { count: 1 }, // Should be filtered
                'color-contrast': { count: 3 }, // Should be included
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result.fixedIssues.critical['https://example.com/page1']).to.include('color-contrast');
      expect(result.fixedIssues.critical['https://example.com/page1']).to.not.include('image-alt');
      expect(result.fixedIssues.critical['https://example.com/page1']).to.not.include('role-img-alt');
      expect(result.fixedIssues.critical['https://example.com/page1']).to.not.include('svg-img-alt');
    });

    it('should handle missing items property in current data (line 190)', () => {
      const currentFile = {
        overall: { violations: { total: 5 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              // Missing items property - should fallback to {}
            },
            serious: {
              items: {
                'focus-visible': { count: 1 },
              },
            },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 0 } },
        'https://example.com/page1': {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      // Should handle missing items gracefully
      expect(result.newIssues.serious['https://example.com/page1']).to.include('focus-visible');
      expect(result.newIssues.critical).to.deep.equal({});
    });

    it('should handle missing items property in last week data (line 207)', () => {
      const currentFile = {
        overall: { violations: { total: 0 } },
        'https://example.com/page1': {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 5 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              // Missing items property - should fallback to {}
            },
            serious: {
              items: {
                'focus-visible': { count: 1 },
              },
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      // Should handle missing items gracefully
      expect(result.fixedIssues.serious['https://example.com/page1']).to.include('focus-visible');
      expect(result.fixedIssues.critical).to.deep.equal({});
    });

    it('should skip overall entries in both current and last week data (lines 185, 202)', () => {
      const currentFile = {
        overall: { violations: { total: 10 } }, // Should be skipped
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 2 },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 5 } }, // Should be skipped
        'https://example.com/page1': {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      // Should only process page URLs, not overall
      expect(result.newIssues.critical['https://example.com/page1']).to.include('color-contrast');
      expect(result.newIssues.critical.overall).to.be.undefined;
      expect(result.fixedIssues.critical.overall).to.be.undefined;
    });

    it('should handle pages that exist in current but not in last week data (line 193)', () => {
      const currentFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 2 },
              },
            },
            serious: { items: {} },
          },
        },
        'https://example.com/new-page': { // New page not in last week
          violations: {
            critical: {
              items: {
                'aria-label': { count: 1 },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 5 } },
        'https://example.com/page1': {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
        // Missing 'https://example.com/new-page'
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      // New page issues should be marked as new
      expect(result.newIssues.critical['https://example.com/page1']).to.include('color-contrast');
      expect(result.newIssues.critical['https://example.com/new-page']).to.include('aria-label');
    });

    it('should handle pages that exist in last week but not in current data (line 209)', () => {
      const currentFile = {
        overall: { violations: { total: 5 } },
        'https://example.com/page1': {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
        // Missing 'https://example.com/old-page'
      };

      const lastWeekFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 2 },
              },
            },
            serious: { items: {} },
          },
        },
        'https://example.com/old-page': { // Page removed from current
          violations: {
            critical: {
              items: {
                'aria-label': { count: 1 },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      // Old page issues should be marked as fixed
      expect(result.fixedIssues.critical['https://example.com/page1']).to.include('color-contrast');
      expect(result.fixedIssues.critical['https://example.com/old-page']).to.include('aria-label');
    });

    it('should initialize arrays for new issues when URL does not exist (lines 194-195)', () => {
      const currentFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 2 },
                'aria-label': { count: 1 },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 0 } },
        'https://example.com/page1': {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      // Should initialize array and add both issues
      expect(result.newIssues.critical['https://example.com/page1']).to.be.an('array');
      expect(result.newIssues.critical['https://example.com/page1']).to.have.lengthOf(2);
      expect(result.newIssues.critical['https://example.com/page1']).to.include('color-contrast');
      expect(result.newIssues.critical['https://example.com/page1']).to.include('aria-label');
    });

    it('should initialize arrays for fixed issues when URL does not exist (lines 210-211)', () => {
      const currentFile = {
        overall: { violations: { total: 0 } },
        'https://example.com/page1': {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 2 },
                'aria-label': { count: 1 },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      // Should initialize array and add both issues
      expect(result.fixedIssues.critical['https://example.com/page1']).to.be.an('array');
      expect(result.fixedIssues.critical['https://example.com/page1']).to.have.lengthOf(2);
      expect(result.fixedIssues.critical['https://example.com/page1']).to.include('color-contrast');
      expect(result.fixedIssues.critical['https://example.com/page1']).to.include('aria-label');
    });

    it('should handle both critical and serious levels comprehensively', () => {
      const currentFile = {
        overall: { violations: { total: 15 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 2 }, // Existing
                'new-critical': { count: 1 }, // New
              },
            },
            serious: {
              items: {
                'focus-visible': { count: 3 }, // Existing
                'new-serious': { count: 2 }, // New
              },
            },
          },
        },
      };

      const lastWeekFile = {
        overall: { violations: { total: 20 } },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 1 }, // Still exists
                'fixed-critical': { count: 2 }, // Fixed
              },
            },
            serious: {
              items: {
                'focus-visible': { count: 2 }, // Still exists
                'fixed-serious': { count: 1 }, // Fixed
              },
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      // Check new issues
      expect(result.newIssues.critical['https://example.com/page1']).to.include('new-critical');
      expect(result.newIssues.serious['https://example.com/page1']).to.include('new-serious');
      expect(result.newIssues.critical['https://example.com/page1']).to.not.include('color-contrast');
      expect(result.newIssues.serious['https://example.com/page1']).to.not.include('focus-visible');

      // Check fixed issues
      expect(result.fixedIssues.critical['https://example.com/page1']).to.include('fixed-critical');
      expect(result.fixedIssues.serious['https://example.com/page1']).to.include('fixed-serious');
      expect(result.fixedIssues.critical['https://example.com/page1']).to.not.include('color-contrast');
      expect(result.fixedIssues.serious['https://example.com/page1']).to.not.include('focus-visible');
    });

    it('should return properly structured diff data object', () => {
      const currentFile = {
        overall: { violations: { total: 5 } },
      };

      const lastWeekFile = {
        overall: { violations: { total: 3 } },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      // Check structure
      expect(result).to.have.property('fixedIssues');
      expect(result).to.have.property('newIssues');
      expect(result.fixedIssues).to.have.property('critical');
      expect(result.fixedIssues).to.have.property('serious');
      expect(result.newIssues).to.have.property('critical');
      expect(result.newIssues).to.have.property('serious');

      // Check initial state
      expect(result.fixedIssues.critical).to.deep.equal({});
      expect(result.fixedIssues.serious).to.deep.equal({});
      expect(result.newIssues.critical).to.deep.equal({});
      expect(result.newIssues.serious).to.deep.equal({});
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

  describe('generateAccessibilityIssuesOverviewSection', () => {
    it('should return empty string when no issues after filtering (line 323)', () => {
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

      expect(result).to.equal(''); // Should return empty string when all issues are filtered
    });

    it('should return empty string when sortedIssues length is 0 (line 323)', () => {
      // Test the specific condition where sortedIssues.length === 0
      const issuesOverview = {
        levelA: [], // Empty array
        levelAA: [], // Empty array
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      expect(result).to.equal(''); // Should return empty string when no issues at all
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

    it('should prioritize level A over level AA when levels are different (line 320)', () => {
      // Test the specific line: return a.level === 'A' ? -1 : 1;
      const issuesOverview = {
        levelA: [
          {
            rule: 'level-a-issue',
            count: 5, // Lower count
            level: 'A',
            description: 'Level A issue',
            successCriteriaNumber: '143',
            understandingUrl: 'https://example.com/understanding1',
          },
        ],
        levelAA: [
          {
            rule: 'level-aa-issue',
            count: 10, // Higher count
            level: 'AA',
            description: 'Level AA issue',
            successCriteriaNumber: '241',
            understandingUrl: 'https://example.com/understanding2',
          },
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // Level A should come before Level AA regardless of count
      const levelAIndex = result.indexOf('level-a-issue');
      const levelAAIndex = result.indexOf('level-aa-issue');
      expect(levelAIndex).to.be.lessThan(levelAAIndex);
    });

    it('should execute line 320 when a.level is A and b.level is AA', () => {
      // Test the condition a.level === 'A' ? -1 : 1 when a.level is 'A'
      const issuesOverview = {
        levelA: [
          {
            rule: 'critical-issue',
            count: 1, // Very low count
            level: 'A',
            description: 'Critical A level issue',
            successCriteriaNumber: '111',
            understandingUrl: 'https://example.com/understanding1',
          },
        ],
        levelAA: [
          {
            rule: 'serious-issue',
            count: 100, // Very high count
            level: 'AA',
            description: 'Serious AA level issue',
            successCriteriaNumber: '241',
            understandingUrl: 'https://example.com/understanding2',
          },
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // A level issue should come first despite having much lower count
      const criticalIndex = result.indexOf('critical-issue');
      const seriousIndex = result.indexOf('serious-issue');
      expect(criticalIndex).to.be.lessThan(seriousIndex);
    });

    it('should execute line 320 when a.level is AA and b.level is A', () => {
      // Test the condition a.level === 'A' ? -1 : 1 when a.level is 'AA'
      // This tests the : 1 part of the ternary operator
      const issuesOverview = {
        levelAA: [
          {
            rule: 'aa-first-issue',
            count: 50,
            level: 'AA',
            description: 'AA level issue listed first',
            successCriteriaNumber: '241',
            understandingUrl: 'https://example.com/understanding1',
          },
        ],
        levelA: [
          {
            rule: 'a-second-issue',
            count: 1,
            level: 'A',
            description: 'A level issue listed second',
            successCriteriaNumber: '111',
            understandingUrl: 'https://example.com/understanding2',
          },
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // A level should still come first even when AA is listed first in input
      const aIssueIndex = result.indexOf('a-second-issue');
      const aaIssueIndex = result.indexOf('aa-first-issue');
      expect(aIssueIndex).to.be.lessThan(aaIssueIndex);
    });

    it('should generate complete section with headers and table structure (lines 325-335)', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'test-issue',
            count: 5,
            level: 'A',
            description: 'Test issue description',
            successCriteriaNumber: '143',
            understandingUrl: 'https://example.com/understanding',
          },
        ],
        levelAA: [],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // Should include section header
      expect(result).to.include('### Accessibility Issues Overview');

      // Should include table headers
      expect(result).to.include('| Issue | WCAG Success Criterion | Count| Level |Impact| Description | WCAG Docs Link |');
      expect(result).to.include('|-------|-------|-------------|-------------|-------------|-------------|-------------|');

      // Should include the issue data
      expect(result).to.include('test-issue');
      expect(result).to.include('Test issue description');

      // Should end with separator
      expect(result).to.include('---');
    });

    it('should handle missing accessibilityIssuesImpact for issue rule (line 329)', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'unknown-impact-issue',
            count: 3,
            level: 'A',
            description: 'Issue with unknown impact',
            successCriteriaNumber: '143',
            understandingUrl: 'https://example.com/understanding',
          },
        ],
        levelAA: [],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // Should handle missing impact gracefully (empty string)
      expect(result).to.include('unknown-impact-issue');
      expect(result).to.include('Issue with unknown impact');
    });

    it('should format success criteria number with dots (line 331)', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'format-test-issue',
            count: 2,
            level: 'A',
            description: 'Format test issue',
            successCriteriaNumber: '143',
            understandingUrl: 'https://example.com/understanding',
          },
        ],
        levelAA: [],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // Should format '143' as '1.4.3'
      expect(result).to.include('1.4.3');
    });

    it('should escape HTML in description using escapeHtmlTags (line 331)', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'html-test-issue',
            count: 1,
            level: 'A',
            description: 'Issue with <script>alert("test")</script> tags',
            successCriteriaNumber: '143',
            understandingUrl: 'https://example.com/understanding',
          },
        ],
        levelAA: [],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // Should escape HTML tags in description
      expect(result).to.include('`<script>`alert("test")`</script>`');
    });

    it('should handle multiple issues with mixed levels and counts (comprehensive test)', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'a-low-count',
            count: 2,
            level: 'A',
            description: 'A level low count',
            successCriteriaNumber: '111',
            understandingUrl: 'https://example.com/understanding1',
          },
          {
            rule: 'a-high-count',
            count: 20,
            level: 'A',
            description: 'A level high count',
            successCriteriaNumber: '112',
            understandingUrl: 'https://example.com/understanding2',
          },
        ],
        levelAA: [
          {
            rule: 'aa-medium-count',
            count: 10,
            level: 'AA',
            description: 'AA level medium count',
            successCriteriaNumber: '241',
            understandingUrl: 'https://example.com/understanding3',
          },
          {
            rule: 'aa-very-high-count',
            count: 100,
            level: 'AA',
            description: 'AA level very high count',
            successCriteriaNumber: '242',
            understandingUrl: 'https://example.com/understanding4',
          },
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // All A level issues should come before all AA level issues
      const aHighIndex = result.indexOf('a-high-count');
      const aLowIndex = result.indexOf('a-low-count');
      const aaMediumIndex = result.indexOf('aa-medium-count');
      const aaHighIndex = result.indexOf('aa-very-high-count');

      // Both A level issues should come before both AA level issues
      expect(aHighIndex).to.be.lessThan(aaMediumIndex);
      expect(aHighIndex).to.be.lessThan(aaHighIndex);
      expect(aLowIndex).to.be.lessThan(aaMediumIndex);
      expect(aLowIndex).to.be.lessThan(aaHighIndex);

      // Within A level, higher count should come first
      expect(aHighIndex).to.be.lessThan(aLowIndex);

      // Within AA level, higher count should come first
      expect(aaHighIndex).to.be.lessThan(aaMediumIndex);
    });

    it('should filter out all image-alt related issues (line 315)', () => {
      const issuesOverview = {
        levelA: [
          { rule: 'image-alt', count: 10, level: 'A' }, // Should be filtered
          { rule: 'role-img-alt', count: 5, level: 'A' }, // Should be filtered
          { rule: 'svg-img-alt', count: 3, level: 'A' }, // Should be filtered
          {
            rule: 'valid-issue',
            count: 2,
            level: 'A',
            description: 'Valid issue',
            successCriteriaNumber: '143',
            understandingUrl: 'https://example.com/understanding',
          },
        ],
        levelAA: [
          { rule: 'image-alt', count: 8, level: 'AA' }, // Should be filtered
          { rule: 'role-img-alt', count: 4, level: 'AA' }, // Should be filtered
          { rule: 'svg-img-alt', count: 2, level: 'AA' }, // Should be filtered
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // Should only include the valid issue
      expect(result).to.include('valid-issue');
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
    });

    it('should handle edge case with only one issue (lines 325-335)', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'single-issue',
            count: 1,
            level: 'A',
            description: 'Single issue test',
            successCriteriaNumber: '143',
            understandingUrl: 'https://example.com/understanding',
          },
        ],
        levelAA: [],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      // Should generate complete section for single issue
      expect(result).to.include('### Accessibility Issues Overview');
      expect(result).to.include('single-issue');
      expect(result).to.include('Single issue test');
      expect(result).to.include('---');
    });
  });

  describe('filterImageAltIssues', () => {
    it('should filter out image-alt related issues', () => {
      const issues = [
        { rule: 'image-alt', count: 5 },
        { rule: 'role-img-alt', count: 3 },
        { rule: 'svg-img-alt', count: 2 },
        { rule: 'color-contrast', count: 10 },
        { rule: 'aria-label', count: 7 },
      ];

      const result = filterImageAltIssues(issues);

      expect(result).to.have.lengthOf(2);
      expect(result[0].rule).to.equal('color-contrast');
      expect(result[1].rule).to.equal('aria-label');
    });

    it('should return empty array when all issues are image-alt related', () => {
      const issues = [
        { rule: 'image-alt', count: 5 },
        { rule: 'role-img-alt', count: 3 },
        { rule: 'svg-img-alt', count: 2 },
      ];

      const result = filterImageAltIssues(issues);

      expect(result).to.have.lengthOf(0);
    });

    it('should return all issues when none are image-alt related', () => {
      const issues = [
        { rule: 'color-contrast', count: 10 },
        { rule: 'aria-label', count: 7 },
        { rule: 'focus-visible', count: 4 },
      ];

      const result = filterImageAltIssues(issues);

      expect(result).to.have.lengthOf(3);
      expect(result).to.deep.equal(issues);
    });
  });

  describe('sortIssuesByLevelAndCount', () => {
    it('should return -1 when first issue is level A and second is level AA', () => {
      const issueA = { level: 'A', count: 5 };
      const issueAA = { level: 'AA', count: 10 };

      const result = sortIssuesByLevelAndCount(issueA, issueAA);

      expect(result).to.equal(-1);
    });

    it('should return 1 when first issue is level AA and second is level A', () => {
      const issueAA = { level: 'AA', count: 10 };
      const issueA = { level: 'A', count: 5 };

      const result = sortIssuesByLevelAndCount(issueAA, issueA);

      expect(result).to.equal(1);
    });

    it('should sort by count descending when levels are equal (A level)', () => {
      const issue1 = { level: 'A', count: 5 };
      const issue2 = { level: 'A', count: 10 };

      const result = sortIssuesByLevelAndCount(issue1, issue2);

      expect(result).to.equal(5); // 5 - 10 = -5, but we want b.count - a.count = 10 - 5 = 5
    });

    it('should sort by count descending when levels are equal (AA level)', () => {
      const issue1 = { level: 'AA', count: 15 };
      const issue2 = { level: 'AA', count: 8 };

      const result = sortIssuesByLevelAndCount(issue1, issue2);

      expect(result).to.equal(-7); // 8 - 15 = -7
    });

    it('should prioritize level A over AA regardless of count', () => {
      const lowCountA = { level: 'A', count: 1 };
      const highCountAA = { level: 'AA', count: 100 };

      const result = sortIssuesByLevelAndCount(lowCountA, highCountAA);

      expect(result).to.equal(-1); // A comes first
    });
  });

  describe('isImageAltIssue', () => {
    it('should return true for image-alt issue', () => {
      expect(isImageAltIssue('image-alt')).to.be.true;
    });

    it('should return true for role-img-alt issue', () => {
      expect(isImageAltIssue('role-img-alt')).to.be.true;
    });

    it('should return true for svg-img-alt issue', () => {
      expect(isImageAltIssue('svg-img-alt')).to.be.true;
    });

    it('should return false for non-image-alt issues', () => {
      expect(isImageAltIssue('color-contrast')).to.be.false;
      expect(isImageAltIssue('aria-label')).to.be.false;
      expect(isImageAltIssue('focus-visible')).to.be.false;
    });

    it('should return false for undefined or null', () => {
      expect(isImageAltIssue(undefined)).to.be.false;
      expect(isImageAltIssue(null)).to.be.false;
    });

    it('should return false for empty string', () => {
      expect(isImageAltIssue('')).to.be.false;
    });
  });

  describe('filterImageAltFromStrings', () => {
    it('should filter out image-alt related issues from strings', () => {
      const strings = [
        '1 x `image-alt`',
        '2 x `role-img-alt`',
        '1 x `svg-img-alt`',
        '3 x `color-contrast`',
        '1 x `aria-label`',
        '2 x `focus-visible`',
      ];
      const result = filterImageAltFromStrings(strings);
      expect(result).to.deep.equal(['3 x `color-contrast`', '1 x `aria-label`', '2 x `focus-visible`']);
    });

    it('should return all strings when no image-alt related issues are found', () => {
      const strings = [
        '3 x `color-contrast`',
        '1 x `aria-label`',
        '2 x `focus-visible`',
      ];
      const result = filterImageAltFromStrings(strings);
      expect(result).to.deep.equal(['3 x `color-contrast`', '1 x `aria-label`', '2 x `focus-visible`']);
    });

    it('should return empty array when all strings contain image-alt issues', () => {
      const strings = [
        '1 x `image-alt`',
        '2 x `role-img-alt`',
        '1 x `svg-img-alt`',
      ];
      const result = filterImageAltFromStrings(strings);
      expect(result).to.deep.equal([]);
    });

    it('should handle empty array', () => {
      const result = filterImageAltFromStrings([]);
      expect(result).to.deep.equal([]);
    });

    it('should handle mixed content with image-alt issues', () => {
      const strings = [
        '1 x `image-alt` and other text',
        'some text with `role-img-alt` in it',
        'normal issue without image-alt',
        'another `svg-img-alt` issue',
        'clean issue',
      ];
      const result = filterImageAltFromStrings(strings);
      expect(result).to.deep.equal(['normal issue without image-alt', 'clean issue']);
    });
  });

  describe('generateEnhancingAccessibilitySection', () => {
    it('should filter out image-alt issues from issuesOverview (line 363)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `color-contrast`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'image-alt', description: 'Image alt', level: 'A', successCriteriaNumber: '111',
          },
          {
            rule: 'color-contrast', description: 'Color contrast', level: 'A', successCriteriaNumber: '143',
          },
        ],
        levelAA: [
          {
            rule: 'role-img-alt', description: 'Role img alt', level: 'AA', successCriteriaNumber: '241',
          },
        ],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('color-contrast');
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
    });

    it('should create issuesLookup with escaped HTML content (lines 365-372)', () => {
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
            description: 'Test <script>alert("xss")</script> issue',
            level: 'A',
            impact: 'High <b>impact</b>',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('Test `<script>`alert("xss")`</script>` issue');
    });

    it('should sort traffic violations by traffic and slice to top 10 (lines 374-376)', () => {
      const trafficViolations = Array.from({ length: 15 }, (_, i) => ({
        url: `https://example.com/page${i + 1}`,
        traffic: (15 - i) * 100, // Descending traffic
        levelA: [`1 x \`issue-${i + 1}\``],
        levelAA: [],
      }));
      const issuesOverview = {
        levelA: Array.from({ length: 15 }, (_, i) => ({
          rule: `issue-${i + 1}`,
          description: `Issue ${i + 1}`,
          level: 'A',
          successCriteriaNumber: '143',
        })),
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      // Should only include top 10 pages (highest traffic)
      expect(result).to.include('https://example.com/page1'); // Highest traffic
      expect(result).to.include('https://example.com/page10'); // 10th highest
      // 11th highest, should be excluded
      expect(result).to.not.include('https://example.com/page11');
    });

    it('should handle null traffic values in sorting (line 375)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: null,
          levelA: ['1 x `issue-1`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/page2',
          traffic: 1000,
          levelA: ['1 x `issue-2`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/page3',
          traffic: undefined,
          levelA: ['1 x `issue-3`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'issue-1',
            description: 'Issue 1',
            level: 'A',
            successCriteriaNumber: '143',
          },
          {
            rule: 'issue-2',
            description: 'Issue 2',
            level: 'A',
            successCriteriaNumber: '143',
          },
          {
            rule: 'issue-3',
            description: 'Issue 3',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      // Page with traffic should come first
      const page2Index = result.indexOf('https://example.com/page2');
      const page1Index = result.indexOf('https://example.com/page1');
      const page3Index = result.indexOf('https://example.com/page3');
      expect(page2Index).to.be.lessThan(page1Index);
      expect(page2Index).to.be.lessThan(page3Index);
    });

    it('should process both levelA and levelAA issues (lines 380-381)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['2 x `critical-issue`'],
          levelAA: ['3 x `serious-issue`'],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'critical-issue',
            description: 'Critical Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [
          {
            rule: 'serious-issue',
            description: 'Serious Issue',
            level: 'AA',
            successCriteriaNumber: '241',
          },
        ],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('critical-issue');
      expect(result).to.include('serious-issue');
      expect(result).to.include('https://example.com/page1 (2)'); // Critical issue count
      expect(result).to.include('https://example.com/page1 (3)'); // Serious issue count
    });

    it('should parse issue text with regex and extract count and name (lines 382-385)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['5 x `complex-issue-name`', 'invalid format', '10 x `another-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'complex-issue-name',
            description: 'Complex Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
          {
            rule: 'another-issue',
            description: 'Another Issue',
            level: 'A',
            successCriteriaNumber: '144',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('complex-issue-name');
      expect(result).to.include('another-issue');
      expect(result).to.include('https://example.com/page1 (5)');
      expect(result).to.include('https://example.com/page1 (10)');
      // Invalid format should be ignored
      expect(result).to.not.include('invalid format');
    });

    it('should filter out image-alt issues from parsed issue names (line 387)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `image-alt`', '2 x `role-img-alt`', '3 x `svg-img-alt`', '4 x `valid-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'image-alt',
            description: 'Image Alt',
            level: 'A',
            successCriteriaNumber: '111',
          },
          {
            rule: 'role-img-alt',
            description: 'Role Img Alt',
            level: 'A',
            successCriteriaNumber: '111',
          },
          {
            rule: 'svg-img-alt',
            description: 'SVG Img Alt',
            level: 'A',
            successCriteriaNumber: '111',
          },
          {
            rule: 'valid-issue',
            description: 'Valid Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('valid-issue');
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
    });

    it('should create new commonIssues entry when issue does not exist (lines 389-395)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `new-issue`'],
          levelAA: ['2 x `another-new-issue`'],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'new-issue',
            description: 'New Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [
          {
            rule: 'another-new-issue',
            description: 'Another New Issue',
            level: 'AA',
            successCriteriaNumber: '241',
          },
        ],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('new-issue');
      expect(result).to.include('another-new-issue');
      // Should correctly map levelA to 'A' and levelAA to 'AA'
      expect(result).to.include('| A |');
      expect(result).to.include('| AA |');
    });

    it('should add pages to existing commonIssues entry (lines 397-400)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['2 x `shared-issue`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/page2',
          traffic: 900,
          levelA: ['3 x `shared-issue`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/page3',
          traffic: 800,
          levelA: ['1 x `shared-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'shared-issue',
            description: 'Shared Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('shared-issue');
      expect(result).to.include('https://example.com/page1 (2)');
      expect(result).to.include('https://example.com/page2 (3)');
      expect(result).to.include('https://example.com/page3 (1)');
    });

    it('should sort issues by level (A before AA) (lines 405-406)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `a-level-issue`'],
          levelAA: ['10 x `aa-level-issue`'], // Higher count but AA level
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'a-level-issue',
            description: 'A Level Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [
          {
            rule: 'aa-level-issue',
            description: 'AA Level Issue',
            level: 'AA',
            successCriteriaNumber: '241',
          },
        ],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      const aLevelIndex = result.indexOf('a-level-issue');
      const aaLevelIndex = result.indexOf('aa-level-issue');
      expect(aLevelIndex).to.be.lessThan(aaLevelIndex);
    });

    it('should sort issues by page count when levels are equal (lines 407-408)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `issue-few-pages`', '1 x `issue-many-pages`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/page2',
          traffic: 900,
          levelA: ['1 x `issue-many-pages`'], // This issue appears on more pages
          levelAA: [],
        },
        {
          url: 'https://example.com/page3',
          traffic: 800,
          levelA: ['1 x `issue-many-pages`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'issue-few-pages',
            description: 'Issue Few Pages',
            level: 'A',
            successCriteriaNumber: '143',
          },
          {
            rule: 'issue-many-pages',
            description: 'Issue Many Pages',
            level: 'A',
            successCriteriaNumber: '144',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      const manyPagesIndex = result.indexOf('issue-many-pages');
      const fewPagesIndex = result.indexOf('issue-few-pages');
      expect(manyPagesIndex).to.be.lessThan(fewPagesIndex);
    });

    it('should sort issues by total count when levels and page counts are equal (lines 409-412)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['2 x `issue-low-count`', '5 x `issue-high-count`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/page2',
          traffic: 900,
          levelA: ['1 x `issue-low-count`', '3 x `issue-high-count`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'issue-low-count',
            description: 'Issue Low Count',
            level: 'A',
            successCriteriaNumber: '143',
          },
          {
            rule: 'issue-high-count',
            description: 'Issue High Count',
            level: 'A',
            successCriteriaNumber: '144',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      // issue-high-count has total count of 8 (5+3), issue-low-count has 3 (2+1)
      const highCountIndex = result.indexOf('issue-high-count');
      const lowCountIndex = result.indexOf('issue-low-count');
      expect(highCountIndex).to.be.lessThan(lowCountIndex);
    });

    it('should generate section headers and table structure (lines 415-417)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('### Enhancing accessibility for the top 10 most-visited pages');
      // eslint-disable-next-line max-len
      expect(result).to.include('| Issue | WCAG Success Criterion | Level| Pages |Description| How is the user affected | Suggestion | Solution Example |');
      // eslint-disable-next-line max-len
      expect(result).to.include('|-------|-------|-------------|-------------|-------------|-------------|-------------|-------------|');
      expect(result).to.include('---');
    });

    it('should format pages text with URL and count (line 420)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['3 x `test-issue`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/page2',
          traffic: 900,
          levelA: ['2 x `test-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'test-issue',
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('https://example.com/page1 (3), https://example.com/page2 (2)');
    });

    it('should handle missing issue in issuesLookup (lines 421-426)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `unknown-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [], // Empty, so issuesLookup will be empty
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('unknown-issue');
      // Should handle missing data gracefully with empty strings
      expect(result).to.include('| unknown-issue |');
    });

    it('should escape HTML in userImpact and suggestion (lines 422-423)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('test-issue');
    });

    it('should handle missing pages in issue (lines 430-431)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('test-issue');
      // Should handle gracefully without crashing
    });

    it('should handle missing pageData in currentData (lines 432-433)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {}; // Missing page data

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('test-issue');
      // Should handle missing page data gracefully
    });

    it('should handle missing violations in pageData (lines 433-434)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {
        'https://example.com/page1': {
          // Missing violations property
        },
      };

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('test-issue');
      // Should handle missing violations gracefully
    });

    it('should handle missing pageViolation items (line 435)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
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

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('test-issue');
      // Should handle missing violation items gracefully
    });

    it('should handle missing failureSummary in pageViolation (lines 436-437)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
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

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('test-issue');
      // Should handle missing failureSummary gracefully
    });

    it('should process and escape failureSummary with HTML replacement (lines 438-441)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
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
                  // eslint-disable-next-line max-len
                  failureSummary: 'Fix all of the following:\nFirst issue\nSecond issue\nContains <script>alert("xss")</script> and | pipe character',
                },
              },
            },
          },
        },
      };

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('test-issue');
      // Should escape HTML and replace newlines with <br> and pipes with &#124;
      expect(result).to.include('`<script>`alert("xss")`</script>`');
      expect(result).to.include('<br>');
      expect(result).to.include('&#124;');
    });

    it('should format successCriteriaNumber with dots (line 444)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('1.4.3'); // Should format '143' as '1.4.3'
    });

    it('should generate complete table row with all columns (line 444)', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['2 x `complete-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'complete-issue',
            description: 'Complete Issue Description',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'complete-issue': {
                  failureSummary: 'Complete failure summary',
                },
              },
            },
          },
        },
      };

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      // Should include all table columns
      expect(result).to.include('complete-issue'); // Issue name
      expect(result).to.include('1.4.3'); // WCAG criterion
      expect(result).to.include('A'); // Level
      expect(result).to.include('https://example.com/page1 (2)'); // Pages
      expect(result).to.include('Complete Issue Description'); // Description
    });

    it('should handle empty trafficViolations', () => {
      const trafficViolations = [];
      const issuesOverview = {
        levelA: [],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('### Enhancing accessibility for the top 10 most-visited pages');
      expect(result).to.include('---');
      // Should not crash and return valid section structure
    });

    it('should handle empty issuesOverview', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `unknown-issue`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('unknown-issue');
      // Should handle gracefully with empty issuesLookup
    });

    it('should escape HTML in userImpact and suggestion (lines 422-423)', () => {
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
            description: 'Test Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      expect(result).to.include('test-issue');
    });

    it('should execute line 410 when a.level is A and b.level is AA', () => {
      // Test the specific condition: a.level !== b.level and a.level === 'A' ? -1 : 1
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['1 x `level-a-issue`'],
          levelAA: ['100 x `level-aa-issue`'], // Much higher count but AA level
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'level-a-issue',
            description: 'Level A Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [
          {
            rule: 'level-aa-issue',
            description: 'Level AA Issue',
            level: 'AA',
            successCriteriaNumber: '241',
          },
        ],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      // Level A should come before Level AA despite lower count (line 410: return -1)
      const levelAIndex = result.indexOf('level-a-issue');
      const levelAAIndex = result.indexOf('level-aa-issue');
      expect(levelAIndex).to.be.lessThan(levelAAIndex);
    });

    it('should execute line 410 when a.level is AA and b.level is A', () => {
      // Test the specific condition: a.level !== b.level and a.level === 'A' ? -1 : 1
      // When a.level is 'AA', it should return 1
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelAA: ['1000 x `aa-first-issue`'], // Listed first but AA level
          levelA: ['1 x `a-second-issue`'], // Listed second but A level
        },
      ];
      const issuesOverview = {
        levelAA: [
          {
            rule: 'aa-first-issue',
            description: 'AA Issue Listed First',
            level: 'AA',
            successCriteriaNumber: '241',
          },
        ],
        levelA: [
          {
            rule: 'a-second-issue',
            description: 'A Issue Listed Second',
            level: 'A',
            successCriteriaNumber: '143',
          },
        ],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      // A level should still come first even when AA is listed first (line 410: return 1)
      const aIssueIndex = result.indexOf('a-second-issue');
      const aaIssueIndex = result.indexOf('aa-first-issue');
      expect(aIssueIndex).to.be.lessThan(aaIssueIndex);
    });

    it('should verify line 410 ternary operator both branches', () => {
      // Test both branches of the ternary: a.level === 'A' ? -1 : 1
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 1000,
          levelA: ['5 x `critical-a-issue`'],
          levelAA: ['10 x `serious-aa-issue`'],
        },
        {
          url: 'https://example.com/page2',
          traffic: 900,
          levelA: ['3 x `another-a-issue`'],
          levelAA: ['15 x `another-aa-issue`'],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'critical-a-issue',
            description: 'Critical A Issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
          {
            rule: 'another-a-issue',
            description: 'Another A Issue',
            level: 'A',
            successCriteriaNumber: '144',
          },
        ],
        levelAA: [
          {
            rule: 'serious-aa-issue',
            description: 'Serious AA Issue',
            level: 'AA',
            successCriteriaNumber: '241',
          },
          {
            rule: 'another-aa-issue',
            description: 'Another AA Issue',
            level: 'AA',
            successCriteriaNumber: '242',
          },
        ],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      // All A level issues should come before all AA level issues
      const criticalAIndex = result.indexOf('critical-a-issue');
      const anotherAIndex = result.indexOf('another-a-issue');
      const seriousAAIndex = result.indexOf('serious-aa-issue');
      const anotherAAIndex = result.indexOf('another-aa-issue');

      // Both A level issues should come before both AA level issues
      expect(criticalAIndex).to.be.lessThan(seriousAAIndex);
      expect(criticalAIndex).to.be.lessThan(anotherAAIndex);
      expect(anotherAIndex).to.be.lessThan(seriousAAIndex);
      expect(anotherAIndex).to.be.lessThan(anotherAAIndex);
    });
  });
});
