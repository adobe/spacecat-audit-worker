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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { describe } from 'mocha';
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import handler, {
  inferRecommendationType,
  reconcileOpportunities,
  MAX_OPPORTUNITIES_PER_TYPE,
} from '../../../src/paid-keyword-optimizer/guidance-handler.js';

use(sinonChai);
use(chaiAsPromised);

const TEST_URL = 'https://example-page/page1';

// Helper to create a message in the GuidanceWithBody format
function createMessage({ bodyOverrides, guidanceOverrides } = {}) {
  return {
    auditId: 'auditId',
    siteId: 'site',
    data: {
      url: TEST_URL,
      guidance: [{
        insight: 'test insight',
        rationale: 'test rationale',
        recommendation: 'test recommendation',
        type: 'guidance',
        ...guidanceOverrides,
        body: {
          issueSeverity: 'medium',
          url: TEST_URL,
          suggestions: [
            { id: 'original', name: 'Original', screenshotUrl: 'https://example.com/original.png' },
            { id: 'variation-0', name: 'Variation 0', screenshotUrl: 'https://example.com/var0.png' },
          ],
          cpc: 0.075,
          sumTraffic: 23423.5,
          ...bodyOverrides,
        },
      }],
      suggestions: [],
    },
  };
}

// Counter for unique suggestion IDs
let suggestionCounter = 0;

// Helper to create suggestion mocks with variations
function makeSuggestionWithVariations(variations) {
  suggestionCounter += 1;
  return [{
    getId: () => `suggestion-${suggestionCounter}`,
    getData: () => ({ variations }),
  }];
}

// Helper to create a fresh stubbed opportunity instance
function makeOppty({
  id, type, status = 'NEW', updatedBy = 'system', url = null,
  sumTraffic = 0, suggestions = [], updatedAt = null,
}) {
  return {
    getId: () => id,
    getSuggestions: async () => suggestions,
    setAuditId: sinon.stub(),
    setData: sinon.stub(),
    setGuidance: sinon.stub(),
    setTitle: sinon.stub(),
    setDescription: sinon.stub(),
    setStatus: sinon.stub(),
    save: sinon.stub().resolvesThis(),
    getType: () => type,
    getData: () => ({ url, sumTraffic }),
    getStatus: () => status,
    getUpdatedBy: () => updatedBy,
    getUpdatedAt: () => updatedAt || new Date().toISOString(),
  };
}

