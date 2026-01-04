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

import * as chai from 'chai';
import sinon from 'sinon';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';
import { processSuggestionsForMystique } from '../../../src/accessibility/guidance-utils/mystique-data-processing.js';

const { expect } = chai;

// Configure Chai
chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('mystique-data-processing', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processSuggestionsForMystique', () => {
    it('should return empty array when no suggestions provided', () => {
      const result = processSuggestionsForMystique([]);
      expect(result).to.deep.equal([]);
    });

    it('should return empty array when suggestions is null', () => {
      const result = processSuggestionsForMystique(null);
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should return empty array when suggestions is undefined', () => {
      const result = processSuggestionsForMystique(undefined);
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should return empty array when suggestions is not an array', () => {
      const result = processSuggestionsForMystique('not an array');
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should use legacy aggregation when useCodeFixFlow is false', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      // Call with useCodeFixFlow = false to trigger legacy aggregation
      const result = processSuggestionsForMystique([mockSuggestion], false);

      expect(result).to.have.length(1);
      expect(result[0]).to.have.property('url', 'https://example.com');
      // In legacy mode, aggregationKey should be just the URL
      expect(result[0]).to.have.property('aggregationKey', 'https://example.com');
      expect(result[0].issuesList).to.have.length(1);
    });

    it('should return empty array when suggestions is empty', () => {
      const mockSuggestion = {
        getData: () => ({ issues: [] }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };
      const result = processSuggestionsForMystique([mockSuggestion]);
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should skip suggestions without issues', () => {
      const mockSuggestion = {
        getData: () => ({ issues: null }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([mockSuggestion]);
      expect(result).to.deep.equal([]);
    });

    it('should process suggestions with valid issues and group by URL', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0]).to.have.property('url', 'https://example.com');
      expect(result[0]).to.have.property('issuesList');
      expect(result[0].issuesList).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issueName: 'aria-allowed-attr',
        faultyLine: '<dt aria-level="3">Term</dt>',
        targetSelector: 'dt',
        issueDescription: 'ARIA attribute not allowed on this element',
        suggestionId: 'sugg-1',
      });
    });

    it('should handle issues without htmlWithIssues', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      // Should not include URL entry when no htmlWithIssues to process
      expect(result).to.have.length(0);
    });

    it('should handle issues with empty htmlWithIssues array', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      // Should not include URL entry when no htmlWithIssues to process
      expect(result).to.have.length(0);
    });

    it('should handle issues without target_selector', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: '',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issueName: 'aria-allowed-attr',
        faultyLine: '<dt aria-level="3">Term</dt>',
        targetSelector: '',
        issueDescription: 'ARIA attribute not allowed on this element',
        suggestionId: 'sugg-1',
      });
    });

    it('should handle issues without description', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                },
              ],
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issueName: 'aria-allowed-attr',
        faultyLine: '<dt aria-level="3">Term</dt>',
        targetSelector: 'dt',
        issueDescription: '',
        suggestionId: 'sugg-1',
      });
    });

    it('should filter out issue types not in issueTypesForMystique', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
            {
              type: 'color-contrast',
              htmlWithIssues: [
                {
                  update_from: '<button style="color: #ccc">Button</button>',
                  target_selector: 'button',
                },
              ],
              description: 'Insufficient color contrast',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com');
      expect(result[0].issuesList).to.have.length(1);
      expect(result[0].issuesList[0].issueName).to.equal('aria-allowed-attr');
    });

    it('should process multiple suggestions and group by URL', () => {
      const mockSuggestion1 = {
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const mockSuggestion2 = {
        getData: () => ({
          url: 'https://example.com/page2',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="2">Text</span>',
                  target_selector: 'span',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-2',
        getStatus: () => 'IN_PROGRESS',
      };

      const mockSuggestion3 = {
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<li aria-level="3">Term</li>',
                  target_selector: 'li',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-3',
        getStatus: () => 'APPROVED',
      };

      const result = processSuggestionsForMystique(
        [mockSuggestion1, mockSuggestion2, mockSuggestion3],
      );

      // aria-allowed-attr uses PER_TYPE granularity, so all are grouped into one message
      expect(result).to.have.length(1);
      expect(result[0]).to.have.property('aggregationKey');
      expect(result[0].url).to.equal('https://example.com/page1'); // URL from first suggestion
      expect(result[0].issuesList).to.have.length(3);
      expect(result[0].issuesList[0].suggestionId).to.equal('sugg-1');
      expect(result[0].issuesList[0].targetSelector).to.equal('dt');
      expect(result[0].issuesList[1].suggestionId).to.equal('sugg-2');
      expect(result[0].issuesList[1].targetSelector).to.equal('span');
      expect(result[0].issuesList[2].suggestionId).to.equal('sugg-3');
      expect(result[0].issuesList[2].targetSelector).to.equal('li');
    });

    it('should group suggestions with the same URL', () => {
      const mockSuggestion1 = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const mockSuggestion2 = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="2">Text</span>',
                  target_selector: 'span',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-2',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([mockSuggestion1, mockSuggestion2]);

      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com');
      expect(result[0].issuesList).to.have.length(2);
      expect(result[0].issuesList[0].suggestionId).to.equal('sugg-1');
      expect(result[0].issuesList[1].suggestionId).to.equal('sugg-2');
    });

    it('should handle mixed valid and invalid suggestions', () => {
      const mockSuggestion1 = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const mockSuggestion2 = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'color-contrast',
              htmlWithIssues: [
                {
                  update_from: '<button style="color: #ccc">Button</button>',
                  target_selector: 'button',
                },
              ],
              description: 'Insufficient color contrast',
            },
          ],
        }),
        getId: () => 'sugg-2',
        getStatus: () => 'NEW',
      };

      const mockSuggestion3 = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="2">Text</span>',
                  target_selector: 'span',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-3',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([
        mockSuggestion1,
        mockSuggestion2,
        mockSuggestion3,
      ]);

      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com');
      expect(result[0].issuesList).to.have.length(2);
      expect(result[0].issuesList[0].suggestionId).to.equal('sugg-1');
      expect(result[0].issuesList[1].suggestionId).to.equal('sugg-3');
    });

    it('should handle missing faulty_line, target_selector, and issue_description', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  // Missing update_from, target_selector
                },
              ],
              // Missing description
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issueName: 'aria-allowed-attr',
        faultyLine: '', // Should default to empty string
        targetSelector: '', // Should default to empty string
        issueDescription: '', // Should default to empty string
        suggestionId: 'sugg-1',
      });
    });

    it('should skip issues that already have guidance in legacy flow', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                  guidance: {
                    generalSuggestion: 'Remove aria-level',
                    updateTo: '<dt>Term</dt>',
                    userImpact: 'Screen readers will...',
                  },
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      // Use legacy flow (useCodeFixFlow = false)
      const result = processSuggestionsForMystique([mockSuggestion], false);

      // Should not include this suggestion since it already has guidance
      expect(result).to.have.length(0);
    });

    it('should resend issues with guidance but no codefix when useCodeFixFlow is true', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          isCodeChangeAvailable: false, // No code fix available
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                  guidance: {
                    generalSuggestion: 'Remove aria-level',
                    updateTo: '<dt>Term</dt>',
                    userImpact: 'Screen readers will...',
                  },
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      // Call with useCodeFixFlow = true
      const result = processSuggestionsForMystique([mockSuggestion], true);

      // Should resend because code fix is not available
      expect(result).to.have.length(1);
      expect(result[0].issuesList).to.have.length(1);
    });

    it('should skip issues with both guidance and codefix when useCodeFixFlow is true', () => {
      const mockSuggestion = {
        getData: () => ({
          url: 'https://example.com',
          isCodeChangeAvailable: true, // Code fix is available
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                  guidance: {
                    generalSuggestion: 'Remove aria-level',
                    updateTo: '<dt>Term</dt>',
                    userImpact: 'Screen readers will...',
                  },
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      // Call with useCodeFixFlow = true
      const result = processSuggestionsForMystique([mockSuggestion], true);

      // Should not resend because both guidance and code fix are available
      expect(result).to.have.length(0);
    });

    it('should aggregate multiple issues by URL in legacy flow', () => {
      const mockSuggestion1 = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                },
              ],
              description: 'ARIA attribute not allowed',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const mockSuggestion2 = {
        getData: () => ({
          url: 'https://example.com',
          issues: [
            {
              type: 'button-name',
              htmlWithIssues: [
                {
                  update_from: '<button></button>',
                  target_selector: 'button',
                },
              ],
              description: 'Button needs name',
            },
          ],
        }),
        getId: () => 'sugg-2',
        getStatus: () => 'NEW',
      };

      // Call with useCodeFixFlow = false for legacy aggregation
      const result = processSuggestionsForMystique([mockSuggestion1, mockSuggestion2], false);

      // In legacy mode, all issues for the same URL should be grouped together
      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com');
      expect(result[0].aggregationKey).to.equal('https://example.com');
      expect(result[0].issuesList).to.have.length(2);
    });

    it('should group by URL only in legacy flow, ignoring issue type and selector', () => {
      // Create multiple suggestions with different issue types and selectors for the same URL
      const mockSuggestion1 = {
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term 1</dt>',
                  target_selector: 'dt.first',
                },
              ],
              description: 'ARIA attribute not allowed',
            },
          ],
        }),
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
      };

      const mockSuggestion2 = {
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="2">Term 2</dt>',
                  target_selector: 'dt.second', // Different selector
                },
              ],
              description: 'ARIA attribute not allowed',
            },
          ],
        }),
        getId: () => 'sugg-2',
        getStatus: () => 'NEW',
      };

      const mockSuggestion3 = {
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'button-name', // Different issue type
              htmlWithIssues: [
                {
                  update_from: '<button></button>',
                  target_selector: 'button.submit',
                },
              ],
              description: 'Button needs name',
            },
          ],
        }),
        getId: () => 'sugg-3',
        getStatus: () => 'NEW',
      };

      const mockSuggestion4 = {
        getData: () => ({
          url: 'https://example.com/page2', // Different URL
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="1">Term</dt>',
                  target_selector: 'dt',
                },
              ],
              description: 'ARIA attribute not allowed',
            },
          ],
        }),
        getId: () => 'sugg-4',
        getStatus: () => 'NEW',
      };

      // Call with useCodeFixFlow = false for legacy aggregation
      const result = processSuggestionsForMystique(
        [mockSuggestion1, mockSuggestion2, mockSuggestion3, mockSuggestion4],
        false,
      );

      // Should have 2 messages (one per URL)
      expect(result).to.have.length(2);

      // Find the message for page1
      const page1Message = result.find((msg) => msg.url === 'https://example.com/page1');
      expect(page1Message).to.exist;
      expect(page1Message.aggregationKey).to.equal('https://example.com/page1');
      // All 3 suggestions for page1 should be grouped together
      expect(page1Message.issuesList).to.have.length(3);
      
      // Verify all three issues are present
      const suggestionIds = page1Message.issuesList.map((item) => item.suggestionId);
      expect(suggestionIds).to.include.members(['sugg-1', 'sugg-2', 'sugg-3']);

      // Find the message for page2
      const page2Message = result.find((msg) => msg.url === 'https://example.com/page2');
      expect(page2Message).to.exist;
      expect(page2Message.aggregationKey).to.equal('https://example.com/page2');
      expect(page2Message.issuesList).to.have.length(1);
      expect(page2Message.issuesList[0].suggestionId).to.equal('sugg-4');
    });
  });
});
