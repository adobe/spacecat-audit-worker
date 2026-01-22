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

// Helper to create a fresh stubbed opportunity instance
function makeOppty({
  id, type, status = 'NEW', updatedBy = 'system',
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
    getData: () => ({}),
    getStatus: () => status,
    getUpdatedBy: () => updatedBy,
    getUpdatedAt: () => new Date().toISOString(),
  };
}

const TEST_URLS = ['https://example-page/page1', 'https://example-page/page2'];

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
      getType: () => 'paid-keyword-optimizer',
      getData: () => ({ urls: TEST_URLS }),
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
      getAuditResult: () => ({
        totalPageViews: 10000,
        averageBounceRate: 0.45,
        predominantlyPaidPages: [
          { url: TEST_URLS[0], bounceRate: 0.5, pageViews: 5000, trafficLoss: 2500 },
          { url: TEST_URLS[1], bounceRate: 0.4, pageViews: 5000, trafficLoss: 2000 },
        ],
        predominantlyPaidCount: 2,
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
    const message = {
      auditId: '123',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance: [{}] },
    };
    const result = await handler(message, context);
    expect(result.status).to.equal(notFound().status);
  });

  it('should create a new opportunity and suggestion', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          analysis: 'test analysis',
          impact: {
            business: 'business impact',
            user: 'user impact',
          },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
    }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should create new opportunity and mark existing paid-keyword-optimizer NEW system opportunities as IGNORED', async () => {
    const existingOppty1 = makeOppty({
      id: 'opptyId-1',
      type: 'paid-keyword-optimizer',
      status: 'NEW',
      updatedBy: 'system',
    });
    const existingOppty2 = makeOppty({
      id: 'opptyId-2',
      type: 'paid-keyword-optimizer',
      status: 'NEW',
      updatedBy: 'system',
    });
    const wrongTypeOppty = makeOppty({
      id: 'opptyId-3',
      type: 'other-type',
      status: 'NEW',
      updatedBy: 'system',
    });

    Opportunity.allBySiteId.resolves([wrongTypeOppty, existingOppty1, existingOppty2]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          analysis: 'test analysis',
          impact: {
            business: 'business impact',
            user: 'user impact',
          },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
    }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;

    // The paid-keyword-optimizer opportunities should be marked as IGNORED
    expect(existingOppty1.setStatus).to.have.been.calledWith('IGNORED');
    expect(existingOppty1.save).to.have.been.called;
    expect(existingOppty2.setStatus).to.have.been.calledWith('IGNORED');
    expect(existingOppty2.save).to.have.been.called;

    // The non-matching type should not be touched
    expect(wrongTypeOppty.setStatus).to.not.have.been.called;

    expect(result.status).to.equal(ok().status);
  });

  it('should not mark non-system paid-keyword-optimizer opportunities as IGNORED', async () => {
    const systemOppty = makeOppty({
      id: 'opptyId-system',
      type: 'paid-keyword-optimizer',
      status: 'NEW',
      updatedBy: 'system',
    });
    const userOppty = makeOppty({
      id: 'opptyId-user',
      type: 'paid-keyword-optimizer',
      status: 'NEW',
      updatedBy: 'user',
    });

    Opportunity.allBySiteId.resolves([systemOppty, userOppty]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          analysis: 'test analysis',
          impact: { business: 'business', user: 'user' },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
    }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;

    // Only system opportunity should be marked as IGNORED
    expect(systemOppty.setStatus).to.have.been.calledWith('IGNORED');
    expect(systemOppty.save).to.have.been.called;

    // The user opportunity should not be touched
    expect(userOppty.setStatus).to.not.have.been.called;
    expect(userOppty.save).to.not.have.been.called;

    expect(result.status).to.equal(ok().status);
  });

  it('should handle guidance body as JSON object with issueSeverity', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          analysis: 'test analysis',
          impact: { business: 'business', user: 'user' },
        },
        issueSeverity: 'high',
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
    }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should skip opportunity creation and log for low severity', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const body = {
      issueSeverity: 'low',
      data: {
        analysis: 'test analysis',
        impact: { business: 'business', user: 'user' },
      },
    };
    const guidance = [{ body }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
    expect(logStub.info).to.have.been.calledWithMatch(/Skipping opportunity creation/);
    expect(result.status).to.equal(ok().status);
  });

  it('should create opportunity if severity is medium', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const body = {
      issueSeverity: 'Medium',
      data: {
        analysis: 'test analysis',
        impact: { business: 'business', user: 'user' },
      },
    };
    const guidance = [{ body }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should skip opportunity creation for none severity', async () => {
    Opportunity.allBySiteId.resolves([]);
    const body = { issueSeverity: 'none', data: {} };
    const guidance = [{ body }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    expect(Opportunity.create).not.to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should set suggestion status to PENDING_VALIDATION when site requires validation', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    context.site = { requiresValidation: true };

    const guidance = [{
      body: {
        data: {
          analysis: 'test analysis',
          impact: { business: 'business', user: 'user' },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
    }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.calledWith(sinon.match.has('status', 'PENDING_VALIDATION'));
  });

  it('should not mark opportunities as IGNORED when no existing paid-keyword-optimizer opportunities exist', async () => {
    const otherOppty = makeOppty({
      id: 'opptyId-other',
      type: 'other-type',
      status: 'NEW',
      updatedBy: 'system',
    });

    Opportunity.allBySiteId.resolves([otherOppty]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          analysis: 'test analysis',
          impact: { business: 'business', user: 'user' },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
    }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(otherOppty.setStatus).to.not.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should not mark the newly created opportunity as IGNORED', async () => {
    const existingOppty = makeOppty({
      id: 'existing-oppty-id',
      type: 'paid-keyword-optimizer',
      status: 'NEW',
      updatedBy: 'system',
    });

    Opportunity.allBySiteId.resolves([existingOppty]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          analysis: 'test analysis',
          impact: { business: 'business', user: 'user' },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
    }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    // Only the existing opportunity should be marked as IGNORED, not the newly created one
    expect(existingOppty.setStatus).to.have.been.calledWith('IGNORED');
    expect(existingOppty.save).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should handle empty guidance array', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    const result = await handler(message, context);

    // Should still try to create opportunity with undefined guidance
    expect(Opportunity.create).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should log appropriate debug messages', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: { analysis: 'test' },
      },
    }];
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: { urls: TEST_URLS, guidance },
    };

    await handler(message, context);

    expect(logStub.debug).to.have.been.calledWithMatch(/Message received for guidance:paid-keyword-optimizer handler/);
    expect(logStub.debug).to.have.been.calledWithMatch(/Creating new paid-keyword-optimizer opportunity/);
  });
});
