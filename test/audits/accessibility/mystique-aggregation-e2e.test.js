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
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';
import { processSuggestionsForMystique } from '../../../src/accessibility/guidance-utils/mystique-data-processing.js';

const { expect } = chai;

// Configure Chai
chai.use(chaiAsPromised);
chai.use(sinonChai);

/**
 * End-to-end test for accessibility suggestion aggregation flow
 * 
 * This test verifies that suggestions are correctly aggregated into groups
 * based on their issue types and granularity strategies before being sent
 * to the Mystique queue for remediation.
 */
describe('Accessibility Suggestion Aggregation - End-to-End', () => {
  describe('processSuggestionsForMystique - Aggregation Scenario', () => {
    it('should aggregate 3 suggestions into 2 groups: 1 button-name and 2 aria-prohibited-attr', () => {
      // Create 3 mock suggestions that simulate real accessibility issues
      
      // Suggestion 1: button-name on page1
      // button-name uses PER_PAGE_PER_COMPONENT granularity: url|type
      const suggestion1 = {
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'button-name',
              description: 'Buttons must have discernible text',
              htmlWithIssues: [
                {
                  update_from: '<button class="nav"></button>',
                  updateFrom: '<button class="nav"></button>',
                  target_selector: 'button.nav',
                  targetSelector: 'button.nav',
                },
              ],
            },
          ],
        }),
      };

      // Suggestion 2: aria-prohibited-attr on page1
      // aria-prohibited-attr uses PER_TYPE granularity: just the type
      const suggestion2 = {
        getId: () => 'sugg-2',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'aria-prohibited-attr',
              description: 'ARIA attribute not allowed on this element',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="1">Text</span>',
                  updateFrom: '<span aria-level="1">Text</span>',
                  target_selector: 'span.icon',
                  targetSelector: 'span.icon',
                },
              ],
            },
          ],
        }),
      };

      // Suggestion 3: aria-prohibited-attr on page2
      // Should be grouped with suggestion 2 due to PER_TYPE granularity
      const suggestion3 = {
        getId: () => 'sugg-3',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page2',
          issues: [
            {
              type: 'aria-prohibited-attr',
              description: 'ARIA attribute not allowed on this element',
              htmlWithIssues: [
                {
                  update_from: '<div aria-level="2">Content</div>',
                  updateFrom: '<div aria-level="2">Content</div>',
                  target_selector: 'div.content',
                  targetSelector: 'div.content',
                },
              ],
            },
          ],
        }),
      };

      const suggestions = [suggestion1, suggestion2, suggestion3];

      // Execute the aggregation function
      const result = processSuggestionsForMystique(suggestions);

      // Verify: Should have exactly 2 aggregation groups
      expect(result).to.have.length(2);

      // Find the button-name group and aria-prohibited-attr group
      const buttonNameGroup = result.find((group) => group.aggregationKey.includes('button-name'));
      const ariaProhibitedGroup = result.find((group) => group.aggregationKey === 'aria-prohibited-attr');

      // Verify button-name group (PER_PAGE_PER_COMPONENT: url|type)
      expect(buttonNameGroup).to.exist;
      expect(buttonNameGroup.url).to.equal('https://example.com/page1');
      expect(buttonNameGroup.aggregationKey).to.equal('https://example.com/page1|button-name');
      expect(buttonNameGroup.issuesList).to.have.length(1);
      expect(buttonNameGroup.issuesList[0]).to.deep.include({
        issueName: 'button-name',
        suggestionId: 'sugg-1',
        targetSelector: 'button.nav',
        faultyLine: '<button class="nav"></button>',
        issueDescription: 'Buttons must have discernible text',
      });

      // Verify aria-prohibited-attr group (PER_TYPE: just the type)
      expect(ariaProhibitedGroup).to.exist;
      expect(ariaProhibitedGroup.aggregationKey).to.equal('aria-prohibited-attr');
      // Should have 2 issues: one from page1, one from page2
      expect(ariaProhibitedGroup.issuesList).to.have.length(2);
      
      // URL should be from the first suggestion in this group
      expect(ariaProhibitedGroup.url).to.equal('https://example.com/page1');
      
      // Verify both issues are present
      const suggestionIds = ariaProhibitedGroup.issuesList.map((issue) => issue.suggestionId);
      expect(suggestionIds).to.include.members(['sugg-2', 'sugg-3']);
      
      // Verify issue details
      const issue1 = ariaProhibitedGroup.issuesList.find((i) => i.suggestionId === 'sugg-2');
      expect(issue1).to.deep.include({
        issueName: 'aria-prohibited-attr',
        targetSelector: 'span.icon',
        faultyLine: '<span aria-level="1">Text</span>',
        issueDescription: 'ARIA attribute not allowed on this element',
      });

      const issue2 = ariaProhibitedGroup.issuesList.find((i) => i.suggestionId === 'sugg-3');
      expect(issue2).to.deep.include({
        issueName: 'aria-prohibited-attr',
        targetSelector: 'div.content',
        faultyLine: '<div aria-level="2">Content</div>',
        issueDescription: 'ARIA attribute not allowed on this element',
      });
    });

    it('should handle suggestions from different pages with different aggregation strategies', () => {
      // Mix of different granularity types to ensure they're handled correctly
      
      // button-name: PER_PAGE_PER_COMPONENT (url|type)
      const buttonSugg1 = {
        getId: () => 'btn-1',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [{
            type: 'button-name',
            htmlWithIssues: [{ update_from: '<button>1</button>', target_selector: 'button' }],
          }],
        }),
      };

      const buttonSugg2 = {
        getId: () => 'btn-2',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page2',
          issues: [{
            type: 'button-name',
            htmlWithIssues: [{ update_from: '<button>2</button>', target_selector: 'button' }],
          }],
        }),
      };

      // aria-prohibited-attr: PER_TYPE (just type - groups globally)
      const ariaSugg1 = {
        getId: () => 'aria-1',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [{
            type: 'aria-prohibited-attr',
            htmlWithIssues: [{ update_from: '<span>1</span>', target_selector: 'span' }],
          }],
        }),
      };

      const ariaSugg2 = {
        getId: () => 'aria-2',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page2',
          issues: [{
            type: 'aria-prohibited-attr',
            htmlWithIssues: [{ update_from: '<span>2</span>', target_selector: 'span' }],
          }],
        }),
      };

      const suggestions = [buttonSugg1, buttonSugg2, ariaSugg1, ariaSugg2];
      const result = processSuggestionsForMystique(suggestions);

      // Should have 3 groups:
      // 1. button-name on page1
      // 2. button-name on page2
      // 3. aria-prohibited-attr (global - includes both pages)
      expect(result).to.have.length(3);

      // Verify button-name groups are separate (PER_PAGE_PER_COMPONENT)
      const buttonGroups = result.filter((g) => g.aggregationKey.includes('button-name'));
      expect(buttonGroups).to.have.length(2);
      expect(buttonGroups[0].issuesList).to.have.length(1);
      expect(buttonGroups[1].issuesList).to.have.length(1);

      // Verify aria-prohibited-attr is grouped globally (PER_TYPE)
      const ariaGroup = result.find((g) => g.aggregationKey === 'aria-prohibited-attr');
      expect(ariaGroup).to.exist;
      expect(ariaGroup.issuesList).to.have.length(2);
    });

    it('should skip suggestions with FIXED or SKIPPED status', () => {
      const activeSuggestion = {
        getId: () => 'active-1',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [{
            type: 'button-name',
            htmlWithIssues: [{ update_from: '<button></button>', target_selector: 'button' }],
          }],
        }),
      };

      const fixedSuggestion = {
        getId: () => 'fixed-1',
        getStatus: () => 'FIXED',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [{
            type: 'button-name',
            htmlWithIssues: [{ update_from: '<button></button>', target_selector: 'button' }],
          }],
        }),
      };

      const skippedSuggestion = {
        getId: () => 'skipped-1',
        getStatus: () => 'SKIPPED',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [{
            type: 'button-name',
            htmlWithIssues: [{ update_from: '<button></button>', target_selector: 'button' }],
          }],
        }),
      };

      const suggestions = [activeSuggestion, fixedSuggestion, skippedSuggestion];
      const result = processSuggestionsForMystique(suggestions);

      // Should only have 1 group from the active suggestion
      expect(result).to.have.length(1);
      expect(result[0].issuesList).to.have.length(1);
      expect(result[0].issuesList[0].suggestionId).to.equal('active-1');
    });

    it('should filter out issue types not in issueTypesForMystique', () => {
      const mystiqueIssue = {
        getId: () => 'mystique-1',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [{
            type: 'button-name',
            htmlWithIssues: [{ update_from: '<button></button>', target_selector: 'button' }],
          }],
        }),
      };

      const nonMystiqueIssue = {
        getId: () => 'non-mystique-1',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [{
            type: 'color-contrast', // Not in issueTypesForMystique
            htmlWithIssues: [{ update_from: '<div></div>', target_selector: 'div' }],
          }],
        }),
      };

      const suggestions = [mystiqueIssue, nonMystiqueIssue];
      const result = processSuggestionsForMystique(suggestions);

      // Should only have 1 group from the Mystique-eligible issue
      expect(result).to.have.length(1);
      expect(result[0].issuesList[0].issueName).to.equal('button-name');
    });
  });

  describe('Mystique Message Structure Verification', () => {
    it('should verify forward payload structure with all required fields', () => {
      // Create suggestions with code-fix eligible issue types
      const suggestion = {
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          source: 'form1',
          issues: [
            {
              type: 'button-name',
              description: 'Buttons must have discernible text',
              htmlWithIssues: [
                {
                  update_from: '<button class="nav"></button>',
                  target_selector: 'button.nav',
                },
              ],
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([suggestion]);

      // Verify the structure
      expect(result).to.have.length(1);
      const messageData = result[0];

      // Verify all required fields are present
      expect(messageData).to.have.property('url');
      expect(messageData).to.have.property('aggregationKey');
      expect(messageData).to.have.property('issuesList');

      // Verify field types and values
      expect(messageData.url).to.be.a('string');
      expect(messageData.url).to.equal('https://example.com/page1');
      
      expect(messageData.aggregationKey).to.be.a('string');
      expect(messageData.aggregationKey).to.include('button-name');
      
      expect(messageData.issuesList).to.be.an('array');
      expect(messageData.issuesList).to.have.length(1);

      // Verify issuesList item structure
      const issue = messageData.issuesList[0];
      expect(issue).to.have.property('issueName');
      expect(issue).to.have.property('suggestionId');
      expect(issue).to.have.property('faultyLine');
      expect(issue).to.have.property('targetSelector');
      expect(issue).to.have.property('issueDescription');
      expect(issue).to.have.property('url');

      expect(issue.issueName).to.equal('button-name');
      expect(issue.suggestionId).to.equal('sugg-1');
      expect(issue.url).to.equal('https://example.com/page1');
    });

    it('should support messages without aggregationKey for backwards compatibility', () => {
      // In backwards compatibility mode, aggregationKey might not be required
      // The system should still process suggestions and create messages
      const suggestion = {
        getId: () => 'sugg-legacy',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/legacy',
          issues: [
            {
              type: 'aria-prohibited-attr',
              description: 'ARIA attribute not allowed',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="1">Text</span>',
                  target_selector: 'span.icon',
                },
              ],
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([suggestion]);

      expect(result).to.have.length(1);
      const messageData = result[0];

      // Even in backwards compatibility mode, the aggregationKey should be generated
      expect(messageData).to.have.property('aggregationKey');
      expect(messageData.aggregationKey).to.be.a('string');
      expect(messageData.aggregationKey).to.equal('aria-prohibited-attr');

      // Verify basic structure is maintained
      expect(messageData.url).to.equal('https://example.com/legacy');
      expect(messageData.issuesList).to.have.length(1);
      expect(messageData.issuesList[0].suggestionId).to.equal('sugg-legacy');
    });

    it('should handle multiple issues with the same aggregation key', () => {
      // Create suggestions that should be grouped together
      const suggestion1 = {
        getId: () => 'sugg-1',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'aria-prohibited-attr',
              description: 'ARIA attribute not allowed',
              htmlWithIssues: [
                {
                  update_from: '<span aria-level="1">Text</span>',
                  target_selector: 'span.icon',
                },
              ],
            },
          ],
        }),
      };

      const suggestion2 = {
        getId: () => 'sugg-2',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page2',
          issues: [
            {
              type: 'aria-prohibited-attr',
              description: 'ARIA attribute not allowed',
              htmlWithIssues: [
                {
                  update_from: '<div aria-level="2">Content</div>',
                  target_selector: 'div.content',
                },
              ],
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([suggestion1, suggestion2]);

      // aria-prohibited-attr uses PER_TYPE granularity, so should be grouped
      expect(result).to.have.length(1);
      const messageData = result[0];

      expect(messageData.aggregationKey).to.equal('aria-prohibited-attr');
      expect(messageData.issuesList).to.have.length(2);

      // Verify both issues are present with their suggestionIds
      const suggestionIds = messageData.issuesList.map((issue) => issue.suggestionId);
      expect(suggestionIds).to.include.members(['sugg-1', 'sugg-2']);
    });

    it('should not process issues that already have guidance', () => {
      // Issues with guidance should be filtered out
      const suggestionWithGuidance = {
        getId: () => 'sugg-with-guidance',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'button-name',
              description: 'Buttons must have discernible text',
              htmlWithIssues: [
                {
                  update_from: '<button></button>',
                  target_selector: 'button',
                  guidance: {
                    generalSuggestion: 'Add text to button',
                    updateTo: '<button>Click me</button>',
                  },
                },
              ],
            },
          ],
        }),
      };

      const suggestionWithoutGuidance = {
        getId: () => 'sugg-without-guidance',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            {
              type: 'button-name',
              description: 'Buttons must have discernible text',
              htmlWithIssues: [
                {
                  update_from: '<button class="nav"></button>',
                  target_selector: 'button.nav',
                },
              ],
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([suggestionWithGuidance, suggestionWithoutGuidance]);

      // Should only process the suggestion without guidance
      expect(result).to.have.length(1);
      expect(result[0].issuesList).to.have.length(1);
      expect(result[0].issuesList[0].suggestionId).to.equal('sugg-without-guidance');
    });

    it('should include source in aggregation key when present', () => {
      const suggestionWithSource = {
        getId: () => 'sugg-with-source',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/contact',
          source: 'contact-form',
          issues: [
            {
              type: 'button-name',
              description: 'Buttons must have discernible text',
              htmlWithIssues: [
                {
                  update_from: '<button></button>',
                  target_selector: 'button.submit',
                },
              ],
            },
          ],
        }),
      };

      const suggestionWithoutSource = {
        getId: () => 'sugg-without-source',
        getStatus: () => 'NEW',
        getData: () => ({
          url: 'https://example.com/contact',
          issues: [
            {
              type: 'button-name',
              description: 'Buttons must have discernible text',
              htmlWithIssues: [
                {
                  update_from: '<button></button>',
                  target_selector: 'button.cancel',
                },
              ],
            },
          ],
        }),
      };

      const result = processSuggestionsForMystique([suggestionWithSource, suggestionWithoutSource]);

      // Should create separate groups based on source
      expect(result).to.have.length(2);

      const withSourceGroup = result.find((r) => r.aggregationKey.includes('contact-form'));
      const withoutSourceGroup = result.find((r) => !r.aggregationKey.includes('contact-form'));

      expect(withSourceGroup).to.exist;
      expect(withoutSourceGroup).to.exist;

      expect(withSourceGroup.issuesList[0].suggestionId).to.equal('sugg-with-source');
      expect(withoutSourceGroup.issuesList[0].suggestionId).to.equal('sugg-without-source');
    });
  });
});

