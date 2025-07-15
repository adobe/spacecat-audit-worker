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
import {
  formatWcagRule,
  formatIssue,
  aggregateAccessibilityIssues,
  createIndividualOpportunity,
  deleteExistingAccessibilityOpportunities,
  calculateAccessibilityMetrics,
} from '../../../src/accessibility/utils/generate-individual-opportunities.js';
import * as constants from '../../../src/accessibility/utils/constants.js';
import * as generateIndividualOpportunitiesModule from '../../../src/accessibility/utils/generate-individual-opportunities.js';

const { expect } = chai;

// Configure Chai
chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('formatWcagRule', () => {
  let sandbox;
  let originalSuccessCriteriaLinks;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Deep clone to preserve original values and structure
    originalSuccessCriteriaLinks = JSON.parse(JSON.stringify(constants.successCriteriaLinks));
  });

  afterEach(() => {
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
});

describe('formatIssue', () => {
  let sandbox;
  let originalSuccessCriteriaLinks;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    originalSuccessCriteriaLinks = JSON.parse(JSON.stringify(constants.successCriteriaLinks));
    // Add some test WCAG rules
    constants.successCriteriaLinks['412'] = { name: 'Name, Role, Value' };
    constants.successCriteriaLinks['111'] = { name: 'Non-text Content' };
  });

  afterEach(() => {
    Object.keys(constants.successCriteriaLinks).forEach((key) => {
      delete constants.successCriteriaLinks[key];
    });
    Object.assign(constants.successCriteriaLinks, originalSuccessCriteriaLinks);
    sandbox.restore();
  });

  it('should format critical severity issues', () => {
    const result = formatIssue('color-contrast', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      level: 'AA',
      count: 5,
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
      wcagLevel: 'AA',
      severity: 'critical',
      occurrences: 5,
      htmlWithIssues: [
        {
          update_from: '',
          target_selector: '',
          issue_id: result.htmlWithIssues[0].issue_id, // Use the generated UUID
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
    expect(result.htmlWithIssues[0].issue_id).to.be.a('string');
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
      wcagLevel: '',
      severity: 'critical',
      occurrences: 0,
      htmlWithIssues: [
        {
          update_from: '',
          target_selector: '',
          issue_id: result.htmlWithIssues[0].issue_id,
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
      wcagLevel: '',
      severity: 'critical',
      occurrences: 0,
      htmlWithIssues: [
        {
          update_from: '',
          target_selector: '',
          issue_id: result.htmlWithIssues[0].issue_id,
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
      wcagLevel: '',
      severity: 'critical',
      occurrences: 0,
      htmlWithIssues: [
        {
          update_from: '',
          target_selector: '',
          issue_id: result.htmlWithIssues[0].issue_id,
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
      wcagLevel: '', // Should default to empty string
      severity: 'critical',
      occurrences: 0, // Should default to 0
      htmlWithIssues: [
        {
          update_from: '', // Should default to empty string
          target_selector: '', // Uses targetSelector from issueData.target (empty in this case)
          issue_id: result.htmlWithIssues[0].issue_id, // Should generate UUID
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
      wcagLevel: '', // Should default to empty string
      severity: 'critical',
      occurrences: 0, // Should default to 0
      htmlWithIssues: [
        {
          update_from: '', // Should default to empty string
          target_selector: '', // Should default to empty string
          issue_id: result.htmlWithIssues[0].issue_id, // Should generate UUID
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
          issue_id: 'existing-uuid',
          some_other_prop: 'value',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.equal('existing-uuid');
  });

  it('should handle htmlWithIssues with undefined update_from property (line 207 fallback)', () => {
    // This test targets line 207 - the final fallback to empty string
    // when item.update_from is undefined
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          // Object with undefined update_from (not even null)
          issue_id: 'test-uuid',
          // update_from is undefined (not present)
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.equal('test-uuid');
  });

  it('should handle htmlWithIssues with empty string update_from (line 207 fallback)', () => {
    // This test targets line 207 - the final fallback to empty string
    // when item.update_from is an empty string (falsy)
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: '', // Empty string (falsy)
          issue_id: 'test-uuid',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.equal('test-uuid');
  });

  it('should handle htmlWithIssues with object without update_from (line 208)', () => {
    // This test verifies line 208 - the final fallback to empty string
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        { issue_id: 'test-uuid' }, // Object without update_from
      ],
    }, 'critical');

    // Should fallback to empty string since no update_from is present (line 208)
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.equal('test-uuid');
  });

  it('should handle htmlWithIssues with object having falsy update_from (line 208)', () => {
    // This test also targets line 208 with a falsy update_from value
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          issue_id: 'test-uuid',
          update_from: null, // Falsy update_from
        },
      ],
    }, 'critical');

    // Should fallback to empty string since update_from is falsy (line 208)
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.equal('test-uuid');
  });

  it('should handle htmlWithIssues with empty object (line 208)', () => {
    // This test specifically targets line 208 with an empty object
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {}, // Empty object - no issue_id or update_from
      ],
    }, 'critical');

    // Should fallback to empty string and generate UUID (line 208)
    expect(result.htmlWithIssues).to.have.length(1);
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.be.a('string'); // Generated UUID
  });

  it('should handle htmlWithIssues with null item (line 208)', () => {
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
    expect(result.htmlWithIssues[0].issue_id).to.be.a('string'); // Generated UUID
  });

  it('should handle htmlWithIssues with undefined item (line 208)', () => {
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
    expect(result.htmlWithIssues[0].issue_id).to.be.a('string'); // Generated UUID
  });

  it('should handle htmlWithIssues with false item (line 208)', () => {
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
    expect(result.htmlWithIssues[0].issue_id).to.be.a('string'); // Generated UUID
  });

  it('should handle htmlWithIssues with object missing update_from (final fallback)', () => {
    // This test targets the final fallback when no update_from is available
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          // Object without update_from property
          issue_id: 'test-uuid',
          other_prop: 'value',
        },
      ],
    }, 'critical');

    // Should use the final fallback to empty string
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.equal('test-uuid');
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
    expect(result.htmlWithIssues[0].issue_id).to.be.a('string'); // Should generate UUID for string items
  });

  it('should handle htmlWithIssues with null values triggering all fallbacks', () => {
    // This test ensures all fallback paths are covered
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: null, // Falsy value
          issue_id: null, // Falsy value to test issue_id fallback too
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.be.a('string'); // Should generate UUID
  });

  it('should handle htmlWithIssues with false values (line 207)', () => {
    // This test specifically targets line 207 - the final || ''
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: false, // Falsy but not null/undefined
          issue_id: 'test-uuid',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.equal('test-uuid');
  });

  it('should handle htmlWithIssues with zero values (line 205)', () => {
    // This test specifically targets line 205 - the final || ''
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: 0, // Falsy number
          issue_id: 'test-uuid',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.equal('test-uuid');
  });

  it('should handle htmlWithIssues with NaN values (line 205)', () => {
    // This test specifically targets line 205 - the final || '' fallback
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      htmlWithIssues: [
        {
          update_from: NaN, // Falsy NaN value
          issue_id: 'test-uuid',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('');
    expect(result.htmlWithIssues[0].issue_id).to.equal('test-uuid');
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
    expect(result.htmlWithIssues[0].issue_id).to.be.a('string');
    expect(result.htmlWithIssues[1].update_from).to.equal('<span>another string</span>');
    expect(result.htmlWithIssues[1].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[1].issue_id).to.be.a('string');
  });

  it('should process htmlWithIssues with object items that have update_from', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: [
        {
          update_from: '<div>object with update_from</div>',
          issue_id: 'existing-uuid-1',
        },
        {
          update_from: '<span>another object</span>',
          issue_id: 'existing-uuid-2',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues).to.have.length(2);
    expect(result.htmlWithIssues[0].update_from).to.equal('<div>object with update_from</div>');
    expect(result.htmlWithIssues[0].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[0].issue_id).to.equal('existing-uuid-1');
    expect(result.htmlWithIssues[1].update_from).to.equal('<span>another object</span>');
    expect(result.htmlWithIssues[1].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[1].issue_id).to.equal('existing-uuid-2');
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
          issue_id: 'existing-uuid',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues).to.have.length(2);
    expect(result.htmlWithIssues[0].update_from).to.equal('<div>string item</div>');
    expect(result.htmlWithIssues[0].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[0].issue_id).to.be.a('string'); // Generated UUID for string
    expect(result.htmlWithIssues[1].update_from).to.equal('<span>object item</span>');
    expect(result.htmlWithIssues[1].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[1].issue_id).to.equal('existing-uuid');
  });

  it('should handle htmlWithIssues with objects without update_from (triggers line 208)', () => {
    const result = formatIssue('aria-allowed-attr', {
      successCriteriaTags: ['wcag412'],
      description: 'Test description',
      target: ['div.test'],
      htmlWithIssues: [
        {
          // No update_from property
          issue_id: 'existing-uuid',
        },
        {
          update_from: null, // Null update_from
          issue_id: 'another-uuid',
        },
        {
          update_from: '', // Empty string update_from
          issue_id: 'third-uuid',
        },
      ],
    }, 'critical');

    expect(result.htmlWithIssues).to.have.length(3);
    // All should have empty string update_from due to line 208
    expect(result.htmlWithIssues[0].update_from).to.equal('');
    expect(result.htmlWithIssues[0].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[0].issue_id).to.equal('existing-uuid');
    expect(result.htmlWithIssues[1].update_from).to.equal('');
    expect(result.htmlWithIssues[1].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[1].issue_id).to.equal('another-uuid');
    expect(result.htmlWithIssues[2].update_from).to.equal('');
    expect(result.htmlWithIssues[2].target_selector).to.equal('div.test');
    expect(result.htmlWithIssues[2].issue_id).to.equal('third-uuid');
  });
});

