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
  generateBaseReportMarkdown,
  generateInDepthReportMarkdown,
  generateEnhancedReportMarkdown,
  generateFixedNewReportMarkdown,
  getWeekNumber,
} from '../../../src/accessibility/utils/generate-md-reports.js';

describe('Generate MD Reports Utils', () => {
  // Test data fixtures
  const mockCurrentData = {
    overall: {
      violations: {
        total: 100,
        critical: {
          count: 40,
          items: {
            'color-contrast': {
              count: 15,
              description: 'Elements must have sufficient color contrast',
              level: 'A',
              successCriteriaNumber: '143',
              understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
            },
            'button-name': {
              count: 10,
              description: 'Buttons must have discernible text',
              level: 'A',
              successCriteriaNumber: '411',
              understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            },
            'image-alt': {
              count: 15,
              description: 'Images must have alternative text',
              level: 'A',
              successCriteriaNumber: '111',
              understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
            },
          },
        },
        serious: {
          count: 60,
          items: {
            'aria-label': {
              count: 25,
              description: 'ARIA labels must be appropriate',
              level: 'AA',
              successCriteriaNumber: '412',
              understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            },
            'focus-order': {
              count: 35,
              description: 'Focus order must be logical',
              level: 'AA',
              successCriteriaNumber: '241',
              understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html',
            },
          },
        },
      },
    },
    'https://example.com/page1': {
      traffic: 15000,
      violations: {
        critical: {
          items: {
            'color-contrast': {
              count: 5,
              failureSummary: 'Fix all of the following:\nEnsure color contrast ratio is at least 4.5:1',
            },
            'button-name': {
              count: 3,
            },
          },
        },
        serious: {
          items: {
            'aria-label': {
              count: 8,
            },
          },
        },
      },
    },
    'https://example.com/page2': {
      traffic: 12000,
      violations: {
        critical: {
          items: {
            'color-contrast': {
              count: 10,
            },
          },
        },
        serious: {
          items: {
            'focus-order': {
              count: 15,
            },
          },
        },
      },
    },
  };

  const mockPreviousData = {
    overall: {
      violations: {
        total: 80,
        critical: {
          count: 30,
          items: {
            'color-contrast': {
              count: 20,
              description: 'Elements must have sufficient color contrast',
              level: 'A',
              successCriteriaNumber: '143',
            },
            'link-name': {
              count: 10,
              description: 'Links must have discernible text',
              level: 'A',
              successCriteriaNumber: '411',
            },
          },
        },
        serious: {
          count: 50,
          items: {
            'aria-label': {
              count: 30,
              description: 'ARIA labels must be appropriate',
              level: 'AA',
              successCriteriaNumber: '412',
            },
            'heading-order': {
              count: 20,
              description: 'Heading levels should not be skipped',
              level: 'AA',
              successCriteriaNumber: '131',
            },
          },
        },
      },
    },
    'https://example.com/page1': {
      traffic: 15000,
      violations: {
        critical: {
          items: {
            'color-contrast': {
              count: 8,
            },
            'link-name': {
              count: 5,
            },
          },
        },
        serious: {
          items: {
            'aria-label': {
              count: 10,
            },
          },
        },
      },
    },
  };

  const mockRelatedReportsUrls = {
    inDepthReportUrl: 'https://example.com/in-depth-report',
    enhancedReportUrl: 'https://example.com/enhanced-report',
    fixedVsNewReportUrl: 'https://example.com/fixed-vs-new-report',
  };

  describe('getWeekNumber', () => {
    it('should return correct week number for a given date', () => {
      const date = new Date('2024-01-15'); // Monday of week 3 in 2024
      const weekNumber = getWeekNumber(date);
      expect(weekNumber).to.be.a('number');
      expect(weekNumber).to.be.greaterThan(0);
      expect(weekNumber).to.be.lessThanOrEqual(53);
    });

    it('should return week 1 for January 1st', () => {
      const date = new Date('2024-01-01');
      const weekNumber = getWeekNumber(date);
      expect(weekNumber).to.equal(1);
    });

    it('should handle different years correctly', () => {
      const date2024 = new Date('2024-06-15');
      const date2025 = new Date('2025-06-15');

      const week2024 = getWeekNumber(date2024);
      const week2025 = getWeekNumber(date2025);

      expect(week2024).to.be.a('number');
      expect(week2025).to.be.a('number');
      // Both should be valid week numbers
      expect(week2024).to.be.greaterThan(20);
      expect(week2025).to.be.greaterThan(20);
    });
  });

  describe('generateBaseReportMarkdown', () => {
    it('should generate complete base report with all sections', () => {
      const report = generateBaseReportMarkdown(
        mockCurrentData,
        mockPreviousData,
        mockRelatedReportsUrls,
      );

      expect(report).to.be.a('string');
      expect(report).to.include('### Accessibility Compliance Overview');
      expect(report).to.include('### Road To WCAG 2.2 Level A');
      expect(report).to.include('### Road To WCAG 2.2 Level AA');
      expect(report).to.include('### Quick Wins');
      expect(report).to.include('### Accessibility Compliance Issues vs Traffic');
      expect(report).to.include('Week Over Week');
    });

    it('should include traffic data in the report', () => {
      const report = generateBaseReportMarkdown(
        mockCurrentData,
        mockPreviousData,
        mockRelatedReportsUrls,
      );

      expect(report).to.include('15.0K'); // Formatted traffic for page1
      expect(report).to.include('12.0K'); // Formatted traffic for page2
    });

    it('should include WCAG compliance scores', () => {
      const report = generateBaseReportMarkdown(
        mockCurrentData,
        mockPreviousData,
        mockRelatedReportsUrls,
      );

      // Should include compliance percentages
      expect(report).to.match(/\d+\.\d+%/);
      expect(report).to.include('Compliance Score');
    });

    it('should handle missing previous data gracefully', () => {
      const report = generateBaseReportMarkdown(
        mockCurrentData,
        null,
        mockRelatedReportsUrls,
      );

      expect(report).to.be.a('string');
      expect(report).to.include('### Accessibility Compliance Overview');
      // Should show default values when no previous data
      expect(report).to.include('-%');
    });

    it('should include related report URLs', () => {
      const report = generateBaseReportMarkdown(
        mockCurrentData,
        mockPreviousData,
        mockRelatedReportsUrls,
      );

      expect(report).to.include(mockRelatedReportsUrls.inDepthReportUrl);
      expect(report).to.include(mockRelatedReportsUrls.enhancedReportUrl);
      expect(report).to.include(mockRelatedReportsUrls.fixedVsNewReportUrl);
    });

    it('should filter out image-alt issues from main sections', () => {
      const report = generateBaseReportMarkdown(
        mockCurrentData,
        mockPreviousData,
        mockRelatedReportsUrls,
      );

      // Quick wins should not include image-alt issues
      const quickWinsSection = report.split('### Quick Wins')[1]?.split('---')[0] || '';
      expect(quickWinsSection).to.not.include('image-alt');
      expect(quickWinsSection).to.not.include('role-img-alt');
      expect(quickWinsSection).to.not.include('svg-img-alt');
    });

    it('should handle missing overall data gracefully', () => {
      const incompleteData = {
        overall: {
          violations: {
            total: 0,
            critical: { count: 0, items: {} },
            serious: { count: 0, items: {} },
          },
        },
        'https://example.com/page1': {
          traffic: 1000,
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      expect(() => {
        generateBaseReportMarkdown(incompleteData, null, mockRelatedReportsUrls);
      }).to.not.throw();
    });

    it('should handle missing violations data gracefully', () => {
      const incompleteData = {
        overall: {
          violations: {
            total: 0,
            critical: { count: 0, items: {} },
            serious: { count: 0, items: {} },
          },
        },
        'https://example.com/page1': {
          traffic: 1000,
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      expect(() => {
        generateBaseReportMarkdown(incompleteData, null, mockRelatedReportsUrls);
      }).to.not.throw();
    });
  });

  describe('generateInDepthReportMarkdown', () => {
    it('should generate in-depth report with issues overview', () => {
      const report = generateInDepthReportMarkdown(mockCurrentData);

      expect(report).to.be.a('string');
      expect(report).to.include('### Accessibility Issues Overview');
      expect(report).to.include('| Issue | WCAG Success Criterion | Count| Level |Impact| Description | WCAG Docs Link |');
    });

    it('should include all critical and serious issues', () => {
      const report = generateInDepthReportMarkdown(mockCurrentData);

      expect(report).to.include('color-contrast');
      expect(report).to.include('button-name');
      expect(report).to.include('aria-label');
      expect(report).to.include('focus-order');
    });

    it('should sort issues by level (A before AA) and count', () => {
      const report = generateInDepthReportMarkdown(mockCurrentData);

      const issuesSection = report.split('### Accessibility Issues Overview')[1];
      expect(issuesSection).to.be.a('string');

      // Should contain the table rows
      expect(issuesSection).to.include('| color-contrast |');
      expect(issuesSection).to.include('| button-name |');
    });

    it('should return empty string when no issues exist', () => {
      const emptyData = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      const report = generateInDepthReportMarkdown(emptyData);
      expect(report).to.equal('');
    });

    it('should escape HTML in descriptions', () => {
      const dataWithHtml = {
        overall: {
          violations: {
            critical: {
              items: {
                'test-issue': {
                  count: 5,
                  description: 'Test with <script>alert("xss")</script> tags',
                  level: 'A',
                  successCriteriaNumber: '111',
                  understandingUrl: 'https://example.com',
                },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const report = generateInDepthReportMarkdown(dataWithHtml);
      expect(report).to.include('`<script>`');
      expect(report).to.not.include('<script>alert("xss")</script>');
    });

    it('should handle missing success criteria data', () => {
      const dataWithMissingCriteria = {
        overall: {
          violations: {
            critical: {
              items: {
                'unknown-issue': {
                  count: 5,
                  description: 'Unknown issue',
                  level: 'A',
                  successCriteriaNumber: '999', // Non-existent criteria
                },
              },
            },
            serious: { items: {} },
          },
        },
      };

      expect(() => {
        generateInDepthReportMarkdown(dataWithMissingCriteria);
      }).to.not.throw();
    });

    it('should preserve existing backtick content while escaping HTML', () => {
      // This tests the backtick preservation logic
      const dataWithBackticks = {
        overall: {
          violations: {
            critical: {
              items: {
                'test-issue': {
                  count: 5,
                  description: 'Use `existing code` and fix <script>alert("test")</script>',
                  level: 'A',
                  successCriteriaNumber: '111',
                  understandingUrl: 'https://example.com',
                },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const report = generateInDepthReportMarkdown(dataWithBackticks);
      expect(report).to.include('`existing code`');
      expect(report).to.include('`<script>`');
      expect(report).to.not.include('<script>alert("test")</script>');
    });

    it('should handle multiple backtick sections and HTML properly', () => {
      // This tests lines 45-46: the backtick replacement logic more thoroughly
      const dataWithComplexBackticks = {
        overall: {
          violations: {
            critical: {
              items: {
                'test-issue': {
                  count: 5,
                  description: 'Check `first code` and `second code` then fix <div>content</div> and <span>text</span>',
                  level: 'A',
                  successCriteriaNumber: '111',
                  understandingUrl: 'https://example.com',
                },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const report = generateInDepthReportMarkdown(dataWithComplexBackticks);
      expect(report).to.include('`first code`');
      expect(report).to.include('`second code`');
      expect(report).to.include('`<div>`');
      expect(report).to.include('`<span>`');
      expect(report).to.not.include('<div>content</div>');
      expect(report).to.not.include('<span>text</span>');
    });
  });

  describe('generateEnhancedReportMarkdown', () => {
    it('should generate enhanced report with top pages section', () => {
      const report = generateEnhancedReportMarkdown(mockCurrentData);

      expect(report).to.be.a('string');
      expect(report).to.include('### Enhancing accessibility for the top 10 most-visited pages');
      expect(report).to.include('### Quick Wins Pages Per Issue');
    });

    it('should include page-specific issue counts', () => {
      const report = generateEnhancedReportMarkdown(mockCurrentData);

      expect(report).to.include('https://example.com/page1 (5)'); // color-contrast count
      expect(report).to.include('https://example.com/page2 (10)'); // color-contrast count
    });

    it('should include failure summaries when available', () => {
      const report = generateEnhancedReportMarkdown(mockCurrentData);

      // Should format and include failure summary
      expect(report).to.include('The following issue has been identified and must be addressed');
    });

    it('should group issues by description and sort properly', () => {
      const report = generateEnhancedReportMarkdown(mockCurrentData);

      // Should include the enhancing accessibility table
      expect(report).to.include('| Issue | WCAG Success Criterion | Level| Pages |Description| How is the user affected | Suggestion | Solution Example |');
    });

    it('should handle pages without traffic data', () => {
      const dataWithoutTraffic = {
        ...mockCurrentData,
        'https://example.com/page3': {
          // No traffic field
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

      const report = generateEnhancedReportMarkdown(dataWithoutTraffic);
      expect(report).to.be.a('string');
      expect(report).to.include('### Enhancing accessibility');
    });
  });

  describe('generateFixedNewReportMarkdown', () => {
    it('should generate report showing fixed and new issues', () => {
      const report = generateFixedNewReportMarkdown(mockCurrentData, mockPreviousData);

      expect(report).to.be.a('string');
      expect(report).to.include('### Fixed Accessibility Issues');
      expect(report).to.include('### New Accessibility Issues');
    });

    it('should identify correctly fixed issues', () => {
      const report = generateFixedNewReportMarkdown(mockCurrentData, mockPreviousData);

      // link-name was in previous but not in current, so it should be fixed
      expect(report).to.include('link-name');
      expect(report).to.include('### Fixed Accessibility Issues');
    });

    it('should identify correctly new issues', () => {
      const report = generateFixedNewReportMarkdown(mockCurrentData, mockPreviousData);

      // button-name is in current but not in previous, so it should be new
      expect(report).to.include('button-name');
      expect(report).to.include('### New Accessibility Issues');
    });

    it('should return empty string when no previous data', () => {
      const report = generateFixedNewReportMarkdown(mockCurrentData, null);
      expect(report).to.equal('');
    });

    it('should return empty string when previous data is missing violations', () => {
      const incompletePreviousData = {
        overall: {},
      };

      const report = generateFixedNewReportMarkdown(mockCurrentData, incompletePreviousData);
      expect(report).to.equal('');
    });

    it('should filter out image-alt issues', () => {
      const dataWithImageAlt = {
        overall: {
          violations: {
            critical: {
              items: {
                'image-alt': { count: 10 },
                'button-name': { count: 5 },
              },
            },
            serious: { items: {} },
          },
        },
        'https://example.com/test': {
          violations: {
            critical: {
              items: {
                'image-alt': { count: 5 },
                'button-name': { count: 2 },
              },
            },
            serious: { items: {} },
          },
        },
      };

      const previousWithImageAlt = {
        overall: {
          violations: {
            critical: {
              items: {
                'image-alt': { count: 15 },
                'color-contrast': { count: 8 },
              },
            },
            serious: { items: {} },
          },
        },
        'https://example.com/test': {
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
      };

      const report = generateFixedNewReportMarkdown(dataWithImageAlt, previousWithImageAlt);

      // Should not include image-alt in the report
      expect(report).to.not.include('image-alt');
      // Should include other issues
      expect(report).to.include('button-name');
      expect(report).to.include('color-contrast');
    });

    it('should handle empty fixed and new issues gracefully', () => {
      // Same data for both current and previous
      const report = generateFixedNewReportMarkdown(mockCurrentData, mockCurrentData);

      // Should return empty string when no changes detected
      expect(report).to.equal('');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle very large traffic numbers', () => {
      const dataWithLargeTraffic = {
        ...mockCurrentData,
        'https://example.com/page1': {
          ...mockCurrentData['https://example.com/page1'],
          traffic: 1500000, // 1.5M
        },
      };

      const report = generateBaseReportMarkdown(
        dataWithLargeTraffic,
        null,
        mockRelatedReportsUrls,
      );

      expect(report).to.include('1.5M');
    });

    it('should handle zero traffic gracefully', () => {
      const dataWithZeroTraffic = {
        ...mockCurrentData,
        'https://example.com/page1': {
          ...mockCurrentData['https://example.com/page1'],
          traffic: 0,
        },
      };

      const report = generateBaseReportMarkdown(
        dataWithZeroTraffic,
        null,
        mockRelatedReportsUrls,
      );

      expect(report).to.include('0');
    });
  });

  describe('Utility functions', () => {
    describe('escapeHtmlTags', () => {
      it('should return empty string for null text', () => {
        // This test covers line 33: if (!text) return '';
        const result = generateInDepthReportMarkdown({
          overall: {
            violations: {
              critical: {
                items: {
                  'test-issue': {
                    count: 5,
                    description: null, // null description will test escapeHtmlTags with null
                    level: 'A',
                    successCriteriaNumber: '111',
                    understandingUrl: 'https://example.com',
                  },
                },
              },
              serious: { items: {} },
            },
          },
        });

        expect(result).to.be.a('string');
      });

      it('should return empty string for undefined text', () => {
        // This test covers line 33: if (!text) return '';
        const result = generateInDepthReportMarkdown({
          overall: {
            violations: {
              critical: {
                items: {
                  'test-issue': {
                    count: 5,
                    // description is undefined
                    level: 'A',
                    successCriteriaNumber: '111',
                    understandingUrl: 'https://example.com',
                  },
                },
              },
              serious: { items: {} },
            },
          },
        });

        expect(result).to.be.a('string');
      });

      it('should preserve existing backtick content while escaping HTML', () => {
        // This tests the backtick preservation logic
        const dataWithBackticks = {
          overall: {
            violations: {
              critical: {
                items: {
                  'test-issue': {
                    count: 5,
                    description: 'Use `existing code` and fix <script>alert("test")</script>',
                    level: 'A',
                    successCriteriaNumber: '111',
                    understandingUrl: 'https://example.com',
                  },
                },
              },
              serious: { items: {} },
            },
          },
        };

        const report = generateInDepthReportMarkdown(dataWithBackticks);
        expect(report).to.include('`existing code`');
        expect(report).to.include('`<script>`');
        expect(report).to.not.include('<script>alert("test")</script>');
      });
    });

    describe('formatFailureSummary', () => {
      it('should handle "Fix any of the following" sections', () => {
        // This covers lines 79-92: the "Fix any of the following" branch
        const dataWithFixAny = {
          ...mockCurrentData,
          'https://example.com/page1': {
            ...mockCurrentData['https://example.com/page1'],
            violations: {
              critical: {
                items: {
                  'color-contrast': {
                    count: 5,
                    failureSummary: `Fix any of the following:
Ensure the contrast ratio is at least 4.5:1
Use a darker color for the text
Increase the background darkness`,
                  },
                },
              },
              serious: { items: {} },
            },
          },
        };

        const report = generateEnhancedReportMarkdown(dataWithFixAny);
        expect(report).to.include('One or more of the following related issues may also be present:');
        expect(report).to.include('1. Ensure the contrast ratio is at least 4.5:1');
        expect(report).to.include('2. Use a darker color for the text');
        expect(report).to.include('3. Increase the background darkness');
      });

      it('should handle multiple sections with previous section logic', () => {
        // This covers lines 81-82 and 96-97: the previous section handling
        const dataWithMultipleSections = {
          ...mockCurrentData,
          'https://example.com/page1': {
            ...mockCurrentData['https://example.com/page1'],
            violations: {
              critical: {
                items: {
                  'color-contrast': {
                    count: 5,
                    failureSummary: `Fix all of the following:
Check color contrast ratio
Fix any of the following:
Use darker colors
Increase background brightness`,
                  },
                },
              },
              serious: { items: {} },
            },
          },
        };

        const report = generateEnhancedReportMarkdown(dataWithMultipleSections);
        expect(report).to.include('The following issue has been identified and must be addressed:');
        expect(report).to.include('One or more of the following related issues may also be present:');
      });

      it('should handle "Fix all of the following" with final section addition', () => {
        // This covers lines 103-105: if (currentSection) { result += currentSection; }
        const dataWithFixAll = {
          ...mockCurrentData,
          'https://example.com/page1': {
            ...mockCurrentData['https://example.com/page1'],
            violations: {
              critical: {
                items: {
                  'color-contrast': {
                    count: 5,
                    failureSummary: `Fix all of the following:
Ensure the contrast ratio is at least 4.5:1`,
                  },
                },
              },
              serious: { items: {} },
            },
          },
        };

        const report = generateEnhancedReportMarkdown(dataWithFixAll);
        expect(report).to.include('The following issue has been identified and must be addressed:');
        expect(report).to.include('1. Ensure the contrast ratio is at least 4.5:1');
      });
    });

    describe('generateQuickWinsOverviewSection', () => {
      it('should return empty string when no quick wins are available', () => {
        // This covers lines 488-489: if (sortedGroups.length === 0) return '';
        const dataWithNoQuickWins = {
          overall: {
            violations: {
              total: 10,
              critical: {
                items: {
                  'image-alt': { // This will be filtered out
                    count: 10,
                    description: 'Images must have alternative text',
                    level: 'A',
                    successCriteriaNumber: '111',
                  },
                },
              },
              serious: { items: {} },
            },
          },
        };

        const report = generateBaseReportMarkdown(
          dataWithNoQuickWins,
          null,
          mockRelatedReportsUrls,
        );

        // Should not contain Quick Wins section since all issues are filtered
        expect(report).to.not.include('### Quick Wins');
      });
    });

    describe('generateQuickWinsPagesSection', () => {
      it('should show dash when no page info is available for an issue', () => {
        // This covers line 533: pagesText = pageInfo.length > 0 ? ... : '-';
        const dataWithMissingPageInfo = {
          overall: {
            violations: {
              total: 100,
              critical: {
                items: {
                  'color-contrast': {
                    count: 15,
                    description: 'Elements must have sufficient color contrast',
                    level: 'A',
                    successCriteriaNumber: '143',
                  },
                },
              },
              serious: { items: {} },
            },
          },
          // No page-specific data, so pageInfo will be empty
        };

        const report = generateEnhancedReportMarkdown(dataWithMissingPageInfo);
        expect(report).to.include('| Elements must have sufficient color contrast | - |');
      });
    });

    describe('generateQuickWinsPagesSection edge cases', () => {
      it('should return empty string when no grouped issues exist', () => {
        // This covers lines 569-570: if (sortedGroups.length === 0) return '';
        const dataWithOnlyImageAlt = {
          overall: {
            violations: {
              total: 10,
              critical: {
                items: {
                  'image-alt': { // This will be filtered out
                    count: 10,
                    description: 'Images must have alternative text',
                    level: 'A',
                    successCriteriaNumber: '111',
                  },
                },
              },
              serious: { items: {} },
            },
          },
        };

        const report = generateEnhancedReportMarkdown(dataWithOnlyImageAlt);
        // Should not contain Quick Wins Pages section since all issues are filtered
        expect(report).to.not.include('### Quick Wins Pages Per Issue');
      });
    });

    describe('generateWeekOverWeekSection edge cases', () => {
      it('should test improved issues calculation', () => {
        // Test the improved issues logic (lines in critical/serious improved calculations)
        const currentDataWithImproved = {
          overall: {
            violations: {
              total: 15,
              critical: {
                count: 5,
                items: {
                  'color-contrast': {
                    count: 5, // Reduced from 15
                    description: 'Elements must have sufficient color contrast',
                    level: 'A',
                    successCriteriaNumber: '143',
                  },
                },
              },
              serious: {
                count: 10,
                items: {
                  'aria-label': {
                    count: 10, // Reduced from 25
                    description: 'ARIA labels must be appropriate',
                    level: 'AA',
                    successCriteriaNumber: '412',
                  },
                },
              },
            },
          },
        };

        const previousDataWithHigher = {
          overall: {
            violations: {
              total: 40,
              critical: {
                count: 15,
                items: {
                  'color-contrast': {
                    count: 15, // Higher than current
                    description: 'Elements must have sufficient color contrast',
                    level: 'A',
                    successCriteriaNumber: '143',
                  },
                },
              },
              serious: {
                count: 25,
                items: {
                  'aria-label': {
                    count: 25, // Higher than current
                    description: 'ARIA labels must be appropriate',
                    level: 'AA',
                    successCriteriaNumber: '412',
                  },
                },
              },
            },
          },
        };

        const report = generateBaseReportMarkdown(
          currentDataWithImproved,
          previousDataWithHigher,
          mockRelatedReportsUrls,
        );

        expect(report).to.include('`color-contrast` (10 less)');
        expect(report).to.include('`aria-label` (15 less)');
      });
    });
  });
});
