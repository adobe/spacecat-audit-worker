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
import esmock from 'esmock';
// Functions will be imported via esmock in beforeEach
let formatWcagRule;
let formatIssue;
let aggregateA11yIssuesByOppType;
let createIndividualOpportunity;
let calculateAccessibilityMetrics;
let createMystiqueForwardPayload;

// Mock tagMappings module
const mockTagMappings = {
  mergeTagsWithHardcodedTags: sinon.stub().callsFake((opportunityType, currentTags) => {
    if (opportunityType === 'a11y-assistive') {
      return ['ARIA Labels', 'Accessibility'];
    }
    if (opportunityType === 'a11y-color-contrast') {
      return ['Color Contrast', 'Accessibility', 'Engagement'];
    }
    return currentTags || [];
  }),
};
import * as constants from '../../../src/accessibility/utils/constants.js';
import * as generateIndividualOpportunitiesModule from '../../../src/accessibility/utils/generate-individual-opportunities.js';

const { expect } = chai;

// Configure Chai
chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('formatWcagRule', () => {
  let sandbox;
  let originalSuccessCriteriaLinks;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // Import functions with mocked tagMappings
    if (!formatWcagRule) {
      const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
        '@adobe/spacecat-shared-utils': mockTagMappings,
      });
      formatWcagRule = module.formatWcagRule;
      formatIssue = module.formatIssue;
      aggregateA11yIssuesByOppType = module.aggregateA11yIssuesByOppType;
      createIndividualOpportunity = module.createIndividualOpportunity;
      calculateAccessibilityMetrics = module.calculateAccessibilityMetrics;
      createMystiqueForwardPayload = module.createMystiqueForwardPayload;
    }
    // Deep clone to preserve original values and structure
    originalSuccessCriteriaLinks = JSON.parse(JSON.stringify(constants.successCriteriaLinks));
  });

  afterEach(async () => {
    // Don't stop the patch here to allow coverage tracking
    // await esmock.patchStop('../../../src/accessibility/utils/generate-individual-opportunities.js');
    // Restore the original values by replacing the properties
    Object.keys(constants.successCriteriaLinks).forEach((key) => {
      delete constants.successCriteriaLinks[key];
    });
    Object.assign(constants.successCriteriaLinks, originalSuccessCriteriaLinks);
    sandbox.restore();
  });

  it('should correctly format a WCAG rule with a known name', () => {
    // Ensure the specific keys used in the test are present in our live object
    constants.successCriteriaLinks['412'] = { name: 'Name, Role, Value' };
    expect(formatWcagRule('wcag412')).to.equal('4.1.2 Name, Role, Value');
  });

  it('should correctly format a WCAG rule with multiple digits and a known name', () => {
    constants.successCriteriaLinks['111'] = { name: 'Non-text Content' };
    expect(formatWcagRule('wcag111')).to.equal('1.1.1 Non-text Content');
  });

  it('should correctly format a WCAG rule without a known name', () => {
    // Ensure '123' is not in the mocked links or remove it if it is for this test
    delete constants.successCriteriaLinks['123'];
    expect(formatWcagRule('wcag123')).to.equal('1.2.3');
  });

  it('should return the input if it does not start with "wcag"', () => {
    expect(formatWcagRule('invalidRule')).to.equal('invalidRule');
  });

  it('should return the input if it is "wcag" with no number part', () => {
    expect(formatWcagRule('wcag')).to.equal('wcag');
  });

  it('should return the input if the number part is not purely numeric', () => {
    expect(formatWcagRule('wcag1a2')).to.equal('wcag1a2');
  });

  it('should return the input for null', () => {
    expect(formatWcagRule(null)).to.be.null;
  });

  it('should return the input for undefined', () => {
    expect(formatWcagRule(undefined)).to.be.undefined;
  });

  it('should handle single digit wcag rule correctly if name exists', () => {
    constants.successCriteriaLinks['1'] = { name: 'Single Digit Rule' };
    expect(formatWcagRule('wcag1')).to.equal('1 Single Digit Rule');
  });

  it('should handle single digit wcag rule correctly if name does not exist', () => {
    delete constants.successCriteriaLinks['2'];
    expect(formatWcagRule('wcag2')).to.equal('2');
  });

  it('should handle wcag rule with no corresponding entry in successCriteriaLinks', () => {
    delete constants.successCriteriaLinks['999'];
    expect(formatWcagRule('wcag999')).to.equal('9.9.9');
  });

  it('should not be affected by other properties on successCriteriaLinks items', () => {
    constants.successCriteriaLinks['789'] = { name: 'Test Name', otherProp: 'test' };
    expect(formatWcagRule('wcag789')).to.equal('7.8.9 Test Name');
  });

  it('should handle empty successCriteriaLinks gracefully', () => {
    // Clear all properties from the live object for this test
    Object.keys(constants.successCriteriaLinks).forEach((key) => {
      delete constants.successCriteriaLinks[key];
    });
    expect(formatWcagRule('wcag111')).to.equal('1.1.1');
  });

  it('should execute all lines in formatWcagRule including numberPart extraction and formatting loop', () => {
    constants.successCriteriaLinks['412'] = { name: 'Name, Role, Value' };
    const result = formatWcagRule('wcag412');
    expect(result).to.equal('4.1.2 Name, Role, Value');
  });

  it('should execute formatWcagRule loop for multi-digit number', () => {
    constants.successCriteriaLinks['1234'] = { name: 'Test Rule' };
    const result = formatWcagRule('wcag1234');
    expect(result).to.equal('1.2.3.4 Test Rule');
  });

  it('should execute formatWcagRule when ruleInfo exists but name is falsy', () => {
    constants.successCriteriaLinks['412'] = { name: null };
    const result = formatWcagRule('wcag412');
    expect(result).to.equal('4.1.2');
  });
});

describe('formatIssue', () => {
  let sandbox;
  let originalSuccessCriteriaLinks;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // Ensure formatIssue is imported
    if (!formatIssue) {
      const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
        '@adobe/spacecat-shared-utils': mockTagMappings,
      });
      formatIssue = module.formatIssue;
    }
    originalSuccessCriteriaLinks = JSON.parse(JSON.stringify(constants.successCriteriaLinks));
    // Add some test WCAG rules
    constants.successCriteriaLinks['412'] = {
      name: 'Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
    };
    constants.successCriteriaLinks['111'] = {
      name: 'Non-text Content',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
    };
  });

  afterEach(() => {
    Object.keys(constants.successCriteriaLinks).forEach((key) => {
      delete constants.successCriteriaLinks[key];
    });
    Object.assign(constants.successCriteriaLinks, originalSuccessCriteriaLinks);
    sandbox.restore();
    // Don't stop the patch here to allow coverage tracking
  });

  it('should format critical severity issues', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      level: 'AA',
      count: 5,
      htmlWithIssues: ['<div>test1</div>', '<div>test2</div>', '<div>test3</div>', '<div>test4</div>', '<div>test5</div>'],
      nodes: [
        {
          html: '<div>test</div>',
          target: ['div.test'],
        },
      ],
      failureSummary: 'Test summary',
    }, 'critical');

    expect(result).to.deep.equal({
      type: 'color-contrast',
      description: 'Test description',
      wcagRule: '4.1.2 Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      wcagLevel: 'AA',
      severity: 'critical',
      occurrences: 5,
      htmlWithIssues: [
        {
          update_from: '<div>test1</div>',
          target_selector: '',
        },
        {
          update_from: '<div>test2</div>',
          target_selector: '',
        },
        {
          update_from: '<div>test3</div>',
          target_selector: '',
        },
        {
          update_from: '<div>test4</div>',
          target_selector: '',
        },
        {
          update_from: '<div>test5</div>',
          target_selector: '',
        },
      ],
      failureSummary: 'Test summary',
    });
  });

  it('should format serious severity issues', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
    }, 'serious');

    expect(result.severity).to.equal('serious');
  });

  it('should format moderate severity issues', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
    }, 'moderate');

    expect(result.severity).to.equal('moderate');
  });

  it('should handle missing successCriteriaTags', () => {
    const result = formatIssue('color-contrast', {
      description: 'Test description',
    }, 'critical');

    expect(result.wcagRule).to.equal('');
  });

  it('should handle empty successCriteriaTags array', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: [],
      description: 'Test description',
    }, 'critical');

    expect(result.wcagRule).to.equal('');
  });

  it('should handle missing description', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412'],
    }, 'critical');

    expect(result.description).to.equal('');
  });

  it('should handle missing level', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
    }, 'critical');

    expect(result.wcagLevel).to.equal('');
  });

  it('should handle missing count', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
    }, 'critical');

    expect(result.occurrences).to.equal(0);
  });

  it('should handle missing htmlWithIssues', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
    }, 'critical');

    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0]).to.deep.include({
      update_from: '',
      target_selector: '',
    });
  });

  it('should handle missing failureSummary', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
    }, 'critical');

    expect(result.failureSummary).to.equal('');
  });

  it('should handle unknown WCAG rules', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag999'],
      description: 'Test description',
    }, 'critical');

    expect(result.wcagRule).to.equal('9.9.9');
  });

  it('should handle multiple WCAG rules (using first one)', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412', 'wcag111'],
      description: 'Test description',
    }, 'critical');

    expect(result.wcagRule).to.equal('4.1.2 Name, Role, Value');
  });

  it('should extract targetSelector from target field', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div:nth-child(1) > .footer-menu-item'],
    }, 'critical');

    expect(result.htmlWithIssues[0].target_selector).to.equal('div:nth-child(1) > .footer-menu-item');
  });

  it('should handle missing target field', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
    }, 'critical');

    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle empty target array', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: [],
    }, 'critical');

    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle nodes with non-array target (fallback to string)', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      nodes: [
        {
          html: '<div>test</div>',
          target: 'div.single-target', // String instead of array
        },
      ],
    }, 'critical');

    expect(result).to.deep.equal({
      type: 'aria-allowed-attr',
      description: 'Test description',
      wcagRule: '4.1.2 Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      wcagLevel: '',
      severity: 'critical',
      occurrences: 0,
      htmlWithIssues: [
        {
          update_from: '',
          target_selector: '',
        },
      ],
      failureSummary: '',
    });
  });

  it('should handle nodes with null target (fallback to empty string)', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      nodes: [
        {
          html: '<div>test</div>',
          target: null, // null target
        },
      ],
    }, 'critical');

    expect(result).to.deep.equal({
      type: 'aria-allowed-attr',
      description: 'Test description',
      wcagRule: '4.1.2 Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      wcagLevel: '',
      severity: 'critical',
      occurrences: 0,
      htmlWithIssues: [
        {
          update_from: '',
          target_selector: '',
        },
      ],
      failureSummary: '',
    });
  });

  it('should handle nodes with missing html property', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      nodes: [
        {
          // Missing html property
          target: ['div.test'],
        },
      ],
    }, 'critical');

    expect(result).to.deep.equal({
      type: 'aria-allowed-attr',
      description: 'Test description',
      wcagRule: '4.1.2 Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      wcagLevel: '',
      severity: 'critical',
      occurrences: 0,
      htmlWithIssues: [
        {
          update_from: '',
          target_selector: '',
        },
      ],
      failureSummary: '',
    });
  });

  it('should handle missing properties with fallback values', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      // Missing description, level, count, failureSummary
      htmlWithIssues: [
        {
          // Missing update_from and issue_id, but has target_selector
          target_selector: 'div.test',
        },
      ],
    }, 'critical');

    expect(result).to.deep.equal({
      type: 'aria-allowed-attr',
      description: '', // Should default to empty string
      wcagRule: '4.1.2 Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      wcagLevel: '', // Should default to empty string
      severity: 'critical',
      occurrences: 1, // Length of htmlWithIssues array
      htmlWithIssues: [
        {
          update_from: '', // Should default to empty string
          target_selector: '', // Uses targetSelector from issueData.target (empty in this case)
        },
      ],
      failureSummary: '', // Should default to empty string
    });
  });

  it('should handle missing properties with completely empty htmlWithIssues', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      // Missing description, level, count, failureSummary
      htmlWithIssues: [
        {
          // Missing all properties
        },
      ],
    }, 'critical');

    expect(result).to.deep.equal({
      type: 'aria-allowed-attr',
      description: '', // Should default to empty string
      wcagRule: '4.1.2 Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
      wcagLevel: '', // Should default to empty string
      severity: 'critical',
      occurrences: 1, // Length of htmlWithIssues array
      htmlWithIssues: [
        {
          update_from: '', // Should default to empty string
          target_selector: '', // Should default to empty string
        },
      ],
      failureSummary: '', // Should default to empty string
    });
  });

  it('should handle htmlWithIssues with object having no update_from (fallback logic)', () => {
    // This test covers the complex fallback logic on lines 204-208
    // where we have an object without update_from property
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          // Object without update_from to trigger fallback
          some_other_prop: 'value',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with undefined update_from property', () => {
    // This test targets line 207 - the final fallback to empty string
    // when item.update_from is undefined
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          // Object with undefined update_from (not even null)
          // update_from is undefined (not present)
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with empty string update_from', () => {
    // This test targets line 207 - the final fallback to empty string
    // when item.update_from is an empty string (falsy)
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: '', // Empty string (falsy)
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with object without update_from', () => {
    // This test verifies line 208 - the final fallback to empty string
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {}, // Object without update_from
      ],
    }, 'critical');

    // Should fallback to empty string since no update_from is present (line 208)
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('');
  });

  it('should handle htmlWithIssues with object having falsy update_from', () => {
    // This test also targets line 208 with a falsy update_from value
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: null, // Falsy update_from
        },
      ],
    }, 'critical');

    // Should fallback to empty string since update_from is falsy (line 208)
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('');
  });

  it('should handle htmlWithIssues with empty object', () => {
    // This test specifically targets line 208 with an empty object
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {}, // Empty object - no issue_id or update_from
      ],
    }, 'critical');

    // Should fallback to empty string (line 208)
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with null item', () => {
    // This test specifically targets line 208 with a null item
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        null,
      ],
    }, 'critical');

    // Should fallback to empty string since item is falsy (line 208)
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with undefined item', () => {
    // This test specifically targets line 208 with an undefined item
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        undefined, // Undefined item
      ],
    }, 'critical');

    // Should fallback to empty string since item is falsy (line 208)
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with false item', () => {
    // This test specifically targets line 208 with false value
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        false, // Boolean false is falsy
      ],
    }, 'critical');

    // Should fallback to empty string since item is falsy (line 208)
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with object missing update_from (final fallback)', () => {
    // This test targets the final fallback when no update_from is available
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          // Object without update_from property
          other_prop: 'value',
        },
      ],
    }, 'critical');

    // Should use the final fallback to empty string
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should extract understandingUrl from successCriteriaLinks', () => {
    constants.successCriteriaLinks['412'] = {
      name: 'Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
    };

    const issueData = {
      description: 'Test issue',
      successCriteriaTags: ['wcag412'],
      level: 'AA',
      htmlWithIssues: ['<div>test</div>'],
      target: ['div.test'],
    };

    const result = formatIssue('aria-allowed-attr', issueData, 'critical');

    expect(result.understandingUrl).to.equal('https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html');
  });

  it('should handle understandingUrl when ruleInfo exists but understandingUrl is missing', () => {
    constants.successCriteriaLinks['412'] = {
      name: 'Name, Role, Value',
      // No understandingUrl
    };

    const issueData = {
      description: 'Test issue',
      successCriteriaTags: ['wcag412'],
      level: 'AA',
      htmlWithIssues: ['<div>test</div>'],
      target: ['div.test'],
    };

    const result = formatIssue('aria-allowed-attr', issueData, 'critical');

    expect(result.understandingUrl).to.equal('');
  });

  it('should handle htmlWithIssues with string items', () => {
    // This test verifies the simplified logic handles string items correctly
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        '<div>string content</div>', // String item
      ],
    }, 'critical');

    // Should use the string as update_from
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('<div>string content</div>');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with null values triggering all fallbacks', () => {
    // This test ensures all fallback paths are covered
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: null, // Falsy value
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with false values', () => {
    // This test specifically targets line 207 - the final || ''
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: false, // Falsy but not null/undefined
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with zero values', () => {
    // This test specifically targets line 205 - the final || ''
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: 0, // Falsy number
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle htmlWithIssues with NaN values', () => {
    // This test specifically targets line 205 - the final || '' fallback
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: NaN, // Falsy NaN value
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
  });

  // New tests that actually use htmlWithIssues to cover lines 201-219
  it('should process htmlWithIssues with string items', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test string</div>', '<span>another string</span>'],
    }, 'critical');

    expect(result.htmlWithIssues).to.have.length(2);
    expect(result.htmlWithIssues[0].update_from).to.equal('<div>test string</div>');
    expect(result.htmlWithIssues[0].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[1].update_from).to.equal('<span>another string</span>');
    expect(result.htmlWithIssues[1].target_selector).to.equal('div.test');
  });

  it('should process htmlWithIssues with object items that have update_from', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: [
        {
          update_from: '<div>object with update_from</div>',
        },
        {
          update_from: '<span>another object</span>',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues).to.have.length(2);
    expect(result.htmlWithIssues[0].update_from).to.equal('<div>object with update_from</div>');
    expect(result.htmlWithIssues[0].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[1].update_from).to.equal('<span>another object</span>');
    expect(result.htmlWithIssues[1].target_selector).to.equal('div.test');
  });

  it('should process htmlWithIssues with mixed string and object items', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: [
        '<div>string item</div>',
        {
          update_from: '<span>object item</span>',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues).to.have.length(2);
    expect(result.htmlWithIssues[0].update_from).to.equal('<div>string item</div>');
    expect(result.htmlWithIssues[0].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[1].update_from).to.equal('<span>object item</span>');
    expect(result.htmlWithIssues[1].target_selector).to.equal('div.test');
  });

  it('should handle htmlWithIssues with objects without update_from (triggers line 208)', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: [
        {
          // No update_from property
        },
        {
          update_from: null, // Null update_from
        },
        {
          update_from: '', // Empty string update_from
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues).to.have.length(3);
    // All should have empty string update_from due to line 208
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[1].update_from).to.equal('');
    expect(result.htmlWithIssues[1].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[2].update_from).to.equal('');
    expect(result.htmlWithIssues[2].target_selector).to.equal('div.test');
  });

  it('should extract understandingUrl when WCAG rule has understandingUrl', () => {
    constants.successCriteriaLinks['412'] = {
      name: 'Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
    };
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html');
  });

  it('should not extract understandingUrl when WCAG rule does not have understandingUrl', () => {
    delete constants.successCriteriaLinks['999'];
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag999'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('');
  });

  it('should not extract understandingUrl when rawWcagRule does not start with wcag', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['invalid-rule'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('');
  });

  it('should not extract understandingUrl when rawWcagRule is empty', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: [],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('');
  });

  it('should not extract understandingUrl when ruleInfo exists but has no understandingUrl property', () => {
    constants.successCriteriaLinks['412'] = {
      name: 'Name, Role, Value',
      // No understandingUrl property
    };
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('');
  });

  it('should not extract understandingUrl when ruleInfo is null/undefined for valid wcag rule', () => {
    delete constants.successCriteriaLinks['999'];
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag999'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('');
  });

  it('should extract understandingUrl when rawWcagRule starts with wcag and has understandingUrl', () => {
    constants.successCriteriaLinks['111'] = {
      name: 'Non-text Content',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
    };
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag111'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html');
  });

  it('should execute all lines in understandingUrl extraction including numberPart replacement', () => {
    constants.successCriteriaLinks['412'] = {
      name: 'Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
    };
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html');
    expect(result.wcagRule).to.equal('4.1.2 Name, Role, Value');
  });

  it('should execute understandingUrl extraction when rawWcagRule is truthy and starts with wcag', () => {
    constants.successCriteriaLinks['999'] = {
      name: 'Test Rule',
      understandingUrl: 'https://example.com/understanding',
    };
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag999'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('https://example.com/understanding');
  });

  it('should execute understandingUrl extraction when ruleInfo exists but understandingUrl is falsy', () => {
    constants.successCriteriaLinks['412'] = {
      name: 'Name, Role, Value',
      understandingUrl: null,
    };
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('');
  });

  it('should execute all lines in understandingUrl extraction including numberPart replacement and ruleInfo lookup', () => {
    constants.successCriteriaLinks['412'] = {
      name: 'Name, Role, Value',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
    };
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html');
    expect(result.wcagRule).to.equal('4.1.2 Name, Role, Value');
  });

  it('should execute understandingUrl extraction when ruleInfo is undefined for valid wcag rule', () => {
    delete constants.successCriteriaLinks['999'];
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag999'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('');
  });

  it('should execute understandingUrl extraction when ruleInfo exists but understandingUrl property is undefined', () => {
    constants.successCriteriaLinks['412'] = {
      name: 'Name, Role, Value',
      // understandingUrl property is undefined
    };
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: ['<div>test</div>'],
    }, 'critical');

    expect(result.understandingUrl).to.equal('');
  });
});