describe('aggregateAccessibilityIssues', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return empty data array for null input', () => {
    const result = aggregateAccessibilityIssues(null);
    expect(result).to.deep.equal({ data: [] });
  });

  it('should return empty data array for undefined input', () => {
    const result = aggregateAccessibilityIssues(undefined);
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
    const result = aggregateAccessibilityIssues(input);
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
                count: 5,
              },
            },
          },
        },
      },
    };

    const result = aggregateAccessibilityIssues(input);
    expect(result.data).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive']).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com');
    expect(result.data[0]['a11y-assistive'][0].issues).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].issues[0].type).to.equal('aria-hidden-focus');
    expect(result.data[0]['a11y-assistive'][0].issues[0].severity).to.equal('critical');
    expect(result.data[0]['a11y-assistive'][0].issues[0].occurrences).to.equal(5);
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
                count: 3,
              },
            },
          },
        },
      },
    };

    const result = aggregateAccessibilityIssues(input);
    expect(result.data).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive']).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com');
    expect(result.data[0]['a11y-assistive'][0].issues).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].issues[0].type).to.equal('aria-hidden-focus');
    expect(result.data[0]['a11y-assistive'][0].issues[0].severity).to.equal('serious');
    expect(result.data[0]['a11y-assistive'][0].issues[0].occurrences).to.equal(3);
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
                count: 2,
              },
            },
          },
          serious: {
            items: {
              'aria-hidden-focus': {
                description: 'Serious issue',
                successCriteriaTags: ['wcag412'],
                count: 1,
              },
            },
          },
        },
      },
    };

    const result = aggregateAccessibilityIssues(input);
    expect(result.data).to.have.lengthOf(1);
    const opportunity = result.data[0];
    expect(opportunity['a11y-assistive']).to.have.lengthOf(1);
    expect(opportunity['a11y-assistive'][0].issues).to.have.lengthOf(2);
    expect(opportunity['a11y-assistive'][0].issues[0].severity).to.equal('critical');
    expect(opportunity['a11y-assistive'][0].issues[1].severity).to.equal('serious');
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
                count: 2,
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
                count: 3,
              },
            },
          },
        },
      },
    };

    const result = aggregateAccessibilityIssues(input);
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
                count: 5,
              },
            },
          },
          serious: { items: {} },
        },
      },
    };

    const result = aggregateAccessibilityIssues(input);
    expect(result.data).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive']).to.have.lengthOf(1);
    expect(result.data[0]['a11y-assistive'][0].url).to.equal('https://example.com/page2');
  });

  it('should handle missing violations object', () => {
    const input = {
      'https://example.com': {},
    };

    const result = aggregateAccessibilityIssues(input);
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

    const result = aggregateAccessibilityIssues(input);
    expect(result.data).to.be.empty;
  });
});

