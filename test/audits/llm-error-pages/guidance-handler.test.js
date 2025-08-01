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
/* eslint-disable max-len */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('LLM Error Pages – guidance-handler', () => {
  let guidanceHandler;
  const sandbox = sinon.createSandbox();
  let SuggestionCreateStub;
  let dataAccess;

  before(async () => {
    SuggestionCreateStub = sandbox.stub().resolves({ getId: () => 'suggestion-1' });
    const OpportunityMock = { findById: sandbox.stub().resolves({ getSiteId: () => 'site-1' }) };
    const SiteMock = { findById: sandbox.stub().resolves({}) };
    const AuditMock = { findById: sandbox.stub().resolves({}) };

    dataAccess = {
      Audit: AuditMock,
      Suggestion: { create: SuggestionCreateStub },
      Site: SiteMock,
      Opportunity: OpportunityMock,
    };

    guidanceHandler = await esmock('../../../src/llm-error-pages/guidance-handler.js');
  });

  afterEach(() => sandbox.restore());

  it('creates a new suggestion from Mystique response', async () => {
    const message = {
      auditId: 'audit-1',
      siteId: 'site-1',
      data: {
        opportunityId: 'oppty-1',
        brokenUrl: 'https://example.com/old',
        userAgent: 'ChatGPT',
        statusCode: 404,
        totalRequests: 10,
        suggestedUrls: ['/new'],
        aiRationale: 'AI suggests /new',
        confidenceScore: 0.9,
      },
    };

    const context = { log: console, dataAccess };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
    expect(SuggestionCreateStub).to.have.been.calledOnce;
    const arg = SuggestionCreateStub.firstCall.args[0];
    expect(arg.data.url).to.equal('https://example.com/old');
    expect(arg.data.suggestedUrls).to.deep.equal(['/new']);
  });

  it('should return 404 when site is not found', async () => {
    const message = {
      auditId: 'audit-1',
      siteId: 'nonexistent-site',
      data: { opportunityId: 'oppty-1' },
    };

    // Create new dataAccess with Site.findById returning null
    const dataAccessWithNoSite = {
      ...dataAccess,
      Site: { findById: sandbox.stub().resolves(null) },
    };

    const context = {
      log: { error: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub() },
      dataAccess: dataAccessWithNoSite,
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(404);
    expect(context.log.error).to.have.been.calledWith('Site not found for siteId: nonexistent-site');
  });

  it('should return 404 when audit is not found', async () => {
    const message = {
      auditId: 'nonexistent-audit',
      siteId: 'site-1',
      data: { opportunityId: 'oppty-1' },
    };

    // Create new dataAccess with Audit.findById returning null
    const dataAccessWithNoAudit = {
      ...dataAccess,
      Audit: { findById: sandbox.stub().resolves(null) },
    };

    const context = {
      log: { error: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub() },
      dataAccess: dataAccessWithNoAudit,
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(404);
    expect(context.log.warn).to.have.been.calledWith('No audit found for auditId: nonexistent-audit');
  });

  it('should return 404 when opportunity is not found', async () => {
    const message = {
      auditId: 'audit-1',
      siteId: 'site-1',
      data: { opportunityId: 'nonexistent-opportunity' },
    };

    // Create new dataAccess with Opportunity.findById returning null
    const dataAccessWithNoOpportunity = {
      ...dataAccess,
      Opportunity: { findById: sandbox.stub().resolves(null) },
    };

    const context = { log: { error: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub() }, dataAccess: dataAccessWithNoOpportunity };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(404);
    expect(context.log.error).to.have.been.calledWith('[LLMErrorPagesGuidance] Opportunity not found for ID: nonexistent-opportunity');
  });

  it('should return 400 when site ID mismatch occurs', async () => {
    const message = {
      auditId: 'audit-1',
      siteId: 'site-1',
      data: { opportunityId: 'oppty-1' },
    };

    // Create new dataAccess with Opportunity returning different site ID
    const dataAccessWithMismatch = {
      ...dataAccess,
      Opportunity: { findById: sandbox.stub().resolves({ getSiteId: () => 'different-site' }) },
    };

    const context = { log: { error: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub() }, dataAccess: dataAccessWithMismatch };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(400);
    expect(context.log.error).to.have.been.calledWith('[LLMErrorPagesGuidance] Site ID mismatch. Expected: site-1, Found: different-site');
  });
});
