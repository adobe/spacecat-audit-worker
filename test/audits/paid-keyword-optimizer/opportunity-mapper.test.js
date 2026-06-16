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

import { expect } from 'chai';
import sinon from 'sinon';
import { describe } from 'mocha';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import {
  assignClusterRanks,
  mapToKeywordOptimizerOpportunity,
  mapClusterToSuggestion,
} from '../../../src/paid-keyword-optimizer/guidance-opportunity-mapper.js';

const TEST_SITE_ID = 'some-id';
const TEST_URL = 'https://sample-page/page1';

function makeCluster({
  clusterId = 'cluster-1',
  analysisStatus = 'ok',
  recommendation = null,
  clusterMisalignedSpend = 100,
  clusterTraffic = 500,
  clusterCpc = 2.0,
  representativeKeyword = 'test keyword',
  serpTitle = 'Test SERP Title',
  keywords = [{ keyword: 'test', cpc: 2.0, traffic: 500 }],
  gapAnalysis = { overallAlignment: 'fair' },
  overallAlignmentScore = 'fair',
  keywordAnalysis = [{ keyword: 'test', alignmentScore: 0.6 }],
} = {}) {
  return {
    clusterId,
    representativeKeyword,
    serpTitle,
    keywords,
    clusterTraffic,
    clusterCpc,
    clusterMisalignedSpend,
    analysisStatus,
    gapAnalysis,
    overallAlignmentScore,
    keywordAnalysis,
    ...(recommendation && { recommendation }),
  };
}

function createClusterMessage({
  clusterResults = [makeCluster()],
  portfolioMetrics = { totalSpend: 1000 },
  langfuseTraceId = 'trace-123',
  langfuseTraceUrl = 'https://langfuse.example.com/trace/123',
  extraBody,
} = {}) {
  return {
    auditId: 'audit-id-123',
    siteId: TEST_SITE_ID,
    data: {
      url: TEST_URL,
      guidance: [{
        body: {
          clusterResults,
          portfolioMetrics,
          observability: {
            langfuseTraceId,
            langfuseTraceUrl,
          },
          ...(extraBody || {}),
        },
      }],
    },
  };
}

function createMockAudit() {
  return {
    getAuditId: () => 'audit-id-123',
    getAuditResult: () => ({
      totalPageViews: 10000,
      averageBounceRate: 0.45,
    }),
  };
}