describe('createIndividualOpportunity', () => {
  let sandbox;
  let mockOpportunity;
  let mockContext;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
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

  afterEach(() => {
    sandbox.restore();
  });

  it('should create an opportunity with correct data', async () => {
    const opportunityInstance = {
      runbook: 'test-runbook',
      type: 'test-type',
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
      type: 'test-type',
      origin: 'test-origin',
      title: 'test-title',
      description: 'test-description',
      tags: ['test-tag'],
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
      'Failed to create new opportunity for siteId test-site and auditId test-audit: Test error',
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
    expect(callArgs.log).to.equal(mockContext.log);
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
      'Failed to create suggestions for opportunity test-id: Test error',
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
            },
            {
              type: 'image-alt',
              occurrences: 3,
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

    expect(result).to.deep.equal({
      opportunityId: 'test-id',
      type: 'CODE_CHANGE',
      rank: 8, // 5 + 3 occurrences
      data: {
        url: 'https://example.com/page1',
        type: 'url',
        issues: [
          {
            type: 'color-contrast',
            occurrences: 5,
          },
          {
            type: 'image-alt',
            occurrences: 3,
          },
        ],
        isCreateTicketClicked: false,
      },
    });
  });

  it('should call buildKey function correctly', async () => {
    const aggregatedData = {
      data: [
        {
          url: 'https://example.com/page1',
          type: 'url',
          issues: [],
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

    expect(result).to.equal('https://example.com/page1');
  });

  it('should handle suggestions with no issues in debug logging', async () => {
    // Override getSuggestions to return data with no issues (falsy)
    mockOpportunity.getSuggestions = sandbox.stub().resolves([
      {
        getData: () => ({
          url: 'https://example.com/page1',
          issues: null, // This will trigger the else branch in the ternary operator
        }),
      },
      {
        getData: () => ({
          url: 'https://example.com/page2',
          // no issues property at all - should be undefined
        }),
      },
    ]);

    const aggregatedData = {
      data: [
        { url: 'https://example.com', type: 'url', issues: [] },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    // The function should complete without errors when handling suggestions with no issues
    expect(mockLog.info).to.have.been.calledWith(
      '[A11yIndividual] No messages to send to Mystique - no matching issue types found',
    );
  });

  it('should handle SQS sendMessage errors in sendMystiqueMessage', async () => {
    // Override getSuggestions to return data that will trigger message sending
    mockOpportunity.getSuggestions = sandbox.stub().resolves([]);

    // Mock sendMessage to throw an error
    const sendMessageStub = sandbox.stub().rejects(new Error('SQS connection failed'));
    mockContext.sqs.sendMessage = sendMessageStub;

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            suggestion: { getId: () => 'sugg-1' },
            suggestionData: { url: 'https://example.com', suggestionId: 'sugg-1' },
            issueType: 'aria-allowed-attr',
            issuesList: [{ issue_name: 'aria-allowed-attr' }],
          },
        ]),
      },
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: mockIsAuditEnabledForSite,
      },
    });

    const testFunction = module.createIndividualOpportunitySuggestions;

    const aggregatedData = {
      data: [
        { url: 'https://example.com', type: 'url', issues: [] },
      ],
    };

    await testFunction(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    // Should log the completion summary with failed messages
    expect(mockLog.info).to.have.been.calledWithMatch(
      /Message sending completed: 0 successful, 1 failed, 0 rejected/,
    );
  });

  it('should skip mystique suggestions and log when feature toggle is disabled', async () => {
    mockIsAuditEnabledForSite.withArgs('a11y-mystique-auto-suggest', sinon.match.any, sinon.match.any).resolves(false);
    const result = await createIndividualOpportunitySuggestions(
      mockOpportunity,
      { data: [] }, // aggregatedData cu proprietatea data
      mockContext,
      mockLog,
    );
    expect(result).to.deep.equal({ success: true });
    expect(mockLog.info).to.have.been.calledWith('[A11yIndividual] Mystique suggestions are disabled for site, skipping message sending');
  });
});

