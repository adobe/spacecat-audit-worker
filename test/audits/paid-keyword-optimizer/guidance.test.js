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
import handler from '../../../src/paid-keyword-optimizer/guidance-handler.js';

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
  id, type, status = 'NEW', updatedBy = 'system', url = null,
}) {
  return {
    getId: () => id,
    getSuggestions: async () => [],
    setAuditId: sinon.stub(),
    setData: sinon.stub(),
    setGuidance: sinon.stub(),
    setTitle: sinon.stub(),
    setDescription: sinon.stub(),
    setStatus: sinon.stub(),
    save: sinon.stub().resolvesThis(),
    getType: () => type,
    getData: () => ({ url }),
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
    expect(existingOpptyForSameUrl.save).to.have.been.called;

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
    expect(systemOpptyForSameUrl.save).to.have.been.called;

    // The user-modified opportunity should not be touched
    expect(userOpptyForSameUrl.setStatus).to.not.have.been.called;
    expect(userOpptyForSameUrl.save).to.not.have.been.called;

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
    expect(existingOppty.save).to.have.been.called;
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
});
