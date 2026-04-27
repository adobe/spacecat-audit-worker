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
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { describe } from 'mocha';
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import handler from '../../../src/paid-keyword-optimizer/guidance-handler.js';

use(sinonChai);
use(chaiAsPromised);

const TEST_URL = 'https://example-page/page1';

function makeCluster({
  clusterId = 'cluster-1',
  analysisStatus = 'ok',
  recommendation = null,
  clusterMisalignedSpend = 100,
  clusterTraffic = 500,
  clusterCpc = 2.0,
  representativeKeyword = 'test keyword',
  serpTitle = 'Test SERP Title',
  keywords = [],
  gapAnalysis = {},
  overallAlignmentScore = 'fair',
  keywordAnalysis = [],
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
  observability = null,
  langfuseTraceId = 'trace-123',
  langfuseTraceUrl = 'https://langfuse.example.com/trace/123',
} = {}) {
  return {
    auditId: 'auditId',
    siteId: 'site',
    data: {
      url: TEST_URL,
      guidance: [{
        body: {
          clusterResults,
          portfolioMetrics,
          langfuseTraceId,
          langfuseTraceUrl,
          ...(observability && { observability }),
        },
      }],
    },
  };
}

// Helper to create a fresh stubbed opportunity instance
function makeOppty({
  id, type = 'ad-intent-mismatch', status = 'NEW', url = null,
}) {
  return {
    getId: () => id,
    setStatus: sinon.stub(),
    save: sinon.stub().resolvesThis(),
    getType: () => type,
    getData: () => ({ url }),
    getStatus: () => status,
  };
}