describe('deleteExistingAccessibilityOpportunities', () => {
  let sandbox;
  let mockLog;
  let mockDataAccess;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
    };
    mockDataAccess = {
      Opportunity: {
        allBySiteId: sandbox.stub(),
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should delete existing opportunities of specified type', async () => {
    const mockOpportunity = {
      getId: sandbox.stub().returns('test-id'),
      remove: sandbox.stub().resolves(),
      getType: sandbox.stub().returns('test-type'),
    };
    mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

    const result = await deleteExistingAccessibilityOpportunities(
      mockDataAccess,
      'test-site',
      'test-type',
      mockLog,
    );

    expect(result).to.equal(1);
    expect(mockOpportunity.remove).to.have.been.calledOnce;
    expect(mockLog.info).to.have.been.calledWith('[A11yIndividual] Found 1 existing opportunities of type test-type - deleting');
  });

  it('should handle no existing opportunities', async () => {
    mockDataAccess.Opportunity.allBySiteId.resolves([]);

    const result = await deleteExistingAccessibilityOpportunities(
      mockDataAccess,
      'test-site',
      'test-type',
      mockLog,
    );

    expect(result).to.equal(0);
    expect(mockLog.info).to.have.been.calledWith('[A11yIndividual] No existing opportunities of type test-type found - proceeding with creation');
  });

  it('should handle errors during deletion', async () => {
    const mockOpportunity = {
      getId: sandbox.stub().returns('test-id'),
      remove: sandbox.stub().rejects(new Error('Test error')),
      getType: sandbox.stub().returns('test-type'),
    };
    mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

    const errorMessage = 'Failed to delete existing opportunities: Test error';
    await expect(deleteExistingAccessibilityOpportunities(
      mockDataAccess,
      'test-site',
      'test-type',
      mockLog,
    )).to.be.rejectedWith(errorMessage);
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
    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/accessibility/utils/constants.js': {
        accessibilityOpportunitiesMap: {
          'a11y-assistive': ['aria-hidden-focus', 'aria-allowed-attr'],
          'a11y-usability': ['button-name', 'label'],
        },
        successCriteriaLinks: {
          412: { name: 'Name, Role, Value' },
          111: { name: 'Non-text Content' },
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
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            suggestion: {},
            suggestionData: {},
            issueType: 'type1',
            issuesList: [1],
          },
          {
            suggestion: {},
            suggestionData: {},
            issueType: 'type2',
            issuesList: [2],
          },
          {
            suggestion: {},
            suggestionData: {},
            issueType: 'type3',
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

  // it('should create opportunities and suggestions for accessibility issues', async () => {
  //   const accessibilityData = {
  //     'https://example.com/page1': {
  //       violations: {
  //         critical: {
  //           items: {
  //             'aria-hidden-focus': {
  //               description: 'Test issue',
  //               successCriteriaTags: ['wcag412'],
  //               count: 5,
  //             },
  //           },
  //         },
  //       },
  //     },
  //   };

  //   const result = await createAccessibilityIndividualOpportunities(
  //     accessibilityData,
  //     mockContext,
  //   );

  //   expect(result).to.exist;
  //   if (result.status === 'OPPORTUNITIES_FAILED') {
  //     expect.fail(`Function failed with error: ${result.error}`);
  //   }
  //   expect(result.opportunities).to.have.lengthOf(1);
  //   expect(result.opportunities[0].status).to.equal('OPPORTUNITY_CREATED');
  //   expect(result.opportunities[0].opportunityType).to.equal('a11y-assistive');
  //   expect(result.opportunities[0].suggestionsCount).to.equal(1);
  //   expect(result.opportunities[0].totalIssues).to.equal(5);
  //   expect(result.opportunities[0].pagesWithIssues).to.equal(1);
  //   expect(mockGetAuditData).to.have.been.calledWith(mockSite, 'accessibility');
  //   expect(mockCreateAssistiveOppty).to.have.been.calledOnce;
  //   expect(mockSyncSuggestions).to.have.been.calledOnce;
  // });

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

  it('should handle errors during opportunity creation', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 5,
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
                count: 5,
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
                count: 5,
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

  // it('should handle multiple pages with issues', async () => {
  //   const accessibilityData = {
  //     'https://example.com/page1': {
  //       violations: {
  //         critical: {
  //           items: {
  //             'aria-hidden-focus': {
  //               description: 'Page 1 issue',
  //               successCriteriaTags: ['wcag412'],
  //               count: 2,
  //             },
  //           },
  //         },
  //       },
  //     },
  //     'https://example.com/page2': {
  //       violations: {
  //         critical: {
  //           items: {
  //             'aria-hidden-focus': {
  //               description: 'Page 2 issue',
  //               successCriteriaTags: ['wcag412'],
  //               count: 3,
  //             },
  //           },
  //         },
  //       },
  //     },
  //   };

  //   const result = await createAccessibilityIndividualOpportunities(
  //     accessibilityData,
  //     mockContext,
  //   );

  //   expect(result).to.exist;
  //   if (result.status === 'OPPORTUNITIES_FAILED') {
  //     expect.fail(`Function failed with error: ${result.error}`);
  //   }
  //   expect(result.opportunities).to.have.lengthOf(1);
  //   expect(result.opportunities[0].status).to.equal('OPPORTUNITY_CREATED');
  //   expect(result.opportunities[0].suggestionsCount).to.equal(2);
  //   expect(result.opportunities[0].totalIssues).to.equal(5);
  //   expect(result.opportunities[0].pagesWithIssues).to.equal(2);
  // });

  it('should handle errors during opportunity deletion', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 5,
              },
            },
          },
        },
      },
    };

    mockContext.dataAccess.Opportunity.allBySiteId.rejects(new Error('Delete Error'));

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('Delete Error');
  });

  it('should handle errors during opportunity removal', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Test issue',
                successCriteriaTags: ['wcag412'],
                count: 5,
              },
            },
          },
        },
      },
    };

    const mockExistingOpportunity = {
      getId: sandbox.stub().returns('existing-id'),
      remove: sandbox.stub().rejects(new Error('Remove Error')),
      getType: sandbox.stub().returns('a11y-assistive'),
    };
    mockContext.dataAccess.Opportunity.allBySiteId.resolves([mockExistingOpportunity]);

    const result = await createAccessibilityIndividualOpportunities(
      accessibilityData,
      mockContext,
    );

    expect(result.status).to.equal('OPPORTUNITIES_FAILED');
    expect(result.error).to.include('Remove Error');
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
                count: 5,
              },
            },
          },
        },
      },
    };

    const mockExistingOpportunity = {
      getId: sandbox.stub().returns('existing-id'),
      remove: sandbox.stub().resolves(),
      getType: sandbox.stub().returns('a11y-assistive'),
    };
    mockContext.dataAccess.Opportunity.allBySiteId.resolves([mockExistingOpportunity]);
    mockContext.dataAccess.Opportunity.create.rejects(new Error('Create Error'));

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
                count: 5,
              },
            },
          },
        },
      },
    };

    const mockExistingOpportunity = {
      getId: sandbox.stub().returns('existing-id'),
      remove: sandbox.stub().resolves(),
      getType: sandbox.stub().returns('a11y-assistive'),
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
                count: 5,
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
                count: 2,
              },
            },
          },
          serious: {
            items: {
              'aria-allowed-attr': {
                description: 'Second issue',
                successCriteriaTags: ['wcag412'],
                count: 3,
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
    expect(result.opportunities[0].suggestionsCount).to.equal(1);
    expect(result.opportunities[0].totalIssues).to.equal(5);
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
                count: 5,
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
                count: 5,
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
                count: 5,
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
                count: 5,
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
                count: 5,
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
});

describe('createMystiqueMessage', () => {
  it('should create a message object with all required fields', () => {
    const fakeSuggestion = { getId: () => 'sugg-456' };
    const fakeOpportunity = { getId: () => 'oppty-123' };
    const suggestionData = { url: 'https://example.com', suggestionId: 'sugg-456' };
    const issuesList = [{ type: 'color-contrast', description: 'desc' }];
    const siteId = 'site-789';
    const auditId = 'audit-101';
    const deliveryType = 'aem_edge';
    const result = generateIndividualOpportunitiesModule.createMystiqueMessage({
      suggestion: fakeSuggestion,
      suggestionData,
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
      opportunity_id: 'oppty-123',
      suggestion_id: 'sugg-456',
      issues_list: issuesList,
    });
    expect(result.time).to.be.a('string');
  });

  it('should default siteId and auditId to empty string if not provided', () => {
    const fakeSuggestion = { getId: () => 'sugg-456' };
    const fakeOpportunity = { getId: () => 'oppty-123' };
    const suggestionData = { url: 'https://example.com', suggestionId: 'sugg-456' };
    const issuesList = [];
    const result = generateIndividualOpportunitiesModule.createMystiqueMessage({
      suggestion: fakeSuggestion,
      suggestionData,
      issuesList,
      opportunity: fakeOpportunity,
      siteId: undefined,
      auditId: undefined,
      deliveryType: 'aem_edge',
    });
    expect(result.siteId).to.equal('');
    expect(result.auditId).to.equal('');
  });
});

describe('sendMystiqueMessage', () => {
  let sandbox;
  let fakeSqs;
  let fakeEnv;
  let fakeLog;
  let fakeSuggestion;
  let fakeOpportunity;
  let fakeSuggestionData;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    fakeSqs = { sendMessage: sandbox.stub().resolves() };
    fakeEnv = { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' };
    fakeLog = { info: sandbox.stub(), error: sandbox.stub() };
    fakeSuggestion = { getId: () => 'sugg-1' };
    fakeOpportunity = { getId: () => 'oppty-1' };
    fakeSuggestionData = { url: 'https://example.com', suggestionId: 'sugg-1' };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should send a message and log info on success', async () => {
    const result = await generateIndividualOpportunitiesModule.sendMystiqueMessage({
      suggestion: fakeSuggestion,
      suggestionData: fakeSuggestionData,
      issueType: 'color-contrast',
      issuesList: [{ type: 'color-contrast' }],
      opportunity: fakeOpportunity,
      siteId: 'site-1',
      auditId: 'audit-1',
      deliveryType: 'aem_edge',
      sqs: fakeSqs,
      env: fakeEnv,
      log: fakeLog,
    });
    expect(fakeSqs.sendMessage).to.have.been.calledOnce;
    expect(fakeLog.info).to.have.been.calledWithMatch('[A11yIndividual] Sent message to Mystique');
    expect(result).to.deep.include({ success: true, issueType: 'color-contrast', suggestionId: 'sugg-1' });
  });

  it('should log error and return failure object on error', async () => {
    fakeSqs.sendMessage.rejects(new Error('SQS error'));
    const result = await generateIndividualOpportunitiesModule.sendMystiqueMessage({
      suggestion: fakeSuggestion,
      suggestionData: fakeSuggestionData,
      issueType: 'color-contrast',
      issuesList: [{ type: 'color-contrast' }],
      opportunity: fakeOpportunity,
      siteId: 'site-1',
      auditId: 'audit-1',
      deliveryType: 'aem_edge',
      sqs: fakeSqs,
      env: fakeEnv,
      log: fakeLog,
    });
    expect(fakeSqs.sendMessage).to.have.been.calledOnce;
    expect(fakeLog.error).to.have.been.calledWithMatch('[A11yIndividual] Failed to send message to Mystique');
    expect(result).to.deep.include({ success: false, issueType: 'color-contrast', suggestionId: 'sugg-1' });
    expect(result.error).to.equal('SQS error');
  });
});

