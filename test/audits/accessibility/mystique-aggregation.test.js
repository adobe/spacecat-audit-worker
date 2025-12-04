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
import { processSuggestionsForMystique } from '../../../src/accessibility/guidance-utils/mystique-data-processing.js';

const { expect } = chai;

describe('Mystique Integration with Aggregation Strategies', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processSuggestionsForMystique with PER_PAGE_PER_COMPONENT granularity', () => {
    it('should group suggestions with same URL and issue type into one message', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [{
                update_from: '<button class="header">',
                target_selector: 'button.header',
              }],
            }],
          }),
        },
        {
          getId: () => 'sugg-2',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [{
                update_from: '<button class="submit">',
                target_selector: 'button.submit',
              }],
            }],
          }),
        },
      ];

      const result = processSuggestionsForMystique(suggestions);

      // button-name uses PER_PAGE_PER_COMPONENT (url|type), so both should group into 1 message
      expect(result).to.have.lengthOf(1);
      expect(result[0].url).to.equal('https://example.com/page1');
      expect(result[0]).to.have.property('aggregationKey');
      expect(result[0].issuesList).to.have.lengthOf(2);

      // Both items should have their respective suggestionIds
      expect(result[0].issuesList[0].suggestionId).to.equal('sugg-1');
      expect(result[0].issuesList[1].suggestionId).to.equal('sugg-2');
    });
  });

  describe('processSuggestionsForMystique with PER_PAGE_PER_COMPONENT granularity', () => {
    it('should handle multiple htmlWithIssues in one suggestion', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [
                {
                  update_from: '<button class="submit">',
                  target_selector: 'button.submit',
                },
                {
                  update_from: '<button class="cancel">',
                  target_selector: 'button.cancel',
                },
                {
                  update_from: '<button class="apply">',
                  target_selector: 'button.apply',
                },
              ],
            }],
          }),
        },
      ];

      const result = processSuggestionsForMystique(suggestions);

      expect(result).to.have.lengthOf(1); // 1 message (same aggregation key)
      expect(result[0].url).to.equal('https://example.com/page1');
      expect(result[0]).to.have.property('aggregationKey');
      expect(result[0].issuesList).to.have.lengthOf(3); // 3 items in issuesList

      // All items should share the SAME suggestionId
      expect(result[0].issuesList[0].suggestionId).to.equal('sugg-1');
      expect(result[0].issuesList[1].suggestionId).to.equal('sugg-1');
      expect(result[0].issuesList[2].suggestionId).to.equal('sugg-1');

      // But have different selectors
      expect(result[0].issuesList[0].targetSelector).to.equal('button.submit');
      expect(result[0].issuesList[1].targetSelector).to.equal('button.cancel');
      expect(result[0].issuesList[2].targetSelector).to.equal('button.apply');
    });
  });

  describe('processSuggestionsForMystique with mixed granularity', () => {
    it('should handle multiple issue types in one suggestion', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'button-name',
                htmlWithIssues: [{
                  update_from: '<button>',
                  target_selector: 'button.submit',
                }],
              },
              {
                type: 'link-name',
                htmlWithIssues: [{
                  update_from: '<a>',
                  target_selector: 'a.nav',
                }],
              },
            ],
          }),
        },
      ];

      const result = processSuggestionsForMystique(suggestions);

      // button-name and link-name use PER_PAGE_PER_COMPONENT, so they get separate aggregation keys
      expect(result).to.have.lengthOf(2);
      expect(result[0]).to.have.property('aggregationKey');
      expect(result[1]).to.have.property('aggregationKey');

      // Each should have 1 issue from the same suggestion
      expect(result[0].issuesList).to.have.lengthOf(1);
      expect(result[1].issuesList).to.have.lengthOf(1);

      // Both should share same suggestionId
      expect(result[0].issuesList[0].suggestionId).to.equal('sugg-1');
      expect(result[1].issuesList[0].suggestionId).to.equal('sugg-1');
    });
  });

  describe('Message format validation', () => {
    it('should maintain correct message structure for Mystique SQS', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              description: 'Buttons must have accessible names',
              htmlWithIssues: [{
                update_from: '<button class="submit">Submit</button>',
                target_selector: 'button.submit',
              }],
            }],
          }),
        },
      ];

      const result = processSuggestionsForMystique(suggestions);

      expect(result[0]).to.have.property('url');
      expect(result[0]).to.have.property('aggregationKey');
      expect(result[0]).to.have.property('issuesList');

      const item = result[0].issuesList[0];
      expect(item).to.have.property('issueName');
      expect(item).to.have.property('faultyLine');
      expect(item).to.have.property('targetSelector');
      expect(item).to.have.property('issueDescription');
      expect(item).to.have.property('suggestionId');

      // Verify types
      expect(item.issueName).to.be.a('string');
      expect(item.faultyLine).to.be.a('string');
      expect(item.targetSelector).to.be.a('string');
      expect(item.issueDescription).to.be.a('string');
      expect(item.suggestionId).to.be.a('string');
    });

    it('should handle camelCase and snake_case property names', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [{
                update_from: '<button>',
                updateFrom: '<button>',
                target_selector: 'button',
                targetSelector: 'button',
              }],
            }],
          }),
        },
      ];

      const result = processSuggestionsForMystique(suggestions);
      const item = result[0].issuesList[0];

      // Should work with either naming convention
      expect(item.faultyLine).to.equal('<button>');
      expect(item.targetSelector).to.equal('button');
    });
  });

  describe('Filtering behavior', () => {
    it('should skip FIXED suggestions', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'FIXED',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [{ target_selector: 'button' }],
            }],
          }),
        },
      ];

      const result = processSuggestionsForMystique(suggestions);
      expect(result).to.have.lengthOf(0);
    });

    it('should skip SKIPPED suggestions', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'SKIPPED',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [{ target_selector: 'button' }],
            }],
          }),
        },
      ];

      const result = processSuggestionsForMystique(suggestions);
      expect(result).to.have.lengthOf(0);
    });

    it('should skip issues that already have guidance in legacy flow', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [{
                target_selector: 'button',
                guidance: {
                  generalSuggestion: 'Add aria-label',
                  updateTo: '<button aria-label="Submit">',
                  userImpact: 'Screen readers will announce button purpose',
                },
              }],
            }],
          }),
        },
      ];

      // Use legacy flow (useCodeFixFlow = false) to skip issues with guidance
      const result = processSuggestionsForMystique(suggestions, false);
      expect(result).to.have.lengthOf(0);
    });

    it('should resend issues with guidance but no codefix when useCodeFixFlow is true', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            isCodeChangeAvailable: false, // No code fix available
            issues: [{
              type: 'button-name',
              htmlWithIssues: [{
                target_selector: 'button',
                guidance: {
                  generalSuggestion: 'Add aria-label',
                  updateTo: '<button aria-label="Submit">',
                  userImpact: 'Screen readers will announce button purpose',
                },
              }],
            }],
          }),
        },
      ];

      // In code fix flow, should resend because code fix is not available
      const result = processSuggestionsForMystique(suggestions, true);
      expect(result).to.have.lengthOf(1);
    });

    it('should include only issues without guidance from grouped suggestion in legacy flow', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [
                {
                  target_selector: 'button.submit',
                  update_from: '<button class="submit">',
                  // No guidance - should be included
                },
                {
                  target_selector: 'button.cancel',
                  update_from: '<button class="cancel">',
                  guidance: { generalSuggestion: 'Already has guidance' },
                  // Has guidance - should be skipped in legacy flow
                },
              ],
            }],
          }),
        },
      ];

      // Use legacy flow (useCodeFixFlow = false)
      const result = processSuggestionsForMystique(suggestions, false);
      expect(result[0].issuesList).to.have.lengthOf(1);
      expect(result[0].issuesList[0].targetSelector).to.equal('button.submit');
    });

    it('should include issues with guidance but no codefix in code fix flow', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            isCodeChangeAvailable: false, // No code fix available
            issues: [{
              type: 'button-name',
              htmlWithIssues: [
                {
                  target_selector: 'button.submit',
                  update_from: '<button class="submit">',
                  // No guidance - should be included
                },
                {
                  target_selector: 'button.cancel',
                  update_from: '<button class="cancel">',
                  guidance: { generalSuggestion: 'Already has guidance' },
                  // Has guidance but no code fix - should be included in code fix flow
                },
              ],
            }],
          }),
        },
      ];

      // In code fix flow, both should be included (no code fix)
      const result = processSuggestionsForMystique(suggestions, true);
      expect(result[0].issuesList).to.have.lengthOf(2);
    });
  });

  describe('Aggregation key grouping', () => {
    it('should group all issues by aggregation key', () => {
      const suggestions = [
        {
          getId: () => 'sugg-1',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [{ target_selector: 'button.submit', update_from: '<button>' }],
            }],
          }),
        },
        {
          getId: () => 'sugg-2',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{
              type: 'link-name',
              htmlWithIssues: [{ target_selector: 'a.logo', update_from: '<a>' }],
            }],
          }),
        },
        {
          getId: () => 'sugg-3',
          getStatus: () => 'NEW',
          getData: () => ({
            url: 'https://example.com/page2',
            issues: [{
              type: 'button-name',
              htmlWithIssues: [{ target_selector: 'button.submit', update_from: '<button>' }],
            }],
          }),
        },
      ];

      const result = processSuggestionsForMystique(suggestions);

      // Should create 3 messages (one per aggregation key)
      expect(result).to.have.lengthOf(3);

      // Each message should have aggregationKey
      result.forEach((msg) => {
        expect(msg).to.have.property('aggregationKey');
        expect(msg).to.have.property('url');
      });
    });
  });
});

