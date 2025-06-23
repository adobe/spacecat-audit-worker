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
      htmlWithIssues: ['<div>test</div>'],
      failureSummary: 'Test summary',
    }, 'critical');

    expect(result).to.deep.equal({
      type: 'color-contrast',
      description: 'Test description',
      wcagRule: '4.1.2 Name, Role, Value',
      wcagLevel: 'AA',
      severity: 'critical',
      occurrences: 5,
      htmlWithIssues: ['<div>test</div>'],
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

    expect(result.htmlWithIssues).to.deep.equal([]);
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
  let mockSyncSuggestions;
  let createIndividualOpportunitySuggestions;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockOpportunity = {
      getId: sandbox.stub().returns('test-id'),
      getSiteId: sandbox.stub().returns('test-site'),
      getAuditId: sandbox.stub().returns('test-audit'),
      getSuggestions: sandbox.stub().resolves([]),
    };
    mockContext = {
      site: {
        getId: sandbox.stub().returns('test-site'),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
      },
      auditId: 'test-audit',
      log: {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
      },
      dataAccess: {
        Opportunity: {
          create: sandbox.stub().resolves(mockOpportunity),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    // Fix: Create a proper sinon stub for syncSuggestions
    mockSyncSuggestions = sandbox.stub().resolves();
    // Fix: Mock the module with the correct path and get the function
    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: mockSyncSuggestions,
      },
      '../../../src/accessibility/guidance-utils/mistique-data-processing.js': {
        processSuggestionsForMistique: sandbox.stub().returns([
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
      mockContext.log,
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
      mockContext.log,
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
      mockContext.log,
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
      mockContext.log,
    );

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const { buildKey } = mockSyncSuggestions.firstCall.args[0];

    // Test the buildKey function
    const result = buildKey(aggregatedData.data[0]);

    expect(result).to.equal('https://example.com/page1');
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
          allBySiteId: sandbox.stub().resolves([]),
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
      '../../../src/accessibility/guidance-utils/mistique-data-processing.js': {
        processSuggestionsForMistique: sandbox.stub().returns([
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
    expect(result.opportunities[0].opportunityType).to.equal('a11y-assistive');
    expect(result.opportunities[0].suggestionsCount).to.equal(1);
    expect(result.opportunities[0].totalIssues).to.equal(5);
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

  it('should handle multiple pages with issues', async () => {
    const accessibilityData = {
      'https://example.com/page1': {
        violations: {
          critical: {
            items: {
              'aria-hidden-focus': {
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
          critical: {
            items: {
              'aria-hidden-focus': {
                description: 'Page 2 issue',
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
    expect(result.opportunities[0].suggestionsCount).to.equal(2);
    expect(result.opportunities[0].totalIssues).to.equal(5);
    expect(result.opportunities[0].pagesWithIssues).to.equal(2);
  });

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

describe('createMistiqueMessage', () => {
  it('should create a message object with all required fields', () => {
    const fakeOpportunity = { getId: () => 'oppty-123' };
    const suggestionData = { url: 'https://example.com', suggestionId: 'sugg-456' };
    const issuesList = [{ type: 'color-contrast', description: 'desc' }];
    const siteId = 'site-789';
    const auditId = 'audit-101';
    const deliveryType = 'aem_edge';
    const result = generateIndividualOpportunitiesModule.createMistiqueMessage({
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
    const fakeOpportunity = { getId: () => 'oppty-123' };
    const suggestionData = { url: 'https://example.com', suggestionId: 'sugg-456' };
    const issuesList = [];
    const result = generateIndividualOpportunitiesModule.createMistiqueMessage({
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

describe('sendMistiqueMessage', () => {
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
    const result = await generateIndividualOpportunitiesModule.sendMistiqueMessage({
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
    expect(fakeLog.info).to.have.been.calledWithMatch('[A11yIndividual] Sent message to Mistique');
    expect(result).to.deep.include({ success: true, issueType: 'color-contrast', suggestionId: 'sugg-1' });
  });

  it('should log error and return failure object on error', async () => {
    fakeSqs.sendMessage.rejects(new Error('SQS error'));
    const result = await generateIndividualOpportunitiesModule.sendMistiqueMessage({
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
    expect(fakeLog.error).to.have.been.calledWithMatch('[A11yIndividual] Failed to send message to Mistique');
    expect(result).to.deep.include({ success: false, issueType: 'color-contrast', suggestionId: 'sugg-1' });
    expect(result.error).to.equal('SQS error');
  });
});

describe('sendMistiqueMessage error path (coverage)', () => {
  it('should return failure object and log error if sqs.sendMessage rejects', async () => {
    const fakeSqs = { sendMessage: sinon.stub().rejects(new Error('Simulated SQS failure')) };
    const fakeEnv = { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' };
    const fakeLog = { info: sinon.stub(), error: sinon.stub() };
    const fakeSuggestion = { getId: () => 'sugg-err' };
    const fakeOpportunity = { getId: () => 'oppty-err' };
    const fakeSuggestionData = { url: 'https://err.com', suggestionId: 'sugg-err' };
    const result = await generateIndividualOpportunitiesModule.sendMistiqueMessage({
      suggestion: fakeSuggestion,
      suggestionData: fakeSuggestionData,
      issueType: 'error-type',
      issuesList: [{ type: 'error-type' }],
      opportunity: fakeOpportunity,
      siteId: 'site-err',
      auditId: 'audit-err',
      deliveryType: 'aem_edge',
      sqs: fakeSqs,
      env: fakeEnv,
      log: fakeLog,
    });
    expect(result.success).to.be.false;
    expect(result.issueType).to.equal('error-type');
    expect(result.suggestionId).to.equal('sugg-err');
    expect(result.error).to.equal('Simulated SQS failure');
    expect(fakeLog.error).to.have.been.calledWithMatch('[A11yIndividual] Failed to send message to Mistique');
  });
});

describe('createIndividualOpportunitySuggestions (Promise.allSettled coverage)', () => {
  let sandbox;
  let mockOpportunity;
  let mockContext;
  let mockLog;
  let mockProcessSuggestionsForMistique;
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
        },
      },
      sqs: {},
      env: {},
    };
    // Simulate processSuggestionsForMistique returning 3 items
    mockProcessSuggestionsForMistique = sandbox.stub().returns([
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
    ]);
    // Patch the module
    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/accessibility/guidance-utils/mistique-data-processing.js': {
        processSuggestionsForMistique: mockProcessSuggestionsForMistique,
      },
    });
    createIndividualOpportunitySuggestions = module.createIndividualOpportunitySuggestions;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should log correct summary for allSettled results', async () => {
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

    // Should log info with the correct summary
    expect(mockLog.info).to.have.been.calledWithMatch(
      /Message sending completed:/,
    );
  });
});

describe('sendMistiqueMessage edge cases (branch coverage)', () => {
  it('should handle suggestion without getId method', async () => {
    const fakeSqs = { sendMessage: sinon.stub().rejects(new Error('SQS error')) };
    const fakeEnv = { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' };
    const fakeLog = { info: sinon.stub(), error: sinon.stub() };
    const fakeSuggestion = { /* no getId method */ };
    const fakeOpportunity = { getId: () => 'oppty-1' };
    const fakeSuggestionData = { url: 'https://example.com', suggestionId: 'sugg-1' };
    const result = await generateIndividualOpportunitiesModule.sendMistiqueMessage({
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
    expect(result.success).to.be.false;
    expect(result.suggestionId).to.equal('');
    expect(result.error).to.equal('SQS error');
  });
});

describe('createIndividualOpportunitySuggestions fallback logic (branch coverage)', () => {
  let sandbox;
  let mockOpportunity;
  let mockContext;
  let mockLog;
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
        },
      },
      sqs: {},
      env: {},
    };
    const module = await esmock('../../../src/accessibility/utils/generate-individual-opportunities.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/accessibility/guidance-utils/mistique-data-processing.js': {
        processSuggestionsForMistique: sandbox.stub().returns([]),
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
    expect(mockLog.info).to.have.been.calledWithMatch(
      /Message sending completed:/,
    );
  });
});