describe('sendMystiqueMessage error path (coverage)', () => {
  it('should return failure object and log error if sqs.sendMessage rejects', async () => {
    const fakeSqs = { sendMessage: sinon.stub().rejects(new Error('Simulated SQS failure')) };
    const fakeEnv = { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' };
    const fakeLog = { info: sinon.stub(), error: sinon.stub() };
    const fakeSuggestion = { getId: () => 'sugg-123' };
    const fakeOpportunity = { getId: () => 'oppty-456' };
    const fakeSuggestionData = { url: 'https://example.com', suggestionId: 'sugg-123' };
    const result = await generateIndividualOpportunitiesModule.sendMystiqueMessage({
      suggestion: fakeSuggestion,
      suggestionData: fakeSuggestionData,
      issueType: 'aria-allowed-attr',
      issuesList: [{ issue_name: 'aria-allowed-attr' }],
      opportunity: fakeOpportunity,
      siteId: 'site-123',
      auditId: 'audit-456',
      deliveryType: 'aem_edge',
      sqs: fakeSqs,
      env: fakeEnv,
      log: fakeLog,
    });
    expect(result.success).to.be.false;
    expect(result.issueType).to.equal('aria-allowed-attr');
    expect(result.suggestionId).to.equal('sugg-123');
    expect(result.error).to.equal('Simulated SQS failure');
    expect(fakeLog.error).to.have.been.calledWithMatch(
      '[A11yIndividual] Failed to send message to Mystique for suggestion sugg-123 and issue type aria-allowed-attr: Simulated SQS failure',
    );
  });
});

describe('createIndividualOpportunitySuggestions fallback logic (branch coverage)', () => {
  let sandbox;
  let mockOpportunity;
  let mockContext;
  let mockLog;
  let mockIsAuditEnabledForSite;
  let createIndividualOpportunitySuggestions;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockOpportunity = {
      getId: sandbox.stub().returns('oppty-1'),
      // No getSiteId method - this will trigger fallback
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
      auditId: undefined, // This will trigger fallback
      audit: {
        getId: sandbox.stub().returns('audit-1'),
      },
      log: mockLog,
      dataAccess: {
        Opportunity: {
          create: sandbox.stub().resolves(mockOpportunity),
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
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };
    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
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

  it('should use fallback logic for siteId and auditId', async () => {
    const aggregatedData = {
      data: [
        { url: 'https://example.com', type: 'url', issues: [] },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    // Should not throw and should use fallback values
    // Since processSuggestionsForMystique returns empty array, no messages are sent
    expect(mockLog.info).to.have.been.calledWith(
      '[A11yIndividual] No messages to send to Mystique - no matching issue types found',
    );
  });
});

describe('createIndividualOpportunitySuggestions missing SQS context coverage', () => {
  let sandbox;
  let mockOpportunity;
  let mockContext;
  let mockLog;
  let mockIsAuditEnabledForSite;
  let createIndividualOpportunitySuggestions;

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
          create: sandbox.stub().resolves(mockOpportunity),
          findById: sandbox.stub().resolves(mockOpportunity),
        },
        Configuration: {
          findLatest: sandbox.stub().resolves({
            isHandlerEnabledForSite: mockIsAuditEnabledForSite,
          }),
        },
      },
      sqs: null, // Missing SQS
      env: null, // Missing env
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            suggestion: { getId: () => 'sugg-1' },
            suggestionData: { url: 'https://example.com', suggestionId: 'sugg-1' },
            issueType: 'aria-allowed-attr',
            issuesList: [{ issue_name: 'aria-allowed-attr' }],
          },
        ]),
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

  it('should handle missing SQS context gracefully', async () => {
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

    // Should return failure due to missing SQS context
    expect(result.success).to.be.false;
    expect(result.error).to.equal('Missing SQS context or queue configuration');
    expect(mockLog.error).to.have.been.calledWithMatch('[A11yIndividual] Missing required context');
  });

  it('should handle missing env.QUEUE_SPACECAT_TO_MYSTIQUE', async () => {
    // Add SQS but missing queue name
    mockContext.sqs = { sendMessage: sandbox.stub().resolves() };
    mockContext.env = {}; // Missing QUEUE_SPACECAT_TO_MYSTIQUE

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

    // Should return failure due to missing queue name
    expect(result.success).to.be.false;
    expect(result.error).to.equal('Missing SQS context or queue configuration');
    expect(mockLog.error).to.have.been.calledWithMatch('[A11yIndividual] Missing required context');
  });
});

