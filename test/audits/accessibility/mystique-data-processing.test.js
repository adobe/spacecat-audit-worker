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
        getId: () => 'sugg-1',
      };
      const result = processSuggestionsForMystique([mockSuggestion]);
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should skip suggestions without issues', () => {
      const mockSuggestion = {
        getData: () => ({ issues: null }),
        getId: () => 'sugg-1',
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
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0]).to.have.property('url', 'https://example.com');
      expect(result[0]).to.have.property('issuesList');
      expect(result[0].issuesList).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issue_name: 'aria-allowed-attr',
        faulty_line: '<dt aria-level="3">Term</dt>',
        target_selector: 'dt',
        issue_description: 'ARIA attribute not allowed on this element',
        suggestion_id: 'sugg-1',
      });
    });

    it('should group multiple issues of the same type from the same URL', () => {
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
        getId: () => 'sugg-1',
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com');
      expect(result[0].issuesList).to.have.length(2);
      expect(result[0].issuesList[0].issue_name).to.equal('aria-allowed-attr');
      expect(result[0].issuesList[1].issue_name).to.equal('aria-allowed-attr');
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
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      // Should return URL entry with empty issuesList when no htmlWithIssues to process
      expect(result).to.have.length(1);
      expect(result[0]).to.deep.equal({
        url: 'https://example.com',
        issuesList: [],
      });
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
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      // Should return URL entry with empty issuesList when htmlWithIssues is empty
      expect(result).to.have.length(1);
      expect(result[0]).to.deep.equal({
        url: 'https://example.com',
        issuesList: [],
      });
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
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issue_name: 'aria-allowed-attr',
        faulty_line: '<dt aria-level="3">Term</dt>',
        target_selector: '',
        issue_description: 'ARIA attribute not allowed on this element',
        suggestion_id: 'sugg-1',
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
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issue_name: 'aria-allowed-attr',
        faulty_line: '<dt aria-level="3">Term</dt>',
        target_selector: 'dt',
        issue_description: '',
        suggestion_id: 'sugg-1',
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
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com');
      expect(result[0].issuesList).to.have.length(1);
      expect(result[0].issuesList[0].issue_name).to.equal('aria-allowed-attr');
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
      };

      const result = processSuggestionsForMystique([mockSuggestion1, mockSuggestion2]);

      expect(result).to.have.length(2);
      expect(result[0].url).to.equal('https://example.com/page1');
      expect(result[1].url).to.equal('https://example.com/page2');
      expect(result[0].issuesList[0].suggestion_id).to.equal('sugg-1');
      expect(result[1].issuesList[0].suggestion_id).to.equal('sugg-2');
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
      };

      const result = processSuggestionsForMystique([mockSuggestion1, mockSuggestion2]);

      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com');
      expect(result[0].issuesList).to.have.length(2);
      expect(result[0].issuesList[0].suggestion_id).to.equal('sugg-1');
      expect(result[0].issuesList[1].suggestion_id).to.equal('sugg-2');
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
      };

      const result = processSuggestionsForMystique([
        mockSuggestion1,
        mockSuggestion2,
        mockSuggestion3,
      ]);

      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com');
      expect(result[0].issuesList).to.have.length(2);
      expect(result[0].issuesList[0].suggestion_id).to.equal('sugg-1');
      expect(result[0].issuesList[1].suggestion_id).to.equal('sugg-3');
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
      };

      const result = processSuggestionsForMystique([mockSuggestion]);

      expect(result).to.have.length(1);
      expect(result[0].issuesList[0]).to.deep.include({
        issue_name: 'aria-allowed-attr',
        faulty_line: '', // Should default to empty string
        target_selector: '', // Should default to empty string
        issue_description: '', // Should default to empty string
        suggestion_id: 'sugg-1',
      });
    });
  });
});
