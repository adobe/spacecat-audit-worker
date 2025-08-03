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

    const context = {
      log: { error: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub() },
      dataAccess: dataAccessWithNoOpportunity,
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(404);
    expect(context.log.error).to.have.been.calledWith('[LLMErrorPagesGuidance] Opportunity not found for ID: nonexistent-opportunity');
  });

  describe('Handle missing fields', () => {
    it('should handle missing confidenceScore', async () => {
      const message = {
        auditId: 'audit-1',
        siteId: 'site-1',
        data: {
          opportunityId: 'oppty-1',
          brokenUrl: 'https://example.com/missing-confidence',
          userAgent: 'ChatGPT',
          statusCode: 404,
          totalRequests: 5,
          suggestedUrls: ['/redirect'],
          aiRationale: 'Some rationale',
          // confidenceScore: undefined (missing)
        },
      };

      const context = { log: console, dataAccess };
      const resp = await guidanceHandler.default(message, context);

      expect(resp.status).to.equal(200);
      expect(SuggestionCreateStub).to.have.been.called;
      const arg = SuggestionCreateStub.lastCall.args[0];
      expect(arg.rank).to.equal(1); // Should fallback to 1
      expect(arg.data.confidenceScore).to.equal(0); // Should fallback to 0
    });

    it('should handle missing suggestedUrls', async () => {
      const message = {
        auditId: 'audit-1',
        siteId: 'site-1',
        data: {
          opportunityId: 'oppty-1',
          brokenUrl: 'https://example.com/missing-suggestions',
          userAgent: 'Claude',
          statusCode: 404,
          totalRequests: 3,
          // suggestedUrls: undefined (missing)
          aiRationale: 'No suggestions available',
          confidenceScore: 0.7,
        },
      };

      const context = { log: console, dataAccess };
      const resp = await guidanceHandler.default(message, context);

      expect(resp.status).to.equal(200);
      expect(SuggestionCreateStub).to.have.been.called;
      const arg = SuggestionCreateStub.lastCall.args[0];
      expect(arg.data.suggestedUrls).to.deep.equal([]); // Should fallback to empty array
    });

    it('should handle missing aiRationale', async () => {
      const message = {
        auditId: 'audit-1',
        siteId: 'site-1',
        data: {
          opportunityId: 'oppty-1',
          brokenUrl: 'https://example.com/missing-rationale',
          userAgent: 'Bard',
          statusCode: 404,
          totalRequests: 8,
          suggestedUrls: ['/fixed-url'],
          // aiRationale: undefined (missing)
          confidenceScore: 0.5,
        },
      };

      const context = { log: console, dataAccess };
      const resp = await guidanceHandler.default(message, context);

      expect(resp.status).to.equal(200);
      expect(SuggestionCreateStub).to.have.been.called;
      const arg = SuggestionCreateStub.lastCall.args[0];
      expect(arg.data.aiRationale).to.equal(''); // Should fallback to empty string
    });

    it('should handle null/falsy values for all optional fields (comprehensive branch coverage)', async () => {
      const message = {
        auditId: 'audit-1',
        siteId: 'site-1',
        data: {
          opportunityId: 'oppty-1',
          brokenUrl: 'https://example.com/all-missing',
          userAgent: 'TestBot',
          statusCode: 404,
          totalRequests: 1,
          // All optional fields missing/null/falsy
          suggestedUrls: null,
          aiRationale: null,
          confidenceScore: null,
        },
      };

      const context = { log: console, dataAccess };
      const resp = await guidanceHandler.default(message, context);

      expect(resp.status).to.equal(200);
      expect(SuggestionCreateStub).to.have.been.called;
      const arg = SuggestionCreateStub.lastCall.args[0];

      // Test all fallback branches
      expect(arg.rank).to.equal(1); // confidenceScore || 1
      expect(arg.data.suggestedUrls).to.deep.equal([]); // suggestedUrls || []
      expect(arg.data.aiRationale).to.equal(''); // aiRationale || ''
      expect(arg.data.confidenceScore).to.equal(0); // confidenceScore || 0
    });

    it('should handle empty suggestedUrls array for optional chaining branch', async () => {
      const logInfoStub = sandbox.stub();
      const message = {
        auditId: 'audit-1',
        siteId: 'site-1',
        data: {
          opportunityId: 'oppty-1',
          brokenUrl: 'https://example.com/empty-suggestions',
          userAgent: 'EmptyBot',
          statusCode: 404,
          totalRequests: 2,
          suggestedUrls: [], // Empty array to test suggestedUrls?.length || 0
          aiRationale: 'No suggestions found',
          confidenceScore: 0.3,
        },
      };

      const context = {
        log: {
          info: logInfoStub,
          error: sandbox.stub(),
          warn: sandbox.stub(),
        },
        dataAccess,
      };
      const resp = await guidanceHandler.default(message, context);

      expect(resp.status).to.equal(200);
      // Verify log message includes "0" from suggestedUrls?.length || 0
      expect(logInfoStub).to.have.been.calledWithMatch(/0 suggested URLs/);
    });

    it('should handle zero confidenceScore specifically', async () => {
      const message = {
        auditId: 'audit-1',
        siteId: 'site-1',
        data: {
          opportunityId: 'oppty-1',
          brokenUrl: 'https://example.com/zero-confidence',
          userAgent: 'ZeroBot',
          statusCode: 404,
          totalRequests: 1,
          suggestedUrls: ['/some-url'],
          aiRationale: 'Low confidence suggestion',
          confidenceScore: 0, // Explicitly zero (falsy)
        },
      };

      const context = { log: console, dataAccess };
      const resp = await guidanceHandler.default(message, context);

      expect(resp.status).to.equal(200);
      expect(SuggestionCreateStub).to.have.been.called;
      const arg = SuggestionCreateStub.lastCall.args[0];
      expect(arg.rank).to.equal(1); // 0 || 1 should be 1
      expect(arg.data.confidenceScore).to.equal(0); // 0 || 0 should be 0
    });
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