describe('Paid Keyword Optimizer Guidance Handler (cluster format)', () => {
  let sandbox;
  let logStub;
  let context;
  let Suggestion;
  let Opportunity;
  let Audit;
  let opportunityInstance;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    Suggestion = {
      create: sandbox.stub().resolves(),
    };
    opportunityInstance = {
      getId: () => 'opptyId',
      getType: () => 'ad-intent-mismatch',
      getData: () => ({ url: TEST_URL }),
      getStatus: () => 'NEW',
    };
    Opportunity = {
      allBySiteIdAndStatus: sandbox.stub().resolves([]),
      create: sandbox.stub(),
      saveMany: sandbox.stub().resolves(),
    };
    Audit = { findById: sandbox.stub() };

    context = {
      log: logStub,
      dataAccess: { Audit, Opportunity, Suggestion },
      env: {},
    };

    Audit.findById.resolves({
      getAuditId: () => 'auditId',
      getAuditType: () => 'paid-keyword-optimizer',
      getAuditResult: () => ({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
      }),
    });
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  describe('failure envelope', () => {
    it('should return ok and log when receiving a failure envelope', async () => {
      const message = {
        auditId: 'auditId',
        siteId: 'site',
        data: {
          status: 'failed',
          url: TEST_URL,
          error: {
            type: 'GuidanceGenerationError',
            message: 'Analysis failed.',
            traceId: 'test-trace-123',
          },
        },
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).not.to.have.been.called;
      expect(Suggestion.create).not.to.have.been.called;
      expect(Audit.findById).not.to.have.been.called;
      expect(logStub.info).to.have.been.calledWith(
        sinon.match({
          trace_id: 'test-trace-123',
          audit_id: 'auditId',
          site_id: 'site',
          url: TEST_URL,
          error_type: 'GuidanceGenerationError',
        }),
        '[ad-intent-mismatch] URL-level failure from Mystique',
      );
    });
  });

  describe('audit lookup', () => {
    it('should return notFound if no audit is found', async () => {
      Audit.findById.resolves(null);
      const message = createClusterMessage();

      const result = await handler(message, context);

      expect(result.status).to.equal(notFound().status);
    });

    it('should return ok and skip when audit has no result data', async () => {
      Audit.findById.resolves({
        getAuditId: () => 'auditId',
        getAuditType: () => 'paid-keyword-optimizer',
        getAuditResult: () => null,
      });
      const message = createClusterMessage();

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });
  });

  describe('clusterResults gate', () => {
    it('should skip when guidance body is null', async () => {
      const message = {
        auditId: 'auditId',
        siteId: 'site',
        data: {
          url: TEST_URL,
          guidance: [{ body: null }],
        },
      };

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should skip when clusterResults is absent from body', async () => {
      const message = {
        auditId: 'auditId',
        siteId: 'site',
        data: {
          url: TEST_URL,
          guidance: [{ body: { portfolioMetrics: {} } }],
        },
      };

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should skip when guidance array is empty', async () => {
      const message = {
        auditId: 'auditId',
        siteId: 'site',
        data: {
          url: TEST_URL,
          guidance: [],
        },
      };

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should skip when guidance is undefined', async () => {
      const message = {
        auditId: 'auditId',
        siteId: 'site',
        data: {
          url: TEST_URL,
        },
      };

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });
  });

  describe('opportunity and suggestion creation', () => {
    it('should create 1 opportunity and 1 suggestion per cluster', async () => {
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading', changes: [] } }),
        makeCluster({ clusterId: 'c2' }),
      ];
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage({ clusterResults: clusters });

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).to.have.been.calledTwice;
      expect(result.status).to.equal(ok().status);
    });

    it('should create suggestions with composite ranks', async () => {
      const clusters = [
        makeCluster({ clusterId: 'aligned', clusterTraffic: 200 }),
        makeCluster({
          clusterId: 'mismatched',
          recommendation: { type: 'modify_heading', changes: [] },
          clusterMisalignedSpend: 500,
        }),
      ];
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage({ clusterResults: clusters });

      await handler(message, context);

      // mismatched cluster should be rank 1 (tier 0), aligned should be rank 2 (tier 1)
      const call0 = Suggestion.create.getCall(0).args[0];
      const call1 = Suggestion.create.getCall(1).args[0];
      expect(call0.rank).to.equal(1);
      expect(call1.rank).to.equal(2);
    });

    it('should set suggestion status to PENDING_VALIDATION when site requires validation', async () => {
      Opportunity.create.resolves(opportunityInstance);
      context.site = { requiresValidation: true };
      const message = createClusterMessage();

      await handler(message, context);

      expect(Suggestion.create).to.have.been.calledWith(sinon.match.has('status', 'PENDING_VALIDATION'));
    });

    it('should set suggestion status to NEW when site does not require validation', async () => {
      Opportunity.create.resolves(opportunityInstance);
      context.site = { requiresValidation: false };
      const message = createClusterMessage();

      await handler(message, context);

      expect(Suggestion.create).to.have.been.calledWith(sinon.match.has('status', 'NEW'));
    });
  });

  describe('observability logging', () => {
    it('should log observability data when present', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const observability = { duration_ms: 1200, model: 'gpt-4' };
      const message = createClusterMessage({ observability });

      await handler(message, context);

      expect(logStub.info).to.have.been.calledWith(
        sinon.match({
          duration_ms: 1200,
          model: 'gpt-4',
          site_id: 'site',
          url: TEST_URL,
          audit_id: 'auditId',
        }),
        '[ad-intent-mismatch] Mystique observability data',
      );
    });

    it('should not log observability data when absent', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage({ observability: null });

      await handler(message, context);

      const observabilityCalls = logStub.info.getCalls().filter(
        (c) => typeof c.args[1] === 'string' && c.args[1].includes('observability'),
      );
      expect(observabilityCalls).to.have.lengthOf(0);
    });
  });

  describe('replace-on-re-audit', () => {
    it('should mark existing NEW opportunity for same URL as IGNORED', async () => {
      const existingNew = makeOppty({ id: 'old-new', url: TEST_URL });
      Opportunity.allBySiteIdAndStatus
        .withArgs('site', 'NEW').resolves([existingNew])
        .withArgs('site', 'IN_PROGRESS').resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage();

      const result = await handler(message, context);

      expect(existingNew.setStatus).to.have.been.calledWith('IGNORED');
      expect(Opportunity.saveMany).to.have.been.calledWith([existingNew]);
      expect(result.status).to.equal(ok().status);
    });

    it('should mark existing IN_PROGRESS opportunity for same URL as IGNORED', async () => {
      const existingInProgress = makeOppty({ id: 'old-ip', status: 'IN_PROGRESS', url: TEST_URL });
      Opportunity.allBySiteIdAndStatus
        .withArgs('site', 'NEW').resolves([])
        .withArgs('site', 'IN_PROGRESS').resolves([existingInProgress]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage();

      const result = await handler(message, context);

      expect(existingInProgress.setStatus).to.have.been.calledWith('IGNORED');
      expect(Opportunity.saveMany).to.have.been.calledWith([existingInProgress]);
      expect(result.status).to.equal(ok().status);
    });

    it('should NOT mark RESOLVED opportunities as IGNORED (different status query)', async () => {
      // RESOLVED opportunities are not returned by allBySiteIdAndStatus for NEW/IN_PROGRESS
      Opportunity.allBySiteIdAndStatus
        .withArgs('site', 'NEW').resolves([])
        .withArgs('site', 'IN_PROGRESS').resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage();

      const result = await handler(message, context);

      expect(Opportunity.saveMany).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should NOT mark opportunities for different URLs as IGNORED', async () => {
      const differentUrl = makeOppty({ id: 'diff-url', url: 'https://example.com/other' });
      Opportunity.allBySiteIdAndStatus
        .withArgs('site', 'NEW').resolves([differentUrl])
        .withArgs('site', 'IN_PROGRESS').resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage();

      const result = await handler(message, context);

      expect(differentUrl.setStatus).not.to.have.been.called;
      expect(Opportunity.saveMany).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should NOT mark opportunities of different types as IGNORED', async () => {
      const wrongType = makeOppty({ id: 'wrong-type', type: 'other-type', url: TEST_URL });
      Opportunity.allBySiteIdAndStatus
        .withArgs('site', 'NEW').resolves([wrongType])
        .withArgs('site', 'IN_PROGRESS').resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage();

      const result = await handler(message, context);

      expect(wrongType.setStatus).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should handle old-format opportunity in DB without crashing', async () => {
      // Old format: data has gapAnalysis at top level, no portfolioMetrics
      const oldFormatOppty = makeOppty({ id: 'old-format', url: TEST_URL });
      // Override getData to return old-format shape
      oldFormatOppty.getData = () => ({
        url: TEST_URL,
        gapAnalysis: { severity: 'high' },
        cpc: 4.50,
        sumTraffic: 150,
      });
      Opportunity.allBySiteIdAndStatus
        .withArgs('site', 'NEW').resolves([oldFormatOppty])
        .withArgs('site', 'IN_PROGRESS').resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage();

      const result = await handler(message, context);

      // Old opportunity marked IGNORED, new opportunity created, no errors
      expect(oldFormatOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(Opportunity.saveMany).to.have.been.calledWith([oldFormatOppty]);
      expect(Opportunity.create).to.have.been.calledOnce;
      expect(result.status).to.equal(ok().status);
    });

    it('should mark multiple existing opportunities as IGNORED in one saveMany call', async () => {
      const old1 = makeOppty({ id: 'old1', url: TEST_URL });
      const old2 = makeOppty({ id: 'old2', status: 'IN_PROGRESS', url: TEST_URL });
      Opportunity.allBySiteIdAndStatus
        .withArgs('site', 'NEW').resolves([old1])
        .withArgs('site', 'IN_PROGRESS').resolves([old2]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage();

      await handler(message, context);

      expect(old1.setStatus).to.have.been.calledWith('IGNORED');
      expect(old2.setStatus).to.have.been.calledWith('IGNORED');
      expect(Opportunity.saveMany).to.have.been.calledOnce;
      expect(Opportunity.saveMany).to.have.been.calledWith([old1, old2]);
    });
  });

  describe('langfuseTraceId and hasConflictingHeadlineRecommendations', () => {
    it('should pass langfuseTraceId to opportunity data', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const message = createClusterMessage({
        langfuseTraceId: 'trace-abc',
        langfuseTraceUrl: 'https://langfuse.example.com/trace/abc',
      });

      await handler(message, context);

      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.data.langfuseTraceId).to.equal('trace-abc');
      expect(createCall.data.langfuseTraceUrl).to.equal('https://langfuse.example.com/trace/abc');
    });

    it('should compute hasConflictingHeadlineRecommendations=true when multiple modify_heading clusters', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading', changes: [] } }),
        makeCluster({ clusterId: 'c2', recommendation: { type: 'modify_heading', changes: [] } }),
      ];
      const message = createClusterMessage({ clusterResults: clusters });

      await handler(message, context);

      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.data.hasConflictingHeadlineRecommendations).to.be.true;
    });

    it('should compute hasConflictingHeadlineRecommendations=false when one or zero modify_heading clusters', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const clusters = [
        makeCluster({ clusterId: 'c1', recommendation: { type: 'modify_heading', changes: [] } }),
        makeCluster({ clusterId: 'c2' }),
      ];
      const message = createClusterMessage({ clusterResults: clusters });

      await handler(message, context);

      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.data.hasConflictingHeadlineRecommendations).to.be.false;
    });
  });
});
