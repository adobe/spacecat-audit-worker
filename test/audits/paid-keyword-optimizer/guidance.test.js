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
  getEvictionScore,
  findLowestEvictionCandidate,
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

// Helper to create a fresh stubbed opportunity instance
function makeOppty({
  id, type, status = 'NEW', updatedBy = 'system', url = null, sumTraffic = 0, suggestions = [],
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
    getUpdatedAt: () => new Date().toISOString(),
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
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    Suggestion = {
      create: sandbox.stub().resolves(),
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
      allBySiteId: sandbox.stub(),
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

  describe('getEvictionScore', () => {
    it('should return sumTraffic from opportunity data', () => {
      const oppty = makeOppty({
        id: 'o1', type: 'ad-intent-mismatch', sumTraffic: 5000,
      });
      expect(getEvictionScore(oppty)).to.equal(5000);
    });

    it('should return 0 when sumTraffic is missing', () => {
      const oppty = {
        getData: () => ({}),
      };
      expect(getEvictionScore(oppty)).to.equal(0);
    });

    it('should return 0 when getData returns null', () => {
      const oppty = {
        getData: () => null,
      };
      expect(getEvictionScore(oppty)).to.equal(0);
    });
  });

  describe('findLowestEvictionCandidate', () => {
    it('should find the opportunity with the lowest sumTraffic', () => {
      const oppty1 = makeOppty({ id: 'o1', type: 'ad-intent-mismatch', sumTraffic: 5000 });
      const oppty2 = makeOppty({ id: 'o2', type: 'ad-intent-mismatch', sumTraffic: 1000 });
      const oppty3 = makeOppty({ id: 'o3', type: 'ad-intent-mismatch', sumTraffic: 3000 });

      const result = findLowestEvictionCandidate([oppty1, oppty2, oppty3]);
      expect(result.getId()).to.equal('o2');
    });

    it('should return first element if all have equal scores', () => {
      const oppty1 = makeOppty({ id: 'o1', type: 'ad-intent-mismatch', sumTraffic: 100 });
      const oppty2 = makeOppty({ id: 'o2', type: 'ad-intent-mismatch', sumTraffic: 100 });

      const result = findLowestEvictionCandidate([oppty1, oppty2]);
      expect(result.getId()).to.equal('o1');
    });

    it('should handle single element', () => {
      const oppty = makeOppty({ id: 'o1', type: 'ad-intent-mismatch', sumTraffic: 500 });

      const result = findLowestEvictionCandidate([oppty]);
      expect(result.getId()).to.equal('o1');
    });
  });

  describe('MAX_OPPORTUNITIES_PER_TYPE', () => {
    it('should be 4', () => {
      expect(MAX_OPPORTUNITIES_PER_TYPE).to.equal(4);
    });
  });

  describe('handler', () => {
    it('should return notFound if no audit is found', async () => {
      Audit.findById.resolves(null);
      Opportunity.allBySiteId.resolves([]);
      const message = createMessage();

      const result = await handler(message, context);

      expect(result.status).to.equal(notFound().status);
    });

    it('should create a new opportunity and suggestion', async () => {
      Opportunity.allBySiteId.resolves([]);
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
        url: TEST_URL, // Same URL
      });

      Opportunity.allBySiteId.resolves([existingOpptyForSameUrl]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;

      // The existing opportunity for the same URL should be marked as IGNORED
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
        url: 'https://example-page/different-page', // Different URL
      });

      Opportunity.allBySiteId.resolves([existingOpptyForDifferentUrl]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;

      // The existing opportunity for a different URL should NOT be marked as IGNORED
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

      Opportunity.allBySiteId.resolves([systemOpptyForSameUrl, userOpptyForSameUrl]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      // Only the system opportunity should be marked as IGNORED
      expect(systemOpptyForSameUrl.setStatus).to.have.been.calledWith('IGNORED');
      expect(Opportunity.saveMany).to.have.been.calledWith([systemOpptyForSameUrl]);

      // The user-modified opportunity should not be touched
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

      Opportunity.allBySiteId.resolves([wrongTypeOppty]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      expect(wrongTypeOppty.setStatus).to.not.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should skip opportunity creation and log for low severity', async () => {
      Opportunity.allBySiteId.resolves([]);
      const message = createMessage({ bodyOverrides: { issueSeverity: 'low' } });

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(Suggestion.create).not.to.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch(/\[paid-audit\] Skipping ad-intent-mismatch: low issue severity/);
      expect(result.status).to.equal(ok().status);
    });

    it('should skip opportunity creation for none severity', async () => {
      Opportunity.allBySiteId.resolves([]);
      const message = createMessage({ bodyOverrides: { issueSeverity: 'none' } });

      const result = await handler(message, context);

      expect(Opportunity.create).not.to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should create opportunity if severity is medium', async () => {
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage({ bodyOverrides: { issueSeverity: 'Medium' } });

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should create opportunity if severity is high', async () => {
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage({ bodyOverrides: { issueSeverity: 'high' } });

      const result = await handler(message, context);

      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
      expect(result.status).to.equal(ok().status);
    });

    it('should set suggestion status to PENDING_VALIDATION when site requires validation', async () => {
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      context.site = { requiresValidation: true };
      const message = createMessage();

      await handler(message, context);

      expect(Suggestion.create).to.have.been.calledWith(sinon.match.has('status', 'PENDING_VALIDATION'));
    });

    it('should set suggestion status to NEW when site does not require validation', async () => {
      Opportunity.allBySiteId.resolves([]);
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

      Opportunity.allBySiteId.resolves([existingOppty]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      const result = await handler(message, context);

      // Only the existing opportunity should be marked as IGNORED, not the newly created one
      expect(existingOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(Opportunity.saveMany).to.have.been.calledWith([existingOppty]);
      expect(result.status).to.equal(ok().status);
    });

    it('should skip opportunity creation when guidance is empty', async () => {
      Opportunity.allBySiteId.resolves([]);
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
      Opportunity.allBySiteId.resolves([]);
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
      Opportunity.allBySiteId.resolves([]);
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
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const message = createMessage();

      await handler(message, context);

      const opportunityCreateCall = Opportunity.create.getCall(0);
      const createdOpportunity = opportunityCreateCall.args[0];

      // Check that the opportunity has the correct data from the message
      expect(createdOpportunity.data).to.have.property('url', TEST_URL);
      expect(createdOpportunity.data).to.have.property('cpc', 0.075);
      expect(createdOpportunity.data).to.have.property('sumTraffic', 23423.5);
    });

    it('should include insight, rationale, and recommendation in opportunity guidance', async () => {
      Opportunity.allBySiteId.resolves([]);
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

    describe('eviction flow', () => {
      // Helper: create a suggestion mock that getSuggestions returns
      function makeSuggestionWithVariations(variations) {
        return [{
          getData: () => ({ variations }),
        }];
      }

      it('should create opportunity when under cap (less than MAX_OPPORTUNITIES_PER_TYPE)', async () => {
        // 2 existing opportunities of same inferred type (under cap of 4)
        const existing1 = makeOppty({
          id: 'e1',
          type: 'ad-intent-mismatch',
          url: 'https://other1.com',
          sumTraffic: 100,
          suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
        });
        const existing2 = makeOppty({
          id: 'e2',
          type: 'ad-intent-mismatch',
          url: 'https://other2.com',
          sumTraffic: 200,
          suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
        });

        Opportunity.allBySiteId.resolves([existing1, existing2]);
        Opportunity.create.resolves(opportunityInstance);

        // Message with variationChanges suggestions -> modify_heading type
        const message = createMessage({
          bodyOverrides: {
            suggestions: [
              { variationChanges: [{ tag: 'h1', newValue: 'Better Heading' }] },
            ],
            sumTraffic: 500,
          },
        });

        const result = await handler(message, context);

        expect(Opportunity.create).to.have.been.called;
        expect(existing1.setStatus).to.not.have.been.calledWith('IGNORED');
        expect(existing2.setStatus).to.not.have.been.calledWith('IGNORED');
        expect(result.status).to.equal(ok().status);
      });

      it('should evict lowest-traffic opportunity when at cap and new has higher traffic', async () => {
        // 4 existing opportunities of type modify_heading (at cap)
        const existingOpptys = [];
        for (let i = 0; i < 4; i += 1) {
          existingOpptys.push(makeOppty({
            id: `e${i}`,
            type: 'ad-intent-mismatch',
            url: `https://page${i}.com`,
            sumTraffic: (i + 1) * 100, // 100, 200, 300, 400
            suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
          }));
        }

        Opportunity.allBySiteId.resolves(existingOpptys);
        Opportunity.create.resolves(opportunityInstance);

        // New opportunity has higher traffic than the lowest (100)
        const message = createMessage({
          bodyOverrides: {
            suggestions: [
              { variationChanges: [{ tag: 'h1', newValue: 'New Heading' }] },
            ],
            sumTraffic: 500, // Higher than lowest (100)
          },
        });

        const result = await handler(message, context);

        // Should evict the lowest (e0 with traffic 100)
        expect(existingOpptys[0].setStatus).to.have.been.calledWith('IGNORED');
        expect(existingOpptys[0].save).to.have.been.called;
        // Should create the new opportunity
        expect(Opportunity.create).to.have.been.called;
        expect(logStub.info).to.have.been.calledWithMatch(/Evicted opportunity e0/);
        expect(result.status).to.equal(ok().status);
      });

      it('should drop new opportunity when at cap and new has lower traffic', async () => {
        // 4 existing opportunities of type modify_heading (at cap)
        const existingOpptys = [];
        for (let i = 0; i < 4; i += 1) {
          existingOpptys.push(makeOppty({
            id: `e${i}`,
            type: 'ad-intent-mismatch',
            url: `https://page${i}.com`,
            sumTraffic: (i + 1) * 1000, // 1000, 2000, 3000, 4000
            suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
          }));
        }

        Opportunity.allBySiteId.resolves(existingOpptys);

        // New opportunity has lower traffic than the lowest existing (1000)
        const message = createMessage({
          bodyOverrides: {
            suggestions: [
              { variationChanges: [{ tag: 'h1', newValue: 'New Heading' }] },
            ],
            sumTraffic: 500, // Lower than lowest existing (1000)
          },
        });

        const result = await handler(message, context);

        // Should NOT create new opportunity
        expect(Opportunity.create).not.to.have.been.called;
        expect(logStub.info).to.have.been.calledWithMatch(/Dropped new opportunity/);
        expect(result.status).to.equal(ok().status);
      });

      it('should isolate eviction by type: modify_heading cap does not affect audit_required', async () => {
        // 4 modify_heading type opportunities (at cap)
        const modifyHeadingOpptys = [];
        for (let i = 0; i < 4; i += 1) {
          modifyHeadingOpptys.push(makeOppty({
            id: `mh${i}`,
            type: 'ad-intent-mismatch',
            url: `https://page${i}.com`,
            sumTraffic: (i + 1) * 100,
            suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
          }));
        }

        Opportunity.allBySiteId.resolves(modifyHeadingOpptys);
        Opportunity.create.resolves(opportunityInstance);

        // New opportunity is audit_required type (has suggestionText)
        const message = createMessage({
          bodyOverrides: {
            suggestions: [
              { suggestionText: 'Review this page for intent alignment' },
            ],
            sumTraffic: 50, // Low traffic, but different type
          },
        });

        const result = await handler(message, context);

        // Should create because audit_required type has 0 existing (under cap of 4)
        expect(Opportunity.create).to.have.been.called;
        // None of the modify_heading opportunities should be evicted
        modifyHeadingOpptys.forEach((oppty) => {
          expect(oppty.setStatus).to.not.have.been.calledWith('IGNORED');
        });
        expect(result.status).to.equal(ok().status);
      });

      it('should use sumTraffic from guidance body for eviction comparison', async () => {
        // 4 existing opportunities with low traffic
        const existingOpptys = [];
        for (let i = 0; i < 4; i += 1) {
          existingOpptys.push(makeOppty({
            id: `e${i}`,
            type: 'ad-intent-mismatch',
            url: `https://page${i}.com`,
            sumTraffic: 10, // All very low
            suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
          }));
        }

        Opportunity.allBySiteId.resolves(existingOpptys);
        Opportunity.create.resolves(opportunityInstance);

        // New has sumTraffic in body
        const message = createMessage({
          bodyOverrides: {
            suggestions: [
              { variationChanges: [{ tag: 'h1', newValue: 'Heading' }] },
            ],
            sumTraffic: 100,
          },
        });

        const result = await handler(message, context);

        // New traffic (100) > lowest existing (10), so evict + create
        expect(Opportunity.create).to.have.been.called;
        expect(result.status).to.equal(ok().status);
      });

      it('should fall back to data.sumTraffic when guidanceBody.sumTraffic is missing', async () => {
        // 4 existing opportunities with high traffic
        const existingOpptys = [];
        for (let i = 0; i < 4; i += 1) {
          existingOpptys.push(makeOppty({
            id: `e${i}`,
            type: 'ad-intent-mismatch',
            url: `https://page${i}.com`,
            sumTraffic: 10000,
            suggestions: makeSuggestionWithVariations([{ variationChanges: [{ tag: 'h1' }] }]),
          }));
        }

        Opportunity.allBySiteId.resolves(existingOpptys);

        // sumTraffic is NOT in body, but IS in data
        const message = {
          auditId: 'auditId',
          siteId: 'site',
          data: {
            url: TEST_URL,
            sumTraffic: 5,
            guidance: [{
              insight: 'test',
              rationale: 'test',
              recommendation: 'test',
              type: 'guidance',
              body: {
                issueSeverity: 'medium',
                url: TEST_URL,
                suggestions: [
                  { variationChanges: [{ tag: 'h1' }] },
                ],
                cpc: 1.0,
                // sumTraffic intentionally missing from body
              },
            }],
            suggestions: [],
          },
        };

        const result = await handler(message, context);

        // data.sumTraffic = 5, lower than all existing (10000), so dropped
        expect(Opportunity.create).not.to.have.been.called;
        expect(result.status).to.equal(ok().status);
      });
    });
  });
});
