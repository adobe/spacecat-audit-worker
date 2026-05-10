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

use(sinonChai);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a minimal mock Suggestion with settable data.
 */
function makeSuggestion(url, extraData = {}) {
  let data = { url, ...extraData };
  return {
    getData: () => data,
    setData: sinon.spy((newData) => { data = newData; }),
  };
}

/**
 * Builds a minimal mock Opportunity that resolves its suggestions.
 */
function makeOpportunity(suggestions = []) {
  return {
    getSuggestions: sinon.stub().resolves(suggestions),
  };
}

/**
 * Builds the base Mystique message for the guidance handler.
 */
function makeMessage(overrides = {}) {
  return {
    siteId: 'site-123',
    auditId: 'audit-456',
    data: {
      opportunityId: 'opp-789',
      brokenLinks: [
        {
          urlTo: 'https://example.com/broken',
          urlFrom: 'ChatGPT',
          suggestedUrls: ['https://example.com/fix'],
          aiRationale: 'Best match',
          confidenceScore: 0.92,
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Builds the minimal context required by the guidance handler.
 */
function makeContext(sandbox, overrides = {}) {
  const site = {
    getBaseURL: () => 'https://example.com',
  };

  const dataAccess = {
    Site: { findById: sandbox.stub().resolves(site) },
    Audit: { findById: sandbox.stub().resolves({ getId: () => 'audit-456' }) },
    Opportunity: {
      findById: sandbox.stub().resolves(makeOpportunity([
        makeSuggestion('https://example.com/broken'),
      ])),
    },
    Suggestion: { saveMany: sandbox.stub().resolves() },
  };

  const log = {
    debug: sandbox.stub(),
    info: sandbox.stub(),
    warn: sandbox.stub(),
    error: sandbox.stub(),
  };

  return {
    log,
    dataAccess,
    ...overrides,
    dataAccess: { ...dataAccess, ...(overrides.dataAccess || {}) },
    log: { ...log, ...(overrides.log || {}) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('LLM Error Pages Guidance Handler', function () {
  this.timeout(5000);
  let sandbox;
  let handler;

  before(async () => {
    const mod = await import('../../../src/llm-error-pages/guidance-handler.js');
    handler = mod.default;
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('should update matched suggestions and return ok()', async () => {
    const suggestion = makeSuggestion('https://example.com/broken');
    const saveManyStub = sandbox.stub().resolves();
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({ getId: () => 'audit-456' }) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([suggestion])) },
        Suggestion: { saveMany: saveManyStub },
      },
    });

    const result = await handler(makeMessage(), context);

    expect(result.status).to.equal(200);
    expect(suggestion.setData).to.have.been.calledOnce;

    const updatedData = suggestion.setData.firstCall.args[0];
    expect(updatedData.suggestedUrls).to.deep.equal(['https://example.com/fix']);
    expect(updatedData.aiRationale).to.equal('Best match');
    expect(updatedData.confidenceScore).to.equal(0.92);
    expect(saveManyStub).to.have.been.calledOnce;
  });

  it('should preserve existing suggestion data fields when merging AI enrichment', async () => {
    const suggestion = makeSuggestion('https://example.com/broken', {
      hitCount: 42,
      agentTypes: ['ChatGPT'],
      periodIdentifier: 'w10-2026',
    });
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([suggestion])) },
        Suggestion: { saveMany: sandbox.stub().resolves() },
      },
    });

    await handler(makeMessage(), context);

    const updatedData = suggestion.setData.firstCall.args[0];
    expect(updatedData.hitCount).to.equal(42);
    expect(updatedData.agentTypes).to.deep.equal(['ChatGPT']);
    expect(updatedData.periodIdentifier).to.equal('w10-2026');
    expect(updatedData.suggestedUrls).to.deep.equal(['https://example.com/fix']);
  });

  it('should omit confidenceScore from data when not present in Mystique response', async () => {
    const suggestion = makeSuggestion('https://example.com/broken');
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([suggestion])) },
        Suggestion: { saveMany: sandbox.stub().resolves() },
      },
    });

    const message = makeMessage();
    delete message.data.brokenLinks[0].confidenceScore;

    await handler(message, context);

    const updatedData = suggestion.setData.firstCall.args[0];
    expect(updatedData).to.not.have.property('confidenceScore');
  });

  it('should default aiRationale to empty string when absent from Mystique response', async () => {
    const suggestion = makeSuggestion('https://example.com/broken');
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([suggestion])) },
        Suggestion: { saveMany: sandbox.stub().resolves() },
      },
    });

    const message = makeMessage();
    delete message.data.brokenLinks[0].aiRationale;

    await handler(message, context);

    const updatedData = suggestion.setData.firstCall.args[0];
    expect(updatedData.aiRationale).to.equal('');
  });

  it('should update multiple matched suggestions in a single saveMany call', async () => {
    const s1 = makeSuggestion('https://example.com/page-a');
    const s2 = makeSuggestion('https://example.com/page-b');
    const saveManyStub = sandbox.stub().resolves();
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([s1, s2])) },
        Suggestion: { saveMany: saveManyStub },
      },
    });

    const message = makeMessage();
    message.data.brokenLinks = [
      {
        urlTo: 'https://example.com/page-a',
        suggestedUrls: ['https://example.com/fix-a'],
        aiRationale: 'Rationale A',
        confidenceScore: 0.8,
      },
      {
        urlTo: 'https://example.com/page-b',
        suggestedUrls: ['https://example.com/fix-b'],
        aiRationale: 'Rationale B',
        confidenceScore: 0.9,
      },
    ];

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(saveManyStub).to.have.been.calledOnce;
    const saved = saveManyStub.firstCall.args[0];
    expect(saved).to.have.lengthOf(2);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('should skip brokenLinks with empty suggestedUrls and still update others', async () => {
    const s1 = makeSuggestion('https://example.com/page-a');
    const s2 = makeSuggestion('https://example.com/page-b');
    const saveManyStub = sandbox.stub().resolves();
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([s1, s2])) },
        Suggestion: { saveMany: saveManyStub },
      },
    });

    const message = makeMessage();
    message.data.brokenLinks = [
      { urlTo: 'https://example.com/page-a', suggestedUrls: [], aiRationale: 'None' },
      {
        urlTo: 'https://example.com/page-b',
        suggestedUrls: ['https://example.com/fix-b'],
        aiRationale: 'Good match',
      },
    ];

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(s1.setData).to.not.have.been.called;
    expect(s2.setData).to.have.been.calledOnce;
    expect(saveManyStub).to.have.been.calledOnce;
  });

  it('should skip brokenLinks with no matching suggestion in DB', async () => {
    const suggestion = makeSuggestion('https://example.com/known-page');
    const saveManyStub = sandbox.stub().resolves();
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([suggestion])) },
        Suggestion: { saveMany: saveManyStub },
      },
    });

    const message = makeMessage();
    message.data.brokenLinks = [
      {
        urlTo: 'https://example.com/unknown-page',
        suggestedUrls: ['https://example.com/fix'],
        aiRationale: 'Great',
      },
    ];

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(suggestion.setData).to.not.have.been.called;
    expect(saveManyStub).to.not.have.been.called;
  });

  it('should return ok() and warn when no suggestions match Mystique response', async () => {
    const warnStub = sandbox.stub();
    const saveManyStub = sandbox.stub().resolves();
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([])) },
        Suggestion: { saveMany: saveManyStub },
      },
      log: {
        debug: sandbox.stub(),
        info: sandbox.stub(),
        warn: warnStub,
        error: sandbox.stub(),
      },
    });

    const result = await handler(makeMessage(), context);

    expect(result.status).to.equal(200);
    expect(saveManyStub).to.not.have.been.called;
    expect(warnStub).to.have.been.called;
  });

  it('should handle empty brokenLinks array gracefully', async () => {
    const saveManyStub = sandbox.stub().resolves();
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([])) },
        Suggestion: { saveMany: saveManyStub },
      },
    });

    const message = makeMessage();
    message.data.brokenLinks = [];

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(saveManyStub).to.not.have.been.called;
  });

  it('should fall back to empty string base URL when site has no getBaseURL method', async () => {
    const suggestion = makeSuggestion('/broken');
    const saveManyStub = sandbox.stub().resolves();
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({}) }, // no getBaseURL
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(makeOpportunity([suggestion])) },
        Suggestion: { saveMany: saveManyStub },
      },
    });

    const message = makeMessage();
    message.data.brokenLinks = [{
      urlTo: '/broken',
      suggestedUrls: ['https://example.com/fix'],
      aiRationale: 'Match',
    }];

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(saveManyStub).to.have.been.calledOnce;
  });

  // ── Not-found / bad-request paths ─────────────────────────────────────────

  it('should return 404 when site is not found', async () => {
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves(null) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(null) },
        Suggestion: { saveMany: sandbox.stub().resolves() },
      },
    });

    const result = await handler(makeMessage(), context);

    expect(result.status).to.equal(404);
  });

  it('should return 404 when audit is not found', async () => {
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves(null) },
        Opportunity: { findById: sandbox.stub().resolves(null) },
        Suggestion: { saveMany: sandbox.stub().resolves() },
      },
    });

    const result = await handler(makeMessage(), context);

    expect(result.status).to.equal(404);
  });

  it('should return 400 when opportunityId is missing from message', async () => {
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(null) },
        Suggestion: { saveMany: sandbox.stub().resolves() },
      },
    });

    const message = makeMessage();
    delete message.data.opportunityId;

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
  });

  it('should return 404 when opportunity is not found in DB', async () => {
    const context = makeContext(sandbox, {
      dataAccess: {
        Site: { findById: sandbox.stub().resolves({ getBaseURL: () => 'https://example.com' }) },
        Audit: { findById: sandbox.stub().resolves({}) },
        Opportunity: { findById: sandbox.stub().resolves(null) },
        Suggestion: { saveMany: sandbox.stub().resolves() },
      },
    });

    const result = await handler(makeMessage(), context);

    expect(result.status).to.equal(404);
  });
});