describe('aggregateA11yIssuesByOppType early return coverage', () => {
  let sandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    if (!aggregateA11yIssuesByOppType) {
      const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
        '@adobe/spacecat-shared-utils': mockTagMappings,
      });
      aggregateA11yIssuesByOppType = module.aggregateA11yIssuesByOppType;
    }
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should execute early return for null input', () => {
    const result = aggregateA11yIssuesByOppType(null);
    expect(result).to.deep.equal({ data: [] });
  });

  it('should execute early return for undefined input', () => {
    const result = aggregateA11yIssuesByOppType(undefined);
    expect(result).to.deep.equal({ data: [] });
  });

  it('should execute early return for false input', () => {
    const result = aggregateA11yIssuesByOppType(false);
    expect(result).to.deep.equal({ data: [] });
  });

  it('should execute early return for empty string input', () => {
    const result = aggregateA11yIssuesByOppType('');
    expect(result).to.deep.equal({ data: [] });
  });

  it('should execute early return for 0 input', () => {
    const result = aggregateA11yIssuesByOppType(0);
    expect(result).to.deep.equal({ data: [] });
  });
});

describe('aggregateA11yIssuesByOppType functional tests', () => {
  let sandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    if (!aggregateA11yIssuesByOppType) {
      const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
        '@adobe/spacecat-shared-utils': mockTagMappings,
      });
      aggregateA11yIssuesByOppType = module.aggregateA11yIssuesByOppType;
    }
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should extract source from URL with separator in aggregateA11yIssuesByOppType', () => {
    const testData = {
      'https://example.com/page?source=test-source': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                htmlWithIssues: ['<div>test</div>'],
                target: ['div.test'],
              },
            },
          },
        },
      },
    };
    const result = aggregateA11yIssuesByOppType(testData);
    expect(result.data[0]['a11y-assistive'][0].source).to.equal('test-source');
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com/page');
  });

  it('should not include source when URL does not contain separator', () => {
    const testData = {
      'https://example.com/page': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                htmlWithIssues: ['<div>test</div>'],
                target: ['div.test'],
              },
            },
          },
        },
      },
    };
    const result = aggregateA11yIssuesByOppType(testData);
    expect(result.data[0]['a11y-assistive'][0].source).to.be.undefined;
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com/page');
  });

describe('extractSourceFromUrl', () => {
  let extractSourceFromUrl;
  let testModule;

  beforeEach(async () => {
    testModule = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '@adobe/spacecat-shared-utils': mockTagMappings,
    });
    extractSourceFromUrl = testModule.extractSourceFromUrl || ((url) => {
      // Access the internal function via aggregateA11yIssuesByOppType which uses it
      const testData = {
        [`${url}?source=test-source`]: {
          violations: {
            critical: {
              items: {
                'aria-hidden-focus': {
                  htmlWithIssues: ['<div>test</div>'],
                  target: ['div.test'],
                },
              },
            },
          },
        },
      };
      const result = testModule.aggregateA11yIssuesByOppType(testData);
      if (result.data[0] && result.data[0]['a11y-assistive'] && result.data[0]['a11y-assistive'][0]) {
        return { url: result.data[0]['a11y-assistive'][0].url, source: result.data[0]['a11y-assistive'][0].source };
      }
      return { url, source: null };
    });
  });

  it('should extract source from URL with separator', () => {
    const testData = {
      'https://example.com/page?source=test-source': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                htmlWithIssues: ['<div>test</div>'],
                target: ['div.test'],
              },
            },
          },
        },
      },
    };
    const result = testModule.aggregateA11yIssuesByOppType(testData);
    expect(result.data[0]['a11y-assistive'][0].source).to.equal('test-source');
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com/page');
  });

  it('should return null source when URL does not contain separator', () => {
    const testData = {
      'https://example.com/page': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                htmlWithIssues: ['<div>test</div>'],
                target: ['div.test'],
              },
            },
          },
        },
      },
    };
    const result = testModule.aggregateA11yIssuesByOppType(testData);
    expect(result.data[0]['a11y-assistive'][0].source).to.be.undefined;
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com/page');
  });
});

describe('shouldUseCodeFixFlow', () => {
  let shouldUseCodeFixFlow;

  beforeEach(async () => {
    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '@adobe/spacecat-shared-utils': mockTagMappings,
    });
    shouldUseCodeFixFlow = module.shouldUseCodeFixFlow;
  });

  afterEach(async () => {
    // Don't stop the patch to allow coverage tracking
    // await esmock.patchStop('../../../src/accessibility/utils/generate-individual-opportunities.js');
  });

  it('should return false for empty array', () => {
    expect(shouldUseCodeFixFlow([])).to.be.false;
  });

  it('should return false for null', () => {
    expect(shouldUseCodeFixFlow(null)).to.be.false;
  });

  it('should return false for undefined', () => {
    expect(shouldUseCodeFixFlow(undefined)).to.be.false;
  });

  it('should return true when all issues are code-fix eligible', () => {
    const issuesList = [
      { issueName: 'aria-hidden-focus' },
      { issueName: 'aria-allowed-attr' },
    ];
    expect(shouldUseCodeFixFlow(issuesList)).to.be.true;
  });

  it('should return false when some issues are not code-fix eligible', () => {
    const issuesList = [
      { issueName: 'aria-hidden-focus' },
      { issueName: 'color-contrast' },
    ];
    expect(shouldUseCodeFixFlow(issuesList)).to.be.false;
  });

  it('should return false when no issues are code-fix eligible', () => {
    const issuesList = [
      { issueName: 'color-contrast' },
      { issueName: 'heading-order' },
    ];
    expect(shouldUseCodeFixFlow(issuesList)).to.be.false;
  });
});

