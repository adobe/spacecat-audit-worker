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
const TEST_URLS = ['https://sample-page/page1', 'https://sample-page/page2'];

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
    const guidance = {
      insight: 'test insight',
      rationale: 'test rationale',
      recommendation: 'test recommendation',
    };

    function createMockAudit(auditResult) {
      return {
        getAuditId: () => 'audit-id-123',
        getAuditResult: () => auditResult,
      };
    }

    it('creates opportunity with correct structure', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, TEST_URLS, audit, guidance);

      expect(result.siteId).to.equal(TEST_SITE_ID);
      expect(result.id).to.be.a('string');
      expect(result.auditId).to.equal('audit-id-123');
      expect(result.type).to.equal('paid-keyword-optimizer');
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.status).to.equal('NEW');
    });

    it('creates correct title and description', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, TEST_URLS, audit, guidance);

      expect(result.title).to.equal('Low-performing paid search pages detected');
      expect(result.description).to.include('2 pages');
      expect(result.description).to.include('45.0%');
      expect(result.description).to.include('10.0K');
    });

    it('formats description with singular page count', () => {
      const audit = createMockAudit({
        totalPageViews: 500,
        averageBounceRate: 0.35,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, ['https://example.com/single'], audit, guidance);

      expect(result.description).to.include('1 page');
      expect(result.description).to.not.include('1 pages');
    });

    it('formats large numbers with K suffix', () => {
      const audit = createMockAudit({
        totalPageViews: 50000,
        averageBounceRate: 0.55,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, TEST_URLS, audit, guidance);

      expect(result.description).to.include('50.0K');
    });

    it('keeps small numbers unformatted', () => {
      const audit = createMockAudit({
        totalPageViews: 500,
        averageBounceRate: 0.4,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, TEST_URLS, audit, guidance);

      expect(result.description).to.include('500');
    });

    it('includes guidance recommendations', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, TEST_URLS, audit, guidance);

      expect(result.guidance.recommendations).to.have.lengthOf(1);
      expect(result.guidance.recommendations[0].insight).to.equal('test insight');
      expect(result.guidance.recommendations[0].rationale).to.equal('test rationale');
      expect(result.guidance.recommendations[0].recommendation).to.equal('test recommendation');
      expect(result.guidance.recommendations[0].type).to.equal('guidance');
    });

    it('includes correct data sources', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, TEST_URLS, audit, guidance);

      expect(result.data.dataSources).to.include('Site');
      expect(result.data.dataSources).to.include('RUM');
      expect(result.data.dataSources).to.include('Page');
    });

    it('includes correct data fields', () => {
      const audit = createMockAudit({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, TEST_URLS, audit, guidance);

      expect(result.data.opportunityType).to.equal('paid-keyword-optimizer');
      expect(result.data.pages).to.deep.equal(TEST_URLS);
      expect(result.data.pageCount).to.equal(2);
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

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, TEST_URLS, audit, guidance);

      expect(result.tags).to.include('Paid');
      expect(result.tags).to.include('SEO');
    });

    it('handles null/undefined values in stats gracefully', () => {
      const audit = createMockAudit({
        totalPageViews: null,
        averageBounceRate: undefined,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, TEST_URLS, audit, guidance);

      // Should handle null/undefined gracefully
      expect(result.description).to.include('0');
    });
  });

  describe('mapToKeywordOptimizerSuggestion', () => {
    it('creates suggestion with correct structure', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const pageGuidance = {
        body: {
          data: {
            analysis: 'test analysis',
            impact: {
              business: 'business impact',
              user: 'user impact',
            },
          },
        },
      };

      const result = mapToKeywordOptimizerSuggestion(
        context,
        TEST_SITE_ID,
        'opportunity-id',
        TEST_URLS,
        pageGuidance,
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
      const pageGuidance = { body: { data: {} } };

      const result = mapToKeywordOptimizerSuggestion(
        context,
        TEST_SITE_ID,
        'opportunity-id',
        TEST_URLS,
        pageGuidance,
      );

      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.PENDING_VALIDATION);
    });

    it('sets status to NEW when site does not require validation', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const pageGuidance = { body: { data: {} } };

      const result = mapToKeywordOptimizerSuggestion(
        context,
        TEST_SITE_ID,
        'opportunity-id',
        TEST_URLS,
        pageGuidance,
      );

      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    });

    it('creates recommendations for each URL', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const pageGuidance = { body: { data: {} } };

      const result = mapToKeywordOptimizerSuggestion(
        context,
        TEST_SITE_ID,
        'opportunity-id',
        TEST_URLS,
        pageGuidance,
      );

      expect(result.data.recommendations).to.have.lengthOf(2);
      expect(result.data.recommendations[0].pageUrl).to.equal(TEST_URLS[0]);
      expect(result.data.recommendations[1].pageUrl).to.equal(TEST_URLS[1]);
      expect(result.data.recommendations[0].id).to.be.a('string');
      expect(result.data.recommendations[1].id).to.be.a('string');
    });

    it('includes analysis and impact data', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const pageGuidance = {
        body: {
          data: {
            analysis: 'detailed analysis',
            impact: {
              business: 'business impact text',
              user: 'user impact text',
            },
          },
        },
      };

      const result = mapToKeywordOptimizerSuggestion(
        context,
        TEST_SITE_ID,
        'opportunity-id',
        TEST_URLS,
        pageGuidance,
      );

      expect(result.data.analysis).to.equal('detailed analysis');
      expect(result.data.impact.business).to.equal('business impact text');
      expect(result.data.impact.user).to.equal('user impact text');
    });

    it('handles missing body data gracefully', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const pageGuidance = {};

      const result = mapToKeywordOptimizerSuggestion(
        context,
        TEST_SITE_ID,
        'opportunity-id',
        TEST_URLS,
        pageGuidance,
      );

      expect(result.data.analysis).to.be.undefined;
      expect(result.data.impact.business).to.be.undefined;
      expect(result.data.impact.user).to.be.undefined;
    });

    it('handles missing site in context', () => {
      const context = {};
      const pageGuidance = { body: { data: {} } };

      const result = mapToKeywordOptimizerSuggestion(
        context,
        TEST_SITE_ID,
        'opportunity-id',
        TEST_URLS,
        pageGuidance,
      );

      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    });

    it('handles empty urls array', () => {
      const context = {
        site: { requiresValidation: false },
      };
      const pageGuidance = { body: { data: {} } };

      const result = mapToKeywordOptimizerSuggestion(
        context,
        TEST_SITE_ID,
        'opportunity-id',
        [],
        pageGuidance,
      );

      expect(result.data.recommendations).to.have.lengthOf(0);
    });
  });
});