describe('Paid Keyword Optimizer opportunity mapper (cluster format)', () => {
  // auditResult passed by the guidance handler; default mock has no predominantlyPaidPages
  const AR = () => createMockAudit().getAuditResult();

  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('assignClusterRanks', () => {
    it('should assign rank 1 to mismatched cluster with highest misaligned spend', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading' }, clusterMisalignedSpend: 200 }),
        makeCluster({ clusterId: 'c2', recommendation: { type: 'modify_heading' }, clusterMisalignedSpend: 500 }),
      ];

      const ranked = assignClusterRanks(clusters);

      expect(ranked[0].clusterId).to.equal('c2');
      expect(ranked[0].rank).to.equal(1);
      expect(ranked[1].clusterId).to.equal('c1');
      expect(ranked[1].rank).to.equal(2);
    });

    it('should place mismatched (tier 0) before aligned (tier 1) before failed (tier 2)', () => {
      const clusters = [
        makeCluster({ clusterId: 'aligned', clusterTraffic: 1000 }),
        makeCluster({ clusterId: 'failed', analysisStatus: 'failed', clusterTraffic: 2000 }),
        makeCluster({ clusterId: 'mismatched', recommendation: { type: 'modify_heading' }, clusterMisalignedSpend: 50 }),
      ];

      const ranked = assignClusterRanks(clusters);

      expect(ranked[0].clusterId).to.equal('mismatched');
      expect(ranked[0].rank).to.equal(1);
      expect(ranked[1].clusterId).to.equal('aligned');
      expect(ranked[1].rank).to.equal(2);
      expect(ranked[2].clusterId).to.equal('failed');
      expect(ranked[2].rank).to.equal(3);
    });

    it('should sort aligned clusters by clusterTraffic descending', () => {
      const clusters = [
        makeCluster({ clusterId: 'low', clusterTraffic: 100 }),
        makeCluster({ clusterId: 'high', clusterTraffic: 1000 }),
      ];

      const ranked = assignClusterRanks(clusters);

      expect(ranked[0].clusterId).to.equal('high');
      expect(ranked[1].clusterId).to.equal('low');
    });

    it('should sort failed clusters by clusterTraffic descending', () => {
      const clusters = [
        makeCluster({ clusterId: 'low-fail', analysisStatus: 'failed', clusterTraffic: 100 }),
        makeCluster({ clusterId: 'high-fail', analysisStatus: 'failed', clusterTraffic: 1000 }),
      ];

      const ranked = assignClusterRanks(clusters);

      expect(ranked[0].clusterId).to.equal('high-fail');
      expect(ranked[1].clusterId).to.equal('low-fail');
    });

    it('should handle empty array', () => {
      const ranked = assignClusterRanks([]);
      expect(ranked).to.deep.equal([]);
    });

    it('should handle null/undefined input', () => {
      expect(assignClusterRanks(null)).to.deep.equal([]);
      expect(assignClusterRanks(undefined)).to.deep.equal([]);
    });

    it('should handle clusters with missing optional fields', () => {
      const clusters = [
        { clusterId: 'minimal', analysisStatus: 'ok' },
        {
          clusterId: 'mismatched-minimal',
          analysisStatus: 'ok',
          recommendation: { type: 'modify_heading' },
        },
      ];

      const ranked = assignClusterRanks(clusters);

      // mismatched first (has recommendation), aligned second
      expect(ranked[0].clusterId).to.equal('mismatched-minimal');
      expect(ranked[0].rank).to.equal(1);
      expect(ranked[1].clusterId).to.equal('minimal');
      expect(ranked[1].rank).to.equal(2);
    });

    it('should handle single cluster', () => {
      const clusters = [makeCluster({ clusterId: 'only' })];
      const ranked = assignClusterRanks(clusters);

      expect(ranked).to.have.lengthOf(1);
      expect(ranked[0].rank).to.equal(1);
    });

    it('should handle null clusterMisalignedSpend in mismatched tier (|| 0 fallback)', () => {
      const clusters = [
        {
          clusterId: 'c1',
          analysisStatus: 'ok',
          recommendation: { type: 'modify_heading' },
          clusterMisalignedSpend: null,
        },
        {
          clusterId: 'c2',
          analysisStatus: 'ok',
          recommendation: { type: 'modify_heading' },
          clusterMisalignedSpend: 100,
        },
      ];

      const ranked = assignClusterRanks(clusters);

      // c2 has spend=100, c1 has spend=null(->0), so c2 comes first
      expect(ranked[0].clusterId).to.equal('c2');
      expect(ranked[1].clusterId).to.equal('c1');
    });

    it('should handle null clusterTraffic in aligned tier (|| 0 fallback)', () => {
      const clusters = [
        { clusterId: 'c1', analysisStatus: 'ok', clusterTraffic: null },
        { clusterId: 'c2', analysisStatus: 'ok', clusterTraffic: 500 },
      ];

      const ranked = assignClusterRanks(clusters);

      // c2 has traffic=500, c1 has traffic=null(->0), so c2 comes first
      expect(ranked[0].clusterId).to.equal('c2');
      expect(ranked[1].clusterId).to.equal('c1');
    });

    it('should handle null clusterTraffic in failed tier (|| 0 fallback)', () => {
      const clusters = [
        { clusterId: 'f1', analysisStatus: 'failed', clusterTraffic: null },
        { clusterId: 'f2', analysisStatus: 'failed', clusterTraffic: 300 },
      ];

      const ranked = assignClusterRanks(clusters);

      // f2 has traffic=300, f1 has traffic=null(->0), so f2 comes first
      expect(ranked[0].clusterId).to.equal('f2');
      expect(ranked[1].clusterId).to.equal('f1');
    });

    it('should handle undefined clusterMisalignedSpend and clusterTraffic', () => {
      const clusters = [
        { clusterId: 'c1', analysisStatus: 'ok', recommendation: { type: 'modify_heading' } },
        { clusterId: 'c2', analysisStatus: 'ok' },
        { clusterId: 'c3', analysisStatus: 'failed' },
      ];

      const ranked = assignClusterRanks(clusters);

      // Should not throw and should assign ranks
      expect(ranked).to.have.lengthOf(3);
      expect(ranked[0].clusterId).to.equal('c1'); // mismatched
      expect(ranked[1].clusterId).to.equal('c2'); // aligned
      expect(ranked[2].clusterId).to.equal('c3'); // failed
    });

    it('should cover || 0 both sides for mismatched tier: both null', () => {
      const clusters = [
        {
          clusterId: 'c1',
          analysisStatus: 'ok',
          recommendation: { type: 'modify_heading' },
          clusterMisalignedSpend: undefined,
        },
        {
          clusterId: 'c2',
          analysisStatus: 'ok',
          recommendation: { type: 'modify_heading' },
          clusterMisalignedSpend: undefined,
        },
      ];

      const ranked = assignClusterRanks(clusters);
      expect(ranked).to.have.lengthOf(2);
    });

    it('should cover || 0 both sides for aligned tier: both null', () => {
      const clusters = [
        { clusterId: 'c1', analysisStatus: 'ok', clusterTraffic: undefined },
        { clusterId: 'c2', analysisStatus: 'ok', clusterTraffic: undefined },
      ];

      const ranked = assignClusterRanks(clusters);
      expect(ranked).to.have.lengthOf(2);
    });

    it('should cover || 0 both sides for failed tier: both null', () => {
      const clusters = [
        { clusterId: 'f1', analysisStatus: 'failed', clusterTraffic: undefined },
        { clusterId: 'f2', analysisStatus: 'failed', clusterTraffic: undefined },
      ];

      const ranked = assignClusterRanks(clusters);
      expect(ranked).to.have.lengthOf(2);
    });

    it('should cover || 0 fallback: a has value, b null for mismatched tier', () => {
      const clusters = [
        {
          clusterId: 'c1',
          analysisStatus: 'ok',
          recommendation: { type: 'modify_heading' },
          clusterMisalignedSpend: 100,
        },
        {
          clusterId: 'c2',
          analysisStatus: 'ok',
          recommendation: { type: 'modify_heading' },
          clusterMisalignedSpend: undefined,
        },
      ];

      const ranked = assignClusterRanks(clusters);
      expect(ranked[0].clusterId).to.equal('c1');
    });

    it('should cover || 0 fallback: a has value, b null for aligned tier', () => {
      const clusters = [
        { clusterId: 'c1', analysisStatus: 'ok', clusterTraffic: 100 },
        { clusterId: 'c2', analysisStatus: 'ok', clusterTraffic: undefined },
      ];

      const ranked = assignClusterRanks(clusters);
      expect(ranked[0].clusterId).to.equal('c1');
    });

    it('should cover || 0 fallback: a has value, b null for failed tier', () => {
      const clusters = [
        { clusterId: 'f1', analysisStatus: 'failed', clusterTraffic: 100 },
        { clusterId: 'f2', analysisStatus: 'failed', clusterTraffic: undefined },
      ];

      const ranked = assignClusterRanks(clusters);
      expect(ranked[0].clusterId).to.equal('f1');
    });
  });

  describe('mapToKeywordOptimizerOpportunity', () => {
    it('creates opportunity with correct structure', () => {
      const audit = createMockAudit();
      const message = createClusterMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.siteId).to.equal(TEST_SITE_ID);
      expect(result.id).to.be.a('string');
      expect(result.auditId).to.equal('audit-id-123');
      expect(result.type).to.equal('ad-intent-mismatch');
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.status).to.equal('NEW');
      expect(result.guidance).to.be.null;
    });

    it('creates correct title', () => {
      const audit = createMockAudit();
      const message = createClusterMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.title).to.equal('Ad intent mismatch detected across keyword clusters');
    });

    it('creates description with cluster counts and estimated spend', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading' }, clusterMisalignedSpend: 300 }),
        makeCluster({ clusterId: 'c2', clusterMisalignedSpend: 0 }),
        makeCluster({ clusterId: 'c3', recommendation: { type: 'audit_required' }, clusterMisalignedSpend: 700 }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.description).to.include('2 of 3 clusters show significant alignment gaps');
      expect(result.description).to.include('~$1.0K/month');
    });

    it('formats small spend values without K suffix', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading' }, clusterMisalignedSpend: 50 }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.description).to.include('~$50/month');
    });

    it('includes correct data sources including SEO', () => {
      const audit = createMockAudit();
      const message = createClusterMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.dataSources).to.include('Site');
      expect(result.data.dataSources).to.include('RUM');
      expect(result.data.dataSources).to.include('Page');
      expect(result.data.dataSources).to.include('SEO');
    });

    it('includes url and page fields', () => {
      const audit = createMockAudit();
      const message = createClusterMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.url).to.equal(TEST_URL);
      expect(result.data.page).to.equal(TEST_URL);
    });

    it('includes portfolioMetrics in data', () => {
      const audit = createMockAudit();
      const portfolioMetrics = { totalSpend: 5000, avgCpc: 2.5 };
      const message = createClusterMessage({ portfolioMetrics });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.portfolioMetrics).to.deep.equal(portfolioMetrics);
    });

    it('computes hasConflictingHeadlineRecommendations=true when multiple modify_heading clusters', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading', changes: [] } }),
        makeCluster({ clusterId: 'c2', recommendation: { type: 'modify_heading', changes: [] } }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.hasConflictingHeadlineRecommendations).to.be.true;
    });

    it('computes hasConflictingHeadlineRecommendations=false when only one modify_heading cluster', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading', changes: [] } }),
        makeCluster({ clusterId: 'c2' }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.hasConflictingHeadlineRecommendations).to.be.false;
    });

    it('computes hasConflictingHeadlineRecommendations=false when no modify_heading clusters', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'audit_required', changes: [] } }),
        makeCluster({ clusterId: 'c2' }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.hasConflictingHeadlineRecommendations).to.be.false;
    });

    it('includes langfuseTraceId and langfuseTraceUrl', () => {
      const audit = createMockAudit();
      const message = createClusterMessage({
        langfuseTraceId: 'trace-abc',
        langfuseTraceUrl: 'https://langfuse.example.com/trace/abc',
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.langfuseTraceId).to.equal('trace-abc');
      expect(result.data.langfuseTraceUrl).to.equal('https://langfuse.example.com/trace/abc');
    });

    it('includes totalClusters and misalignedClusters counts', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading' } }),
        makeCluster({ clusterId: 'c2' }),
        makeCluster({ clusterId: 'c3', analysisStatus: 'failed' }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.totalClusters).to.equal(3);
      expect(result.data.misalignedClusters).to.equal(1);
    });

    it('excludes good-aligned clusters from misalignedClusters count', () => {
      const clusters = [
        makeCluster({
          clusterId: 'c1',
          recommendation: { type: 'modify_heading' },
          overallAlignmentScore: 'good',
          clusterMisalignedSpend: 0,
        }),
        makeCluster({
          clusterId: 'c2',
          recommendation: { type: 'audit_required' },
          overallAlignmentScore: 'poor',
          clusterMisalignedSpend: 500,
        }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.totalClusters).to.equal(2);
      expect(result.data.misalignedClusters).to.equal(1);
      expect(result.data.totalMisalignedSpend).to.equal(500);
    });

    it('counts poor-aligned clusters as misaligned', () => {
      const clusters = [
        makeCluster({
          clusterId: 'c1',
          recommendation: { type: 'modify_heading' },
          overallAlignmentScore: 'poor',
        }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.misalignedClusters).to.equal(1);
    });

    it('treats null overallAlignmentScore as not misaligned', () => {
      const clusters = [
        makeCluster({
          clusterId: 'c1',
          recommendation: { type: 'modify_heading' },
          overallAlignmentScore: null,
        }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.misalignedClusters).to.equal(0);
    });

    it('includes correct tags', () => {
      const audit = createMockAudit();
      const message = createClusterMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.tags).to.deep.equal(['Paid', 'SEO']);
    });

    it('handles empty guidance array gracefully', () => {
      const audit = createMockAudit();
      const message = {
        auditId: 'audit-id-123',
        siteId: TEST_SITE_ID,
        data: {
          url: TEST_URL,
          guidance: [],
        },
      };

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.totalClusters).to.equal(0);
      expect(result.data.misalignedClusters).to.equal(0);
      expect(result.data.totalMisalignedSpend).to.equal(0);
    });

    it('handles missing data.url gracefully', () => {
      const audit = createMockAudit();
      const message = {
        auditId: 'audit-id-123',
        siteId: TEST_SITE_ID,
        data: {
          guidance: [{
            body: {
              clusterResults: [],
              portfolioMetrics: {},
            },
          }],
        },
      };

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.url).to.be.undefined;
      expect(result.data.page).to.be.undefined;
    });

    it('formats zero spend as $0', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', clusterMisalignedSpend: 0 }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.description).to.include('~$0/month');
    });

    it('excludes failed clusters from misaligned count', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading' }, analysisStatus: 'failed' }),
        makeCluster({ clusterId: 'c2', recommendation: { type: 'modify_heading' } }),
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({ clusterResults: clusters });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      // c1 is failed so not counted as misaligned even though it has a recommendation
      expect(result.data.misalignedClusters).to.equal(1);
    });

    it('passes resolvedPageHeading and pageTopics through to opportunity.data', () => {
      const pageTopics = [
        {
          topic: 'Email API overview',
          context: 'Overview of the SendGrid Email API and core capabilities.',
          supportingQuote: 'Build with our extensible platforms for customers, workforce, and non-human identities.',
          paragraphIndex: 5,
        },
        {
          topic: 'Deliverability',
          context: 'Deliverability features and analytics.',
          supportingQuote: 'Real-time deliverability metrics and reputation monitoring.',
          paragraphIndex: 12,
        },
      ];
      const audit = createMockAudit();
      const message = createClusterMessage({
        extraBody: {
          resolvedPageHeading: 'Fast, reliable email delivery',
          pageTopics,
        },
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.resolvedPageHeading).to.equal('Fast, reliable email delivery');
      expect(result.data.pageTopics).to.have.lengthOf(2);
      expect(result.data.pageTopics[0]).to.deep.equal({
        topic: 'Email API overview',
        context: 'Overview of the SendGrid Email API and core capabilities.',
        supportingQuote: 'Build with our extensible platforms for customers, workforce, and non-human identities.',
        paragraphIndex: 5,
      });
      expect(result.data.pageTopics[1].topic).to.equal('Deliverability');
      expect(result.data.pageTopics[1].paragraphIndex).to.equal(12);
    });

    it('defaults resolvedPageHeading to null and pageTopics to [] when fields are absent (old mystique)', () => {
      const audit = createMockAudit();
      // No extraBody — guidanceBody has neither resolvedPageHeading nor pageTopics
      const message = createClusterMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.resolvedPageHeading).to.be.null;
      expect(result.data.pageTopics).to.be.an('array').that.is.empty;
    });

    it('collapses explicit null pageTopics to [] (future regression guard)', () => {
      const audit = createMockAudit();
      const message = createClusterMessage({
        extraBody: {
          resolvedPageHeading: null,
          pageTopics: null,
        },
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.resolvedPageHeading).to.be.null;
      expect(result.data.pageTopics).to.be.an('array').that.is.empty;
    });

    it('preserves all existing opportunity.data keys when new fields are present', () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading' }, clusterMisalignedSpend: 200 }),
        makeCluster({ clusterId: 'c2', clusterMisalignedSpend: 50 }),
      ];
      const portfolioMetrics = { totalSpend: 5000, avgCpc: 2.5 };
      const audit = createMockAudit();
      const message = createClusterMessage({
        clusterResults: clusters,
        portfolioMetrics,
        langfuseTraceId: 'trace-xyz',
        langfuseTraceUrl: 'https://langfuse.example.com/trace/xyz',
        extraBody: {
          resolvedPageHeading: 'Headline',
          pageTopics: [{
            topic: 'T', context: 'C', supportingQuote: 'Q', paragraphIndex: 0,
          }],
        },
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      // All existing data keys still present with expected values.
      expect(result.data.url).to.equal(TEST_URL);
      expect(result.data.page).to.equal(TEST_URL);
      expect(result.data.portfolioMetrics).to.deep.equal(portfolioMetrics);
      expect(result.data.hasConflictingHeadlineRecommendations).to.be.false;
      expect(result.data.langfuseTraceId).to.equal('trace-xyz');
      expect(result.data.langfuseTraceUrl).to.equal('https://langfuse.example.com/trace/xyz');
      expect(result.data.totalClusters).to.equal(2);
      expect(result.data.misalignedClusters).to.equal(1);
      expect(result.data.totalMisalignedSpend).to.equal(250);
      expect(result.data.dataSources).to.deep.equal(['Site', 'RUM', 'Page', 'SEO']);
      // New fields present alongside.
      expect(result.data.resolvedPageHeading).to.equal('Headline');
      expect(result.data.pageTopics).to.have.lengthOf(1);
    });

    it('preserves opportunity.title and opportunity.guidance values from the existing branch', () => {
      const audit = createMockAudit();
      const message = createClusterMessage({
        extraBody: {
          resolvedPageHeading: 'Fast, reliable email delivery',
          pageTopics: [],
        },
      });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.title).to.equal('Ad intent mismatch detected across keyword clusters');
      expect(result.guidance).to.be.null;
    });

    it('passes whatsLikelyHappening through to data when present', () => {
      const audit = createMockAudit();
      const message = createClusterMessage({ extraBody: { whatsLikelyHappening: 'spend leaks here' } });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.whatsLikelyHappening).to.equal('spend leaks here');
    });

    it('sets whatsLikelyHappening to null when absent', () => {
      const audit = createMockAudit();
      const message = createClusterMessage();

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.whatsLikelyHappening).to.equal(null);
    });

    it('coerces an explicit null whatsLikelyHappening to null', () => {
      const audit = createMockAudit();
      const message = createClusterMessage({ extraBody: { whatsLikelyHappening: null } });

      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());

      expect(result.data.whatsLikelyHappening).to.equal(null);
    });
  });

  describe('mapToKeywordOptimizerOpportunity — recommendedAction', () => {
    const poorCluster = (over = {}) => makeCluster({
      clusterId: 'c-poor',
      overallAlignmentScore: 'poor',
      representativeKeyword: 'okta verify app',
      keywords: [{ keyword: 'okta verify app', traffic: 565, cpc: 1.2 }],
      gapAnalysis: { keywordToPageGap: { explanation: 'wrong product intent', gapDescription: '' } },
      ...over,
    });

    it('builds an exclude action listing poor clusters and their keywords', () => {
      const message = createClusterMessage({ clusterResults: [poorCluster()] });
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, AR());

      expect(result.data.recommendedAction).to.deep.equal({
        actionType: 'exclude',
        totalClusters: 1,
        totalKeywords: 1,
        totalSearchVolume: 565,
        clusters: [{
          clusterId: 'c-poor',
          representativeKeyword: 'okta verify app',
          alignmentScore: 'poor',
          reason: 'wrong product intent',
          keywords: [{ keyword: 'okta verify app', searchVolume: 565 }],
        }],
      });
    });

    it('returns null when there are no poor clusters', () => {
      const message = createClusterMessage({ clusterResults: [makeCluster({ overallAlignmentScore: 'good' })] });
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, AR());
      expect(result.data.recommendedAction).to.equal(null);
    });

    it('excludes a poor cluster whose analysisStatus is failed', () => {
      const message = createClusterMessage({ clusterResults: [poorCluster({ analysisStatus: 'failed' })] });
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, AR());
      expect(result.data.recommendedAction).to.equal(null);
    });

    it('dedupes a keyword shared across two poor clusters in the totals', () => {
      const a = poorCluster({ clusterId: 'a', keywords: [{ keyword: 'dup', traffic: 100 }, { keyword: 'x', traffic: 50 }] });
      const b = poorCluster({ clusterId: 'b', keywords: [{ keyword: 'dup', traffic: 100 }] });
      const message = createClusterMessage({ clusterResults: [a, b] });
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, AR());

      expect(result.data.recommendedAction.totalClusters).to.equal(2);
      expect(result.data.recommendedAction.totalKeywords).to.equal(2); // dup + x, distinct
      expect(result.data.recommendedAction.totalSearchVolume).to.equal(150); // 100 + 50, dup counted once
    });

    it('handles a poor cluster with empty keywords (contributes 0)', () => {
      const message = createClusterMessage({ clusterResults: [poorCluster({ keywords: [] })] });
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, AR());
      expect(result.data.recommendedAction.clusters[0].keywords).to.deep.equal([]);
      expect(result.data.recommendedAction.totalKeywords).to.equal(0);
      expect(result.data.recommendedAction.totalSearchVolume).to.equal(0);
    });

    it('maps keyword traffic null/undefined to searchVolume 0', () => {
      const message = createClusterMessage({ clusterResults: [poorCluster({ keywords: [{ keyword: 'novol' }] })] });
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, AR());
      expect(result.data.recommendedAction.clusters[0].keywords[0].searchVolume).to.equal(0);
    });

    describe('reason resolution chain', () => {
      const reasonOf = (gapAnalysis) => {
        const message = createClusterMessage({ clusterResults: [poorCluster({ gapAnalysis })] });
        const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, AR());
        return result.data.recommendedAction.clusters[0].reason;
      };

      it('uses keywordToPageGap.explanation when set', () => {
        expect(reasonOf({ keywordToPageGap: { explanation: 'why', gapDescription: 'desc' } })).to.equal('why');
      });
      it('falls back to gapDescription when explanation is empty', () => {
        expect(reasonOf({ keywordToPageGap: { explanation: '  ', gapDescription: 'desc' } })).to.equal('desc');
      });
      it('returns null when both are empty', () => {
        expect(reasonOf({ keywordToPageGap: { explanation: '', gapDescription: '' } })).to.equal(null);
      });
      it('returns null when gapAnalysis has no keywordToPageGap', () => {
        expect(reasonOf({})).to.equal(null);
      });
      it('returns null when the cluster has no gapAnalysis', () => {
        const message = createClusterMessage({
          clusterResults: [makeCluster({ overallAlignmentScore: 'poor', gapAnalysis: undefined, keywords: [{ keyword: 'k', traffic: 1 }] })],
        });
        const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, AR());
        expect(result.data.recommendedAction.clusters[0].reason).to.equal(null);
      });
    });
  });

  describe('mapClusterToSuggestion', () => {
    it('creates suggestion with correct structure', () => {
      const context = { site: { requiresValidation: false } };
      const cluster = { ...makeCluster(), rank: 1 };

      const result = mapClusterToSuggestion(context, 'oppty-id', cluster);

      expect(result.opportunityId).to.equal('oppty-id');
      expect(result.type).to.equal('CONTENT_UPDATE');
      expect(result.rank).to.equal(1);
      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    });

    it('sets status to PENDING_VALIDATION when site requires validation', () => {
      const context = { site: { requiresValidation: true } };
      const cluster = { ...makeCluster(), rank: 1 };

      const result = mapClusterToSuggestion(context, 'oppty-id', cluster);

      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.PENDING_VALIDATION);
    });

    it('sets status to NEW when site is missing from context', () => {
      const context = {};
      const cluster = { ...makeCluster(), rank: 1 };

      const result = mapClusterToSuggestion(context, 'oppty-id', cluster);

      expect(result.status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    });

    it('includes all cluster fields in suggestion data', () => {
      const context = { site: { requiresValidation: false } };
      const cluster = {
        ...makeCluster({
          clusterId: 'c1',
          representativeKeyword: 'buy shoes',
          serpTitle: 'Best Shoes 2025',
          keywords: [{ keyword: 'buy shoes', cpc: 3.0, traffic: 1000 }],
          clusterTraffic: 1000,
          clusterCpc: 3.0,
          clusterMisalignedSpend: 250,
          analysisStatus: 'ok',
          gapAnalysis: { severity: 'medium' },
          overallAlignmentScore: 'fair',
          keywordAnalysis: [{ keyword: 'buy shoes', score: 0.5 }],
        }),
        adAnalysis: {
          isBranded: true,
          intentType: 'navigational',
          adPromise: 'Promotes the Twilio brand',
        },
        rank: 2,
      };

      const result = mapClusterToSuggestion(context, 'oppty-id', cluster);

      expect(result.data.cluster.clusterId).to.equal('c1');
      expect(result.data.cluster.representativeKeyword).to.equal('buy shoes');
      expect(result.data.cluster.serpTitle).to.equal('Best Shoes 2025');
      expect(result.data.cluster.keywords).to.deep.equal([{ keyword: 'buy shoes', cpc: 3.0, traffic: 1000 }]);
      expect(result.data.cluster.clusterTraffic).to.equal(1000);
      expect(result.data.cluster.clusterCpc).to.equal(3.0);
      expect(result.data.cluster.clusterMisalignedSpend).to.equal(250);
      expect(result.data.cluster.analysisStatus).to.equal('ok');
      expect(result.data.cluster.gapAnalysis).to.deep.equal({ severity: 'medium' });
      expect(result.data.cluster.overallAlignmentScore).to.equal('fair');
      expect(result.data.cluster.keywordAnalysis).to.deep.equal([{ keyword: 'buy shoes', score: 0.5 }]);
      // adAnalysis passed through verbatim (spec B.3-(1))
      expect(result.data.cluster.adAnalysis).to.deep.equal({
        isBranded: true,
        intentType: 'navigational',
        adPromise: 'Promotes the Twilio brand',
      });
    });

    it('lifts recommendation.type to recommendationType and removes type from nested object', () => {
      const context = { site: { requiresValidation: false } };
      const cluster = {
        ...makeCluster({
          recommendation: {
            type: 'modify_heading',
            changes: [{ tag: 'h1', newValue: 'New Title' }],
            rationale: 'Better alignment',
          },
        }),
        rank: 1,
      };

      const result = mapClusterToSuggestion(context, 'oppty-id', cluster);

      expect(result.data.recommendationType).to.equal('modify_heading');
      expect(result.data.recommendation).to.deep.equal({
        changes: [{ tag: 'h1', newValue: 'New Title' }],
        rationale: 'Better alignment',
      });
      // Verify 'type' is not in nested recommendation
      expect(result.data.recommendation).to.not.have.property('type');
    });

    it('omits recommendationType and recommendation when cluster has no recommendation', () => {
      const context = { site: { requiresValidation: false } };
      const cluster = { ...makeCluster(), rank: 1 };

      const result = mapClusterToSuggestion(context, 'oppty-id', cluster);

      expect(result.data).to.not.have.property('recommendationType');
      expect(result.data).to.not.have.property('recommendation');
    });

    it('defaults missing optional fields', () => {
      const context = { site: { requiresValidation: false } };
      const cluster = { clusterId: 'minimal', rank: 1 };

      const result = mapClusterToSuggestion(context, 'oppty-id', cluster);

      expect(result.data.cluster.keywords).to.deep.equal([]);
      expect(result.data.cluster.clusterTraffic).to.equal(0);
      expect(result.data.cluster.clusterCpc).to.be.null;
      expect(result.data.cluster.clusterMisalignedSpend).to.be.null;
      expect(result.data.cluster.analysisStatus).to.equal('unknown');
      expect(result.data.cluster.gapAnalysis).to.deep.equal({});
      expect(result.data.cluster.overallAlignmentScore).to.be.null;
      expect(result.data.cluster.keywordAnalysis).to.deep.equal([]);
      // adAnalysis is undefined on rolling-deploy clusters (older mystique
      // omits the key). Mapper MUST coerce to null. Spec B.3-(2).
      expect(result.data.cluster).to.have.property('adAnalysis');
      expect(result.data.cluster.adAnalysis).to.be.null;
    });

    it('preserves explicit null adAnalysis without coercion (spec B.3-(3))', () => {
      // Mystique emits explicit null when the cluster lacks ad-copy signal
      // (see spec Decision #3 — producer-internal threshold). The mapper MUST
      // NOT coerce that null to `{}` because the UI relies on the null to
      // hide the "What the ad promises" block.
      const context = { site: { requiresValidation: false } };
      const cluster = {
        ...makeCluster(),
        adAnalysis: null,
        rank: 1,
      };

      const result = mapClusterToSuggestion(context, 'oppty-id', cluster);

      expect(result.data.cluster).to.have.property('adAnalysis');
      expect(result.data.cluster.adAnalysis).to.be.null;
    });

    it('uses rank from cluster', () => {
      const context = { site: { requiresValidation: false } };
      const cluster = { ...makeCluster(), rank: 5 };

      const result = mapClusterToSuggestion(context, 'oppty-id', cluster);

      expect(result.rank).to.equal(5);
    });
  });

  describe('mapToKeywordOptimizerOpportunity — landingPageMetrics', () => {
    const auditResultWithPage = (over = {}) => ({
      predominantlyPaidPages: [{
        url: TEST_URL, bounceRate: 0.62, engagedScrollRate: 0.18, paidTrafficShare: 0.91, ...over,
      }],
    });

    it('builds landingPageMetrics from the matching predominantlyPaidPages row', () => {
      const result = mapToKeywordOptimizerOpportunity(
        TEST_SITE_ID, createMockAudit(), createClusterMessage(), auditResultWithPage(),
      );
      expect(result.data.landingPageMetrics).to.deep.equal({
        bounceRate: 0.62, engagedScrollRate: 0.18, paidTrafficShare: 0.91,
      });
    });

    it('returns null when auditResult has no predominantlyPaidPages', () => {
      const result = mapToKeywordOptimizerOpportunity(
        TEST_SITE_ID, createMockAudit(), createClusterMessage(), {},
      );
      expect(result.data.landingPageMetrics).to.equal(null);
    });

    it('returns null when the opportunity URL is not in predominantlyPaidPages', () => {
      const ar = { predominantlyPaidPages: [{ url: 'https://other/page', bounceRate: 0.5, engagedScrollRate: 0.1, paidTrafficShare: 0.8 }] };
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), createClusterMessage(), ar);
      expect(result.data.landingPageMetrics).to.equal(null);
    });

    it('sets paidTrafficShare to null when the matched row predates the field', () => {
      const ar = { predominantlyPaidPages: [{ url: TEST_URL, bounceRate: 0.62, engagedScrollRate: 0.18 }] };
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), createClusterMessage(), ar);
      expect(result.data.landingPageMetrics.paidTrafficShare).to.equal(null);
    });

    it('matches the URL ignoring a www. difference', () => {
      const ar = { predominantlyPaidPages: [{ url: 'https://www.sample-page/page1', bounceRate: 0.4, engagedScrollRate: 0.2, paidTrafficShare: 0.75 }] };
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), createClusterMessage(), ar);
      expect(result.data.landingPageMetrics).to.deep.equal({ bounceRate: 0.4, engagedScrollRate: 0.2, paidTrafficShare: 0.75 });
    });

    // Spec B.3 final bullet: existing keys + top-level title/guidance survive WHEN the new keys are present.
    it('preserves existing opportunity fields when the new keys are present', () => {
      const message = createClusterMessage({ extraBody: { whatsLikelyHappening: 'narr' } });
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, auditResultWithPage());

      expect(result.title).to.equal('Ad intent mismatch detected across keyword clusters');
      expect(result.guidance).to.equal(null);
      expect(result.data.url).to.equal(TEST_URL);
      expect(result.data.page).to.equal(TEST_URL);
      expect(result.data.portfolioMetrics).to.exist;
      expect(result.data.totalClusters).to.be.a('number');
      expect(result.data.langfuseTraceId).to.equal('trace-123');
      expect(result.data.whatsLikelyHappening).to.equal('narr');
      expect(result.data.landingPageMetrics).to.not.equal(null);
    });
  });
});