describe('aggregateAccessibilityIssues', () => {
  let sandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // Ensure aggregateA11yIssuesByOppType is imported
    if (!aggregateA11yIssuesByOppType) {
      const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
        '@adobe/spacecat-shared-utils': mockTagMappings,
      });
      aggregateA11yIssuesByOppType = module.aggregateA11yIssuesByOppType;
    }
  });

  afterEach(async () => {
    // Don't stop the patch to allow coverage tracking
    // await esmock.patchStop('../../../src/accessibility/utils/generate-individual-opportunities.js');
    sandbox.restore();
  });

  it('should return empty data array for null input', () => {
    const result = aggregateA11yIssuesByOppType(null);
    expect(result).to.deep.equal({ data: [] });
  });

  it('should return empty data array for undefined input', () => {
    const result = aggregateA11yIssuesByOppType(undefined);
    expect(result).to.deep.equal({ data: [] });
  });

  it('should return empty data array for false input', () => {
    const result = aggregateA11yIssuesByOppType(false);
    expect(result).to.deep.equal({ data: [] });
  });

  it('should return empty data array for empty string input', () => {
    const result = aggregateA11yIssuesByOppType('');
    expect(result).to.deep.equal({ data: [] });
  });

  it('should return empty data array for 0 input', () => {
    const result = aggregateA11yIssuesByOppType(0);
    expect(result).to.deep.equal({ data: [] });
  });

  it('should skip overall summary data', () => {
    const input = {
      overall: {
        violations: {
          critical: { items: {} },
          serious: { items: {} },
        },
      },
    };
    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.be.empty;
  });

  it('should process critical violations correctly', () => {
    const input = {
      'https://example.com': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive']).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com');
    expect(result.data[0]['a11y-assistive'][0].issues).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].issues[0].type).to.equal('aria-hidden-focus');
    expect(result.data[0]['a11y-assistive'][0].issues[0].severity).to.equal('critical');
    expect(result.data[0]['a11y-assistive'][0].issues[0].occurrences).to.equal(1);
    expect(result.data[0]['a11y-assistive'][0].issues[0].htmlWithIssues).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].issues[0].htmlWithIssues[0].update_from).to.equal('<div aria-hidden="true"><button>Click</button></div>');
  });

  it('should process serious violations correctly', () => {
    const input = {
      'https://example.com': {
        violations: {
          serious: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><input type="text"></div>'],
                target: ['div[aria-hidden] input'],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive']).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com');
    expect(result.data[0]['a11y-assistive'][0].issues).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].issues[0].type).to.equal('aria-hidden-focus');
    expect(result.data[0]['a11y-assistive'][0].issues[0].severity).to.equal('serious');
    expect(result.data[0]['a11y-assistive'][0].issues[0].occurrences).to.equal(1);
    expect(result.data[0]['a11y-assistive'][0].issues[0].htmlWithIssues).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].issues[0].htmlWithIssues[0].update_from).to.equal('<div aria-hidden="true"><input type="text"></div>');
  });

  it('should process both critical and serious violations', () => {
    const input = {
      'https://example.com': {
        violations: {
          critical: {
            items: {
              'aria-required-parent': {
                description: 'Critical issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div><li>Item</li></div>'],
                target: ['div > li'],
              },
            },
          },
          serious: {
            items: {
              'aria-hidden-focus': {
                description: 'Serious issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.have.lengthOf(1);
    const opportunity = result.data[0];
    expect(opportunity['a11y-assistive']).to.have.lengthOf(2); // Now creates separate URL objects
    // First URL object (critical issue)
    expect(opportunity['a11y-assistive'][0].url).to.equal('https://example.com');
    expect(opportunity['a11y-assistive'][0].issues).to.have.lengthOf(1);
    expect(opportunity['a11y-assistive'][0].issues[0].type).to.equal('aria-required-parent');
    expect(opportunity['a11y-assistive'][0].issues[0].severity).to.equal('critical');
    // Second URL object (serious issue)
    expect(opportunity['a11y-assistive'][1].url).to.equal('https://example.com');
    expect(opportunity['a11y-assistive'][1].issues).to.have.lengthOf(1);
    expect(opportunity['a11y-assistive'][1].issues[0].type).to.equal('aria-hidden-focus');
    expect(opportunity['a11y-assistive'][1].issues[0].severity).to.equal('serious');
  });

  it('should handle multiple URLs', () => {
    const input = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-required-parent': {
                description: 'Page 1 issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div><li>Item</li></div>'],
                target: ['div > li'],
              },
            },
          },
        },
      },
      'https://example.com/page2': {
        violations: {
          serious: {
            items: {
              'aria-hidden-focus': {
                description: 'Page 2 issue',
                successCriteriaTags: ['wcag111'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.have.lengthOf(1);
    const opportunity = result.data[0];
    expect(opportunity['a11y-assistive']).to.have.lengthOf(2);
    expect(opportunity['a11y-assistive'][0].url).to.equal('https://example.com/page1');
    expect(opportunity['a11y-assistive'][1].url).to.equal('https://example.com/page2');
  });

  it('should skip URLs with no issues', () => {
    const input = {
      'https://example.com/page1': {
        violations: {
          critical: { items: {} },
          serious: { items: {} },
        },
      },
      'https://example.com/page2': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Page 2 issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
          serious: { items: {} },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive']).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com/page2');
  });

  it('should handle missing violations object', () => {
    const input = {
      'https://example.com': {},
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.be.empty;
  });

  it('should handle missing items object', () => {
    const input = {
      'https://example.com': {
        violations: {
          critical: {},
          serious: {},
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.be.empty;
  });

  it('should skip issues without htmlWithIssues', () => {
    const input = {
      'https://example.com': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Issue without HTML',
                successCriteriaTags: ['wcag412'],
                count: 1,
                // No htmlWithIssues array
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.be.empty;
  });

  it('should handle missing target list', () => {
    const input = {
      'https://example.com': {
        violations: {
          critical: {
            items: {
              'aria-allowed-attr': {
                description: 'Multiple elements with invalid ARIA',
                successCriteriaTags: ['wcag412'],
                count: 3,
                htmlWithIssues: [
                  '<div aria-fake="true">Content 1</div>',
                ],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);

    expect(result.data).to.have.lengthOf(1);
    const opportunity = result.data[0];
    expect(opportunity['a11y-assistive']).to.have.lengthOf(1);
    const assistiveOpportunity = opportunity['a11y-assistive'][0];

    expect(assistiveOpportunity.url).to.equal('https://example.com');
    expect(assistiveOpportunity.issues).to.have.lengthOf(1);
    expect(assistiveOpportunity.issues[0].type).to.equal('aria-allowed-attr');
    expect(assistiveOpportunity.issues[0].htmlWithIssues).to.have.lengthOf(1);
    expect(assistiveOpportunity.issues[0].htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should handle target array with index matching htmlWithIssues', () => {
    const input = {
      'https://example.com': {
        violations: {
          critical: {
            items: {
              'aria-allowed-attr': {
                description: 'Multiple elements with invalid ARIA',
                successCriteriaTags: ['wcag412'],
                htmlWithIssues: [
                  '<div aria-fake="true">Content 1</div>',
                  '<span aria-invalid-attr="value">Content 2</span>',
                ],
                target: [
                  'div[aria-fake]',
                  'span[aria-invalid-attr]',
                ],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data[0]['a11y-assistive']).to.have.lengthOf(2);
    expect(result.data[0]['a11y-assistive'][0].issues[0].htmlWithIssues[0].target_selector).to.equal('div[aria-fake]');
    expect(result.data[0]['a11y-assistive'][1].issues[0].htmlWithIssues[0].target_selector).to.equal('span[aria-invalid-attr]');
  });

  it('should handle target array shorter than htmlWithIssues array', () => {
    const input = {
      'https://example.com': {
        violations: {
          critical: {
            items: {
              'aria-allowed-attr': {
                description: 'Multiple elements with invalid ARIA',
                successCriteriaTags: ['wcag412'],
                htmlWithIssues: [
                  '<div aria-fake="true">Content 1</div>',
                  '<span aria-invalid-attr="value">Content 2</span>',
                  '<p aria-made-up="test">Content 3</p>',
                ],
                target: [
                  'div[aria-fake]',
                  'span[aria-invalid-attr]',
                ],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data[0]['a11y-assistive']).to.have.lengthOf(3);
    expect(result.data[0]['a11y-assistive'][0].issues[0].htmlWithIssues[0].target_selector).to.equal('div[aria-fake]');
    expect(result.data[0]['a11y-assistive'][1].issues[0].htmlWithIssues[0].target_selector).to.equal('span[aria-invalid-attr]');
    expect(result.data[0]['a11y-assistive'][2].issues[0].htmlWithIssues[0].target_selector).to.equal('');
  });

  it('should create separate URL objects for multiple HTML elements', () => {
    const input = {
      'https://example.com': {
        violations: {
          critical: {
            items: {
              'aria-allowed-attr': {
                description: 'Multiple elements with invalid ARIA',
                successCriteriaTags: ['wcag412'],
                count: 3,
                htmlWithIssues: [
                  '<div aria-fake="true">Content 1</div>',
                  '<span aria-invalid-attr="value">Content 2</span>',
                  '<p aria-made-up="test">Content 3</p>',
                ],
                target: [
                  'div[aria-fake]',
                  'span[aria-invalid-attr]',
                  'p[aria-made-up]',
                ],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.have.lengthOf(1);
    const opportunity = result.data[0];
    expect(opportunity['a11y-assistive']).to.have.lengthOf(3); // Creates 3 separate URL objects (one per HTML element)

    // Verify each URL object has one issue with one HTML element
    opportunity['a11y-assistive'].forEach((urlObject) => {
      expect(urlObject.url).to.equal('https://example.com');
      expect(urlObject.issues).to.have.lengthOf(1);
      expect(urlObject.issues[0].type).to.equal('aria-allowed-attr');
      expect(urlObject.issues[0].htmlWithIssues).to.have.lengthOf(1);
    });

    // Verify all HTML elements are present across the URL objects (order may vary)
    const allUpdateFromValues = opportunity['a11y-assistive'].map((obj) => obj.issues[0].htmlWithIssues[0].update_from);
    const allTargetSelectors = opportunity['a11y-assistive'].map((obj) => obj.issues[0].htmlWithIssues[0].target_selector);

    expect(allUpdateFromValues).to.include('<div aria-fake="true">Content 1</div>');
    expect(allUpdateFromValues).to.include('<span aria-invalid-attr="value">Content 2</span>');
    expect(allUpdateFromValues).to.include('<p aria-made-up="test">Content 3</p>');

    expect(allTargetSelectors).to.include('div[aria-fake]');
    expect(allTargetSelectors).to.include('span[aria-invalid-attr]');
    expect(allTargetSelectors).to.include('p[aria-made-up]');
  });

  it('should return original url if URL parsing fails', () => {
    const input = {
      'https://example.com:port': {
        violations: {
          critical: {
            items: {
              'aria-allowed-attr': {
                description: 'Multiple elements with invalid ARIA',
                successCriteriaTags: ['wcag412'],
                count: 3,
                htmlWithIssues: ['<div aria-fake="true">Content 1</div>'],
                target: ['div[aria-fake]'],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com:port');
  });

  it('should extract source parameter from URL (covers lines 37-39)', () => {
    const input = {
      'https://example.com?source=test-source': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const result = aggregateA11yIssuesByOppType(input);
    expect(result.data).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive']).to.have.lengthOf(1);
    // URL should be cleaned
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com');
    // Source should be extracted
    expect(result.data[0]['a11y-assistive'][0].source).to.equal('test-source');
    expect(result.data[0]['a11y-assistive'][0].issues).to.have.lengthOf(1);
  });
});

describe('createIndividualOpportunity', () => {
  let sandbox;
  let mockOpportunity;
  let mockContext;
  let mockTagMappings;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockTagMappings = {
      mergeTagsWithHardcodedTags: sandbox.stub().callsFake((opportunityType, currentTags) => {
        // Return hardcoded tags based on type, preserving isElmo/isASO
        if (opportunityType === 'a11y-assistive') {
          return ['ARIA Labels', 'Accessibility'];
        }
        if (opportunityType === 'a11y-color-contrast') {
          return ['Color Contrast', 'Accessibility', 'Engagement'];
        }
        // For other types, return current tags or empty array
        return currentTags || [];
      }),
    };
    
    mockOpportunity = {
      getId: sandbox.stub().returns('test-id'),
      getSiteId: sandbox.stub().returns('test-site'),
      getAuditId: sandbox.stub().returns('test-audit'),
    };
    mockContext = {
      log: {
        debug: sandbox.stub(),
        error: sandbox.stub(),
      },
      dataAccess: {
        Opportunity: {
          create: sandbox.stub().resolves(mockOpportunity),
        },
      },
    };
  });

  afterEach(async () => {
    // Don't stop the patch to allow coverage tracking
    // await esmock.patchStop('../../../src/accessibility/utils/generate-individual-opportunities.js');
    sandbox.restore();
  });

  it('should create an opportunity with correct data', async () => {
    const opportunityInstance = {
      runbook: 'test-runbook',
      type: 'a11y-assistive',
      origin: 'test-origin',
      title: 'test-title',
      description: 'test-description',
      tags: ['test-tag'],
      status: 'test-status',
      data: { test: 'data' },
    };
    const auditData = {
      siteId: 'test-site',
      auditId: 'test-audit',
    };

    const result = await createIndividualOpportunity(opportunityInstance, auditData, mockContext);

    expect(result.opportunity).to.equal(mockOpportunity);
    expect(mockContext.dataAccess.Opportunity.create).to.have.been.calledWith({
      siteId: 'test-site',
      auditId: 'test-audit',
      runbook: 'test-runbook',
      type: 'a11y-assistive',
      origin: 'test-origin',
      title: 'test-title',
      description: 'test-description',
      tags: ['ARIA Labels', 'Accessibility'], // Hardcoded tags applied
      status: 'test-status',
      data: { test: 'data' },
    });
  });

  it('should handle errors during opportunity creation', async () => {
    const error = new Error('Test error');
    mockContext.dataAccess.Opportunity.create.rejects(error);

    const opportunityInstance = {
      runbook: 'test-runbook',
      type: 'test-type',
    };
    const auditData = {
      siteId: 'test-site',
      auditId: 'test-audit',
    };

    await expect(createIndividualOpportunity(opportunityInstance, auditData, mockContext))
      .to.be.rejectedWith('Test error');
    expect(mockContext.log.error).to.have.been.calledWith(
      '[A11yProcessingError] Failed to create new opportunity for siteId test-site and auditId test-audit: Test error',
    );
  });
});

describe('createIndividualOpportunitySuggestions', () => {
  let sandbox;
  let mockOpportunity;
  let mockContext;
  let mockLog;
  let mockSyncSuggestions;
  let mockIsAuditEnabledForSite;
  let createIndividualOpportunitySuggestions;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockOpportunity = {
      getId: sandbox.stub().returns('test-id'),
      getSiteId: sandbox.stub().returns('test-site'),
      getAuditId: sandbox.stub().returns('test-audit'),
      getSuggestions: sandbox.stub().resolves([]),
    };
    mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
    };
    mockSyncSuggestions = sandbox.stub().resolves();
    mockIsAuditEnabledForSite = sandbox.stub().returns(true);
    mockContext = {
      site: {
        getId: sandbox.stub().returns('test-site'),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
      },
      auditId: 'test-audit',
      log: mockLog,
      dataAccess: {
        Opportunity: {
          create: sandbox.stub().resolves(mockOpportunity),
          findById: sandbox.stub().resolves(mockOpportunity),
        },
        Suggestion: {
          bulkUpdateStatus: sandbox.stub().resolves(),
        },
        Configuration: {
          findLatest: sandbox.stub().resolves({
            isHandlerEnabledForSite: mockIsAuditEnabledForSite,
          }),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        IMPORT_WORKER_QUEUE_URL: 'import-worker-queue',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: mockSyncSuggestions,
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });
    createIndividualOpportunitySuggestions = module.createIndividualOpportunitySuggestions;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should create suggestions for each URL with issues', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page1',
          type: 'url',
          issues: [
            {
              type: 'color-contrast',
              occurrences: 5,
              htmlWithIssues: [
                {
                  target_selector: 'div[aria-fake]',
                },
              ],
            },
          ],
        },
        {
          url: 'https://example.com/page2',
          type: 'url',
          issues: [
            {
              type: 'image-alt',
              occurrences: 3,
              htmlWithIssues: [
                {
                  target_selector: 'div[aria-invalid-attr]',
                },
              ],
            },
          ],
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const callArgs = mockSyncSuggestions.firstCall.args[0];
    expect(callArgs.opportunity).to.equal(mockOpportunity);
    expect(callArgs.newData).to.deep.equal(aggregatedData.data);
    expect(callArgs.context).to.equal(mockContext);
    expect(callArgs.buildKey).to.be.a('function');
    expect(callArgs.mapNewSuggestion).to.be.a('function');
  });

  it('should handle errors during suggestion creation', async () => {
    const error = new Error('Test error');
    mockSyncSuggestions.rejects(error);

    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page1',
          type: 'url',
          issues: [],
        },
      ],
    };

    await expect(createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    )).to.be.rejectedWith('Test error');
    expect(mockContext.log.error).to.have.been.calledWith(
      '[A11yProcessingError] Failed to create suggestions for opportunity test-id: Test error',
    );
  });

  it('should call mapNewSuggestion function correctly', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page1',
          type: 'url',
          issues: [
            {
              type: 'color-contrast',
              occurrences: 5,
              htmlWithIssues: [
                {
                  target_selector: 'div[aria-fake]',
                },
              ],
            },
            {
              type: 'image-alt',
              occurrences: 3,
              htmlWithIssues: [
                {
                  target_selector: 'div[aria-invalid-attr]',
                },
              ],
            },
          ],
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { mapNewSuggestion } = mockSyncSuggestions.firstCall.args[0];

    // Test the mapNewSuggestion function
    const result = mapNewSuggestion(aggregatedData.data[0]);

    // Check all properties except status which depends on context.site.requiresValidation
    expect(result).to.include({
      opportunityId: 'test-id',
      type: 'CODE_CHANGE',
      rank: 8, // 5 + 3 occurrences
    });
    
    expect(result.data).to.deep.equal({
      url: 'https://example.com/page1',
      type: 'url',
      issues: [
        {
          type: 'color-contrast',
          occurrences: 5,
          htmlWithIssues: [
            {
              target_selector: 'div[aria-fake]',
            },
          ],
        },
        {
          type: 'image-alt',
          occurrences: 3,
          htmlWithIssues: [
            {
              target_selector: 'div[aria-invalid-attr]',
            },
          ],
        },
      ],
      jiraLink: '',
    });
  });

  it('should call buildKey function correctly', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page1',
          type: 'url',
          issues: [{
            type: 'color-contrast',
            occurrences: 5,
            htmlWithIssues: [
              {
                target_selector: 'div[aria-fake]',
              },
            ],
          }],
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { buildKey } = mockSyncSuggestions.firstCall.args[0];

    // Test the buildKey function
    const result = buildKey(aggregatedData.data[0]);

    expect(result).to.equal('https://example.com/page1|color-contrast|div[aria-fake]');
  });

  it('should call buildKey function with empty issues array', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page1',
          type: 'url',
          issues: [], // Empty issues array
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { buildKey } = mockSyncSuggestions.firstCall.args[0];

    // Test the buildKey function with empty issues
    const result = buildKey(aggregatedData.data[0]);

    expect(result).to.equal('https://example.com/page1');
  });

  it('should call buildKey function with no issues property', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page2',
          type: 'url',
          // No issues property at all
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { buildKey } = mockSyncSuggestions.firstCall.args[0];

    // Test the buildKey function with no issues property
    const result = buildKey(aggregatedData.data[0]);

    expect(result).to.equal('https://example.com/page2');
  });

  it('should call buildKey function with missing target_selector', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page3',
          type: 'url',
          issues: [{
            type: 'image-alt',
            occurrences: 3,
            htmlWithIssues: [
              {
                // Missing target_selector property
                update_from: '<img src="test.jpg">',
              },
            ],
          }],
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { buildKey } = mockSyncSuggestions.firstCall.args[0];

    // Test the buildKey function with missing target_selector
    const result = buildKey(aggregatedData.data[0]);

    // buildKey always uses INDIVIDUAL granularity for database uniqueness: url|type|selector
    // Empty selector results in trailing pipe for backwards compatibility
    expect(result).to.equal('https://example.com/page3|image-alt|');
  });

  it('should call buildKey function with null target_selector', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page4',
          type: 'url',
          issues: [{
            type: 'button-name',
            occurrences: 2,
            htmlWithIssues: [
              {
                target_selector: null, // Explicitly null
                update_from: '<button></button>',
              },
            ],
          }],
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { buildKey } = mockSyncSuggestions.firstCall.args[0];

    // Test the buildKey function with null target_selector
    const result = buildKey(aggregatedData.data[0]);

    // buildKey always uses INDIVIDUAL granularity: url|type|selector
    // Null selector results in trailing pipe
    expect(result).to.equal('https://example.com/page4|button-name|');
  });

  it('should call buildKey function with empty htmlWithIssues array', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page5',
          type: 'url',
          issues: [{
            type: 'label',
            occurrences: 1,
            htmlWithIssues: [], // Empty htmlWithIssues array
          }],
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { buildKey } = mockSyncSuggestions.firstCall.args[0];

    // Test the buildKey function with empty htmlWithIssues
    const result = buildKey(aggregatedData.data[0]);

    // buildKey always uses INDIVIDUAL granularity: url|type|selector
    // Empty htmlWithIssues results in empty selector and trailing pipe
    expect(result).to.equal('https://example.com/page5|label|');
  });

  it('should successfully create suggestions', async () => {
    const aggregatedData = {
      data: [
        { url: 'https://example.com', type: 'url', issues: [] },
      ],
    };

    const result = await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(result).to.deep.equal({ success: true });
    expect(mockSyncSuggestions).to.have.been.calledOnce;
  });

  it('should handle source parameter in url', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page1',
          type: 'url',
          source: '#contact-form',
          issues: [
            {
              type: 'color-contrast',
              occurrences: 1,
              htmlWithIssues: [
                {
                  target_selector: 'div[aria-fake]',
                },
              ],
            },
          ],
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { mapNewSuggestion } = mockSyncSuggestions.firstCall.args[0];

    // Test the mapNewSuggestion function
    const result = mapNewSuggestion(aggregatedData.data[0]);

    expect(result).to.deep.include({
      opportunityId: 'test-id',
      type: 'CODE_CHANGE',
      rank: 1,
      data: {
        url: 'https://example.com/page1',
        type: 'url',
        source: '#contact-form',
        issues: [
          {
            type: 'color-contrast',
            occurrences: 1,
            htmlWithIssues: [
              {
                target_selector: 'div[aria-fake]',
              },
            ],
          },
        ],
        jiraLink: '',
      },
    });
  });

  it('should include source in buildKey when data has source property (covers lines 410-411)', async () => {
    const aggregatedDataWithSource = {
      data: [
        {
          url: 'https://example.com/page1',
          type: 'url',
          source: 'test-source',
          issues: [
            {
              type: 'color-contrast',
              occurrences: 5,
              htmlWithIssues: [
                {
                  target_selector: 'div.test',
                },
              ],
            },
          ],
        },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedDataWithSource,
      mockContext,
      mockLog,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { buildKey } = mockSyncSuggestions.firstCall.args[0];

    // Test the buildKey function with source
    const key = buildKey(aggregatedDataWithSource.data[0]);

    // Key should include the source parameter appended
    expect(key).to.include('|test-source');
    expect(key).to.equal('https://example.com/page1|color-contrast|div.test|test-source');
  });
});

describe('calculateAccessibilityMetrics', () => {
  it('should calculate correct metrics from aggregated data', () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page1',
          issues: [
            { occurrences: 5 },
            { occurrences: 3 },
          ],
        },
        {
          url: 'https://example.com/page2',
          issues: [
            { occurrences: 2 },
          ],
        },
      ],
    };

    const result = calculateAccessibilityMetrics(aggregatedData);

    expect(result).to.deep.equal({
      totalIssues: 10,
      totalSuggestions: 2,
      pagesWithIssues: 2,
    });
  });

  it('should handle empty data', () => {
    const aggregatedData = {
      data: [],
    };

    const result = calculateAccessibilityMetrics(aggregatedData);

    expect(result).to.deep.equal({
      totalIssues: 0,
      totalSuggestions: 0,
      pagesWithIssues: 0,
    });
  });
});

describe('createAccessibilityIndividualOpportunities', () => {
  let sandbox;
  let mockContext;
  let mockSite;
  let mockOpportunity;
  let mockGetAuditData;
  let mockCreateAssistiveOppty;
  let mockSyncSuggestions;
  let mockIsAuditEnabledForSite;
  let createAccessibilityIndividualOpportunities;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockSite = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
    };
    mockOpportunity = {
      getId: sandbox.stub().returns('test-id'),
      getSiteId: sandbox.stub().returns('test-site'),
      getAuditId: sandbox.stub().returns('test-audit'),
      getSuggestions: sandbox.stub().resolves([]),
    };
    mockIsAuditEnabledForSite = sandbox.stub().returns(true);
    mockContext = {
      site: mockSite,
      log: {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
      },
      dataAccess: {
        Opportunity: {
          create: sandbox.stub().resolves(mockOpportunity),
          findById: sandbox.stub().resolves(mockOpportunity),
          allBySiteId: sandbox.stub().resolves([]),
          STATUSES: {
            NEW: 'NEW',
            IN_PROGRESS: 'IN_PROGRESS',
            IGNORED: 'IGNORED',
            RESOLVED: 'RESOLVED',
          },
        },
        Suggestion: {
          bulkUpdateStatus: sandbox.stub().resolves(),
        },
        Configuration: {
          findLatest: sandbox.stub().resolves({
            isHandlerEnabledForSite: mockIsAuditEnabledForSite,
          }),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        IMPORT_WORKER_QUEUE_URL: 'import-worker-queue',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    // Fix: Create proper sinon stubs for all mocks
    mockGetAuditData = sandbox.stub().resolves({
      siteId: 'test-site',
      auditId: 'test-audit',
    });

    mockCreateAssistiveOppty = sandbox.stub().returns({
      type: 'a11y-assistive',
      runbook: 'test-runbook',
      origin: 'AUTOMATION',
      title: 'Test Opportunity',
      description: 'Test Description',
      tags: ['a11y'],
      status: 'NEW',
      data: { dataSources: ['axe-core'] },
    });

    mockSyncSuggestions = sandbox.stub().resolves();

    // Fix: Mock all dependencies before importing the module under test
    const mockConstants = {
      accessibilityOpportunitiesMap: {
        'a11y-assistive': ['aria-hidden-focus', 'aria-allowed-attr'],
        'a11y-color-contrast': ['color-contrast'],
        'a11y-usability': ['button-name', 'label'],
      },
      successCriteriaLinks: {
        412: { name: 'Name, Role, Value' },
        111: { name: 'Non-text Content' },
        143: { name: 'Color Contrast' },
      },
      URL_SOURCE_SEPARATOR: '?source=',
      issueTypesForCodeFix: ['aria-allowed-attr', 'aria-hidden-focus'],
    };
    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/utils/constants.js': mockConstants,
      '../../../src/accessibility/utils/data-processing.js': {
        getAuditData: mockGetAuditData,
      },
      '../../../src/accessibility/utils/report-oppty.js': {
        createAccessibilityAssistiveOpportunity: mockCreateAssistiveOppty,
        createAccessibilityColorContrastOpportunity: sandbox.stub().returns({
          type: 'a11y-color-contrast',
          runbook: 'test-runbook',
          origin: 'AUTOMATION',
          title: 'Test Color Contrast Opportunity',
          description: 'Test Description',
          tags: ['a11y'],
          status: 'NEW',
          data: { dataSources: ['axe-core'] },
        }),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: mockSyncSuggestions,
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com/page1',
            issuesList: [1],
          },
          {
            url: 'https://example.com/page2',
            issuesList: [2],
          },
          {
            url: 'https://example.com/page3',
            issuesList: [3],
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });
    createAccessibilityIndividualOpportunities = module.createAccessibilityIndividualOpportunities;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should create opportunities and suggestions for accessibility issues', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    // Ensure aggregateA11yIssuesByOppType returns data by using the mocked constants
    // The function uses accessibilityOpportunitiesMap as default, which we've mocked
    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    if (result.status === 'NO_OPPORTUNITIES') {
      expect.fail(`Function returned NO_OPPORTUNITIES: ${result.message}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_CREATED');
    expect(result.opportunities[0].opportunityType).to.equal('a11y-assistive');
    expect(result.opportunities[0].suggestionsCount).to.be.greaterThan(0);
    expect(result.opportunities[0].totalIssues).to.be.greaterThan(0);
    expect(result.opportunities[0].pagesWithIssues).to.equal(1);
    expect(mockGetAuditData).to.have.been.calledWith(mockSite, 'accessibility');
    expect(mockCreateAssistiveOppty).to.have.been.calledOnce;
    expect(mockSyncSuggestions).to.have.been.calledOnce;
  });

  it('should handle no accessibility issues', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: { items: {} },
          serious: { items: {} },
        },
      },
    };

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('NO_OPPORTUNITIES');
    expect(result.message).to.equal('No accessibility issues found in tracked categories');
    expect(result.data).to.deep.equal([]);
  });

  it('should handle missing opportunity creator function', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'unknown-issue-type': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div>test</div>'],
                target: ['div.test'],
              },
            },
          },
        },
      },
    };

    // Mock aggregateA11yIssuesByOppType to return unknown opportunity type
    const mockModule = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/utils/constants.js': {
        accessibilityOpportunitiesMap: {
          'unknown-opportunity-type': ['unknown-issue-type'],
        },
        successCriteriaLinks: {},
      },
      '../../../src/accessibility/utils/data-processing.js': {
        getAuditData: mockGetAuditData,
      },
      '../../../src/accessibility/utils/report-oppty.js': {
        createAccessibilityAssistiveOpportunity: mockCreateAssistiveOppty,
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: mockSyncSuggestions,
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    const result = await mockModule.createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('No opportunity creator found for type: unknown-opportunity-type');
    expect(mockContext.log.error).to.have.been.calledWith(
      sinon.match(/No opportunity creator found for type: unknown-opportunity-type/),
    );
  });

  it('should handle errors during opportunity creation', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    mockContext.dataAccess.Opportunity.create.rejects(new Error('DB Error'));

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('DB Error');
  });

  it('should handle errors during suggestion creation', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    mockSyncSuggestions.rejects(new Error('Sync Error'));

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('Sync Error');
  });

  it('should handle errors during audit data retrieval', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    mockGetAuditData.rejects(new Error('Audit Error'));

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('Audit Error');
  });

  it('should handle errors during opportunity creation with existing opportunities', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const mockExistingOpportunity = {
      getId: sandbox.stub().returns('existing-id'),
      getType: sandbox.stub().returns('a11y-assistive'),
      getStatus: sandbox.stub().returns('NEW'),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().rejects(new Error('Create Error')),
    };
    mockContext.dataAccess.Opportunity.allBySiteId.resolves([mockExistingOpportunity]);

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('Create Error');
  });

  it('should handle errors during suggestion creation with existing opportunities', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const mockExistingOpportunity = {
      getId: sandbox.stub().returns('existing-id'),
      getType: sandbox.stub().returns('a11y-assistive'),
      getStatus: sandbox.stub().returns('NEW'),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getSuggestions: sandbox.stub().resolves([]),
    };
    mockContext.dataAccess.Opportunity.allBySiteId.resolves([mockExistingOpportunity]);
    mockSyncSuggestions.rejects(new Error('Sync Error'));

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('Sync Error');
  });

  it('should handle errors during audit data retrieval with existing opportunities', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    mockGetAuditData.rejects(new Error('Audit Error'));

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('Audit Error');
  });

  it('should handle multiple issues of same type on same page', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'First issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
          serious: {
            items: {
              'aria-allowed-attr': {
                description: 'Second issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-fake="true">Content</div>'],
                target: ['div[aria-fake]'],
              },
            },
          },
        },
      },
    };

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_CREATED');
    expect(result.opportunities[0].suggestionsCount).to.equal(2);
    expect(result.opportunities[0].totalIssues).to.equal(2);
    expect(result.opportunities[0].pagesWithIssues).to.equal(1);
  });

  it('should handle issues with missing successCriteriaTags', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_CREATED');
  });

  it('should handle issues with empty successCriteriaTags', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: [],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_CREATED');
  });

  it('should handle issues with invalid successCriteriaTags', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['invalid-tag'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_CREATED');
  });

  it('should handle issues with missing count', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_CREATED');
  });

  it('should handle issues with missing description', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_CREATED');
  });

  it('should handle unknown opportunity types', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'unknown-issue-type': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-unknown="true">Content</div>'],
                target: ['div[aria-unknown]'],
              },
            },
          },
        },
      },
    };

    // Mock the constants to include an unknown opportunity type
    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/utils/constants.js': {
        accessibilityOpportunitiesMap: {
          'a11y-unknown': ['unknown-issue-type'], // This type won't have a creator
        },
        successCriteriaLinks: {
          412: { name: 'Name, Role, Value' },
        },
      },
      '../../../src/accessibility/utils/data-processing.js': {
        getAuditData: mockGetAuditData,
      },
      '../../../src/accessibility/utils/report-oppty.js': {
        createAccessibilityAssistiveOpportunity: mockCreateAssistiveOppty,
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: mockSyncSuggestions,
      },
    });

    const createOpportunitiesWithUnknownType = module.createAccessibilityIndividualOpportunities;

    const result = await createOpportunitiesWithUnknownType(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('No opportunity creator found for type: a11y-unknown');
    expect(mockContext.log.error).to.have.been.calledWith(
      sinon.match.string,
    );
  });

  it('should update existing opportunity with IN_PROGRESS status', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const mockExistingOpportunity = {
      getId: sandbox.stub().returns('existing-id'),
      getType: sandbox.stub().returns('a11y-assistive'),
      getStatus: sandbox.stub().returns('IN_PROGRESS'), // Key difference - tests line 512
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getSuggestions: sandbox.stub().resolves([]),
    };

    mockContext.dataAccess.Opportunity.allBySiteId.resolves([mockExistingOpportunity]);
    mockSyncSuggestions.resolves();

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_UPDATED'); // Tests line 674
    expect(result.opportunities[0].opportunityId).to.equal('existing-id');
    expect(mockExistingOpportunity.setAuditId).to.have.been.called;
    expect(mockExistingOpportunity.setUpdatedBy).to.have.been.calledWith('system');
    expect(mockExistingOpportunity.save).to.have.been.called;
    // Verify the log message contains "Updated" (tests line 667-670)
    expect(mockContext.log.info).to.have.been.calledWith(
      sinon.match(/Updated opportunity for a11y-assistive/),
    );
  });

  it('should successfully update existing opportunity with NEW status and return OPPORTUNITY_UPDATED', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const mockExistingOpportunity = {
      getId: sandbox.stub().returns('existing-id'),
      getType: sandbox.stub().returns('a11y-assistive'),
      getStatus: sandbox.stub().returns('NEW'),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(), // Key: this succeeds
      getSuggestions: sandbox.stub().resolves([]),
    };

    mockContext.dataAccess.Opportunity.allBySiteId.resolves([mockExistingOpportunity]);
    // Ensure syncSuggestions succeeds
    mockSyncSuggestions.resolves();

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_UPDATED'); // Tests line 674
    expect(result.opportunities[0].opportunityType).to.equal('a11y-assistive');
    expect(result.opportunities[0].opportunityId).to.equal('existing-id');
    // Verify the log message contains "Updated" (tests line 667)
    expect(mockContext.log.info).to.have.been.calledWith(
      sinon.match(/Updated opportunity for a11y-assistive/),
    );
  });

  it('should update first active opportunity found when multiple exist', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
                htmlWithIssues: ['<div aria-hidden="true"><button>Click</button></div>'],
                target: ['div[aria-hidden] button'],
              },
            },
          },
        },
      },
    };

    const mockFirstOpportunity = {
      getId: sandbox.stub().returns('first-id'),
      getType: sandbox.stub().returns('a11y-assistive'),
      getStatus: sandbox.stub().returns('NEW'),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getSuggestions: sandbox.stub().resolves([]),
    };

    const mockSecondOpportunity = {
      getId: sandbox.stub().returns('second-id'),
      getType: sandbox.stub().returns('a11y-assistive'),
      getStatus: sandbox.stub().returns('IN_PROGRESS'),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getSuggestions: sandbox.stub().resolves([]),
    };

    const mockIgnoredOpportunity = {
      getId: sandbox.stub().returns('ignored-id'),
      getType: sandbox.stub().returns('a11y-assistive'),
      getStatus: sandbox.stub().returns('IGNORED'),
    };

    // Return multiple opportunities - should pick the first active one (NEW or IN_PROGRESS)
    mockContext.dataAccess.Opportunity.allBySiteId.resolves([
      mockIgnoredOpportunity, // This should be skipped (IGNORED status)
      mockFirstOpportunity, // This should be selected (first active one)
      mockSecondOpportunity, // This should be ignored (not first)
    ]);
    mockSyncSuggestions.resolves();

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result).to.exist;
    if (result.status === 'OPPORTUNITIES_FAILED') {
      expect.fail(`Function failed with error: ${result.error}`);
    }
    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].opportunityId).to.equal('first-id');
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_UPDATED');
    // Verify that first active opportunity was updated
    expect(mockFirstOpportunity.setAuditId).to.have.been.called;
    expect(mockFirstOpportunity.save).to.have.been.called;
    // Verify second opportunity was not touched
    expect(mockSecondOpportunity.setAuditId).to.not.have.been.called;
  });
});

describe('createDirectMystiqueMessage', () => {
  it('should create a message object with all required fields', () => {
    const fakeOpportunity = { getId: () => 'oppty-123' };
    const issuesList = [{ type: 'color-contrast', description: 'desc' }];
    const siteId = 'site-789';
    const auditId = 'audit-101';
    const deliveryType = 'aem_edge';
    const result = generateIndividualOpportunitiesModule.createDirectMystiqueMessage({
      url: 'https://example.com',
      issuesList,
      opportunity: fakeOpportunity,
      siteId,
      auditId,
      deliveryType,
    });
    expect(result).to.include({
      type: 'guidance:accessibility-remediation',
      siteId,
      auditId,
      deliveryType,
    });
    expect(result.data).to.deep.equal({
      url: 'https://example.com',
      opportunityId: 'oppty-123',
      issuesList,
    });
    expect(result.time).to.be.a('string');
  });

  it('should default siteId and auditId to empty string if not provided', () => {
    const fakeOpportunity = { getId: () => 'oppty-123' };
    const issuesList = [];
    const result = generateIndividualOpportunitiesModule.createDirectMystiqueMessage({
      url: 'https://example.com',
      issuesList,
      opportunity: fakeOpportunity,
      siteId: undefined,
      auditId: undefined,
      deliveryType: 'aem_edge',
    });
    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('');
  });

  it('should default siteId and auditId to empty string when null', () => {
    const fakeOpportunity = { getId: () => 'oppty-456' };
    const issuesList = [];
    const result = generateIndividualOpportunitiesModule.createDirectMystiqueMessage({
      url: 'https://example.com',
      issuesList,
      opportunity: fakeOpportunity,
      siteId: null,
      auditId: null,
      deliveryType: 'aem_edge',
    });
    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('');
  });

  it('should default siteId and auditId to empty string when empty string', () => {
    const fakeOpportunity = { getId: () => 'oppty-789' };
    const issuesList = [];
    const result = generateIndividualOpportunitiesModule.createDirectMystiqueMessage({
      url: 'https://example.com',
      issuesList,
      opportunity: fakeOpportunity,
      siteId: '',
      auditId: '',
      deliveryType: 'aem_edge',
    });
    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('');
  });
});

describe('sendMessageToMystiqueForRemediation', () => {
  let sandbox;
  let mockOpportunity;
  let mockContext;
  let mockLog;
  let mockIsAuditEnabledForSite;
  let sendMessageToMystiqueForRemediation;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockOpportunity = {
      getId: sandbox.stub().returns('oppty-1'),
      getSiteId: sandbox.stub().returns('site-1'),
      getAuditId: sandbox.stub().returns('audit-1'),
      getSuggestions: sandbox.stub().resolves([]),
    };
    mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
    };
    mockIsAuditEnabledForSite = sandbox.stub().returns(true);
    mockContext = {
      site: {
        getId: sandbox.stub().returns('site-1'),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
      },
      auditId: 'audit-1',
      log: mockLog,
      dataAccess: {
        Opportunity: {
          findById: sandbox.stub().resolves(mockOpportunity),
        },
        Configuration: {
          findLatest: sandbox.stub().resolves({
            isHandlerEnabledForSite: mockIsAuditEnabledForSite,
          }),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        IMPORT_WORKER_QUEUE_URL: 'import-worker-queue',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };
    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });
    sendMessageToMystiqueForRemediation = module.sendMessageToMystiqueForRemediation;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should handle suggestions with no issues in debug logging', async () => {
    // Override getSuggestions to return data with no issues (falsy)
    mockOpportunity.getSuggestions = sandbox.stub().resolves([
      {
        getData: () => ({
          url: 'https://example.com/page1',
          issues: null,
        }),
        getStatus: () => 'NEW',
        getId: () => 'suggestion-1',
      },
      {
        getData: () => ({
          url: 'https://example.com/page2',
        }),
        getStatus: () => 'NEW',
        getId: () => 'suggestion-2',
      },
    ]);

    await sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    expect(mockLog.info).to.have.been.calledWith(
      '[A11yIndividual] No messages to send to Mystique - no matching issue types found',
    );
  });

  it('should handle SQS sendMessage errors', async () => {
    const sendMessageStub = sandbox.stub().rejects(new Error('SQS connection failed'));
    mockContext.sqs.sendMessage = sendMessageStub;

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com',
            issuesList: [{ issue_name: 'aria-allowed-attr' }],
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    await module.sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    expect(mockLog.debug).to.have.been.calledWithMatch(
      /Message sending completed: 0 successful, 1 failed, 0 rejected/,
    );
  });

  it('should skip when feature toggle is disabled', async () => {
    mockIsAuditEnabledForSite.withArgs('a11y-mystique-auto-suggest', sinon.match.any, sinon.match.any).resolves(false);

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    const result = await module.sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    expect(result).to.deep.equal({ success: true });
    expect(mockLog.info).to.have.been.calledWith('[A11yIndividual] Mystique suggestions are disabled for site, skipping message sending');
  });

  it('should use fallback logic for siteId and auditId', async () => {
    // Create opportunity without getSiteId/getAuditId methods
    const opportunityWithoutMethods = {
      getId: sandbox.stub().returns('oppty-1'),
      getSuggestions: sandbox.stub().resolves([]),
    };

    // Create context with fallback values
    const contextWithFallbacks = {
      site: {
        getId: sandbox.stub().returns('site-1'),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
      },
      auditId: undefined,
      audit: {
        getId: sandbox.stub().returns('audit-1'),
      },
      log: mockLog,
      dataAccess: {
        Opportunity: {
          findById: sandbox.stub().resolves(opportunityWithoutMethods),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        IMPORT_WORKER_QUEUE_URL: 'import-worker-queue',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    await module.sendMessageToMystiqueForRemediation(
      opportunityWithoutMethods,
      contextWithFallbacks,
      mockLog,
    );

    expect(mockLog.info).to.have.been.calledWith(
      '[A11yIndividual] No messages to send to Mystique - no matching issue types found',
    );
  });

  it('should handle missing SQS context gracefully', async () => {
    mockContext.sqs = null;
    mockContext.env = null;

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com',
            issuesList: [{ issue_name: 'aria-allowed-attr' }],
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    const result = await module.sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    expect(result.success).to.be.false;
    expect(result.error).to.equal('Missing SQS context or queue configuration');
    expect(mockLog.error).to.have.been.calledWithMatch('[A11yIndividual][A11yProcessingError] Missing required context');
  });

  it('should handle missing env.QUEUE_SPACECAT_TO_MYSTIQUE', async () => {
    mockContext.sqs = { sendMessage: sandbox.stub().resolves() };
    mockContext.env = {};

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com',
            issuesList: [{ issue_name: 'aria-allowed-attr' }],
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    const result = await module.sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    expect(result.success).to.be.false;
    expect(result.error).to.equal('Missing SQS context or queue configuration');
    expect(mockLog.error).to.have.been.calledWithMatch('[A11yIndividual][A11yProcessingError] Missing required context');
  });

  it('should process suggestions and send messages to Mystique', async () => {
    mockOpportunity.getSuggestions = sandbox.stub().resolves([
      {
        getData: () => ({
          url: 'https://example.com/page1',
          type: 'url',
          issues: [
            {
              type: 'color-contrast',
              occurrences: 5,
              htmlWithIssues: [
                {
                  target_selector: 'div[aria-fake]',
                },
              ],
            },
          ],
        }),
        getStatus: () => 'NEW',
        getId: () => 'suggestion-1',
      },
    ]);

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com',
            issuesList: [{ issue_name: 'aria-allowed-attr' }],
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    await module.sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    // The log message now says either "code fix" or "legacy" flow
    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/\[A11yIndividual\] Sending 1 messages to Mystique \(via (code fix|legacy) flow\)/),
    );
    expect(mockLog.debug).to.have.been.calledWithMatch(
      '[A11yIndividual] Message sending completed: 1 successful, 0 failed, 0 rejected',
    );
  });

  it('should send messages directly to Mystique with code info for code fix issues', async () => {
    const sendMessageSpy = sandbox.spy();
    mockContext.sqs.sendMessage = sendMessageSpy;
    mockOpportunity.getSuggestions = sandbox.stub().resolves([
      {
        getData: () => ({
          url: 'https://example.com/page1',
          type: 'url',
          issues: [
            {
              type: 'aria-allowed-attr',
              occurrences: 5,
              htmlWithIssues: [
                {
                  target_selector: 'div[aria-fake]',
                },
              ],
            },
          ],
        }),
        getStatus: () => 'NEW',
        getId: () => 'suggestion-1',
      },
    ]);

    const mockGetCodeInfo = sandbox.stub().resolves({
      codeBucket: 'test-importer-bucket',
      codePath: 'code/site-1/github/owner/repo/main/repository.zip',
    });

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com',
            issuesList: [{ issueName: 'aria-allowed-attr' }], // This is in issueTypesForCodeFix
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
      '../../../src/accessibility/utils/data-processing.js': {
        getCodeInfo: mockGetCodeInfo,
      },
    });

    await module.sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    // Verify message sent directly to Mystique (new flow)
    expect(sendMessageSpy).to.have.been.calledOnce;
    const [queueUrl, message] = sendMessageSpy.firstCall.args;
    
    // Verify correct queue URL (directly to Mystique)
    expect(queueUrl).to.equal('test-queue');
    
    // Verify message structure
    expect(message).to.have.property('type', 'guidance:accessibility-remediation');
    expect(message).to.have.property('siteId', 'site-1');
    expect(message).to.have.property('auditId', 'audit-1');
    expect(message).to.have.property('deliveryType', 'aem_edge');
    expect(message).to.have.property('data');
    expect(message.data).to.have.property('url', 'https://example.com');
    expect(message.data).to.have.property('opportunityId', 'oppty-1');
    expect(message.data).to.have.property('issuesList').that.is.an('array');
    
    // Verify codeBucket and codePath are included in the message data
    expect(message.data).to.have.property('codeBucket', 'test-importer-bucket');
    expect(message.data).to.have.property('codePath', 'code/site-1/github/owner/repo/main/repository.zip');
    
    // Verify getCodeInfo was called with correct parameters
    expect(mockGetCodeInfo).to.have.been.calledOnceWith(
      mockContext.site,
      'accessibility',
      mockContext,
    );
  });

  it('should send messages directly to Mystique for non-code-fix issues', async () => {
    const sendMessageSpy = sandbox.spy();
    mockContext.sqs.sendMessage = sendMessageSpy;
    mockOpportunity.getSuggestions = sandbox.stub().resolves([
      {
        getData: () => ({
          url: 'https://example.com/page1',
          type: 'url',
          issues: [
            {
              type: 'color-contrast',
              occurrences: 5,
              htmlWithIssues: [
                {
                  target_selector: 'div',
                },
              ],
            },
          ],
        }),
        getStatus: () => 'NEW',
        getId: () => 'suggestion-1',
      },
    ]);

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com',
            issuesList: [{ issueName: 'color-contrast' }], // This is NOT in issueTypesForCodeFix
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    await module.sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    // Verify message sent directly to Mystique (legacy flow)
    expect(sendMessageSpy).to.have.been.calledOnce;
    const [queueUrl, message] = sendMessageSpy.firstCall.args;
    
    // Verify correct queue URL (directly to Mystique for legacy flow)
    expect(queueUrl).to.equal('test-queue');
    
    // Verify message structure (direct Mystique message)
    expect(message).to.have.property('type', 'guidance:accessibility-remediation');
    expect(message).to.have.property('siteId', 'site-1');
    expect(message).to.have.property('auditId', 'audit-1');
    expect(message).to.have.property('deliveryType', 'aem_edge');
    expect(message).to.have.property('data');
    expect(message.data).to.have.property('url', 'https://example.com');
    expect(message.data).to.have.property('opportunityId', 'oppty-1');
    expect(message.data).to.have.property('issuesList').that.is.an('array');
    
    // In legacy flow, there's no forward configuration
    expect(message).to.not.have.property('forward');
  });

  it('should handle errors in main try block and throw with proper logging', async () => {
    // Make Opportunity.findById throw an error to trigger the catch block (lines 544-546)
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().rejects(new Error('Database connection lost'));

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    try {
      await module.sendMessageToMystiqueForRemediation(
        mockOpportunity,
        mockContext,
        mockLog,
      );
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error.message).to.equal('Database connection lost');
      expect(mockLog.error).to.have.been.calledWith(
        '[A11yProcessingError] Failed to send messages to Mystique for opportunity oppty-1: Database connection lost',
      );
    }
  });

});

describe('handleAccessibilityRemediationGuidance', () => {
  let testModule;
  let sandbox;
  let mockLog;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    testModule = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com/page1',
            issuesList: [
              { suggestionId: 'sugg-789' },
            ],
          },
        ]),
      },
    });
    mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should successfully process remediation guidance', async () => {
    const mockOpportunity = {
      getId: () => 'oppty-123',
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr',
                htmlWithIssues: [
                  {
                    update_from: '<div aria-label="test">Content</div>',
                    target_selector: 'div.test',
                    issue_id: 'issue-123',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-new-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
        ],
        totalIssues: 1,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: true,
      totalIssues: 1,
      pageUrl: 'https://example.com/page1',
      notFoundSuggestionIds: [],
      invalidRemediations: [],
      failedSuggestionIds: [],
    });

    expect(mockLog.debug).to.have.been.calledWith(
      '[A11yRemediationGuidance] site site-456, audit audit-new-123, page https://example.com/page1, opportunity oppty-123: Received accessibility remediation guidance with 1 remediations and 1 total issues',
    );
    expect(mockLog.debug).to.have.been.calledWith(
      '[A11yRemediationGuidance] site site-456, audit audit-new-123, page https://example.com/page1, opportunity oppty-123: Successfully processed 1 remediations',
    );

    expect(mockOpportunity.setAuditId).to.have.been.calledWith('audit-new-123');
    expect(mockOpportunity.setUpdatedBy).to.have.been.calledWith('system');
    expect(mockOpportunity.save).to.have.been.called;
  });

  it('should return error when opportunity not found', async () => {
    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(null),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-nonexistent',
        pageUrl: 'https://example.com/page1',
        remediations: [],
        totalIssues: 0,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: false,
      error: 'Opportunity not found',
    });

    expect(mockLog.error).to.have.been.calledWith(
      '[A11yRemediationGuidance][A11yProcessingError] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-nonexistent: Opportunity not found',
    );
  });

  it('should return error when site ID mismatch', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-different',
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [],
        totalIssues: 0,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: false,
      error: 'Site ID mismatch',
    });

    expect(mockLog.error).to.have.been.calledWith(
      '[A11yRemediationGuidance][A11yProcessingError] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: Site ID mismatch. Expected: site-456, Found: site-different',
    );
  });

  it('should return error when suggestion not found', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-different',
        },
      ]),
      setAuditId: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub().resolves(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
        ],
        totalIssues: 1,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: true,
      totalIssues: 1,
      pageUrl: 'https://example.com/page1',
      failedSuggestionIds: [],
      notFoundSuggestionIds: ['sugg-789'],
      invalidRemediations: [],
    });

    expect(mockLog.warn).to.have.been.calledWith(
      '[A11yRemediationGuidance] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: 1 suggestions not found: sugg-789',
    );
  });

  it('should handle issues without htmlWithIssues and return them unchanged', async () => {
    const originalIssue1 = {
      type: 'aria-allowed-attr',
      description: 'Issue without htmlWithIssues',
      // No htmlWithIssues property at all
    };

    const originalIssue2 = {
      type: 'color-contrast',
      description: 'Issue with null htmlWithIssues',
      htmlWithIssues: null,
    };

    const originalIssue3 = {
      type: 'image-alt',
      description: 'Issue with empty htmlWithIssues',
      htmlWithIssues: [],
    };

    const setDataSpy = sandbox.stub();

    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [originalIssue1, originalIssue2, originalIssue3],
          }),
          setData: setDataSpy,
          save: sandbox.stub().resolves(),
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'some-other-issue',
            general_suggestion: 'Some suggestion',
            update_to: '<div>Fixed</div>',
            user_impact: 'Some impact',
            suggestionId: 'sugg-789',
          },
        ],
        totalIssues: 1,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: true,
      totalIssues: 1,
      pageUrl: 'https://example.com/page1',
      notFoundSuggestionIds: [],
      invalidRemediations: [],
      failedSuggestionIds: [],
    });

    // Verify that setData was called with unchanged issues
    expect(setDataSpy).to.have.been.calledOnce;
    const updatedSuggestionData = setDataSpy.firstCall.args[0];

    // All issues should be returned unchanged since they don't have valid htmlWithIssues
    expect(updatedSuggestionData.issues).to.have.length(3);
    expect(updatedSuggestionData.issues[0]).to.deep.equal(originalIssue1);
    expect(updatedSuggestionData.issues[1]).to.deep.equal(originalIssue2);
    expect(updatedSuggestionData.issues[2]).to.deep.equal(originalIssue3);
  });

  it('should handle function errors and return error object', async () => {
    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().rejects(new Error('Database connection failed')),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [],
        totalIssues: 0,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: false,
      error: 'Database connection failed',
    });

    expect(mockLog.error).to.have.been.calledWith(
      '[A11yRemediationGuidance][A11yProcessingError] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: Failed to process accessibility remediation guidance: Database connection failed',
    );
  });

  it('should handle empty remediations array', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [],
        totalIssues: 0,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: true,
      totalIssues: 0,
      pageUrl: 'https://example.com/page1',
      notFoundSuggestionIds: [],
      invalidRemediations: [],
      failedSuggestionIds: [],
    });

    expect(mockLog.warn).to.have.been.calledWith(
      '[A11yRemediationGuidance] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: No remediations provided',
    );
  });

  it('should handle multiple remediations with unique suggestionIds', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr',
                htmlWithIssues: [
                  {
                    update_from: '<div aria-label="test">Content</div>',
                    target_selector: 'div.test',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
        {
          getId: () => 'sugg-790',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'color-contrast',
                htmlWithIssues: [
                  {
                    update_from: '<div style="color: #ccc">Content</div>',
                    target_selector: 'div.contrast',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
          {
            issue_name: 'color-contrast',
            general_suggestion: 'Improve color contrast',
            update_to: '<div style="color: #000">Content</div>',
            user_impact: 'Improves readability',
            suggestionId: 'sugg-790',
          },
        ],
        totalIssues: 2,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: true,
      totalIssues: 2,
      pageUrl: 'https://example.com/page1',
      notFoundSuggestionIds: [],
      invalidRemediations: [],
      failedSuggestionIds: [],
    });
  });

  it('should handle missing suggestionId in some remediations', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr',
                htmlWithIssues: [
                  {
                    update_from: '<div aria-label="test">Content</div>',
                    target_selector: 'div.test',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
          {
            issue_name: 'color-contrast',
            general_suggestion: 'Improve color contrast',
            update_to: '<div style="color: #000">Content</div>',
            user_impact: 'Improves readability',
            // Missing suggestionId
          },
        ],
        totalIssues: 2,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: true,
      totalIssues: 2,
      pageUrl: 'https://example.com/page1',
      notFoundSuggestionIds: [],
      invalidRemediations: [
        {
          issue_name: 'color-contrast',
          general_suggestion: 'Improve color contrast',
          update_to: '<div style="color: #000">Content</div>',
          user_impact: 'Improves readability',
        },
      ],
      failedSuggestionIds: [],
    });

    expect(mockLog.warn).to.have.been.calledWith(
      '[A11yRemediationGuidance] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: 1 remediations missing suggestionId',
    );
  });

  it('should handle all suggestions not found', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-different',
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
          {
            issue_name: 'color-contrast',
            general_suggestion: 'Improve color contrast',
            update_to: '<div style="color: #000">Content</div>',
            user_impact: 'Improves readability',
            suggestionId: 'sugg-790',
          },
        ],
        totalIssues: 2,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: true,
      totalIssues: 2,
      pageUrl: 'https://example.com/page1',
      notFoundSuggestionIds: ['sugg-789', 'sugg-790'],
      invalidRemediations: [],
      failedSuggestionIds: [],
    });

    expect(mockLog.warn).to.have.been.calledWith(
      '[A11yRemediationGuidance] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: 2 suggestions not found: sugg-789, sugg-790',
    );
  });

  it('should handle suggestion save failures', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr',
                htmlWithIssues: [
                  {
                    update_from: '<div aria-label="test">Content</div>',
                    target_selector: 'div.test',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().rejects(new Error('Database connection failed')),
        },
        {
          getId: () => 'sugg-790',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'color-contrast',
                htmlWithIssues: [
                  {
                    update_from: '<div style="color: #ccc">Content</div>',
                    target_selector: 'div.contrast',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
          {
            issue_name: 'color-contrast',
            general_suggestion: 'Improve color contrast',
            update_to: '<div style="color: #000">Content</div>',
            user_impact: 'Improves readability',
            suggestionId: 'sugg-790',
          },
        ],
        totalIssues: 2,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: true,
      totalIssues: 2,
      pageUrl: 'https://example.com/page1',
      notFoundSuggestionIds: [],
      invalidRemediations: [],
      failedSuggestionIds: ['sugg-789'],
    });

    expect(mockLog.error).to.have.been.calledWith(
      '[A11yRemediationGuidance][A11yProcessingError] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: Failed to save suggestion sugg-789: Error: Database connection failed',
    );
    expect(mockLog.warn).to.have.been.calledWith(
      '[A11yRemediationGuidance] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: 1 suggestions failed to save: sugg-789',
    );
    expect(mockLog.debug).to.have.been.calledWith(
      '[A11yRemediationGuidance] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: Successfully processed 1 remediations',
    );
  });

  it('should log success message when metrics are saved successfully', async () => {
    // Mock both the scrape-utils and mystique-data-processing modules
    // to ensure saveMystiqueValidationMetricsToS3 succeeds
    const mockScrapeUtils = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/utils/scrape-utils.js': {
        saveMystiqueValidationMetricsToS3: sandbox.stub().resolves(),
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com/page1',
            issuesList: [
              { suggestionId: 'sugg-789' },
            ],
          },
        ]),
      },
    });

    const mockOpportunity = {
      getId: () => 'oppty-123',
      getSiteId: () => 'site-456',
      getType: () => 'accessibility',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr',
                htmlWithIssues: [
                  {
                    update_from: '<div aria-label="test">Content</div>',
                    target_selector: 'div.test',
                    issue_id: 'issue-123',
                  },
                ],
              },
            ],
          }),
          getStatus: () => 'NEW',
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-new-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
        ],
        totalIssues: 1,
      },
    };

    const result = await mockScrapeUtils.handleAccessibilityRemediationGuidance(
      message,
      mockContext,
    );

    expect(result).to.deep.equal({
      success: true,
      totalIssues: 1,
      pageUrl: 'https://example.com/page1',
      notFoundSuggestionIds: [],
      invalidRemediations: [],
      failedSuggestionIds: [],
    });

    // Verify that the success log message for metrics saving was called (line 889)
    expect(mockLog.debug).to.have.been.calledWith(
      '[A11yRemediationGuidance] Saved complete Mystique validation metrics for opportunity oppty-123, page https://example.com/page1: sent=1, received=1',
    );
  });

  it('should handle error saving metrics to S3 gracefully', async () => {
    // Mock scrape-utils to reject when saving metrics
    const mockScrapeUtils = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/utils/scrape-utils.js': {
        saveMystiqueValidationMetricsToS3: sandbox.stub().rejects(new Error('S3 save failed')),
        saveOpptyWithRetry: sandbox.stub().resolves(),
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com/page1',
            issuesList: [
              { suggestionId: 'sugg-789' },
            ],
          },
        ]),
      },
    });

    const mockOpportunity = {
      getId: () => 'oppty-123',
      getSiteId: () => 'site-456',
      getType: () => 'a11y-assistive',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr',
                htmlWithIssues: [
                  {
                    update_from: '<div aria-label="test">Content</div>',
                    target_selector: 'div.test',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
        ],
        totalIssues: 1,
      },
    };

    const result = await mockScrapeUtils.handleAccessibilityRemediationGuidance(
      message,
      mockContext,
    );

    // Should still succeed even if metrics save fails
    expect(result.success).to.be.true;
    expect(mockLog.error).to.have.been.calledWith(
      '[A11yRemediationGuidance][A11yProcessingError] Failed to save Mystique validation metrics for opportunity oppty-123, page https://example.com/page1: S3 save failed',
    );
  });

  it('should handle snake_case remediation properties (general_suggestion, update_to, user_impact)', async () => {
    const mockSuggestion = {
      getId: () => 'sugg-789',
      getData: () => ({
        url: 'https://example.com/page1',
        issues: [
          {
            type: 'aria-allowed-attr',
            htmlWithIssues: [
              {
                update_from: '<div aria-label="test">Content</div>',
                target_selector: 'div.test',
              },
            ],
          },
        ],
      }),
      setData: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([mockSuggestion]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes', // snake_case
            update_to: '<div>Content</div>', // snake_case
            user_impact: 'Improves screen reader accessibility', // snake_case
            suggestionId: 'sugg-789',
          },
        ],
        totalIssues: 1,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result.success).to.be.true;
    expect(mockSuggestion.setData).to.have.been.called;
    const updatedData = mockSuggestion.setData.firstCall.args[0];
    expect(updatedData.issues[0].htmlWithIssues[0].guidance.generalSuggestion).to.equal('Remove disallowed ARIA attributes');
    expect(updatedData.issues[0].htmlWithIssues[0].guidance.updateTo).to.equal('<div>Content</div>');
    expect(updatedData.issues[0].htmlWithIssues[0].guidance.userImpact).to.equal('Improves screen reader accessibility');
  });

  it('should handle camelCase remediation properties (generalSuggestion, updateTo, userImpact)', async () => {
    const mockSuggestion = {
      getId: () => 'sugg-789',
      getData: () => ({
        url: 'https://example.com/page1',
        issues: [
          {
            type: 'aria-allowed-attr',
            htmlWithIssues: [
              {
                update_from: '<div aria-label="test">Content</div>',
                target_selector: 'div.test',
              },
            ],
          },
        ],
      }),
      setData: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([mockSuggestion]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            generalSuggestion: 'Remove disallowed ARIA attributes', // camelCase
            updateTo: '<div>Content</div>', // camelCase
            userImpact: 'Improves screen reader accessibility', // camelCase
            suggestionId: 'sugg-789',
          },
        ],
        totalIssues: 1,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result.success).to.be.true;
    expect(mockSuggestion.setData).to.have.been.called;
    const updatedData = mockSuggestion.setData.firstCall.args[0];
    expect(updatedData.issues[0].htmlWithIssues[0].guidance.generalSuggestion).to.equal('Remove disallowed ARIA attributes');
    expect(updatedData.issues[0].htmlWithIssues[0].guidance.updateTo).to.equal('<div>Content</div>');
    expect(updatedData.issues[0].htmlWithIssues[0].guidance.userImpact).to.equal('Improves screen reader accessibility');
  });

  it('should use saveOpptyWithRetry instead of direct save', async () => {
    const mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };
    const mockSaveOpptyWithRetry = sandbox.stub().resolves();
    const mockScrapeUtils = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/utils/scrape-utils.js': {
        saveMystiqueValidationMetricsToS3: sandbox.stub().resolves(),
        saveOpptyWithRetry: mockSaveOpptyWithRetry,
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com/page1',
            issuesList: [
              { suggestionId: 'sugg-789' },
            ],
          },
        ]),
      },
    });

    const mockOpportunity = {
      getId: () => 'oppty-123',
      getSiteId: () => 'site-456',
      getType: () => 'a11y-assistive',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr',
                htmlWithIssues: [
                  {
                    update_from: '<div aria-label="test">Content</div>',
                    target_selector: 'div.test',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
        ],
        totalIssues: 1,
      },
    };

    await mockScrapeUtils.handleAccessibilityRemediationGuidance(message, mockContext);

    // Verify saveOpptyWithRetry was called instead of opportunity.save()
    expect(mockSaveOpptyWithRetry).to.have.been.calledOnce;
    expect(mockSaveOpptyWithRetry).to.have.been.calledWith(
      mockOpportunity,
      'audit-123',
      mockDataAccess.Opportunity,
      mockLog,
    );
    expect(mockOpportunity.save).to.not.have.been.called;
  });

  it('should handle both fulfilled and rejected save results', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr',
                htmlWithIssues: [
                  {
                    update_from: '<div aria-label="test">Content</div>',
                    target_selector: 'div.test',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(), // First succeeds
        },
        {
          getId: () => 'sugg-790',
          getData: () => ({
            url: 'https://example.com/page2',
            issues: [
              {
                type: 'color-contrast',
                htmlWithIssues: [
                  {
                    update_from: '<div style="color: #ccc">Content</div>',
                    target_selector: 'div.contrast',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().rejects(new Error('Save failed')), // Second fails
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
            suggestionId: 'sugg-789',
          },
          {
            issue_name: 'color-contrast',
            general_suggestion: 'Improve color contrast',
            update_to: '<div style="color: #000">Content</div>',
            user_impact: 'Improves readability',
            suggestionId: 'sugg-790',
          },
        ],
        totalIssues: 2,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

      expect(result.success).to.be.true;
      expect(result.failedSuggestionIds).to.deep.equal(['sugg-790']);
      expect(mockLog.error).to.have.been.calledWith(
        '[A11yRemediationGuidance][A11yProcessingError] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: Failed to save suggestion sugg-790: Error: Save failed',
      );
      expect(mockLog.debug).to.have.been.calledWith(
        '[A11yRemediationGuidance] site site-456, audit audit-123, page https://example.com/page1, opportunity oppty-123: Successfully processed 1 remediations',
      );
  });

  it('should handle sendMystiqueMessage when useCodeFixFlow is undefined and context exists', async () => {
    const mockIsAuditEnabledForSite = sandbox.stub();
    mockIsAuditEnabledForSite.withArgs('a11y-mystique-auto-fix', sinon.match.any, sinon.match.any).resolves(true);
    mockIsAuditEnabledForSite.withArgs('a11y-mystique-auto-suggest', sinon.match.any, sinon.match.any).resolves(true);

    const sendMystiqueMessageModule = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
      '../../../src/accessibility/utils/data-processing.js': {
        getCodeInfo: sandbox.stub().resolves({
          codeBucket: 'test-bucket',
          codePath: 'test-path',
        }),
      },
    });

    const mockSqs = {
      sendMessage: sandbox.stub().resolves(),
    };
    const mockEnv = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
    };
    const mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };
    const mockOpportunity = {
      getId: sandbox.stub().returns('oppty-123'),
    };
    const mockContext = {
      site: { getId: sandbox.stub().returns('site-123') },
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      siteId: 'site-123',
      auditId: 'audit-456',
      deliveryType: 'aem_edge',
      aggregationKey: 'agg-key',
      sqs: mockSqs,
      env: mockEnv,
      log: mockLog,
      context: mockContext,
      useCodeFixFlow: undefined, // This should trigger the auto-detection logic
    };

    const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

    expect(result.success).to.be.true;
    expect(mockSqs.sendMessage).to.have.been.calledOnce;
    const sentMessage = mockSqs.sendMessage.firstCall.args[1];
    expect(sentMessage.data).to.have.property('codeBucket', 'test-bucket');
    expect(sentMessage.data).to.have.property('codePath', 'test-path');
  });

  it('should handle sendMystiqueMessage when codeInfo exists but codeBucket is missing', async () => {
    const mockIsAuditEnabledForSite = sandbox.stub();
    mockIsAuditEnabledForSite.withArgs('a11y-mystique-auto-fix', sinon.match.any, sinon.match.any).resolves(true);
    mockIsAuditEnabledForSite.withArgs('a11y-mystique-auto-suggest', sinon.match.any, sinon.match.any).resolves(true);

    const sendMystiqueMessageModule = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
      '../../../src/accessibility/utils/data-processing.js': {
        getCodeInfo: sandbox.stub().resolves({
          codePath: 'test-path', // Missing codeBucket
        }),
      },
    });

    const mockSqs = {
      sendMessage: sandbox.stub().resolves(),
    };
    const mockEnv = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
    };
    const mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };
    const mockOpportunity = {
      getId: sandbox.stub().returns('oppty-123'),
    };
    const mockContext = {
      site: { getId: sandbox.stub().returns('site-123') },
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      siteId: 'site-123',
      auditId: 'audit-456',
      deliveryType: 'aem_edge',
      aggregationKey: 'agg-key',
      sqs: mockSqs,
      env: mockEnv,
      log: mockLog,
      context: mockContext,
      useCodeFixFlow: true,
    };

    const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

    expect(result.success).to.be.true;
    expect(mockSqs.sendMessage).to.have.been.calledOnce;
    const sentMessage = mockSqs.sendMessage.firstCall.args[1];
    expect(sentMessage.data).to.not.have.property('codeBucket');
    expect(sentMessage.data).to.not.have.property('codePath');
  });

  it('should handle sendMessageToMystiqueForRemediation with fallback siteId from context.site', async () => {
    const mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };
    const mockIsAuditEnabledForSite = sandbox.stub().resolves(false);
    const opportunityWithoutGetSiteId = {
      getId: sandbox.stub().returns('oppty-1'),
      getSuggestions: sandbox.stub().resolves([]),
    };

    const contextWithSiteId = {
      site: {
        getId: sandbox.stub().returns('site-from-context'),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
      },
      auditId: 'audit-1',
      log: mockLog,
      dataAccess: {
        Opportunity: {
          findById: sandbox.stub().resolves(opportunityWithoutGetSiteId),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    await module.sendMessageToMystiqueForRemediation(
      opportunityWithoutGetSiteId,
      contextWithSiteId,
      mockLog,
    );

    expect(mockLog.info).to.have.been.calledWithMatch(
      /No messages to send to Mystique|Mystique suggestions are disabled/,
    );
  });

  it('should handle sendMessageToMystiqueForRemediation with fallback auditId from context.audit', async () => {
    const mockIsAuditEnabledForSite = sandbox.stub().resolves(true);
    const opportunityWithoutGetAuditId = {
      getId: sandbox.stub().returns('oppty-1'),
      getSiteId: sandbox.stub().returns('site-1'),
      getSuggestions: sandbox.stub().resolves([]),
    };

    const contextWithAuditId = {
      site: {
        getId: sandbox.stub().returns('site-1'),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
      },
      auditId: undefined,
      audit: {
        getId: sandbox.stub().returns('audit-from-context'),
      },
      log: mockLog,
      dataAccess: {
        Opportunity: {
          findById: sandbox.stub().resolves(opportunityWithoutGetAuditId),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    await module.sendMessageToMystiqueForRemediation(
      opportunityWithoutGetAuditId,
      contextWithAuditId,
      mockLog,
    );

    expect(mockLog.info).to.have.been.calledWith(
      '[A11yIndividual] No messages to send to Mystique - no matching issue types found',
    );
  });

  it('should handle sendMessageToMystiqueForRemediation with code fix eligible issues check', async () => {
    const mockIsAuditEnabledForSite = sandbox.stub();
    mockIsAuditEnabledForSite.withArgs('a11y-mystique-auto-fix', sinon.match.any, sinon.match.any).resolves(true);
    mockIsAuditEnabledForSite.withArgs('a11y-mystique-auto-suggest', sinon.match.any, sinon.match.any).resolves(true);

    const mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mockOpportunity = {
      getId: sandbox.stub().returns('oppty-123'),
      getSiteId: sandbox.stub().returns('site-456'),
      getAuditId: sandbox.stub().returns('audit-789'),
      getSuggestions: sandbox.stub().resolves([
        {
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr', // This is in issueTypesForCodeFix
                htmlWithIssues: [{ target_selector: 'div.test' }], // Has htmlWithIssues
              },
            ],
          }),
          getId: () => 'sugg-1',
        },
      ]),
    };

    const mockContext = {
      site: { getId: sandbox.stub().returns('site-123') },
      auditId: 'audit-456',
      log: mockLog,
      dataAccess: {
        Opportunity: {
          findById: sandbox.stub().resolves(mockOpportunity),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com',
            issuesList: [{ issueName: 'aria-allowed-attr' }],
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    await module.sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    expect(mockLog.debug).to.have.been.calledWith(
      sinon.match(/Code fix flow enabled: true, has eligible issues: true, using code fix flow: true/),
    );
  });

  it('should handle sendMessageToMystiqueForRemediation with rejected promises in results', async () => {
    const mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };
    const mockIsAuditEnabledForSite = sandbox.stub().resolves(true);

    const mockOpportunity = {
      getId: sandbox.stub().returns('oppty-123'),
      getSiteId: sandbox.stub().returns('site-456'),
      getAuditId: sandbox.stub().returns('audit-789'),
      getSuggestions: sandbox.stub().resolves([
        {
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [{ type: 'color-contrast' }],
          }),
          getId: () => 'sugg-1',
        },
      ]),
    };

    const sendMessageStub = sandbox.stub();
    sendMessageStub.onFirstCall().rejects(new Error('SQS error'));
    sendMessageStub.onSecondCall().resolves();
    
    const mockContext = {
      site: { getId: sandbox.stub().returns('site-123') },
      auditId: 'audit-456',
      log: mockLog,
      dataAccess: {
        Opportunity: {
          findById: sandbox.stub().resolves(mockOpportunity),
        },
      },
      sqs: {
        sendMessage: sendMessageStub,
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com/page1',
            issuesList: [{ issueName: 'color-contrast' }],
            aggregationKey: 'key1',
          },
          {
            url: 'https://example.com/page2',
            issuesList: [{ issueName: 'color-contrast' }],
            aggregationKey: 'key2',
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    await module.sendMessageToMystiqueForRemediation(
      mockOpportunity,
      mockContext,
      mockLog,
    );

    expect(mockLog.debug).to.have.been.calledWithMatch(
      /Message sending completed: 1 successful, 1 failed, 0 rejected/,
    );
  });

  it('should handle findOrCreateAccessibilityOpportunity with IN_PROGRESS status', async () => {
    const mockOpportunityInstance = {
      type: 'a11y-assistive',
    };
    const mockAuditData = {
      siteId: 'site-123',
      auditId: 'audit-456',
    };
    const existingOpportunity = {
      getType: sandbox.stub().returns('a11y-assistive'),
      getStatus: sandbox.stub().returns('IN_PROGRESS'),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        allBySiteId: sandbox.stub().resolves([existingOpportunity]),
        STATUSES: {
          NEW: 'NEW',
          IN_PROGRESS: 'IN_PROGRESS',
        },
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '@adobe/spacecat-shared-utils': mockTagMappings,
    });

    const result = await module.findOrCreateAccessibilityOpportunity(
      mockOpportunityInstance,
      mockAuditData,
      mockContext,
    );

    expect(result.isNew).to.be.false;
    expect(result.opportunity).to.equal(existingOpportunity);
    expect(existingOpportunity.setAuditId).to.have.been.calledWith('audit-456');
    expect(existingOpportunity.setUpdatedBy).to.have.been.calledWith('system');
    expect(existingOpportunity.save).to.have.been.called;
  });

  it('should handle createAccessibilityIndividualOpportunities with Updated opportunity', async () => {
    const existingOpportunity = {
      getId: sandbox.stub().returns('existing-opp-id'),
      getType: sandbox.stub().returns('a11y-assistive'),
      getStatus: sandbox.stub().returns('NEW'),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getSuggestions: sandbox.stub().resolves([]),
    };

    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                htmlWithIssues: ['<div>test</div>'],
                target: ['div.test'],
              },
            },
          },
        },
      },
    };

    const mockDataAccess = {
      Opportunity: {
        allBySiteId: sandbox.stub().resolves([existingOpportunity]),
        findById: sandbox.stub().resolves(existingOpportunity),
        create: sandbox.stub(),
        STATUSES: {
          NEW: 'NEW',
          IN_PROGRESS: 'IN_PROGRESS',
        },
      },
    };

    const mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mockSite = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getId: sandbox.stub().returns('site-123'),
    };

    const mockContext = {
      site: mockSite,
      log: mockLog,
      dataAccess: mockDataAccess,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
      sqs: {
        sendMessage: sandbox.stub().resolves({}),
      },
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '@adobe/spacecat-shared-utils': mockTagMappings,
      '../../../src/accessibility/utils/data-processing.js': {
        getAuditData: sandbox.stub().resolves({
          siteId: 'site-123',
          auditId: 'audit-456',
        }),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: sandbox.stub().resolves(false), // Disable mystique to skip that path
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([]),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(), // Mock syncSuggestions at import level
        keepSameDataFunction: (existing) => existing,
      },
    });

    const result = await module.createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.opportunities).to.have.lengthOf(1);
    expect(result.opportunities[0].status).to.equal('OPPORTUNITY_UPDATED');
    expect(result.opportunities[0].opportunityId).to.equal('existing-opp-id');
    expect(mockContext.log.info).to.have.been.calledWith(
      sinon.match(/Updated opportunity for a11y-assistive/),
    );
  });

  it('should handle handleAccessibilityRemediationGuidance with sent count calculation', async () => {
    const mockOpportunity = {
      getId: () => 'oppty-123',
      getSiteId: () => 'site-456',
      getType: () => 'a11y-assistive',
      getSuggestions: sandbox.stub().resolves([
        {
          getId: () => 'sugg-789',
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              {
                type: 'aria-allowed-attr',
                htmlWithIssues: [
                  {
                    update_from: '<div aria-label="test">Content</div>',
                    target_selector: 'div.test',
                  },
                ],
              },
            ],
          }),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
      ]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            suggestionId: 'sugg-789',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
          },
        ],
        totalIssues: 1,
      },
    };

    const mockScrapeUtils = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/utils/scrape-utils.js': {
        saveMystiqueValidationMetricsToS3: sandbox.stub().resolves(),
        saveOpptyWithRetry: sandbox.stub().resolves(),
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            url: 'https://example.com/page1',
            issuesList: [
              { suggestionId: 'sugg-789' },
            ],
          },
        ]),
      },
    });

    const result = await mockScrapeUtils.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result.success).to.be.true;
    expect(mockLog.debug).to.have.been.calledWith(
      '[A11yRemediationGuidance] Saved complete Mystique validation metrics for opportunity oppty-123, page https://example.com/page1: sent=1, received=1',
    );
  });

  it('should handle handleAccessibilityRemediationGuidance with issues without htmlWithIssues in mapping', async () => {
    const mockSuggestion = {
      getId: () => 'sugg-789',
      getData: () => ({
        url: 'https://example.com/page1',
        issues: [
          {
            type: 'aria-allowed-attr',
            // No htmlWithIssues property
          },
        ],
      }),
      setData: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockOpportunity = {
      getSiteId: () => 'site-456',
      getSuggestions: sandbox.stub().resolves([mockSuggestion]),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };

    const message = {
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            suggestionId: 'sugg-789',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
          },
        ],
        totalIssues: 1,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result.success).to.be.true;
    expect(mockSuggestion.setData).to.have.been.called;
    const updatedData = mockSuggestion.setData.firstCall.args[0];
    // Issue without htmlWithIssues should be returned unchanged
    expect(updatedData.issues[0]).to.not.have.property('htmlWithIssues');
  });
});

describe('createMystiqueForwardPayload', () => {
  beforeEach(async () => {
    // Ensure createMystiqueForwardPayload is imported
    if (!createMystiqueForwardPayload) {
      const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
        '@adobe/spacecat-shared-utils': mockTagMappings,
      });
      createMystiqueForwardPayload = module.createMystiqueForwardPayload;
    }
  });
  it('should create payload with valid siteId and auditId', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: 'site-456',
      auditId: 'audit-789',
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result).to.deep.include({
      type: 'guidance:accessibility-remediation',
      siteId: 'site-456',
      auditId: 'audit-789',
      deliveryType: 'aem-sites',
    });
    expect(result.data).to.deep.equal({
      aggregationKey: 'aggregation-key-123',
      url: 'https://example.com/page',
      opportunityId: 'opportunity-123',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
    });
    expect(result.time).to.be.a('string');
  });

  it('should default siteId to empty string when undefined', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: undefined,
      auditId: 'audit-789',
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('audit-789');
  });

  it('should default siteId to empty string when null', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: null,
      auditId: 'audit-789',
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('audit-789');
  });

  it('should default siteId to empty string when empty string', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: '',
      auditId: 'audit-789',
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('audit-789');
  });

  it('should default auditId to empty string when undefined', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: 'site-456',
      auditId: undefined,
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result.siteId).to.equal('site-456');
    expect(result.auditId).to.equal('');
  });

  it('should default auditId to empty string when null', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: 'site-456',
      auditId: null,
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result.siteId).to.equal('site-456');
    expect(result.auditId).to.equal('');
  });

  it('should default auditId to empty string when empty string', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: 'site-456',
      auditId: '',
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result.siteId).to.equal('site-456');
    expect(result.auditId).to.equal('');
  });

  it('should default both siteId and auditId to empty string when undefined', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: undefined,
      auditId: undefined,
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('');
  });

  it('should default both siteId and auditId to empty string when null', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: null,
      auditId: null,
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('');
  });

  it('should default both siteId and auditId to empty string when empty strings', () => {
    const mockOpportunity = {
      getId: () => 'opportunity-123',
    };

    const params = {
      url: 'https://example.com/page',
      issuesList: [{ issueName: 'aria-allowed-attr' }],
      opportunity: mockOpportunity,
      aggregationKey: 'aggregation-key-123',
      siteId: '',
      auditId: '',
      deliveryType: 'aem-sites',
    };

    const result = createMystiqueForwardPayload(params);

    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('');
  });
});

describe('sendMystiqueMessage', () => {
  let sandbox;
  let mockContext;
  let mockLog;
  let mockSqs;
  let mockEnv;
  let mockOpportunity;
  let mockIsAuditEnabledForSite;
  let mockGetCodeInfo;
  let sendMystiqueMessageModule;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    mockSqs = {
      sendMessage: sandbox.stub().resolves(),
    };

    mockEnv = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'test-mystique-queue',
      S3_IMPORTER_BUCKET_NAME: 'test-bucket',
    };

    mockOpportunity = {
      getId: sandbox.stub().returns('oppty-123'),
    };

    mockIsAuditEnabledForSite = sandbox.stub();
    mockGetCodeInfo = sandbox.stub();

    mockContext = {
      site: {
        getId: sandbox.stub().returns('site-123'),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
        getCode: sandbox.stub().returns({
          type: 'github',
          owner: 'test-owner',
          repo: 'test-repo',
          ref: 'main',
        }),
      },
      log: mockLog,
      sqs: mockSqs,
      env: mockEnv,
      s3Client: {},
    };

    // Mock the module with dependencies
    sendMystiqueMessageModule = await esmock(
      '../../../src/accessibility/utils/generate-individual-opportunities.js',
      {
        '../../../src/common/audit-utils.js': {
          isAuditEnabledForSite: mockIsAuditEnabledForSite,
        },
        '../../../src/accessibility/utils/data-processing.js': {
          getCodeInfo: mockGetCodeInfo,
        },
      },
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Legacy flow (without code fix)', () => {
    it('should send message to Mystique successfully when autoFixEnabled is false', async () => {
      mockIsAuditEnabledForSite.resolves(false);

      const params = {
        url: 'https://example.com/page1',
        issuesList: [{ issueName: 'color-contrast' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-1',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result).to.deep.equal({
        success: true,
        url: 'https://example.com/page1',
      });

      expect(mockSqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.type).to.equal('guidance:accessibility-remediation');
      expect(sentMessage.data).to.not.have.property('codeBucket');
      expect(sentMessage.data).to.not.have.property('codePath');
      expect(mockGetCodeInfo).to.not.have.been.called;
    });

    it('should send message to Mystique successfully when issue type does not require code fix', async () => {
      mockIsAuditEnabledForSite.resolves(true);

      const params = {
        url: 'https://example.com/page2',
        issuesList: [{ issueName: 'color-contrast' }, { issueName: 'heading-order' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-2',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result).to.deep.equal({
        success: true,
        url: 'https://example.com/page2',
      });

      expect(mockSqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data).to.not.have.property('codeBucket');
      expect(sentMessage.data).to.not.have.property('codePath');
      expect(mockGetCodeInfo).to.not.have.been.called;
    });

    it('should return error when SQS sendMessage fails in legacy flow', async () => {
      mockIsAuditEnabledForSite.resolves(false);
      mockSqs.sendMessage.rejects(new Error('SQS connection failed'));

      const params = {
        url: 'https://example.com/page3',
        issuesList: [{ issueName: 'color-contrast' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-3',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result).to.deep.equal({
        success: false,
        url: 'https://example.com/page3',
        error: 'SQS connection failed',
      });

      expect(mockLog.error).to.have.been.calledWithMatch(
        /\[A11yIndividual\]\[A11yProcessingError\] Failed to send message to Mystique for url https:\/\/example\.com\/page3 with error: SQS connection failed/,
      );
    });
  });

  describe('Code fix flow', () => {
    it('should send message with codeBucket and codePath when code fix is enabled and code info is available', async () => {
      mockIsAuditEnabledForSite.resolves(true);
      mockGetCodeInfo.resolves({
        codeBucket: 'test-bucket',
        codePath: 'code/site-123/github/test-owner/test-repo/main/repository.zip',
      });

      const params = {
        url: 'https://example.com/page4',
        issuesList: [{ issueName: 'aria-allowed-attr' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-4',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result).to.deep.equal({
        success: true,
        url: 'https://example.com/page4',
      });

      expect(mockGetCodeInfo).to.have.been.calledOnceWith(
        mockContext.site,
        'accessibility',
        mockContext,
      );

      expect(mockSqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.type).to.equal('guidance:accessibility-remediation');
      expect(sentMessage.data.codeBucket).to.equal('test-bucket');
      expect(sentMessage.data.codePath).to.equal('code/site-123/github/test-owner/test-repo/main/repository.zip');
    });

    it('should send message without code info when codePath is empty string (falsy)', async () => {
      mockIsAuditEnabledForSite.resolves(true);
      mockGetCodeInfo.resolves({
        codeBucket: 'test-bucket',
        codePath: '',
      });

      const params = {
        url: 'https://example.com/page5',
        issuesList: [{ issueName: 'aria-required-attr' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-5',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result).to.deep.equal({
        success: true,
        url: 'https://example.com/page5',
      });

      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      // Empty string is falsy, so code info is not added
      expect(sentMessage.data).to.not.have.property('codeBucket');
      expect(sentMessage.data).to.not.have.property('codePath');
    });

    it('should send message without code info when getCodeInfo returns null', async () => {
      mockIsAuditEnabledForSite.resolves(true);
      mockGetCodeInfo.resolves(null);

      const params = {
        url: 'https://example.com/page6',
        issuesList: [{ issueName: 'button-name' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'other',
        aggregationKey: 'agg-key-6',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result).to.deep.equal({
        success: true,
        url: 'https://example.com/page6',
      });

      expect(mockGetCodeInfo).to.have.been.calledOnce;
      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data).to.not.have.property('codeBucket');
      expect(sentMessage.data).to.not.have.property('codePath');
    });

    it('should send message without code info when getCodeInfo returns undefined', async () => {
      mockIsAuditEnabledForSite.resolves(true);
      mockGetCodeInfo.resolves(undefined);

      const params = {
        url: 'https://example.com/page7',
        issuesList: [{ issueName: 'link-name' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-7',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result).to.deep.equal({
        success: true,
        url: 'https://example.com/page7',
      });

      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data).to.not.have.property('codeBucket');
      expect(sentMessage.data).to.not.have.property('codePath');
    });

    it('should not add code info when only codeBucket is present (codePath is missing)', async () => {
      mockIsAuditEnabledForSite.resolves(true);
      mockGetCodeInfo.resolves({
        codeBucket: 'test-bucket',
      });

      const params = {
        url: 'https://example.com/page8',
        issuesList: [{ issueName: 'aria-roles' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-8',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result.success).to.be.true;

      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data).to.not.have.property('codeBucket');
      expect(sentMessage.data).to.not.have.property('codePath');
    });

    it('should not add code info when only codePath is present (codeBucket is missing)', async () => {
      mockIsAuditEnabledForSite.resolves(true);
      mockGetCodeInfo.resolves({
        codePath: 'code/site-123/github/test-owner/test-repo/main/repository.zip',
      });

      const params = {
        url: 'https://example.com/page9',
        issuesList: [{ issueName: 'select-name' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-9',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result.success).to.be.true;

      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data).to.not.have.property('codeBucket');
      expect(sentMessage.data).to.not.have.property('codePath');
    });

    it('should handle multiple issue types eligible for code fix', async () => {
      mockIsAuditEnabledForSite.resolves(true);
      mockGetCodeInfo.resolves({
        codeBucket: 'test-bucket',
        codePath: 'code/site-123/github/test-owner/test-repo/main/repository.zip',
      });

      const params = {
        url: 'https://example.com/page10',
        issuesList: [
          { issueName: 'aria-allowed-attr' },
          { issueName: 'aria-required-attr' },
          { issueName: 'button-name' },
        ],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-10',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result.success).to.be.true;
      expect(mockGetCodeInfo).to.have.been.calledOnce;

      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.codeBucket).to.equal('test-bucket');
      expect(sentMessage.data.codePath).to.equal('code/site-123/github/test-owner/test-repo/main/repository.zip');
    });

    it('should return error when SQS sendMessage fails in code fix flow', async () => {
      mockIsAuditEnabledForSite.resolves(true);
      mockGetCodeInfo.resolves({
        codeBucket: 'test-bucket',
        codePath: 'code/site-123/github/test-owner/test-repo/main/repository.zip',
      });
      mockSqs.sendMessage.rejects(new Error('Network timeout'));

      const params = {
        url: 'https://example.com/page11',
        issuesList: [{ issueName: 'aria-prohibited-attr' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-11',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result).to.deep.equal({
        success: false,
        url: 'https://example.com/page11',
        error: 'Network timeout',
      });

      expect(mockLog.error).to.have.been.calledWithMatch(
        /\[A11yIndividual\]\[A11yProcessingError\] Failed to send message to Mystique for url https:\/\/example\.com\/page11 with error: Network timeout/,
      );
    });

    it('should handle getCodeInfo throwing an error gracefully', async () => {
      mockIsAuditEnabledForSite.resolves(true);
      mockGetCodeInfo.rejects(new Error('S3 access denied'));

      const params = {
        url: 'https://example.com/page12',
        issuesList: [{ issueName: 'aria-hidden-focus' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-12',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      await expect(sendMystiqueMessageModule.sendMystiqueMessage(params)).to.be.rejectedWith('S3 access denied');
    });
  });

  describe('Message structure validation', () => {
    it('should create correct message structure with all required fields', async () => {
      mockIsAuditEnabledForSite.resolves(false);

      const params = {
        url: 'https://example.com/page13',
        issuesList: [{ issueName: 'color-contrast', details: 'Low contrast' }],
        opportunity: mockOpportunity,
        siteId: 'site-789',
        auditId: 'audit-999',
        deliveryType: 'aem_cs',
        aggregationKey: 'agg-key-13',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(mockSqs.sendMessage).to.have.been.calledOnce;
      const [queueUrl, message] = mockSqs.sendMessage.firstCall.args;

      expect(queueUrl).to.equal('test-mystique-queue');
      expect(message).to.have.property('type', 'guidance:accessibility-remediation');
      expect(message).to.have.property('siteId', 'site-789');
      expect(message).to.have.property('auditId', 'audit-999');
      expect(message).to.have.property('deliveryType', 'aem_cs');
      expect(message).to.have.property('time');
      expect(message).to.have.property('aggregationKey', 'agg-key-13');
      expect(message.data).to.deep.include({
        url: 'https://example.com/page13',
        opportunityId: 'oppty-123',
        issuesList: [{ issueName: 'color-contrast', details: 'Low contrast' }],
      });
    });

    it('should handle empty siteId and auditId gracefully', async () => {
      mockIsAuditEnabledForSite.resolves(false);

      const params = {
        url: 'https://example.com/page14',
        issuesList: [{ issueName: 'heading-order' }],
        opportunity: mockOpportunity,
        siteId: '',
        auditId: '',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-14',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result.success).to.be.true;

      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.siteId).to.equal('');
      expect(sentMessage.auditId).to.equal('');
    });

    it('should include timestamp in ISO format', async () => {
      mockIsAuditEnabledForSite.resolves(false);
      const beforeTime = new Date().toISOString();

      const params = {
        url: 'https://example.com/page15',
        issuesList: [{ issueName: 'image-alt' }],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-15',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      await sendMystiqueMessageModule.sendMystiqueMessage(params);

      const afterTime = new Date().toISOString();
      const sentMessage = mockSqs.sendMessage.firstCall.args[1];

      expect(sentMessage.time).to.be.a('string');
      expect(sentMessage.time).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(sentMessage.time >= beforeTime).to.be.true;
      expect(sentMessage.time <= afterTime).to.be.true;
    });
  });

  describe('Edge cases', () => {
    it('should handle empty issuesList', async () => {
      mockIsAuditEnabledForSite.resolves(true);

      const params = {
        url: 'https://example.com/page16',
        issuesList: [],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-16',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result.success).to.be.true;
      expect(mockGetCodeInfo).to.not.have.been.called;

      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.issuesList).to.deep.equal([]);
    });

    it('should handle issuesList with mixed code-fix and non-code-fix issues', async () => {
      mockIsAuditEnabledForSite.resolves(true);

      const params = {
        url: 'https://example.com/page17',
        issuesList: [
          { issueName: 'aria-allowed-attr' },
          { issueName: 'color-contrast' },
        ],
        opportunity: mockOpportunity,
        siteId: 'site-123',
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
        aggregationKey: 'agg-key-17',
        sqs: mockSqs,
        env: mockEnv,
        log: mockLog,
        context: mockContext,
      };

      const result = await sendMystiqueMessageModule.sendMystiqueMessage(params);

      expect(result.success).to.be.true;
      // Should not use code fix flow because not all issues are code-fix eligible
      expect(mockGetCodeInfo).to.not.have.been.called;

      const sentMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data).to.not.have.property('codeBucket');
      expect(sentMessage.data).to.not.have.property('codePath');
    });
  });
});
});