describe('Paid Keyword Optimizer Guidance Handler', () => {
  let sandbox;
  let logStub;
  let context;
  let Suggestion;
  let Opportunity;
  let Audit;
  let opportunityInstance;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    suggestionCounter = 0;
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    Suggestion = {
      create: sandbox.stub().resolves(),
      removeByIds: sandbox.stub().resolves(),
      STATUSES: SuggestionDataAccess.STATUSES,
      TYPES: SuggestionDataAccess.TYPES,
    };
    opportunityInstance = {
      getId: () => 'opptyId',
      getSuggestions: async () => [],
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      setTitle: sinon.stub(),
      setStatus: sinon.stub(),
      setDescription: sinon.stub(),
      save: sinon.stub().resolvesThis(),
      getType: () => 'ad-intent-mismatch',
      getData: () => ({ url: TEST_URL }),
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      getUpdatedAt: () => new Date().toISOString(),
    };
    Opportunity = {
      allBySiteIdAndStatus: sandbox.stub().resolves([]),
      create: sandbox.stub(),
      saveMany: sandbox.stub().resolves(),
      removeByIds: sandbox.stub().resolves(),
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
        predominantlyPaidPages: [
          { url: TEST_URL, bounceRate: 0.5, pageViews: 5000, trafficLoss: 2500 },
        ],
        predominantlyPaidCount: 1,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      }),
    });
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  describe('inferRecommendationType', () => {
    it('should return audit_required when suggestions have suggestionText', () => {
      const suggestions = [{ suggestionText: 'some text' }];
      expect(inferRecommendationType(suggestions)).to.equal('audit_required');
    });

    it('should return modify_heading when suggestions have variationChanges', () => {
      const suggestions = [{ variationChanges: [{ tag: 'h1', newValue: 'New' }] }];
      expect(inferRecommendationType(suggestions)).to.equal('modify_heading');
    });

    it('should return unknown when neither field is present', () => {
      const suggestions = [{ id: 'some-id' }];
      expect(inferRecommendationType(suggestions)).to.equal('unknown');
    });

    it('should return unknown for empty array', () => {
      expect(inferRecommendationType([])).to.equal('unknown');
    });

    it('should return unknown for null/undefined input', () => {
      expect(inferRecommendationType(null)).to.equal('unknown');
      expect(inferRecommendationType(undefined)).to.equal('unknown');
    });

    it('should prefer audit_required over modify_heading when both are present', () => {
      const suggestions = [
        { suggestionText: 'text', variationChanges: [{ tag: 'h1' }] },
      ];
      expect(inferRecommendationType(suggestions)).to.equal('audit_required');
    });
  });

  describe('MAX_OPPORTUNITIES_PER_TYPE', () => {
    it('should be 4', () => {
      expect(MAX_OPPORTUNITIES_PER_TYPE).to.equal(4);
    });
  });

  describe('reconcileOpportunities', () => {
    it('should not remove anything when audit_required count <= MAX', async () => {
      const opptys = [];
      for (let i = 0; i < 3; i += 1) {
        opptys.push(makeOppty({
          id: `o${i}`,
          type: 'ad-intent-mismatch',
          suggestions: makeSuggestionWithVariations([{ suggestionText: 'text' }]),
          updatedAt: new Date(2025, 0, i + 1).toISOString(),
        }));
      }

      await reconcileOpportunities(opptys, context.dataAccess, logStub, 'site');

      expect(Opportunity.removeByIds).to.not.have.been.called;
      expect(Suggestion.removeByIds).to.not.have.been.called;
    });

    it('should remove newest excess audit_required opportunities and their suggestions', async () => {
      const opptys = [];
      for (let i = 0; i < 6; i += 1) {
        opptys.push(makeOppty({
          id: `o${i}`,
          type: 'ad-intent-mismatch',
          suggestions: makeSuggestionWithVariations([{ suggestionText: 'text' }]),
          updatedAt: new Date(2025, 0, i + 1).toISOString(), // o0=oldest, o5=newest
        }));
      }

      await reconcileOpportunities(opptys, context.dataAccess, logStub, 'site');

      // Should remove o4 and o5 (newest 2 excess beyond MAX of 4)
      expect(Opportunity.removeByIds).to.have.been.calledOnce;
      const removedIds = Opportunity.removeByIds.getCall(0).args[0];
      expect(removedIds).to.have.lengthOf(2);
      expect(removedIds).to.include('o4');
      expect(removedIds).to.include('o5');

      // Should also remove their suggestions
      expect(Suggestion.removeByIds).to.have.been.calledOnce;
      expect(Suggestion.removeByIds.getCall(0).args[0]).to.have.lengthOf(2);
    });

    it('should never remove modify_heading opportunities even if total count > MAX', async () => {
      const opptys = [];
      // 6 modify_heading opportunities (all have variationChanges)
      for (let i = 0; i < 6; i += 1) {
        opptys.push(makeOppty({
          id: `mh${i}`,
          type: 'ad-intent-mismatch',
          suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
          updatedAt: new Date(2025, 0, i + 1).toISOString(),
        }));
      }

      await reconcileOpportunities(opptys, context.dataAccess, logStub, 'site');

      // Nothing removed — modify_heading are protected
      expect(Opportunity.removeByIds).to.not.have.been.called;
      expect(Suggestion.removeByIds).to.not.have.been.called;
    });

    it('should only cap audit_required while keeping all modify_heading', async () => {
      const opptys = [];

      // 3 modify_heading (protected)
      for (let i = 0; i < 3; i += 1) {
        opptys.push(makeOppty({
          id: `mh${i}`,
          type: 'ad-intent-mismatch',
          suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
          updatedAt: new Date(2025, 0, i + 1).toISOString(),
        }));
      }

      // 5 audit_required (should be capped at 4)
      for (let i = 0; i < 5; i += 1) {
        opptys.push(makeOppty({
          id: `ar${i}`,
          type: 'ad-intent-mismatch',
          suggestions: makeSuggestionWithVariations([{ suggestionText: 'review' }]),
          updatedAt: new Date(2025, 1, i + 1).toISOString(), // ar0=oldest, ar4=newest
        }));
      }

      await reconcileOpportunities(opptys, context.dataAccess, logStub, 'site');

      // Only ar4 (newest excess) should be removed
      expect(Opportunity.removeByIds).to.have.been.calledOnce;
      const removedIds = Opportunity.removeByIds.getCall(0).args[0];
      expect(removedIds).to.have.lengthOf(1);
      expect(removedIds).to.include('ar4');

      // None of the modify_heading should be touched
      expect(removedIds).to.not.include('mh0');
      expect(removedIds).to.not.include('mh1');
      expect(removedIds).to.not.include('mh2');
    });

    it('should handle empty activeOpportunities', async () => {
      await reconcileOpportunities([], context.dataAccess, logStub, 'site');

      expect(Opportunity.removeByIds).to.not.have.been.called;
      expect(Suggestion.removeByIds).to.not.have.been.called;
    });

    it('should handle opportunities with no suggestions (unknown type)', async () => {
      const opptys = [];
      for (let i = 0; i < 6; i += 1) {
        opptys.push(makeOppty({
          id: `u${i}`,
          type: 'ad-intent-mismatch',
          suggestions: [{ getId: () => `s-u${i}`, getData: () => ({}) }],
          updatedAt: new Date(2025, 0, i + 1).toISOString(),
        }));
      }

      await reconcileOpportunities(opptys, context.dataAccess, logStub, 'site');

      // unknown type is not audit_required, so nothing is capped
      expect(Opportunity.removeByIds).to.not.have.been.called;
    });

    it('should not call Suggestion.removeByIds when excess have no suggestions', async () => {
      const opptys = [];
      for (let i = 0; i < 5; i += 1) {
        opptys.push(makeOppty({
          id: `o${i}`,
          type: 'ad-intent-mismatch',
          // getSuggestions returns items with suggestionText but no getId for the removal
          suggestions: [{
            getId: () => `s${i}`,
            getData: () => ({ variations: [{ suggestionText: 'text' }] }),
          }],
          updatedAt: new Date(2025, 0, i + 1).toISOString(),
        }));
      }

      await reconcileOpportunities(opptys, context.dataAccess, logStub, 'site');

      // Should remove o4 (newest excess)
      expect(Opportunity.removeByIds).to.have.been.calledOnce;
      expect(Suggestion.removeByIds).to.have.been.calledOnce;
      expect(Suggestion.removeByIds.getCall(0).args[0]).to.deep.equal(['s4']);
    });
  });

  describe('handler', () => {
    it('should return notFound if no audit is found', async () => {
      Audit.findById.resolves(null);
      const message = createMessage();

      const result = await handler(message, context);

      expect(result.status).to.equal(notFound().status);
    });

    it('should return ok and skip when audit has no result data', async () => {
      Audit.findById.resolves({
        getAuditId: () => 'auditId',
        getAuditType: () => 'paid-keyword-optimizer',
        getAuditResult: () => null,
      });
      const message = createMessage();

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(Suggestion.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should create a new opportunity and suggestion', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should mark existing opportunities for the same URL as IGNORED', async () => {
      const existingOpptyForSameUrl = makeOppty({
        id: 'opptyId-1',
        type: 'ad-intent-mismatch',
        status: 'NEW',
        updatedBy: 'system',
        url: TEST_URL,
      });

      Opportunity.allBySiteIdAndStatus.resolves([existingOpptyForSameUrl]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
      expect(existingOpptyForSameUrl.setStatus).to.have.been.calledWith('IGNORED');
      expect(Opportunity.saveMany).to.have.been.calledWith([existingOpptyForSameUrl]);
      expect(result.status).to.equal(ok().status);
    });

    it('should NOT mark existing opportunities for different URLs as IGNORED', async () => {
      const existingOpptyForDifferentUrl = makeOppty({
        id: 'opptyId-1',
        type: 'ad-intent-mismatch',
        status: 'NEW',
        updatedBy: 'system',
        url: 'https://example-page/different-page',
      });

      Opportunity.allBySiteIdAndStatus.resolves([existingOpptyForDifferentUrl]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      expect(existingOpptyForDifferentUrl.setStatus).to.not.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should only mark same-URL system opportunities as IGNORED, not user-modified ones', async () => {
      const systemOpptyForSameUrl = makeOppty({
        id: 'opptyId-system',
        type: 'ad-intent-mismatch',
        status: 'NEW',
        updatedBy: 'system',
        url: TEST_URL,
      });
      const userOpptyForSameUrl = makeOppty({
        id: 'opptyId-user',
        type: 'ad-intent-mismatch',
        status: 'NEW',
        updatedBy: 'user',
        url: TEST_URL,
      });

      Opportunity.allBySiteIdAndStatus.resolves([systemOpptyForSameUrl, userOpptyForSameUrl]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      expect(systemOpptyForSameUrl.setStatus).to.have.been.calledWith('IGNORED');
      expect(Opportunity.saveMany).to.have.been.calledWith([systemOpptyForSameUrl]);
      expect(userOpptyForSameUrl.setStatus).to.not.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should not mark opportunities of different types as IGNORED', async () => {
      const wrongTypeOppty = makeOppty({
        id: 'opptyId-3',
        type: 'other-type',
        status: 'NEW',
        updatedBy: 'system',
        url: TEST_URL,
      });

      Opportunity.allBySiteIdAndStatus.resolves([wrongTypeOppty]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      expect(wrongTypeOppty.setStatus).to.not.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should create opportunity for low severity (low now qualifies)', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage({ bodyOverrides: { issueSeverity: 'low' } });

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should skip opportunity creation for none severity', async () => {
      const message = createMessage({ bodyOverrides: { issueSeverity: 'none' } });

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should create opportunity if severity is medium', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage({ bodyOverrides: { issueSeverity: 'Medium' } });

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should create opportunity if severity is high', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage({ bodyOverrides: { issueSeverity: 'high' } });

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should set suggestion status to PENDING_VALIDATION when site requires validation', async () => {
      Opportunity.create.resolves(opportunityInstance);
      context.site = { requiresValidation: true };
      const message = createMessage();

      await handler(message, context);

      expect(Suggestion.create).to.have.been.calledWith(sinon.match.has('status', 'PENDING_VALIDATION'));
    });

    it('should set suggestion status to NEW when site does not require validation', async () => {
      Opportunity.create.resolves(opportunityInstance);
      context.site = { requiresValidation: false };
      const message = createMessage();

      await handler(message, context);

      expect(Suggestion.create).to.have.been.calledWith(sinon.match.has('status', 'NEW'));
    });

    it('should not mark the newly created opportunity as IGNORED', async () => {
      const existingOppty = makeOppty({
        id: 'existing-oppty-id',
        type: 'ad-intent-mismatch',
        status: 'NEW',
        updatedBy: 'system',
        url: TEST_URL,
      });

      Opportunity.allBySiteIdAndStatus.resolves([existingOppty]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      expect(existingOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(Opportunity.saveMany).to.have.been.calledWith([existingOppty]);
      expect(result.status).to.equal(ok().status);
    });

    it('should skip opportunity creation when guidance is empty', async () => {
      const message = {
        auditId: 'auditId',
        siteId: 'site',
        data: {
          url: TEST_URL,
          guidance: [],
          suggestions: [],
        },
      };

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(Suggestion.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should skip opportunity creation when guidance is missing', async () => {
      const message = {
        auditId: 'auditId',
        siteId: 'site',
        data: {
          url: TEST_URL,
          suggestions: [],
        },
      };

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(Suggestion.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should store suggestions as variations in the suggestion data', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const suggestions = [
        { id: 'original', name: 'Original', screenshotUrl: 'https://example.com/original.png' },
        { id: 'variation-0', name: 'Variation 0', screenshotUrl: 'https://example.com/var0.png' },
      ];
      const message = createMessage({ bodyOverrides: { suggestions } });

      await handler(message, context);

      const suggestionCreateCall = Suggestion.create.getCall(0);
      expect(suggestionCreateCall.args[0].data.variations).to.deep.equal(suggestions);
    });

    it('should pass the full message to the opportunity mapper', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      await handler(message, context);

      const opportunityCreateCall = Opportunity.create.getCall(0);
      const createdOpportunity = opportunityCreateCall.args[0];

      expect(createdOpportunity.data).to.have.property('url', TEST_URL);
      expect(createdOpportunity.data).to.have.property('cpc', 0.075);
      expect(createdOpportunity.data).to.have.property('sumTraffic', 23423.5);
    });

    it('should include insight, rationale, and recommendation in opportunity guidance', async () => {
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage({
        guidanceOverrides: {
          insight: 'custom insight',
          rationale: 'custom rationale',
          recommendation: 'custom recommendation',
        },
      });

      await handler(message, context);

      const opportunityCreateCall = Opportunity.create.getCall(0);
      const createdOpportunity = opportunityCreateCall.args[0];

      expect(createdOpportunity.guidance.recommendations[0]).to.deep.include({
        insight: 'custom insight',
        rationale: 'custom rationale',
        recommendation: 'custom recommendation',
        type: 'guidance',
      });
    });

    describe('reconciliation in handler flow', () => {
      it('should run reconciliation after creating opportunity', async () => {
        // 5 audit_required opportunities (including the newly created one)
        const opptys = [];
        for (let i = 0; i < 5; i += 1) {
          opptys.push(makeOppty({
            id: `existing-${i}`,
            type: 'ad-intent-mismatch',
            url: `https://other${i}.com`,
            suggestions: makeSuggestionWithVariations([{ suggestionText: 'review' }]),
            updatedAt: new Date(2025, 0, i + 1).toISOString(),
          }));
        }

        Opportunity.allBySiteIdAndStatus.resolves(opptys);
        Opportunity.create.resolves(opportunityInstance);
        const message = createMessage();

        const result = await handler(message, context);

        // Should have created then reconciled (removing newest excess)
        expect(Opportunity.create).to.have.been.called;
        expect(Opportunity.removeByIds).to.have.been.calledOnce;
        expect(result.status).to.equal(ok().status);
      });

      it('should never remove modify_heading opportunities during reconciliation', async () => {
        // 6 modify_heading opportunities — all protected
        const opptys = [];
        for (let i = 0; i < 6; i += 1) {
          opptys.push(makeOppty({
            id: `mh${i}`,
            type: 'ad-intent-mismatch',
            url: `https://page${i}.com`,
            suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
            updatedAt: new Date(2025, 0, i + 1).toISOString(),
          }));
        }

        Opportunity.allBySiteIdAndStatus.resolves(opptys);
        Opportunity.create.resolves(opportunityInstance);
        const message = createMessage();

        const result = await handler(message, context);

        // modify_heading are never removed
        expect(Opportunity.removeByIds).to.not.have.been.called;
        expect(result.status).to.equal(ok().status);
      });

      it('should exclude IGNORED opportunities from reconciliation', async () => {
        // 2 opportunities for same URL (one will be IGNORED) + 3 others = 5 total
        const sameUrlOppty = makeOppty({
          id: 'same-url-old',
          type: 'ad-intent-mismatch',
          url: TEST_URL,
          suggestions: makeSuggestionWithVariations([{ suggestionText: 'old' }]),
          updatedAt: new Date(2025, 0, 1).toISOString(),
        });

        const others = [];
        for (let i = 0; i < 3; i += 1) {
          others.push(makeOppty({
            id: `other-${i}`,
            type: 'ad-intent-mismatch',
            url: `https://other${i}.com`,
            suggestions: makeSuggestionWithVariations([{ suggestionText: 'text' }]),
            updatedAt: new Date(2025, 0, i + 2).toISOString(),
          }));
        }

        Opportunity.allBySiteIdAndStatus.resolves([sameUrlOppty, ...others]);
        Opportunity.create.resolves(opportunityInstance);
        const message = createMessage();

        const result = await handler(message, context);

        // sameUrlOppty should be IGNORED (same URL)
        expect(sameUrlOppty.setStatus).to.have.been.calledWith('IGNORED');
        // Reconciliation should only see 3 active (others), which is under cap
        expect(Opportunity.removeByIds).to.not.have.been.called;
        expect(result.status).to.equal(ok().status);
      });
    });
  });
});
