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

    it('should return empty array when suggestions is empty', () => {
      const mockSuggestion = {
        getData: () => ({ issues: [] }),
      };
      const result = processSuggestionsForMystique([mockSuggestion]);
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should skip suggestions without issues', () => {
      const mockSuggestion = {
        getData: sandbox.stub().returns({
          issues: null,
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion]);
      expect(result).to.deep.equal([]);
    });

    it('should process suggestions with valid issues', () => {
      const mockSuggestion = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                  issue_id: 'test-uuid-1',
                },
              ],
              targetSelector: 'dt',
              description: 'ARIA attribute not allowed on this element',
            },
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="2">Text</span>',
                  target_selector: 'span',
                  issue_id: 'test-uuid-2',
                },
              ],
              targetSelector: 'span',
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0]).to.have.property('suggestion', mockSuggestion);
      expect(result[0]).to.have.property('issueType', 'aria-allowed-attr');
      expect(result[0].issuesList).to.have.length(2);
      expect(result[0].issuesList[0]).to.deep.include({
        issue_name: 'aria-allowed-attr',
        faulty_line: '<dt aria-level="3">Term</dt>',
        target_selector: 'dt',
        issue_description: 'ARIA attribute not allowed on this element',
      });
    });

    it('should group multiple issues of the same type', () => {
      const mockSuggestion = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                  issue_id: 'test-uuid-1',
                },
              ],
              targetSelector: 'dt',
              description: 'ARIA attribute not allowed on this element',
            },
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="2">Text</span>',
                  target_selector: 'span',
                  issue_id: 'test-uuid-2',
                },
              ],
              targetSelector: 'span',
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList).to.have.length(2);
      expect(result[0].issuesList[0].issue_name).to.equal('aria-allowed-attr');
      expect(result[0].issuesList[1].issue_name).to.equal('aria-allowed-attr');
    });

    it('should handle issues without htmlWithIssues', () => {
      const mockSuggestion = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              targetSelector: 'dt',
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      // Should return empty array since no htmlWithIssues means no items to process
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should handle issues with empty htmlWithIssues array', () => {
      const mockSuggestion = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [],
              targetSelector: 'dt',
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      // Should return empty array since empty htmlWithIssues means no items to process
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should handle issues without targetSelector', () => {
      const mockSuggestion = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: '',
                  issue_id: 'test-uuid-1',
                },
              ],
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issue_name: 'aria-allowed-attr',
        faulty_line: '<dt aria-level="3">Term</dt>',
        target_selector: '',
        issue_description: 'ARIA attribute not allowed on this element',
      });
    });

    it('should handle issues without description', () => {
      const mockSuggestion = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                  issue_id: 'test-uuid-1',
                },
              ],
              targetSelector: 'dt',
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issue_name: 'aria-allowed-attr',
        faulty_line: '<dt aria-level="3">Term</dt>',
        target_selector: 'dt',
        issue_description: '',
      });
    });

    it('should filter out issue types not in issueTypesForMystique', () => {
      const mockSuggestion = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                  issue_id: 'test-uuid-1',
                },
              ],
              targetSelector: 'dt',
              description: 'ARIA attribute not allowed on this element',
            },
            {
              type: 'color-contrast',
              htmlWithIssues: [
                {
                  update_from: '<button style="color: #ccc">Button</button>',
                  target_selector: 'button',
                  issue_id: 'test-uuid-2',
                },
              ],
              targetSelector: 'button',
              description: 'Insufficient color contrast',
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issueType).to.equal('aria-allowed-attr');
      expect(result[0].issuesList).to.have.length(1);
      expect(result[0].issuesList[0].issue_name).to.equal('aria-allowed-attr');
    });

    it('should process multiple suggestions', () => {
      const mockSuggestion1 = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                  issue_id: 'test-uuid-1',
                },
              ],
              targetSelector: 'dt',
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
      };

      const mockSuggestion2 = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="2">Text</span>',
                  target_selector: 'span',
                  issue_id: 'test-uuid-2',
                },
              ],
              targetSelector: 'span',
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion1, mockSuggestion2]);

      expect(result).to.have.length(2);
      expect(result[0].suggestion).to.equal(mockSuggestion1);
      expect(result[1].suggestion).to.equal(mockSuggestion2);
      expect(result[0].issueType).to.equal('aria-allowed-attr');
      expect(result[1].issueType).to.equal('aria-allowed-attr');
    });

    it('should handle mixed valid and invalid suggestions', () => {
      const mockSuggestion1 = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<dt aria-level="3">Term</dt>',
                  target_selector: 'dt',
                  issue_id: 'test-uuid-1',
                },
              ],
              targetSelector: 'dt',
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
      };

      const mockSuggestion2 = {
        getData: () => ({
          issues: [
            {
              type: 'color-contrast',
              htmlWithIssues: [
                {
                  update_from: '<button style="color: #ccc">Button</button>',
                  target_selector: 'button',
                  issue_id: 'test-uuid-2',
                },
              ],
              targetSelector: 'button',
              description: 'Insufficient color contrast',
            },
          ],
        }),
      };

      const mockSuggestion3 = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="2">Text</span>',
                  target_selector: 'span',
                  issue_id: 'test-uuid-3',
                },
              ],
              targetSelector: 'span',
              description: 'ARIA attribute not allowed on this element',
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([
        mockSuggestion1,
        mockSuggestion2,
        mockSuggestion3,
      ]);

      expect(result).to.have.length(2);
      expect(result[0].suggestion).to.equal(mockSuggestion1);
      expect(result[1].suggestion).to.equal(mockSuggestion3);
      expect(result[0].issueType).to.equal('aria-allowed-attr');
      expect(result[1].issueType).to.equal('aria-allowed-attr');
    });

    it('should handle missing faulty_line, target_selector, and issue_description', () => {
      const mockSuggestion = {
        getData: () => ({
          issues: [
            {
              type: 'aria-allowed-attr',
              htmlWithIssues: [
                {
                  // Missing update_from, target_selector, issue_id
                },
              ],
              // Missing targetSelector and description
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issue_name: 'aria-allowed-attr',
        faulty_line: '', // Should default to empty string
        target_selector: '', // Should default to empty string
        issue_description: '', // Should default to empty string
        issue_id: '', // Should default to empty string
      });
    });
  });
});