describe('createIndividualOpportunitySuggestions debug logging coverage', () => {
  let sandbox;
  let mockOpportunity;
  let mockContext;
  let mockLog;
  let mockIsAuditEnabledForSite;
  let createIndividualOpportunitySuggestions;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockOpportunity = {
      getId: sandbox.stub().returns('oppty-1'),
      getSiteId: sandbox.stub().returns('site-1'),
      getAuditId: sandbox.stub().returns('audit-1'),
      getSuggestions: sandbox.stub().resolves([
        {
          getData: () => ({
            url: 'https://example.com/page1',
            issues: [
              { type: 'aria-allowed-attr' },
              { type: 'button-name' },
            ],
          }),
        },
        {
          getData: () => ({
            url: 'https://example.com/page2',
            issues: [
              { type: 'color-contrast' },
            ],
          }),
        },
      ]),
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
          create: sandbox.stub().resolves(mockOpportunity),
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
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/accessibility/guidance-utils/mystique-data-processing.js': {
        processSuggestionsForMystique: sandbox.stub().returns([
          {
            suggestion: { getId: () => 'sugg-1' },
            suggestionData: { url: 'https://example.com', suggestionId: 'sugg-1' },
            issueType: 'aria-allowed-attr',
            issuesList: [{ issue_name: 'aria-allowed-attr' }],
          },
        ]),
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

  it('should process suggestions and send messages to Mystique', async () => {
    const aggregatedData = {
      data: [
        { url: 'https://example.com', type: 'url', issues: [] },
      ],
    };

    await createIndividualOpportunitySuggestions(
      mockOpportunity,
      aggregatedData,
      mockContext,
      mockLog,
    );

    // Should send messages to Mystique
    expect(mockLog.info).to.have.been.calledWithMatch(
      '[A11yIndividual] Sending 1 messages to Mystique queue: test-queue',
    );
    expect(mockLog.info).to.have.been.calledWithMatch(
      '[A11yIndividual] Message sending completed: 1 successful, 0 failed, 0 rejected',
    );
  });
});

describe('sendMystiqueMessage error handling', () => {
  let testModule;

  beforeEach(async () => {
    testModule = await import('../../../src/accessibility/utils/generate-individual-opportunities.js');
  });

  it('should handle sendMessage errors and return failure object', async () => {
    const fakeSqs = { sendMessage: sinon.stub().rejects(new Error('SQS connection failed')) };
    const fakeEnv = { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' };
    const fakeLog = { info: sinon.stub(), error: sinon.stub() };
    const fakeSuggestion = { getId: () => 'sugg-123' };
    const fakeOpportunity = { getId: () => 'oppty-456' };
    const fakeSuggestionData = { url: 'https://example.com', suggestionId: 'sugg-123' };

    const result = await testModule.sendMystiqueMessage({
      suggestion: fakeSuggestion,
      suggestionData: fakeSuggestionData,
      issueType: 'aria-allowed-attr',
      issuesList: [{ issue_name: 'aria-allowed-attr' }],
      opportunity: fakeOpportunity,
      siteId: 'site-123',
      auditId: 'audit-456',
      deliveryType: 'aem_edge',
      sqs: fakeSqs,
      env: fakeEnv,
      log: fakeLog,
    });

    // Should return failure object
    expect(result).to.deep.equal({
      success: false,
      issueType: 'aria-allowed-attr',
      suggestionId: 'sugg-123',
      error: 'SQS connection failed',
    });

    // Should log the error
    expect(fakeLog.error).to.have.been.calledWithMatch(
      '[A11yIndividual] Failed to send message to Mystique for suggestion sugg-123 and issue type aria-allowed-attr: SQS connection failed',
    );
  });

  it('should handle sendMessage errors with suggestion without getId method', async () => {
    const fakeSqs = { sendMessage: sinon.stub().rejects(new Error('Network error')) };
    const fakeEnv = { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' };
    const fakeLog = { info: sinon.stub(), error: sinon.stub() };
    const fakeSuggestion = {}; // No getId method
    const fakeOpportunity = { getId: () => 'oppty-456' };
    const fakeSuggestionData = { url: 'https://example.com', suggestionId: 'sugg-123' };

    const result = await testModule.sendMystiqueMessage({
      suggestion: fakeSuggestion,
      suggestionData: fakeSuggestionData,
      issueType: 'color-contrast',
      issuesList: [{ issue_name: 'color-contrast' }],
      opportunity: fakeOpportunity,
      siteId: 'site-123',
      auditId: 'audit-456',
      deliveryType: 'aem_edge',
      sqs: fakeSqs,
      env: fakeEnv,
      log: fakeLog,
    });

    // Should return failure object with empty suggestionId
    expect(result).to.deep.equal({
      success: false,
      issueType: 'color-contrast',
      suggestionId: '',
      error: 'Network error',
    });

    // Should log the error with empty suggestion ID
    expect(fakeLog.error).to.have.been.calledWithMatch(
      '[A11yIndividual] Failed to send message to Mystique for suggestion  and issue type color-contrast: Network error',
    );
  });
});

describe('handleAccessibilityRemediationGuidance', () => {
  let testModule;
  let sandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    testModule = await import('../../../src/accessibility/utils/generate-individual-opportunities.js');
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

    const mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
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
        suggestionId: 'sugg-789',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            issue_id: 'issue-123',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
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
    });

    expect(mockLog.info).to.have.been.calledWith(
      '[A11yRemediationGuidance] Received accessibility remediation guidance for opportunity oppty-123, suggestion sugg-789',
    );
    expect(mockLog.debug).to.have.been.calledWith(
      '[A11yRemediationGuidance] Processing 1 issues for page: https://example.com/page1',
    );
    expect(mockLog.info).to.have.been.calledWith(
      '[A11yRemediationGuidance] Successfully updated suggestion sugg-789 with remediations for opportunity oppty-123',
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

    const mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
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
        suggestionId: 'sugg-789',
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
      '[A11yRemediationGuidance] Opportunity not found for ID: oppty-nonexistent',
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

    const mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
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
        suggestionId: 'sugg-789',
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
      '[A11yRemediationGuidance] Site ID mismatch. Expected: site-456, Found: site-different',
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
    };

    const mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    const mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
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
        suggestionId: 'sugg-789',
        pageUrl: 'https://example.com/page1',
        remediations: [],
        totalIssues: 0,
      },
    };

    const result = await testModule.handleAccessibilityRemediationGuidance(message, mockContext);

    expect(result).to.deep.equal({
      success: false,
      error: 'Suggestion not found',
    });

    expect(mockLog.error).to.have.been.calledWith(
      '[A11yRemediationGuidance] Suggestion not found for ID: sugg-789',
    );
  });

  it('should handle issues without matching remediations', async () => {
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
                    update_from: '<div>Content</div>',
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

    const mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
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
        suggestionId: 'sugg-789',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'different-issue-type',
            issue_id: 'issue-different',
            general_suggestion: 'Different suggestion',
            update_to: '<span>Different</span>',
            user_impact: 'Different impact',
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
    });
  });

  it('should handle htmlWithIssues without matching issue_id', async () => {
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
                    update_from: '<div>Content</div>',
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

    const mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
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
        suggestionId: 'sugg-789',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            issue_id: 'issue-different',
            general_suggestion: 'Different suggestion',
            update_to: '<span>Different</span>',
            user_impact: 'Different impact',
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
    });
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

    const mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
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
        suggestionId: 'sugg-789',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'some-other-issue',
            issue_id: 'issue-123',
            general_suggestion: 'Some suggestion',
            update_to: '<div>Fixed</div>',
            user_impact: 'Some impact',
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

    const mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
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
        suggestionId: 'sugg-789',
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
      '[A11yRemediationGuidance] Failed to process accessibility remediation guidance: Database connection failed',
    );
  });
});
