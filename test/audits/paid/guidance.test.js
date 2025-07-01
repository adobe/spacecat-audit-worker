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
import handler from '../../../src/paid/guidance-handler.js';

use(sinonChai);
use(chaiAsPromised);

// Helper to create a fresh stubbed opportunity instance
function makeOppty({ page, opportunityType }) {
  return {
    getId: () => `opptyId-${page}-${opportunityType}`,
    getSuggestions: async () => [],
    setAuditId: sinon.stub(),
    setData: sinon.stub(),
    setGuidance: sinon.stub(),
    setTitle: sinon.stub(),
    setDescription: sinon.stub(),
    save: sinon.stub().resolvesThis(),
    getType: () => 'generic-opportunity',
    getData: () => ({ page, opportunityType }),
    getStatus: () => 'NEW',
  };
}

describe('Paid Guidance Handler', () => {
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
    Suggestion = { create: sandbox.stub().resolves() };
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
      getType: () => 'generic-opportunity',
      getData: () => ({ page: 'url', opportunityType: 'paid-cookie-consent' }),
      getStatus: () => 'NEW',
    };
    Opportunity = {
      allBySiteId: sandbox.stub(),
      create: sandbox.stub(),
    };
    Audit = { findById: sandbox.stub() };
    context = {
      log: logStub,
      dataAccess: { Audit, Opportunity, Suggestion },
    };

    Audit.findById.resolves({
      getAuditId: () => 'auditId',
      getAuditResult: () => [
        {
          key: 'url',
          value: [{
            url: 'url', pageViews: 10, ctr: 0.5, bounceRate: 0.2,
          }],
        },
        { key: 'pageType', value: [{ topURLs: ['https://example-url'], type: 'product-page' }] },
      ],
    });
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  it('should return notFound if no audit is found', async () => {
    Audit.findById.resolves(null);
    Opportunity.allBySiteId.resolves([]);
    const message = { auditId: '123', siteId: 'site', data: { url: 'url', guidance: [{}] } };
    const result = await handler(message, context);
    expect(result.status).to.equal(notFound().status);
  });

  it('should create a new opportunity and suggestion with plain markup', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: 'plain\nmarkup', insight: 'insight', rationale: 'rationale', recommendation: 'rec',
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: 'url', guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    const suggestion = Suggestion.create.getCall(0).args[0];
    expect(suggestion.data.suggestionValue).to.equal(`plain
markup`);
    expect(result.status).to.equal(ok().status);
  });

  it('should create a new opportunity and suggestion from serialized JSON with markup', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const markup = 'json\nmarkup';
    const guidance = [{
      body: JSON.stringify({ markup }), insight: 'insight', rationale: 'rationale', recommendation: 'rec',
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: 'url', guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    const suggestion = Suggestion.create.getCall(0).args[0];
    expect(suggestion.data.suggestionValue).to.equal(`json
markup`);
    expect(result.status).to.equal(ok().status);
  });

  it('should update an existing opportunity and replace suggestions', async () => {
    // Override getSuggestions for this test to simulate existing suggestions
    const removeStub = sinon.stub().resolves();
    opportunityInstance.getSuggestions = async () => [{ remove: removeStub }];
    Opportunity.allBySiteId.resolves([opportunityInstance]);
    const guidance = [{
      body: 'plain\nmarkup', insight: 'insight', rationale: 'rationale', recommendation: 'rec',
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: 'url', guidance } };
    const result = await handler(message, context);
    expect(opportunityInstance.setAuditId).to.have.been.called;
    expect(opportunityInstance.setData).to.have.been.called;
    expect(opportunityInstance.setGuidance).to.have.been.called;
    expect(opportunityInstance.setTitle).to.have.been.called;
    expect(opportunityInstance.setDescription).to.have.been.called;
    expect(opportunityInstance.save).to.have.been.called;
    expect(removeStub).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(opportunityInstance.setStatus).to.not.have.been.called;
    const suggestion = Suggestion.create.getCall(0).args[0];
    expect(suggestion.data.suggestionValue).to.equal(`plain
markup`);
    expect(result.status).to.equal(ok().status);
  });

  it('should handle missing guidance/body gracefully', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{}];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: 'url', guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    const suggestion = Suggestion.create.getCall(0).args[0];
    expect(suggestion.data.suggestionValue).to.be.undefined;
    expect(result.status).to.equal(ok().status);
  });

  it('should match existing opportunity by page and opportunityType', async () => {
    const correctOppty = makeOppty({ page: 'url', opportunityType: 'paid-cookie-consent' });
    const wrongPageOppty = makeOppty({ page: 'wrong-url', opportunityType: 'paid-cookie-consent' });
    const wrongTypeOppty = makeOppty({ page: 'url', opportunityType: 'other-type' });

    Opportunity.allBySiteId.resolves([wrongPageOppty, wrongTypeOppty, correctOppty]);
    Audit.findById.resolves({
      getAuditId: () => 'auditId',
      getAuditResult: () => [
        {
          key: 'url',
          value: [{
            url: 'url', pageViews: 10, ctr: 0.5, bounceRate: 0.2,
          }],
        },
        { key: 'pageType', value: [{ topURLs: ['url'], type: 'landing' }] },
      ],
    });
    const guidance = [{
      body: 'plain\nmarkup', insight: 'insight', rationale: 'rationale', recommendation: 'rec',
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: 'url', guidance } };

    // Act
    const result = await handler(message, context);

    // Assert: Only the correctOppty should be updated
    expect(correctOppty.setAuditId).to.have.been.called;
    expect(correctOppty.setData).to.have.been.called;
    expect(correctOppty.setGuidance).to.have.been.called;
    expect(correctOppty.setTitle).to.have.been.called;
    expect(correctOppty.setDescription).to.have.been.called;
    expect(correctOppty.save).to.have.been.called;
    expect(result.status).to.equal(ok().status);

    // The wrong ones should not be updated
    expect(wrongPageOppty.setAuditId).to.not.have.been.called;
    expect(wrongTypeOppty.setAuditId).to.not.have.been.called;
  });

  it('should skip opportunity creation and log for low severity (low)', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const body = JSON.stringify({ issueSeverity: 'loW', markup: 'irrelevant' });
    const guidance = [{ body }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: 'url', guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
    expect(logStub.info).to.have.been.calledWithMatch(/Skipping opportunity creation/);
    expect(result.status).to.equal(ok().status);
  });

  it('should create opportunity if severity is medium', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const body = JSON.stringify({ issueSeverity: 'Medium', markup: 'irrelevant' });
    const guidance = [{ body }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: 'url', guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });
});
