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
import sinon from 'sinon';
import { describe } from 'mocha';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import {
  isLowSeverityGuidanceBody,
  mapToKeywordOptimizerOpportunity,
  mapToKeywordOptimizerSuggestion,
} from '../../../src/paid-keyword-optimizer/guidance-opportunity-mapper.js';

const TEST_SITE_ID = 'some-id';
const TEST_URL = 'https://sample-page/page1';

// Helper to create a message in the new format
function createMessage(overrides = {}) {
  return {
    auditId: 'audit-id-123',
    siteId: TEST_SITE_ID,
    insight: 'test insight',
    rationale: 'test rationale',
    recommendation: 'test recommendation',
    body: {
      issueSeverity: 'medium',
      data: {
        url: TEST_URL,
        suggestions: [
          { id: 'original', name: 'Original', screenshotUrl: 'https://example.com/original.png' },
          { id: 'variation-0', name: 'Variation 0', screenshotUrl: 'https://example.com/var0.png' },
        ],
        cpc: 0.075,
        sum_traffic: 23423.5,
      },
    },
    ...overrides,
  };
}

function createMockAudit(auditResult) {
  return {
    getAuditId: () => 'audit-id-123',
    getAuditResult: () => auditResult,
  };
}

describe('Paid Keyword Optimizer opportunity mapper', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isLowSeverityGuidanceBody', () => {
    it('returns true for low severity', () => {
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'low' })).to.be.true;
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'Low' })).to.be.true;
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'LOW' })).to.be.true;
    });

    it('returns true for none severity', () => {
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'none' })).to.be.true;
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'None' })).to.be.true;
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'NONE' })).to.be.true;
    });

    it('returns false for medium severity', () => {
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'medium' })).to.be.false;
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'Medium' })).to.be.false;
    });

    it('returns false for high severity', () => {
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'high' })).to.be.false;
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'High' })).to.be.false;
    });

    it('returns false for critical severity', () => {
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'critical' })).to.be.false;
    });

    it('returns false when issueSeverity is not present', () => {
      expect(isLowSeverityGuidanceBody({})).to.be.false;
      expect(isLowSeverityGuidanceBody({ other: 'data' })).to.be.false;
    });

    it('returns false when body is null or undefined', () => {
      expect(isLowSeverityGuidanceBody(null)).to.be.false;
      expect(isLowSeverityGuidanceBody(undefined)).to.be.false;
    });

    it('handles severity strings containing low or none', () => {
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'very-low' })).to.be.true;
      expect(isLowSeverityGuidanceBody({ issueSeverity: 'none-detected' })).to.be.true;
    });
  });

  describe('mapToKeywordOptimizerOpportunity', () => {
    it('creates opportunity with correct structure', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.siteId).to.equal(TEST_SITE_ID);
      expect(result.id).to.be.a('string');
      expect(result.auditId).to.equal('audit-id-123');
      expect(result.type).to.equal('ad-intent-mismatch');
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.status).to.equal('NEW');
    });

    it('creates correct title and description', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.title).to.equal('Low-performing paid search page detected');
      expect(result.description).to.include('45.0%');
      expect(result.description).to.include('10.0K');
    });

    it('includes guidance recommendations from message', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage({
        insight: 'custom insight',
        rationale: 'custom rationale',
        recommendation: 'custom recommendation',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.guidance.recommendations).to.have.lengthOf(1);
      expect(result.guidance.recommendations[0].insight).to.equal('custom insight');
      expect(result.guidance.recommendations[0].rationale).to.equal('custom rationale');
      expect(result.guidance.recommendations[0].recommendation).to.equal('custom recommendation');
      expect(result.guidance.recommendations[0].type).to.equal('guidance');
    });

    it('includes correct data sources', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.data.dataSources).to.include('Site');
      expect(result.data.dataSources).to.include('RUM');
      expect(result.data.dataSources).to.include('Page');
    });

    it('includes single URL and metrics from message body', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.data.url).to.equal(TEST_URL);
      expect(result.data.cpc).to.equal(0.075);
      expect(result.data.sumTraffic).to.equal(23423.5);
      expect(result.data.opportunityType).to.equal('ad-intent-mismatch');
    });

    it('includes audit result stats', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.data.totalPageViews).to.equal(10000);
      expect(result.data.averageBounceRate).to.equal(0.45);
      expect(result.data.temporalCondition).to.equal('(year=2025 AND week IN (1,2,3,4))');
    });

    it('includes correct tags', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.tags).to.include('Paid');
      expect(result.tags).to.include('SEO');
    });

    it('handles null/undefined values in stats gracefully', () => {
      const audit = createMockAudit({
        totalPageViews: null,
        averageBounceRate: undefined,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      // Should handle null/undefined gracefully
      expect(result.description).to.include('0');
    });

    it('handles missing body.data fields gracefully', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = {
        auditId: 'audit-id-123',
        siteId: TEST_SITE_ID,
        insight: 'insight',
        rationale: 'rationale',
        recommendation: 'recommendation',
        body: {},
      };

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.data.url).to.be.undefined;
      expect(result.data.cpc).to.be.undefined;
      expect(result.data.sumTraffic).to.be.undefined;
    });

    it('formats large numbers with K suffix in description', () => {
      const audit = createMockAudit({
        totalPageViews: 50000,
        averageBounceRate: 0.55,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.description).to.include('50.0K');
    });

    it('keeps small numbers unformatted in description', () => {
      const audit = createMockAudit({
        totalPageViews: 500,
        averageBounceRate: 0.4,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });
      const message = createMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

      expect(result.description).to.include('500');
    });
  });

  describe('mapToKeywordOptimizerSuggestion', () => {
    it('creates suggestion with correct structure', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const message = createMessage();

      const result = mapToKeywordOptimizerSuggestion(
        context,
        'opportunity-id',
        message,
      );

      expect(result.opportunityId).to.equal('opportunity-id');
      expect(result.type).to.equal('CONTENT_UPDATE');
      expect(result.rank).to.equal(1);
      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    });

    it('sets status to PENDING_VALIDATION when site requires validation', () => {
      const context = {
        site: { requiresValidation: true },
      };
      const message = createMessage();

      const result = mapToKeywordOptimizerSuggestion(
        context,
        'opportunity-id',
        message,
      );

      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.PENDING_VALIDATION);
    });

    it('sets status to NEW when site does not require validation', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const message = createMessage();

      const result = mapToKeywordOptimizerSuggestion(
        context,
        'opportunity-id',
        message,
      );

      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    });

    it('stores suggestions as variations from message body', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const suggestions = [
        { id: 'original', name: 'Original', screenshotUrl: 'https://example.com/original.png' },
        { id: 'variation-0', name: 'Variation 0', screenshotUrl: 'https://example.com/var0.png' },
        { id: 'variation-1', name: 'Variation 1', screenshotUrl: 'https://example.com/var1.png' },
      ];
      const message = createMessage({
        body: {
          issueSeverity: 'medium',
          data: {
            url: TEST_URL,
            suggestions,
            cpc: 0.075,
            sum_traffic: 23423.5,
          },
        },
      });

      const result = mapToKeywordOptimizerSuggestion(
        context,
        'opportunity-id',
        message,
      );

      expect(result.data.variations).to.deep.equal(suggestions);
    });

    it('handles missing body data gracefully', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const message = {};

      const result = mapToKeywordOptimizerSuggestion(
        context,
        'opportunity-id',
        message,
      );

      expect(result.data.variations).to.deep.equal([]);
    });

    it('handles missing site in context', () => {
      const context = {};
      const message = createMessage();

      const result = mapToKeywordOptimizerSuggestion(
        context,
        'opportunity-id',
        message,
      );

      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    });

    it('handles empty suggestions array', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const message = createMessage({
        body: {
          issueSeverity: 'medium',
          data: {
            url: TEST_URL,
            suggestions: [],
            cpc: 0.075,
            sum_traffic: 23423.5,
          },
        },
      });

      const result = mapToKeywordOptimizerSuggestion(
        context,
        'opportunity-id',
        message,
      );

      expect(result.data.variations).to.deep.equal([]);
    });

    it('handles undefined suggestions in message body', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const message = {
        body: {
          issueSeverity: 'medium',
          data: {
            url: TEST_URL,
            // suggestions is undefined
            cpc: 0.075,
            sum_traffic: 23423.5,
          },
        },
      };

      const result = mapToKeywordOptimizerSuggestion(
        context,
        'opportunity-id',
        message,
      );

      expect(result.data.variations).to.deep.equal([]);
    });
  });
});
