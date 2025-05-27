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
    it('should return empty string for null or undefined input', () => {
      expect(escapeHtmlTags(null)).to.equal('');
      expect(escapeHtmlTags(undefined)).to.equal('');
      expect(escapeHtmlTags('')).to.equal('');
    });

    it('should escape HTML tags by wrapping them in backticks', () => {
      const input = 'This is a <div> element';
      const expected = 'This is a `<div>` element';
      expect(escapeHtmlTags(input)).to.equal(expected);
    });

    it('should escape multiple HTML tags', () => {
      const input = 'Use <div> and <span> elements';
      const expected = 'Use `<div>` and `<span>` elements';
      expect(escapeHtmlTags(input)).to.equal(expected);
    });

    it('should preserve existing backtick-wrapped content', () => {
      const input = 'Use `existing code` and <div> elements';
      const expected = 'Use `existing code` and `<div>` elements';
      expect(escapeHtmlTags(input)).to.equal(expected);
    });

    it('should handle complex HTML tags with attributes', () => {
      const input = 'Click the <button type="submit" class="btn"> button';
      const expected = 'Click the `<button type="submit" class="btn">` button';
      expect(escapeHtmlTags(input)).to.equal(expected);
    });

    it('should handle self-closing tags', () => {
      const input = 'Add an <img src="test.jpg" alt="test"/> image';
      const expected = 'Add an `<img src="test.jpg" alt="test"/>` image';
      expect(escapeHtmlTags(input)).to.equal(expected);
    });

    it('should handle multiple existing backtick sections', () => {
      const input = 'Use `code1` and `code2` with <div> elements';
      const expected = 'Use `code1` and `code2` with `<div>` elements';
      expect(escapeHtmlTags(input)).to.equal(expected);
    });

    it('should handle nested HTML-like content in backticks', () => {
      const input = 'Use `<span>nested</span>` and <div> elements';
      const expected = 'Use `<span>nested</span>` and `<div>` elements';
      expect(escapeHtmlTags(input)).to.equal(expected);
    });

    it('should handle text with no HTML tags', () => {
      const input = 'This is plain text without any tags';
      const expected = 'This is plain text without any tags';
      expect(escapeHtmlTags(input)).to.equal(expected);
    });
  });

  describe('formatFailureSummary', () => {
    it('should handle "Fix any of the following" section', () => {
      const input = `Fix any of the following:
Item 1
Item 2
Item 3`;
      const expected = `One or more of the following related issues may also be present:
1. Item 1
2. Item 2
3. Item 3`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should handle "Fix all of the following" section', () => {
      const input = `Fix all of the following:
Critical item 1
Critical item 2`;
      const expected = `The following issue has been identified and must be addressed:
1. Critical item 1
2. Critical item 2`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should handle multiple sections with "Fix any" followed by "Fix all"', () => {
      const input = `Fix any of the following:
Optional item 1
Optional item 2
Fix all of the following:
Required item 1
Required item 2`;
      const expected = `One or more of the following related issues may also be present:
1. Optional item 1
2. Optional item 2
The following issue has been identified and must be addressed:
1. Required item 1
2. Required item 2`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should handle multiple sections with "Fix all" followed by "Fix any"', () => {
      const input = `Fix all of the following:
Required item 1
Fix any of the following:
Optional item 1
Optional item 2`;
      const expected = `The following issue has been identified and must be addressed:
1. Required item 1
One or more of the following related issues may also be present:
1. Optional item 1
2. Optional item 2`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should filter out empty lines', () => {
      const input = `Fix any of the following:

Item 1

Item 2

`;
      const expected = `One or more of the following related issues may also be present:
1. Item 1
2. Item 2`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should handle text with extra whitespace', () => {
      const input = `Fix any of the following:
  Item 1 with spaces  
   Item 2 with more spaces   `;
      const expected = `One or more of the following related issues may also be present:
1. Item 1 with spaces
2. Item 2 with more spaces`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should handle single item in each section', () => {
      const input = `Fix any of the following:
Single optional item
Fix all of the following:
Single required item`;
      const expected = `One or more of the following related issues may also be present:
1. Single optional item
The following issue has been identified and must be addressed:
1. Single required item`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should handle empty input', () => {
      expect(formatFailureSummary('')).to.equal('');
    });

    it('should handle input without "Fix" sections', () => {
      const input = 'This is just regular text without any fix sections';
      expect(formatFailureSummary(input)).to.equal('');
    });

    it('should handle only header without items', () => {
      const input = 'Fix any of the following:';
      const expected = 'One or more of the following related issues may also be present:';
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should handle complex real-world example', () => {
      const input = `Fix any of the following:
Ensure the contrast ratio between the foreground and background colors meets WCAG AA standards (at least 4.5:1 for normal text)
Use sufficient color contrast for text elements
Fix all of the following:
Add proper alt text to images
Ensure all form elements have associated labels`;
      const expected = `One or more of the following related issues may also be present:
1. Ensure the contrast ratio between the foreground and background colors meets WCAG AA standards (at least 4.5:1 for normal text)
2. Use sufficient color contrast for text elements
The following issue has been identified and must be addressed:
1. Add proper alt text to images
2. Ensure all form elements have associated labels`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should handle multiple "Fix any" sections', () => {
      const input = `Fix any of the following:
First group item 1
First group item 2
Fix any of the following:
Second group item 1
Second group item 2`;
      const expected = `One or more of the following related issues may also be present:
1. First group item 1
2. First group item 2
One or more of the following related issues may also be present:
1. Second group item 1
2. Second group item 2`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });

    it('should handle multiple "Fix all" sections', () => {
      const input = `Fix all of the following:
First required item
Fix all of the following:
Second required item`;
      const expected = `The following issue has been identified and must be addressed:
1. First required item
The following issue has been identified and must be addressed:
1. Second required item`;
      expect(formatFailureSummary(input)).to.equal(expected);
    });
  });

  describe('calculateWCAGData', () => {
    it('should calculate WCAG compliance data correctly', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: {
              items: {
                'color-contrast': { level: 'A', count: 5 },
                'heading-order': { level: 'A', count: 3 },
                'aria-required-attr': { level: 'AA', count: 2 },
              },
            },
            serious: {
              items: {
                label: { level: 'A', count: 4 },
                'link-name': { level: 'AA', count: 1 },
                region: { level: 'AA', count: 2 },
              },
            },
          },
        },
      };

      const result = calculateWCAGData(currentFile);

      expect(result).to.deep.equal({
        passed: { A: 27, AA: 17 },
        failures: { A: 3, AA: 3 },
        totals: { A: 30, AA: 20 },
        complianceScores: {
          A: (27 / 30) * 100,
          AA: (44 / 50) * 100,
        },
      });
    });

    it('should handle empty violations', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const result = calculateWCAGData(currentFile);

      expect(result).to.deep.equal({
        passed: { A: 30, AA: 20 },
        failures: { A: 0, AA: 0 },
        totals: { A: 30, AA: 20 },
        complianceScores: {
          A: 100,
          AA: 100,
        },
      });
    });

    it('should handle missing items property', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: {},
            serious: {},
          },
        },
      };

      const result = calculateWCAGData(currentFile);

      expect(result).to.deep.equal({
        passed: { A: 30, AA: 20 },
        failures: { A: 0, AA: 0 },
        totals: { A: 30, AA: 20 },
        complianceScores: {
          A: 100,
          AA: 100,
        },
      });
    });
  });

  describe('processTrafficViolations', () => {
    it('should process traffic violations data correctly', () => {
      const currentFile = {
        overall: { /* overall data */ },
        'https://example.com/page1': {
          traffic: 1000,
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 5 },
                'heading-order': { count: 2 },
              },
            },
            serious: {
              items: {
                label: { count: 3 },
                'link-name': { count: 1 },
              },
            },
          },
        },
        'https://example.com/page2': {
          traffic: 500,
          violations: {
            critical: {
              items: {
                'aria-required-attr': { count: 1 },
              },
            },
            serious: {
              items: {
                region: { count: 2 },
              },
            },
          },
        },
      };

      const result = processTrafficViolations(currentFile);

      expect(result).to.have.lengthOf(2);
      expect(result[0]).to.deep.equal({
        url: 'https://example.com/page1',
        traffic: 1000,
        levelA: ['5 x `color-contrast`', '2 x `heading-order`'],
        levelAA: ['3 x `label`', '1 x `link-name`'],
      });
      expect(result[1]).to.deep.equal({
        url: 'https://example.com/page2',
        traffic: 500,
        levelA: ['1 x `aria-required-attr`'],
        levelAA: ['2 x `region`'],
      });
    });

    it('should filter out overall data', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: {
              items: {
                test: {
                  count: 10,
                },
              },
            },
            serious: {
              items: {
                test2: {
                  count: 5,
                },
              },
            },
          },
        },
        'https://example.com/page1': {
          traffic: 1000,
          violations: {
            critical: {
              items: {},
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const result = processTrafficViolations(currentFile);

      expect(result).to.have.lengthOf(1);
      expect(result[0].url).to.equal('https://example.com/page1');
    });

    it('should handle pages with no violations', () => {
      const currentFile = {
        'https://example.com/page1': {
          traffic: 1000,
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const result = processTrafficViolations(currentFile);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.equal({
        url: 'https://example.com/page1',
        traffic: 1000,
        levelA: [],
        levelAA: [],
      });
    });

    it('should handle pages without traffic data', () => {
      const currentFile = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 5 },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const result = processTrafficViolations(currentFile);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.equal({
        url: 'https://example.com/page1',
        traffic: undefined,
        levelA: ['5 x `color-contrast`'],
        levelAA: [],
      });
    });
  });

  describe('processQuickWinsData', () => {
    it('should process quick wins data correctly', () => {
      const currentFile = {
        overall: {
          violations: {
            total: 100,
            critical: {
              items: {
                'color-contrast': {
                  id: 'color-contrast', count: 20, description: 'Color contrast issue', level: 'A',
                },
                'heading-order': {
                  id: 'heading-order', count: 15, description: 'Heading order issue', level: 'A',
                },
                'image-alt': {
                  id: 'image-alt', count: 10, description: 'Image alt issue', level: 'A',
                }, // should be filtered
              },
            },
            serious: {
              items: {
                label: {
                  id: 'label', count: 25, description: 'Label issue', level: 'AA',
                },
                'link-name': {
                  id: 'link-name', count: 5, description: 'Link name issue', level: 'AA',
                },
                'role-img-alt': {
                  id: 'role-img-alt', count: 8, description: 'Role img alt issue', level: 'AA',
                }, // should be filtered
              },
            },
          },
        },
      };

      const result = processQuickWinsData(currentFile);

      expect(result.topIssues).to.have.lengthOf(4);
      expect(result.topIssues[0]).to.deep.include({
        id: 'label',
        count: 25,
        description: 'Label issue',
        level: 'AA',
        percentage: '25.00',
      });
      expect(result.topIssues[1]).to.deep.include({
        id: 'color-contrast',
        count: 20,
        description: 'Color contrast issue',
        level: 'A',
        percentage: '20.00',
      });
      expect(result.totalPercentage).to.equal('60.00'); // Top 3: 25+20+15 = 60, but only 4 items so all included
      expect(result.allViolations).to.equal(currentFile);
    });

    it('should filter out image-alt related issues', () => {
      const currentFile = {
        overall: {
          violations: {
            total: 50,
            critical: {
              items: {
                'image-alt': {
                  id: 'image-alt', count: 10, description: 'Image alt issue', level: 'A',
                },
                'role-img-alt': {
                  id: 'role-img-alt', count: 8, description: 'Role img alt issue', level: 'A',
                },
                'svg-img-alt': {
                  id: 'svg-img-alt', count: 5, description: 'SVG img alt issue', level: 'A',
                },
                'color-contrast': {
                  id: 'color-contrast', count: 20, description: 'Color contrast issue', level: 'A',
                },
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const result = processQuickWinsData(currentFile);

      expect(result.topIssues).to.have.lengthOf(1);
      expect(result.topIssues[0].id).to.equal('color-contrast');
      expect(result.topIssues.every((issue) => !['image-alt', 'role-img-alt', 'svg-img-alt'].includes(issue.id))).to.be.true;
    });

    it('should not duplicate issues between critical and serious', () => {
      const currentFile = {
        overall: {
          violations: {
            total: 100,
            critical: {
              items: {
                'color-contrast': {
                  id: 'color-contrast', count: 20, description: 'Color contrast issue', level: 'A',
                },
              },
            },
            serious: {
              items: {
                'color-contrast': {
                  id: 'color-contrast', count: 15, description: 'Color contrast issue', level: 'A',
                },
                label: {
                  id: 'label', count: 25, description: 'Label issue', level: 'AA',
                },
              },
            },
          },
        },
      };

      const result = processQuickWinsData(currentFile);

      expect(result.topIssues).to.have.lengthOf(2);
      const colorContrastIssue = result.topIssues.find((issue) => issue.id === 'color-contrast');
      expect(colorContrastIssue.count).to.equal(20); // Should use critical version, not serious
    });

    it('should sort issues by count in descending order', () => {
      const currentFile = {
        overall: {
          violations: {
            total: 100,
            critical: {
              items: {
                'issue-a': {
                  id: 'issue-a', count: 5, description: 'Issue A', level: 'A',
                },
                'issue-b': {
                  id: 'issue-b', count: 30, description: 'Issue B', level: 'A',
                },
                'issue-c': {
                  id: 'issue-c', count: 15, description: 'Issue C', level: 'A',
                },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const result = processQuickWinsData(currentFile);

      expect(result.topIssues[0].count).to.equal(30);
      expect(result.topIssues[1].count).to.equal(15);
      expect(result.topIssues[2].count).to.equal(5);
    });

    it('should calculate percentages correctly', () => {
      const currentFile = {
        overall: {
          violations: {
            total: 200,
            critical: {
              items: {
                'issue-a': {
                  id: 'issue-a', count: 50, description: 'Issue A', level: 'A',
                },
                'issue-b': {
                  id: 'issue-b', count: 30, description: 'Issue B', level: 'A',
                },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const result = processQuickWinsData(currentFile);

      expect(result.topIssues[0].percentage).to.equal('25.00'); // 50/200 * 100
      expect(result.topIssues[1].percentage).to.equal('15.00'); // 30/200 * 100
      expect(result.totalPercentage).to.equal('40.00'); // 25 + 15
    });

    it('should handle empty violations', () => {
      const currentFile = {
        overall: {
          violations: {
            total: 0,
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const result = processQuickWinsData(currentFile);

      expect(result.topIssues).to.have.lengthOf(0);
      expect(result.totalPercentage).to.equal('0.00');
      expect(result.allViolations).to.equal(currentFile);
    });
  });

  describe('calculateDiffData', () => {
    it('should calculate diff data correctly for new and fixed issues', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: {
              items: {},
            },
            serious: {
              items: {},
            },
          },
        },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': {
                  count: 5,
                },
                'new-critical-issue': {
                  count: 2,
                },
              },
            },
            serious: {
              items: {
                'new-serious-issue': {
                  count: 3,
                },
              },
            },
          },
        },
        'https://example.com/page2': {
          violations: {
            critical: {
              items: {
                'persistent-issue': {
                  count: 1,
                },
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const lastWeekFile = {
        overall: {
          violations: {
            critical: {
              items: {},
            },
            serious: {
              items: {},
            },
          },
        },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': {
                  count: 5,
                },
                'fixed-critical-issue': {
                  count: 1,
                },
              },
            },
            serious: {
              items: {
                'fixed-serious-issue': {
                  count: 2,
                },
              },
            },
          },
        },
        'https://example.com/page3': {
          violations: {
            critical: {
              items: {
                'removed-page-issue': {
                  count: 1,
                },
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result).to.deep.equal({
        fixedIssues: {
          critical: {
            'https://example.com/page1': ['fixed-critical-issue'],
            'https://example.com/page3': ['removed-page-issue'],
          },
          serious: {
            'https://example.com/page1': ['fixed-serious-issue'],
          },
        },
        newIssues: {
          critical: {
            'https://example.com/page1': ['new-critical-issue'],
            'https://example.com/page2': ['persistent-issue'],
          },
          serious: {
            'https://example.com/page1': ['new-serious-issue'],
          },
        },
      });
    });

    it('should filter out image-alt related issues', () => {
      const currentFile = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'image-alt': {
                  count: 5,
                },
                'role-img-alt': {
                  count: 3,
                },
                'svg-img-alt': {
                  count: 2,
                },
                'color-contrast': {
                  count: 1,
                },
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const lastWeekFile = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'image-alt': {
                  count: 10,
                },
                'role-img-alt': {
                  count: 8,
                },
                'svg-img-alt': {
                  count: 6,
                },
                'fixed-issue': {
                  count: 2,
                },
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result).to.deep.equal({
        fixedIssues: {
          critical: {
            'https://example.com/page1': ['fixed-issue'],
          },
          serious: {},
        },
        newIssues: {
          critical: {
            'https://example.com/page1': ['color-contrast'],
          },
          serious: {},
        },
      });
    });

    it('should handle pages that exist in current but not in previous week', () => {
      const currentFile = {
        'https://example.com/new-page': {
          violations: {
            critical: {
              items: {
                'color-contrast': {
                  count: 5,
                },
              },
            },
            serious: {
              items: {
                label: {
                  count: 3,
                },
              },
            },
          },
        },
      };

      const lastWeekFile = {
        'https://example.com/old-page': {
          violations: {
            critical: {
              items: {
                'heading-order': {
                  count: 2,
                },
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result).to.deep.equal({
        fixedIssues: {
          critical: {
            'https://example.com/old-page': ['heading-order'],
          },
          serious: {},
        },
        newIssues: {
          critical: {
            'https://example.com/new-page': ['color-contrast'],
          },
          serious: {
            'https://example.com/new-page': ['label'],
          },
        },
      });
    });

    it('should handle empty violations gracefully', () => {
      const currentFile = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {},
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const lastWeekFile = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {},
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result).to.deep.equal({
        fixedIssues: {
          critical: {},
          serious: {},
        },
        newIssues: {
          critical: {},
          serious: {},
        },
      });
    });

    it('should handle missing violations items property', () => {
      const currentFile = {
        'https://example.com/page1': {
          violations: {
            critical: {},
            serious: {},
          },
        },
      };

      const lastWeekFile = {
        'https://example.com/page1': {
          violations: {
            critical: {},
            serious: {},
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result).to.deep.equal({
        fixedIssues: {
          critical: {},
          serious: {},
        },
        newIssues: {
          critical: {},
          serious: {},
        },
      });
    });

    it('should skip overall data in both files', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: {
              items: {
                'overall-critical': {
                  count: 100,
                },
              },
            },
            serious: {
              items: {
                'overall-serious': {
                  count: 50,
                },
              },
            },
          },
        },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'new-issue': {
                  count: 1,
                },
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const lastWeekFile = {
        overall: {
          violations: {
            critical: {
              items: {
                'overall-critical-old': {
                  count: 80,
                },
              },
            },
            serious: {
              items: {
                'overall-serious-old': {
                  count: 40,
                },
              },
            },
          },
        },
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'fixed-issue': {
                  count: 1,
                },
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result).to.deep.equal({
        fixedIssues: {
          critical: {
            'https://example.com/page1': ['fixed-issue'],
          },
          serious: {},
        },
        newIssues: {
          critical: {
            'https://example.com/page1': ['new-issue'],
          },
          serious: {},
        },
      });
    });

    it('should handle complex scenario with multiple pages and mixed changes', () => {
      const currentFile = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'persistent-critical': {
                  count: 5,
                },
                'new-critical': {
                  count: 2,
                },
              },
            },
            serious: {
              items: {
                'new-serious': {
                  count: 3,
                },
              },
            },
          },
        },
        'https://example.com/page2': {
          violations: {
            critical: {
              items: {},
            },
            serious: {
              items: {
                'persistent-serious': {
                  count: 1,
                },
              },
            },
          },
        },
        'https://example.com/page3': {
          violations: {
            critical: {
              items: {
                'completely-new-page-issue': {
                  count: 1,
                },
              },
            },
            serious: {
              items: {},
            },
          },
        },
      };

      const lastWeekFile = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'persistent-critical': {
                  count: 5,
                },
                'fixed-critical': {
                  count: 1,
                },
              },
            },
            serious: {
              items: {
                'fixed-serious': {
                  count: 2,
                },
              },
            },
          },
        },
        'https://example.com/page2': {
          violations: {
            critical: {
              items: {
                'fixed-critical-page2': {
                  count: 3,
                },
              },
            },
            serious: {
              items: {
                'persistent-serious': {
                  count: 1,
                },
              },
            },
          },
        },
        'https://example.com/removed-page': {
          violations: {
            critical: {
              items: {
                'removed-page-critical': {
                  count: 2,
                },
              },
            },
            serious: {
              items: {
                'removed-page-serious': {
                  count: 1,
                },
              },
            },
          },
        },
      };

      const result = calculateDiffData(currentFile, lastWeekFile);

      expect(result).to.deep.equal({
        fixedIssues: {
          critical: {
            'https://example.com/page1': ['fixed-critical'],
            'https://example.com/page2': ['fixed-critical-page2'],
            'https://example.com/removed-page': ['removed-page-critical'],
          },
          serious: {
            'https://example.com/page1': ['fixed-serious'],
            'https://example.com/removed-page': ['removed-page-serious'],
          },
        },
        newIssues: {
          critical: {
            'https://example.com/page1': ['new-critical'],
            'https://example.com/page3': ['completely-new-page-issue'],
          },
          serious: {
            'https://example.com/page1': ['new-serious'],
          },
        },
      });
    });
  });

  describe('generateRoadToWCAGSection', () => {
    it('should generate WCAG compliance section with correct data', () => {
      const wcagData = {
        passed: { A: 25, AA: 18 },
        failures: { A: 5, AA: 2 },
        totals: { A: 30, AA: 20 },
        complianceScores: {
          A: 83.33,
          AA: 86.00,
        },
      };

      const result = generateRoadToWCAGSection(wcagData);

      expect(result).to.include('### Road To WCAG 2.2 Level A');
      expect(result).to.include('| 30 | 25 | 5 | 83.33%|');
      expect(result).to.include('### Road To WCAG 2.2 Level AA');
      // eslint-disable-next-line max-len
      expect(result).to.include('| 50 (30 Level A + 20 Level AA) | 43 (25 Level A + 18 Level AA) | 7 (5 Level A + 2 Level AA) | 86.00%|');
      expect(result).to.include('---');
    });

    it('should handle perfect compliance scores', () => {
      const wcagData = {
        passed: { A: 30, AA: 20 },
        failures: { A: 0, AA: 0 },
        totals: { A: 30, AA: 20 },
        complianceScores: {
          A: 100.00,
          AA: 100.00,
        },
      };

      const result = generateRoadToWCAGSection(wcagData);

      expect(result).to.include('| 30 | 30 | 0 | 100.00%|');
      // eslint-disable-next-line max-len
      expect(result).to.include('| 50 (30 Level A + 20 Level AA) | 50 (30 Level A + 20 Level AA) | 0 (0 Level A + 0 Level AA) | 100.00%|');
    });

    it('should format decimal scores correctly', () => {
      const wcagData = {
        passed: { A: 22, AA: 15 },
        failures: { A: 8, AA: 5 },
        totals: { A: 30, AA: 20 },
        complianceScores: {
          A: 73.333333,
          AA: 74.555555,
        },
      };

      const result = generateRoadToWCAGSection(wcagData);

      expect(result).to.include('73.33%');
      expect(result).to.include('74.56%');
    });
  });

  describe('formatTraffic', () => {
    it('should format small numbers without notation', () => {
      expect(formatTraffic(123)).to.equal('123');
      expect(formatTraffic(999)).to.equal('999');
    });

    it('should format thousands with K notation', () => {
      expect(formatTraffic(1000)).to.equal('1K');
      expect(formatTraffic(1500)).to.equal('1.5K');
      expect(formatTraffic(12000)).to.equal('12K');
      expect(formatTraffic(999999)).to.equal('1M');
    });

    it('should format millions with M notation', () => {
      expect(formatTraffic(1000000)).to.equal('1M');
      expect(formatTraffic(1500000)).to.equal('1.5M');
      expect(formatTraffic(12000000)).to.equal('12M');
    });

    it('should handle zero and negative numbers', () => {
      expect(formatTraffic(0)).to.equal('0');
      expect(formatTraffic(-1000)).to.equal('-1K');
    });

    it('should handle decimal inputs', () => {
      expect(formatTraffic(1234)).to.equal('1.2K');
      expect(formatTraffic(1000010)).to.equal('1M');
    });
  });

  describe('generateAccessibilityComplianceIssuesVsTrafficSection', () => {
    it('should generate traffic violations section correctly', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 10000,
          levelA: ['5 x `color-contrast`', '2 x `heading-order`'],
          levelAA: ['3 x `label`', '1 x `link-name`'],
        },
        {
          url: 'https://example.com/page2',
          traffic: 5000,
          levelA: ['1 x `aria-required-attr`'],
          levelAA: ['2 x `region`'],
        },
        {
          url: 'https://example.com/page3',
          traffic: 1000,
          levelA: [],
          levelAA: ['1 x `landmark`'],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced-report';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      // eslint-disable-next-line max-len
      expect(result).to.include('### Accessibility Compliance Issues vs Traffic | **[In-Depth Report](https://example.com/enhanced-report)**');
      expect(result).to.include('An overview of top 10 pages in terms of traffic');
      expect(result).to.include('| Page | Traffic |Total Issues  |Level A |Level AA |');
      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page1 | 10K | 4 | 5 x `color-contrast`, 2 x `heading-order` | 3 x `label`, 1 x `link-name` |');
      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page2 | 5K | 2 | 1 x `aria-required-attr` | 2 x `region` |');
      expect(result).to.include('| https://example.com/page3 | 1K | 1 | - | 1 x `landmark` |');
    });

    it('should sort pages by traffic in descending order', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/low-traffic',
          traffic: 1000,
          levelA: ['1 x `issue1`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/high-traffic',
          traffic: 50000,
          levelA: ['2 x `issue2`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/medium-traffic',
          traffic: 10000,
          levelA: ['1 x `issue3`'],
          levelAA: [],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced-report';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      const lines = result.split('\n');
      const dataLines = lines.filter((line) => line.includes('https://example.com/'));

      expect(dataLines[1]).to.include('high-traffic');
      expect(dataLines[2]).to.include('medium-traffic');
      expect(dataLines[3]).to.include('low-traffic');
    });

    it('should limit to top 10 pages', () => {
      const trafficViolations = Array.from({ length: 15 }, (_, i) => ({
        url: `https://example.com/page${i + 1}`,
        traffic: (15 - i) * 1000,
        levelA: [`1 x \`issue${i + 1}\``],
        levelAA: [],
      }));
      const enhancedReportUrl = 'https://example.com/enhanced-report';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      const lines = result.split('\n');
      const dataLines = lines.filter((line) => line.includes('https://example.com/page'));

      expect(dataLines).to.have.lengthOf(10);
      expect(dataLines[0]).to.include('page1'); // Highest traffic
      expect(dataLines[9]).to.include('page10'); // 10th highest traffic
      expect(result).to.not.include('page11'); // Should not include 11th page
    });

    it('should filter out image-alt related issues', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 10000,
          levelA: ['5 x `image-alt`', '3 x `color-contrast`', '2 x `role-img-alt`'],
          levelAA: ['4 x `svg-img-alt`', '1 x `label`'],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced-report';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page1 | 10K | 2 | 3 x `color-contrast` | 1 x `label` |');
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
    });

    it('should handle pages with no violations', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/clean-page',
          traffic: 10000,
          levelA: [],
          levelAA: [],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced-report';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      expect(result).to.include('| https://example.com/clean-page | 10K | 0 | - | - |');
    });

    it('should handle mixed scenarios with some filtered issues', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/mixed-page',
          traffic: 5000,
          levelA: ['2 x `image-alt`', '1 x `color-contrast`'],
          levelAA: ['3 x `role-img-alt`', '2 x `label`', '1 x `svg-img-alt`'],
        },
      ];
      const enhancedReportUrl = 'https://example.com/enhanced-report';

      // eslint-disable-next-line max-len
      const result = generateAccessibilityComplianceIssuesVsTrafficSection(trafficViolations, enhancedReportUrl);

      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/mixed-page | 5K | 2 | 1 x `color-contrast` | 2 x `label` |');
    });
  });

  describe('generateAccessibilityComplianceOverviewSection', () => {
    it('should generate compliance overview section with current data only', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 15 },
            serious: { count: 8 },
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      const result = generateAccessibilityComplianceOverviewSection(
        currentFile,
        null,
        inDepthReportUrl,
      );

      expect(result).to.include('### Accessibility Compliance Overview');
      expect(result).to.include('A breakdown of accessibility issues found');
      expect(result).to.include('| | Current |Week Over Week |');
      expect(result).to.include(`| **[Critical](${inDepthReportUrl})**| 15 | -% 🟢|`);
      expect(result).to.include(`| **[Serious](${inDepthReportUrl})**| 8 | -% 🟢|`);
    });

    it('should calculate week over week changes correctly', () => {
      const currentFile = {
        overall: {
          violations: {
            critical: { count: 20 },
            serious: { count: 5 },
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

      const result = generateAccessibilityComplianceOverviewSection(
        currentFile,
        lastWeekFile,
        inDepthReportUrl,
      );

      // eslint-disable-next-line max-len
      expect(result).to.include('| **[Critical](https://example.com/in-depth)**| 20 | 100.00% 🔴|');
      expect(result).to.include('| **[Serious](https://example.com/in-depth)**| 5 | -50.00% 🟢|');
    });

    it('should handle zero previous counts', () => {
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
            critical: { count: 0 },
            serious: { count: 0 },
          },
        },
      };
      const inDepthReportUrl = 'https://example.com/in-depth';

      const result = generateAccessibilityComplianceOverviewSection(
        currentFile,
        lastWeekFile,
        inDepthReportUrl,
      );

      // eslint-disable-next-line max-len
      expect(result).to.include('| **[Critical](https://example.com/in-depth)**| 5 | 0.00% 🟢|');
      expect(result).to.include('| **[Serious](https://example.com/in-depth)**| 3 | 0.00% 🟢|');
    });
  });

  describe('generateAccessibilityIssuesOverviewSection', () => {
    it('should generate issues overview section correctly', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'color-contrast',
            count: 15,
            level: 'A',
            successCriteriaNumber: '143',
            description: 'Color contrast issue',
            understandingUrl: 'https://example.com/understanding',
          },
          {
            rule: 'heading-order',
            count: 8,
            level: 'A',
            successCriteriaNumber: '131',
            description: 'Heading order issue',
            understandingUrl: 'https://example.com/understanding2',
          },
        ],
        levelAA: [
          {
            rule: 'label',
            count: 12,
            level: 'AA',
            successCriteriaNumber: '332',
            description: 'Label issue',
            understandingUrl: 'https://example.com/understanding3',
          },
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      expect(result).to.include('### Accessibility Issues Overview');
      // eslint-disable-next-line max-len
      expect(result).to.include('| Issue | WCAG Success Criterion | Count| Level |Impact| Description | WCAG Docs Link |');
      expect(result).to.include('| color-contrast |');
      expect(result).to.include('|15 | A |');
      expect(result).to.include('| Color contrast issue |');
    });

    it('should filter out image-alt related issues', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'image-alt',
            count: 10,
            level: 'A',
            successCriteriaNumber: '111',
            description: 'Image alt issue',
            understandingUrl: 'https://example.com/understanding',
          },
          {
            rule: 'color-contrast',
            count: 5,
            level: 'A',
            successCriteriaNumber: '143',
            description: 'Color contrast issue',
            understandingUrl: 'https://example.com/understanding2',
          },
        ],
        levelAA: [
          {
            rule: 'role-img-alt',
            count: 8,
            level: 'AA',
            successCriteriaNumber: '111',
            description: 'Role img alt issue',
            understandingUrl: 'https://example.com/understanding3',
          },
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      expect(result).to.include('color-contrast');
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
    });

    it('should return empty string when no issues after filtering', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'image-alt',
            count: 10,
            level: 'A',
            successCriteriaNumber: '111',
            description: 'Image alt issue',
            understandingUrl: 'https://example.com/understanding',
          },
        ],
        levelAA: [
          {
            rule: 'svg-img-alt',
            count: 5,
            level: 'AA',
            successCriteriaNumber: '111',
            description: 'SVG img alt issue',
            understandingUrl: 'https://example.com/understanding2',
          },
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      expect(result).to.equal('');
    });

    it('should sort issues correctly by level and count', () => {
      const issuesOverview = {
        levelA: [
          {
            rule: 'low-count-a',
            count: 3,
            level: 'A',
            successCriteriaNumber: '131',
            description: 'Low count A issue',
            understandingUrl: 'https://example.com/understanding',
          },
          {
            rule: 'high-count-a',
            count: 10,
            level: 'A',
            successCriteriaNumber: '143',
            description: 'High count A issue',
            understandingUrl: 'https://example.com/understanding2',
          },
        ],
        levelAA: [
          {
            rule: 'aa-issue',
            count: 15,
            level: 'AA',
            successCriteriaNumber: '332',
            description: 'AA issue',
            understandingUrl: 'https://example.com/understanding3',
          },
        ],
      };

      const result = generateAccessibilityIssuesOverviewSection(issuesOverview);

      const lines = result.split('\n');
      // eslint-disable-next-line max-len
      const dataLines = lines.filter((line) => line.startsWith('| ') && !line.includes('Issue | WCAG'));

      expect(dataLines[0]).to.include('high-count-a');
      expect(dataLines[1]).to.include('low-count-a');
      expect(dataLines[2]).to.include('aa-issue');
    });
  });

  describe('generateWeekOverWeekSection', () => {
    it('should return empty string when no previous data', () => {
      const currentData = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const result = generateWeekOverWeekSection(currentData, null, 'https://example.com/report');

      expect(result).to.equal('');
    });

    it('should generate week over week comparison correctly', () => {
      const currentData = {
        overall: {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 10 },
                'new-critical': { count: 5 },
                'improved-critical': { count: 3 },
              },
            },
            serious: {
              items: {
                'new-serious': { count: 8 },
                'improved-serious': { count: 2 },
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
                'color-contrast': { count: 10 },
                'fixed-critical': { count: 7 },
                'improved-critical': { count: 8 },
              },
            },
            serious: {
              items: {
                'fixed-serious': { count: 4 },
                'improved-serious': { count: 6 },
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      // eslint-disable-next-line max-len
      expect(result).to.include('A Week Over Week breadown of fixed and new accessibility issues');
      expect(result).to.include('| | Fixed | Improved | New |');
      expect(result).to.include('`fixed-critical`');
      expect(result).to.include('`new-critical`');
      expect(result).to.include('`improved-critical` (5 less)');
      expect(result).to.include('`fixed-serious`');
      expect(result).to.include('`new-serious`');
      expect(result).to.include('`improved-serious` (4 less)');
    });

    it('should filter out image-alt related issues', () => {
      const currentData = {
        overall: {
          violations: {
            critical: {
              items: {
                'image-alt': { count: 10 },
                'color-contrast': { count: 5 },
              },
            },
            serious: {
              items: {
                'role-img-alt': { count: 8 },
                label: { count: 3 },
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
                'svg-img-alt': { count: 7 },
                'heading-order': { count: 4 },
              },
            },
            serious: {
              items: {
                'image-alt': { count: 6 },
                region: { count: 2 },
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      expect(result).to.include('`color-contrast`');
      expect(result).to.include('`label`');
      expect(result).to.include('`heading-order`');
      expect(result).to.include('`region`');
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
    });

    it('should return empty string when no changes after filtering', () => {
      const currentData = {
        overall: {
          violations: {
            critical: {
              items: {
                'image-alt': { count: 10 },
              },
            },
            serious: {
              items: {
                'role-img-alt': { count: 8 },
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
                'svg-img-alt': { count: 7 },
              },
            },
            serious: {
              items: {
                'image-alt': { count: 6 },
              },
            },
          },
        },
      };
      const fixedVsNewReportUrl = 'https://example.com/fixed-new';

      const result = generateWeekOverWeekSection(currentData, previousData, fixedVsNewReportUrl);

      expect(result).to.equal('');
    });
  });

  describe('generateFixedIssuesSection', () => {
    it('should generate fixed issues section correctly', () => {
      const diffData = {
        fixedIssues: {
          critical: {
            'https://example.com/page1': ['color-contrast', 'heading-order'],
            'https://example.com/page2': ['aria-required-attr'],
          },
          serious: {
            'https://example.com/page1': ['label'],
            'https://example.com/page3': ['region', 'landmark'],
          },
        },
        newIssues: { critical: {}, serious: {} },
      };

      const result = generateFixedIssuesSection(diffData);

      expect(result).to.include('### Fixed Accessibility Issues');
      // eslint-disable-next-line max-len
      expect(result).to.include('Here is a breakdown of fixed accessibility issues Week Over Week');
      expect(result).to.include('| Page| Issues |Impact|');
      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page1 | `color-contrast`, `heading-order` | Critical |');
      expect(result).to.include('| https://example.com/page2 | `aria-required-attr` | Critical |');
      expect(result).to.include('| https://example.com/page1 | `label` | Serious |');
      expect(result).to.include('| https://example.com/page3 | `region`, `landmark` | Serious |');
    });

    it('should filter out image-alt related issues', () => {
      const diffData = {
        fixedIssues: {
          critical: {
            'https://example.com/page1': ['image-alt', 'color-contrast', 'role-img-alt'],
          },
          serious: {
            'https://example.com/page2': ['svg-img-alt', 'label'],
          },
        },
        newIssues: { critical: {}, serious: {} },
      };

      const result = generateFixedIssuesSection(diffData);

      expect(result).to.include('| https://example.com/page1 | `color-contrast` | Critical |');
      expect(result).to.include('| https://example.com/page2 | `label` | Serious |');
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
    });

    it('should return empty string when no fixed issues', () => {
      const diffData = {
        fixedIssues: {
          critical: {},
          serious: {},
        },
        newIssues: { critical: {}, serious: {} },
      };

      const result = generateFixedIssuesSection(diffData);

      expect(result).to.equal('');
    });

    it('should skip pages with only filtered issues', () => {
      const diffData = {
        fixedIssues: {
          critical: {
            'https://example.com/page1': ['image-alt', 'role-img-alt'],
            'https://example.com/page2': ['color-contrast'],
          },
          serious: {
            'https://example.com/page3': ['svg-img-alt'],
          },
        },
        newIssues: { critical: {}, serious: {} },
      };

      const result = generateFixedIssuesSection(diffData);

      expect(result).to.include('| https://example.com/page2 | `color-contrast` | Critical |');
      expect(result).to.not.include('page1');
      expect(result).to.not.include('page3');
    });
  });

  describe('generateNewIssuesSection', () => {
    it('should generate new issues section correctly', () => {
      const diffData = {
        fixedIssues: { critical: {}, serious: {} },
        newIssues: {
          critical: {
            'https://example.com/page1': ['color-contrast', 'heading-order'],
            'https://example.com/page2': ['aria-required-attr'],
          },
          serious: {
            'https://example.com/page1': ['label'],
            'https://example.com/page3': ['region', 'landmark'],
          },
        },
      };

      const result = generateNewIssuesSection(diffData);

      expect(result).to.include('### New Accessibility Issues');
      // eslint-disable-next-line max-len
      expect(result).to.include('Here is a breakdown of new accessibility issues Week Over Week');
      expect(result).to.include('| Page| Issues |Impact|');
      // eslint-disable-next-line max-len
      expect(result).to.include('| https://example.com/page1 | `color-contrast`, `heading-order` | Critical |');
      expect(result).to.include('| https://example.com/page2 | `aria-required-attr` | Critical |');
      expect(result).to.include('| https://example.com/page1 | `label` | Serious |');
      expect(result).to.include('| https://example.com/page3 | `region`, `landmark` | Serious |');
    });

    it('should filter out image-alt related issues', () => {
      const diffData = {
        fixedIssues: { critical: {}, serious: {} },
        newIssues: {
          critical: {
            'https://example.com/page1': ['image-alt', 'color-contrast', 'role-img-alt'],
          },
          serious: {
            'https://example.com/page2': ['svg-img-alt', 'label'],
          },
        },
      };

      const result = generateNewIssuesSection(diffData);

      expect(result).to.include('| https://example.com/page1 | `color-contrast` | Critical |');
      expect(result).to.include('| https://example.com/page2 | `label` | Serious |');
      expect(result).to.not.include('image-alt');
      expect(result).to.not.include('role-img-alt');
      expect(result).to.not.include('svg-img-alt');
    });

    it('should return empty string when no new issues', () => {
      const diffData = {
        fixedIssues: { critical: {}, serious: {} },
        newIssues: {
          critical: {},
          serious: {},
        },
      };

      const result = generateNewIssuesSection(diffData);

      expect(result).to.equal('');
    });

    it('should skip pages with only filtered issues', () => {
      const diffData = {
        fixedIssues: { critical: {}, serious: {} },
        newIssues: {
          critical: {
            'https://example.com/page1': ['image-alt', 'role-img-alt'],
            'https://example.com/page2': ['color-contrast'],
          },
          serious: {
            'https://example.com/page3': ['svg-img-alt'],
          },
        },
      };

      const result = generateNewIssuesSection(diffData);

      expect(result).to.include('| https://example.com/page2 | `color-contrast` | Critical |');
      expect(result).to.not.include('page1');
      expect(result).to.not.include('page3');
    });
  });

  describe('generateEnhancingAccessibilitySection', () => {
    it('should generate enhancing accessibility section correctly', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 10000,
          levelA: ['5 x `color-contrast`'],
          levelAA: ['3 x `label`'],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'color-contrast',
            level: 'A',
            description: 'Color contrast issue',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [
          {
            rule: 'label',
            level: 'AA',
            description: 'Label issue',
            successCriteriaNumber: '332',
          },
        ],
      };
      const currentData = {
        'https://example.com/page1': {
          violations: {
            critical: {
              items: {
                'color-contrast': {
                  failureSummary: 'Fix any of the following:\nEnsure sufficient color contrast',
                },
              },
            },
            serious: {
              items: {
                label: {
                  failureSummary: 'Fix all of the following:\nAdd proper labels',
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

      expect(result).to.include('### Enhancing accessibility for the top 10 most-visited pages');
      expect(result).to.include('| Issue | WCAG Success Criterion | Level| Pages |Description|');
      expect(result).to.include('| color-contrast |');
      expect(result).to.include('| https://example.com/page1 (5) |');
    });

    it('should filter out image-alt related issues', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 10000,
          levelA: ['5 x `image-alt`', '3 x `color-contrast`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'image-alt',
            level: 'A',
            description: 'Image alt issue',
            successCriteriaNumber: '111',
          },
          {
            rule: 'color-contrast',
            level: 'A',
            description: 'Color contrast issue',
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

      expect(result).to.include('color-contrast');
      expect(result).to.not.include('image-alt');
    });

    it('should sort issues correctly by level, pages count, and total count', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 10000,
          levelA: ['5 x `low-count-a`', '3 x `high-count-a`'],
          levelAA: ['2 x `aa-issue`'],
        },
        {
          url: 'https://example.com/page2',
          traffic: 8000,
          levelA: ['8 x `high-count-a`'],
          levelAA: ['4 x `aa-issue`', '1 x `single-page-aa`'],
        },
        {
          url: 'https://example.com/page3',
          traffic: 5000,
          levelA: ['2 x `low-count-a`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'low-count-a',
            level: 'A',
            description: 'Low count A issue',
            successCriteriaNumber: '131',
          },
          {
            rule: 'high-count-a',
            level: 'A',
            description: 'High count A issue',
            successCriteriaNumber: '143',
          },
        ],
        levelAA: [
          {
            rule: 'aa-issue',
            level: 'AA',
            description: 'AA issue',
            successCriteriaNumber: '332',
          },
          {
            rule: 'single-page-aa',
            level: 'AA',
            description: 'Single page AA issue',
            successCriteriaNumber: '333',
          },
        ],
      };
      const currentData = {};

      const result = generateEnhancingAccessibilitySection(
        trafficViolations,
        issuesOverview,
        currentData,
      );

      const lines = result.split('\n');
      // eslint-disable-next-line max-len
      const dataLines = lines.filter((line) => line.startsWith('| ') && line.includes('https://example.com/'));

      // Level A issues should come first, then AA
      // Within same level, sort by pages count (more pages first)
      // Within same pages count, sort by total count (higher total first)
      expect(dataLines[0]).to.include('high-count-a'); // A level, 2 pages, total 11
      expect(dataLines[1]).to.include('low-count-a'); // A level, 2 pages, total 7
      expect(dataLines[2]).to.include('aa-issue'); // AA level, 2 pages, total 6
      expect(dataLines[3]).to.include('single-page-aa'); // AA level, 1 page, total 1
    });

    it('should handle issues with same level and page count but different totals', () => {
      const trafficViolations = [
        {
          url: 'https://example.com/page1',
          traffic: 10000,
          levelA: ['10 x `higher-total`', '3 x `lower-total`'],
          levelAA: [],
        },
        {
          url: 'https://example.com/page2',
          traffic: 8000,
          levelA: ['2 x `higher-total`', '5 x `lower-total`'],
          levelAA: [],
        },
      ];
      const issuesOverview = {
        levelA: [
          {
            rule: 'higher-total',
            level: 'A',
            description: 'Higher total issue',
            successCriteriaNumber: '143',
          },
          {
            rule: 'lower-total',
            level: 'A',
            description: 'Lower total issue',
            successCriteriaNumber: '131',
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

      const lines = result.split('\n');
      // eslint-disable-next-line max-len
      const dataLines = lines.filter((line) => line.startsWith('| ') && line.includes('https://example.com/'));

      // Both have 2 pages, but higher-total has 12 total count vs lower-total's 8
      expect(dataLines[0]).to.include('higher-total');
      expect(dataLines[1]).to.include('lower-total');
    });
  });

  describe('generateQuickWinsOverviewSection', () => {
    it('should generate quick wins overview section correctly', () => {
      const quickWinsData = {
        topIssues: [
          {
            id: 'color-contrast',
            count: 20,
            description: 'Color contrast issue',
            level: 'A',
            successCriteriaNumber: '143',
          },
          {
            id: 'label',
            count: 15,
            description: 'Label issue',
            level: 'AA',
            successCriteriaNumber: '332',
          },
        ],
      };
      const enhancedReportUrl = 'https://example.com/enhanced';

      const result = generateQuickWinsOverviewSection(quickWinsData, enhancedReportUrl);

      expect(result).to.include('### Quick Wins |');
      expect(result).to.include('Here is a list of accessibility issues');
      // eslint-disable-next-line max-len
      expect(result).to.include('| Issue | WCAG Success Criterion | % of Total |Level|Impact|How To Solve|');
      expect(result).to.include('Color contrast issue');
      expect(result).to.include('Label issue');
    });

    it('should return empty string when no issues after filtering', () => {
      const quickWinsData = {
        topIssues: [
          {
            id: 'image-alt',
            count: 20,
            description: 'Image alt issue',
            level: 'A',
            successCriteriaNumber: '111',
          },
        ],
      };
      const enhancedReportUrl = 'https://example.com/enhanced';

      const result = generateQuickWinsOverviewSection(quickWinsData, enhancedReportUrl);

      expect(result).to.equal('');
    });
  });

  describe('generateQuickWinsPagesSection', () => {
    it('should generate quick wins pages section correctly', () => {
      const quickWinsData = {
        topIssues: [
          {
            id: 'color-contrast',
            description: 'Color contrast issue',
            successCriteriaNumber: '143',
            level: 'A',
            count: 20,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'color-contrast': { count: 5 },
                },
              },
              serious: { items: {} },
            },
          },
          'https://example.com/page2': {
            violations: {
              critical: {
                items: {
                  'color-contrast': { count: 3 },
                },
              },
              serious: { items: {} },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('### Quick Wins Pages Per Issue');
      expect(result).to.include('| Issue | Pages |');
      expect(result).to.include('| Color contrast issue |');
      // eslint-disable-next-line max-len
      expect(result).to.include('https://example.com/page1 (5), https://example.com/page2 (3)');
    });

    it('should accumulate counts for same issue on same page across different levels', () => {
      const quickWinsData = {
        topIssues: [
          {
            id: 'color-contrast',
            description: 'Color contrast issue',
            successCriteriaNumber: '143',
            level: 'A',
            count: 20,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'color-contrast': { count: 5 },
                },
              },
              serious: {
                items: {
                  'color-contrast': { count: 3 },
                },
              },
            },
          },
          'https://example.com/page2': {
            violations: {
              critical: {
                items: {
                  'color-contrast': { count: 2 },
                },
              },
              serious: { items: {} },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('### Quick Wins Pages Per Issue');
      expect(result).to.include('| Color contrast issue |');
      // Should show accumulated count: 5+3=8 for page1, 2 for page2
      expect(result).to.include('https://example.com/page1 (8), https://example.com/page2 (2)');
    });

    it('should handle multiple issues with count accumulation', () => {
      const quickWinsData = {
        topIssues: [
          {
            id: 'color-contrast',
            description: 'Color contrast issue',
            successCriteriaNumber: '143',
            level: 'A',
            count: 15,
          },
          {
            id: 'heading-order',
            description: 'Heading order issue',
            successCriteriaNumber: '131',
            level: 'A',
            count: 10,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'color-contrast': { count: 4 },
                  'heading-order': { count: 2 },
                },
              },
              serious: {
                items: {
                  'color-contrast': { count: 2 },
                  'heading-order': { count: 3 },
                },
              },
            },
          },
          'https://example.com/page2': {
            violations: {
              critical: {
                items: {
                  'color-contrast': { count: 1 },
                },
              },
              serious: {
                items: {
                  'heading-order': { count: 1 },
                },
              },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('### Quick Wins Pages Per Issue');
      expect(result).to.include('| Color contrast issue |');
      expect(result).to.include('| Heading order issue |');
      // color-contrast: page1 (4+2=6), page2 (1)
      expect(result).to.include('https://example.com/page1 (6), https://example.com/page2 (1)');
      // heading-order: page1 (2+3=5), page2 (1)
      expect(result).to.include('https://example.com/page1 (5), https://example.com/page2 (1)');
    });

    it('should filter out image-alt related issues', () => {
      const quickWinsData = {
        topIssues: [
          {
            id: 'image-alt',
            description: 'Image alt issue',
            successCriteriaNumber: '111',
            level: 'A',
            count: 10,
          },
          {
            id: 'color-contrast',
            description: 'Color contrast issue',
            successCriteriaNumber: '143',
            level: 'A',
            count: 5,
          },
        ],
        allViolations: {
          'https://example.com/page1': {
            violations: {
              critical: {
                items: {
                  'image-alt': { count: 8 },
                  'color-contrast': { count: 3 },
                },
              },
              serious: { items: {} },
            },
          },
        },
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.include('Color contrast');
      expect(result).to.not.include('Image alt');
    });

    it('should return empty string when no issues after filtering', () => {
      const quickWinsData = {
        topIssues: [
          {
            id: 'image-alt',
            description: 'Image alt issue',
            successCriteriaNumber: '111',
            level: 'A',
            count: 10,
          },
        ],
        allViolations: {},
      };

      const result = generateQuickWinsPagesSection(quickWinsData);

      expect(result).to.equal('');
    });
  });

  describe('Main Report Generation Functions', () => {
    describe('generateBaseReportMarkdown', () => {
      it('should generate complete base report markdown', () => {
        const mdData = {
          current: {
            overall: {
              violations: {
                critical: {
                  count: 15,
                  items: {
                    'color-contrast': {
                      level: 'A',
                      count: 10,
                      description: 'Color contrast issue',
                      successCriteriaNumber: '143',
                    },
                  },
                },
                serious: {
                  count: 8,
                  items: {
                    label: {
                      level: 'AA',
                      count: 5,
                      description: 'Label issue',
                      successCriteriaNumber: '332',
                    },
                  },
                },
                total: 23,
              },
            },
            'https://example.com/page1': {
              traffic: 10000,
              violations: {
                critical: {
                  items: {
                    'color-contrast': { count: 5 },
                  },
                },
                serious: {
                  items: {
                    label: { count: 3 },
                  },
                },
              },
            },
          },
          lastWeek: {
            overall: {
              violations: {
                critical: { count: 10 },
                serious: { count: 12 },
              },
            },
          },
          relatedReportsUrls: {
            inDepthReportUrl: 'https://example.com/in-depth',
            enhancedReportUrl: 'https://example.com/enhanced',
            fixedVsNewReportUrl: 'https://example.com/fixed-new',
          },
        };

        const result = generateBaseReportMarkdown(mdData);

        expect(result).to.include('### Accessibility Compliance Overview');
        expect(result).to.include('### Road To WCAG 2.2 Level A');
        expect(result).to.include('### Quick Wins |');
        expect(result).to.include('### Accessibility Compliance Issues vs Traffic');
        expect(result).to.include('| **[Critical](https://example.com/in-depth)**| 15 |');
        expect(result).to.include('| **[Serious](https://example.com/in-depth)**| 8 |');
      });

      it('should handle missing last week data', () => {
        const mdData = {
          current: {
            overall: {
              violations: {
                critical: {
                  count: 15,
                  items: {
                    'color-contrast': {
                      level: 'A',
                      count: 10,
                      description: 'Color contrast issue',
                      successCriteriaNumber: '143',
                    },
                  },
                },
                serious: {
                  count: 8,
                  items: {},
                },
                total: 23,
              },
            },
          },
          lastWeek: null,
          relatedReportsUrls: {
            inDepthReportUrl: 'https://example.com/in-depth',
            enhancedReportUrl: 'https://example.com/enhanced',
            fixedVsNewReportUrl: 'https://example.com/fixed-new',
          },
        };

        const result = generateBaseReportMarkdown(mdData);

        expect(result).to.include('### Accessibility Compliance Overview');
        expect(result).to.include('-% 🟢');
        expect(result).to.not.include('A Week Over Week breadown');
      });
    });

    describe('generateInDepthReportMarkdown', () => {
      it('should generate in-depth report markdown', () => {
        const mdData = {
          current: {
            overall: {
              violations: {
                critical: {
                  items: {
                    'color-contrast': {
                      rule: 'color-contrast',
                      level: 'A',
                      count: 15,
                      description: 'Color contrast issue',
                      successCriteriaNumber: '143',
                      understandingUrl: 'https://example.com/understanding',
                    },
                    'heading-order': {
                      rule: 'heading-order',
                      level: 'A',
                      count: 8,
                      description: 'Heading order issue',
                      successCriteriaNumber: '131',
                      understandingUrl: 'https://example.com/understanding2',
                    },
                  },
                },
                serious: {
                  items: {
                    label: {
                      rule: 'label',
                      level: 'AA',
                      count: 12,
                      description: 'Label issue',
                      successCriteriaNumber: '332',
                      understandingUrl: 'https://example.com/understanding3',
                    },
                  },
                },
              },
            },
          },
        };

        const result = generateInDepthReportMarkdown(mdData);

        expect(result).to.include('### Accessibility Issues Overview');
        expect(result).to.include('| color-contrast |');
        expect(result).to.include('| heading-order |');
        expect(result).to.include('| label |');
        expect(result).to.include('|15 | A |');
        expect(result).to.include('|8 | A |');
        expect(result).to.include('|12 | AA |');
      });

      it('should filter out image-alt related issues', () => {
        const mdData = {
          current: {
            overall: {
              violations: {
                critical: {
                  items: {
                    'image-alt': {
                      rule: 'image-alt',
                      level: 'A',
                      count: 10,
                      description: 'Image alt issue',
                      successCriteriaNumber: '111',
                      understandingUrl: 'https://example.com/understanding',
                    },
                    'color-contrast': {
                      rule: 'color-contrast',
                      level: 'A',
                      count: 5,
                      description: 'Color contrast issue',
                      successCriteriaNumber: '143',
                      understandingUrl: 'https://example.com/understanding2',
                    },
                  },
                },
                serious: {
                  items: {
                    'role-img-alt': {
                      rule: 'role-img-alt',
                      level: 'AA',
                      count: 8,
                      description: 'Role img alt issue',
                      successCriteriaNumber: '111',
                      understandingUrl: 'https://example.com/understanding3',
                    },
                  },
                },
              },
            },
          },
        };

        const result = generateInDepthReportMarkdown(mdData);

        expect(result).to.include('color-contrast');
        expect(result).to.not.include('image-alt');
        expect(result).to.not.include('role-img-alt');
      });

      it('should return empty string when no issues after filtering', () => {
        const mdData = {
          current: {
            overall: {
              violations: {
                critical: {
                  items: {
                    'image-alt': {
                      rule: 'image-alt',
                      level: 'A',
                      count: 10,
                      description: 'Image alt issue',
                      successCriteriaNumber: '111',
                      understandingUrl: 'https://example.com/understanding',
                    },
                  },
                },
                serious: {
                  items: {
                    'svg-img-alt': {
                      rule: 'svg-img-alt',
                      level: 'AA',
                      count: 5,
                      description: 'SVG img alt issue',
                      successCriteriaNumber: '111',
                      understandingUrl: 'https://example.com/understanding2',
                    },
                  },
                },
              },
            },
          },
        };

        const result = generateInDepthReportMarkdown(mdData);

        expect(result).to.equal('');
      });
    });

    describe('generateEnhancedReportMarkdown', () => {
      it('should generate enhanced report markdown', () => {
        const mdData = {
          current: {
            overall: {
              violations: {
                critical: {
                  items: {
                    'color-contrast': {
                      rule: 'color-contrast',
                      level: 'A',
                      count: 20,
                      description: 'Color contrast issue',
                      successCriteriaNumber: '143',
                    },
                  },
                },
                serious: {
                  items: {
                    label: {
                      rule: 'label',
                      level: 'AA',
                      count: 15,
                      description: 'Label issue',
                      successCriteriaNumber: '332',
                    },
                  },
                },
                total: 35,
              },
            },
            'https://example.com/page1': {
              traffic: 10000,
              violations: {
                critical: {
                  items: {
                    'color-contrast': { count: 5 },
                  },
                },
                serious: {
                  items: {
                    label: { count: 3 },
                  },
                },
              },
            },
          },
        };

        const result = generateEnhancedReportMarkdown(mdData);

        expect(result).to.include('### Enhancing accessibility for the top 10 most-visited pages');
        expect(result).to.include('### Quick Wins Pages Per Issue');
        expect(result).to.include('| color-contrast |');
        expect(result).to.include('| https://example.com/page1 (5) |');
      });

      it('should handle empty violations data', () => {
        const mdData = {
          current: {
            overall: {
              violations: {
                critical: { items: {} },
                serious: { items: {} },
                total: 0,
              },
            },
          },
        };

        const result = generateEnhancedReportMarkdown(mdData);

        expect(result).to.include('### Enhancing accessibility for the top 10 most-visited pages');
        expect(result).to.not.include('### Quick Wins Pages Per Issue');
      });
    });

    describe('generateFixedNewReportMarkdown', () => {
      it('should generate fixed-new report markdown', () => {
        const mdData = {
          current: {
            'https://example.com/page1': {
              violations: {
                critical: {
                  items: {
                    'color-contrast': { count: 5 },
                    'new-critical': { count: 2 },
                  },
                },
                serious: {
                  items: {
                    'new-serious': { count: 3 },
                  },
                },
              },
            },
            'https://example.com/page2': {
              violations: {
                critical: {
                  items: {
                    'persistent-issue': { count: 1 },
                  },
                },
                serious: { items: {} },
              },
            },
          },
          lastWeek: {
            overall: {
              violations: {
                critical: { items: {} },
                serious: { items: {} },
              },
            },
            'https://example.com/page1': {
              violations: {
                critical: {
                  items: {
                    'color-contrast': { count: 5 },
                    'fixed-critical': { count: 1 },
                  },
                },
                serious: {
                  items: {
                    'fixed-serious': { count: 2 },
                  },
                },
              },
            },
            'https://example.com/page3': {
              violations: {
                critical: {
                  items: {
                    'removed-page-issue': { count: 1 },
                  },
                },
                serious: { items: {} },
              },
            },
          },
        };

        const result = generateFixedNewReportMarkdown(mdData);

        expect(result).to.include('### Fixed Accessibility Issues');
        expect(result).to.include('### New Accessibility Issues');
        expect(result).to.include('| https://example.com/page1 | `fixed-critical` | Critical |');
        expect(result).to.include('| https://example.com/page1 | `fixed-serious` | Serious |');
        expect(result).to.include('| https://example.com/page3 | `removed-page-issue` | Critical |');
        expect(result).to.include('| https://example.com/page1 | `new-critical` | Critical |');
        expect(result).to.include('| https://example.com/page2 | `persistent-issue` | Critical |');
        expect(result).to.include('| https://example.com/page1 | `new-serious` | Serious |');
      });

      it('should return empty string when no last week data', () => {
        const mdData = {
          current: {
            'https://example.com/page1': {
              violations: {
                critical: {
                  items: {
                    'color-contrast': { count: 5 },
                  },
                },
                serious: { items: {} },
              },
            },
          },
          lastWeek: null,
        };

        const result = generateFixedNewReportMarkdown(mdData);

        expect(result).to.equal('');
      });

      it('should return empty string when last week has no violations', () => {
        const mdData = {
          current: {
            'https://example.com/page1': {
              violations: {
                critical: {
                  items: {
                    'color-contrast': { count: 5 },
                  },
                },
                serious: { items: {} },
              },
            },
          },
          lastWeek: {
            overall: {},
          },
        };

        const result = generateFixedNewReportMarkdown(mdData);

        expect(result).to.equal('');
      });

      it('should handle case with only fixed issues', () => {
        const mdData = {
          current: {
            'https://example.com/page1': {
              violations: {
                critical: { items: {} },
                serious: { items: {} },
              },
            },
          },
          lastWeek: {
            overall: {
              violations: {
                critical: { items: {} },
                serious: { items: {} },
              },
            },
            'https://example.com/page1': {
              violations: {
                critical: {
                  items: {
                    'fixed-issue': { count: 3 },
                  },
                },
                serious: { items: {} },
              },
            },
          },
        };

        const result = generateFixedNewReportMarkdown(mdData);

        expect(result).to.include('### Fixed Accessibility Issues');
        expect(result).to.include('| https://example.com/page1 | `fixed-issue` | Critical |');
        expect(result).to.not.include('### New Accessibility Issues');
      });

      it('should handle case with only new issues', () => {
        const mdData = {
          current: {
            'https://example.com/page1': {
              violations: {
                critical: {
                  items: {
                    'new-issue': { count: 2 },
                  },
                },
                serious: { items: {} },
              },
            },
          },
          lastWeek: {
            overall: {
              violations: {
                critical: { items: {} },
                serious: { items: {} },
              },
            },
            'https://example.com/page1': {
              violations: {
                critical: { items: {} },
                serious: { items: {} },
              },
            },
          },
        };

        const result = generateFixedNewReportMarkdown(mdData);

        expect(result).to.include('### New Accessibility Issues');
        expect(result).to.include('| https://example.com/page1 | `new-issue` | Critical |');
        expect(result).to.not.include('### Fixed Accessibility Issues');
      });

      it('should filter out image-alt related issues', () => {
        const mdData = {
          current: {
            'https://example.com/page1': {
              violations: {
                critical: {
                  items: {
                    'image-alt': { count: 5 },
                    'color-contrast': { count: 3 },
                  },
                },
                serious: { items: {} },
              },
            },
          },
          lastWeek: {
            overall: {
              violations: {
                critical: { items: {} },
                serious: { items: {} },
              },
            },
            'https://example.com/page1': {
              violations: {
                critical: {
                  items: {
                    'role-img-alt': { count: 2 },
                    'heading-order': { count: 1 },
                  },
                },
                serious: { items: {} },
              },
            },
          },
        };

        const result = generateFixedNewReportMarkdown(mdData);

        expect(result).to.include('`color-contrast`');
        expect(result).to.include('`heading-order`');
        expect(result).to.not.include('image-alt');
        expect(result).to.not.include('role-img-alt');
      });
    });
  });
});
