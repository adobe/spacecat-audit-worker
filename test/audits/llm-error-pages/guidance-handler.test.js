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

    guidanceHandler = await esmock('../../src/llm-error-pages/guidance-handler.js');
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
});
