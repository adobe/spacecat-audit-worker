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

/* eslint-disable max-len */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('LLM Error Pages – guidance-handler (guards)', () => {
  let guidanceHandler;
  const sandbox = sinon.createSandbox();
  let filterReachableUrlsStub;

  beforeEach(async () => {
    filterReachableUrlsStub = sandbox.stub().callsFake(async (urls) => urls);

    guidanceHandler = await esmock('../../../src/llm-error-pages/guidance-handler.js', {
      '../../../src/llm-error-pages/url-health-check.js': {
        filterOutConfirmedBrokenUrls: filterReachableUrlsStub,
      },
    });
  });

  afterEach(() => sandbox.restore());

  it('returns 404 when site is not found', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'nonexistent-site',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: { findById: sandbox.stub().resolves(null) },
      Audit: { findById: sandbox.stub() },
    };

    const context = {
      log: {
        error: sandbox.stub(), info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(),
      },
      dataAccess,
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(404);
  });

  it('returns 404 when audit is not found', async () => {
    const message = {
      auditId: 'nonexistent-audit',
      siteId: 'site-1',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getId: () => 'test-site-id',
          getBaseURL: () => 'https://example.com',
        }),
      },
      Audit: { findById: sandbox.stub().resolves(null) },
    };

    const context = {
      log: {
        error: sandbox.stub(), info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(),
      },
      dataAccess,
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB write paths (Suggestion enrichment from Mystique guidance)
// ─────────────────────────────────────────────────────────────────────────────

describe('LLM Error Pages – guidance-handler (DB write)', () => {
  let guidanceHandler;
  const sandbox = sinon.createSandbox();
  let filterReachableUrlsStub;

  beforeEach(async () => {
    // Passthrough HEAD-check by default; individual tests override.
    filterReachableUrlsStub = sandbox.stub().callsFake(async (urls) => urls);

    guidanceHandler = await esmock('../../../src/llm-error-pages/guidance-handler.js', {
      '../../../src/llm-error-pages/url-health-check.js': {
        filterOutConfirmedBrokenUrls: filterReachableUrlsStub,
      },
    });
  });

  afterEach(() => sandbox.restore());

  function makeSuggestion(urlPath, existingData = {}) {
    let data = { url: urlPath, ...existingData };
    return {
      getData: () => data,
      setData: sandbox.stub().callsFake((d) => { data = d; }),
    };
  }

  function buildContext(overrides = {}) {
    const site = {
      getId: () => 'site-1',
      getBaseURL: () => 'https://example.com',
      ...overrides.site,
    };
    const suggestions = overrides.suggestions ?? [];
    const opportunity = overrides.opportunity || {
      getId: () => 'opp-1',
      getSiteId: () => 'site-1',
      getSuggestions: sandbox.stub().resolves(suggestions),
    };
    const dataAccess = {
      Site: { findById: sandbox.stub().resolves(site) },
      Audit: { findById: sandbox.stub().resolves({ getId: () => 'audit-1' }) },
      Opportunity: {
        findById: sandbox.stub().resolves(opportunity),
        ...overrides.Opportunity,
      },
      Suggestion: { saveMany: sandbox.stub().resolves() },
    };
    const log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    return {
      log, dataAccess,
    };
  }

  it('writes suggestedUrls, aiRationale, confidenceScore to matched DB Suggestion', async () => {
    const suggestion = makeSuggestion('/products/item');
    const ctx = buildContext({ suggestions: [suggestion] });

    const message = {
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'https://example.com/products/item',
          suggestedUrls: ['/products', '/shop'],
          aiRationale: 'Best match',
          confidenceScore: 0.9,
        }],
      },
    };

    const resp = await guidanceHandler.default(message, ctx);

    expect(resp.status).to.equal(200);
    expect(suggestion.setData).to.have.been.calledOnce;
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal(['/products', '/shop']);
    expect(saved.aiRationale).to.equal('Best match');
    expect(saved.confidenceScore).to.equal(0.9);
    expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.calledOnce;
  });

  it('defaults aiRationale to empty string when missing', async () => {
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: ['/x'],
        }],
      },
    }, ctx);

    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.aiRationale).to.equal('');
  });

  it('omits confidenceScore when not provided', async () => {
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'ChatGPT', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    const saved = suggestion.setData.firstCall.args[0];
    expect(Object.keys(saved)).to.not.include('confidenceScore');
  });

  it('warns and skips DB when opportunityId is missing', async () => {
    const ctx = buildContext({ suggestions: [] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        // no opportunityId
        brokenLinks: [{
          urlFrom: 'ChatGPT', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.dataAccess.Opportunity.findById).to.not.have.been.called;
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    expect(ctx.log.warn).to.have.been.calledWithMatch(/No opportunityId/);
  });

  it('skips DB write and warns when opportunity belongs to a different site', async () => {
    const suggestion = makeSuggestion('/p');
    const otherSiteOpportunity = {
      getId: () => 'opp-other-site',
      getSiteId: () => 'other-site',
      getSuggestions: sandbox.stub().resolves([suggestion]),
    };
    const ctx = buildContext({
      opportunity: otherSiteOpportunity,
    });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-other-site',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.log.warn).to.have.been.calledWithMatch(/siteId mismatch/);
    expect(suggestion.setData).to.not.have.been.called;
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('warns when Opportunity is not found in DB', async () => {
    const ctx = buildContext({
      Opportunity: { findById: sandbox.stub().resolves(null) },
    });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-missing',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.log.warn).to.have.been.calledWithMatch(/Opportunity not found/);
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('persists empty-suggestion rows to DB (kept for opportunity completeness)', async () => {
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: [], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(suggestion.setData).to.have.been.calledOnce;
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal([]);
    // HEAD-check pass clears the rationale once the URL list is empty.
    expect(saved.aiRationale).to.equal('');
    expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.calledOnce;
  });

  it('skips brokenLinks where no suggestion matches the URL path', async () => {
    const suggestion = makeSuggestion('/other');
    const ctx = buildContext({ suggestions: [suggestion] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/no-match', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(suggestion.setData).to.not.have.been.called;
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('logs error and continues when DB write throws', async () => {
    const ctx = buildContext({
      Opportunity: { findById: sandbox.stub().rejects(new Error('db-down')) },
    });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.log.error).to.have.been.calledWithMatch(/DB guidance update failed/);
  });

  it('handles empty brokenLinks (no DB writes attempted)', async () => {
    const ctx = buildContext({ suggestions: [makeSuggestion('/p')] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: { opportunityId: 'opp-1', brokenLinks: [] },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('drops HEAD-failed suggestedUrls before persisting and logs the drop count', async () => {
    // Helper drops /bad, keeps /good.
    filterReachableUrlsStub.callsFake(async (urls) => urls.filter((u) => !u.endsWith('/bad')));
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          suggestedUrls: ['https://example.com/good', 'https://example.com/bad'],
          aiRationale: 'Some prose',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal(['https://example.com/good']);
    // Rationale is preserved when at least one URL survives.
    expect(saved.aiRationale).to.equal('Some prose');
    expect(ctx.log.info).to.have.been.calledWithMatch(/Dropped 1 suggested URL/);
  });

  it('clears aiRationale when HEAD-check empties suggestedUrls for a link', async () => {
    // Helper drops every URL.
    filterReachableUrlsStub.callsFake(async () => []);
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          suggestedUrls: ['https://example.com/bad-1', 'https://example.com/bad-2'],
          aiRationale: 'Refers to URLs that no longer exist',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal([]);
    expect(saved.aiRationale).to.equal('');
  });

  it('tolerates brokenLinks entries with non-array suggestedUrls (e.g. undefined)', async () => {
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          // no suggestedUrls field at all
          aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal([]);
    expect(saved.aiRationale).to.equal('');
  });

  it('handles brokenLinks absent from the message (defensive Array.isArray guard)', async () => {
    const ctx = buildContext({ suggestions: [makeSuggestion('/p')] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      // data has no brokenLinks key
      data: { opportunityId: 'opp-1' },
    }, ctx);

    // brokenLinks is normalised to [] by the `Array.isArray(...) ? : []`
    // guard near the top of the handler. The DB-write reduce sees [] and
    // never calls saveMany. The handler returns 200 normally.
    expect(resp.status).to.equal(200);
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('keeps incoming aiRationale as "" when surviving URLs exist but rationale is undefined (?? "" fallback)', async () => {
    // HEAD-check is the default passthrough so all suggested URLs survive;
    // the link.aiRationale field is missing on the incoming payload, so the
    // `?? ''` fallback in the handler should land an empty string in the DB.
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          suggestedUrls: ['https://example.com/keep-1', 'https://example.com/keep-2'],
          // aiRationale intentionally undefined
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(suggestion.setData).to.have.been.calledOnce;
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal([
      'https://example.com/keep-1',
      'https://example.com/keep-2',
    ]);
    expect(saved.aiRationale).to.equal('');
  });

  it('emits head-check-summary log line with siteId / total / kept / dropped counters', async () => {
    // Drop one URL, keep one — verifies the structured log shape.
    filterReachableUrlsStub.callsFake(async (urls) => urls.filter((u) => !u.endsWith('/bad')));
    const ctx = buildContext({ suggestions: [makeSuggestion('/p')] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          suggestedUrls: ['https://example.com/good', 'https://example.com/bad'],
          aiRationale: 'r',
        }],
      },
    }, ctx);

    const summaryCall = ctx.log.info.getCalls().find(
      (c) => typeof c.args[0] === 'string' && c.args[0].includes('head-check-summary'),
    );
    expect(summaryCall, 'head-check-summary log line missing').to.exist;
    // Structured counters are passed as the second arg (Coralogix native fields).
    expect(summaryCall.args[1]).to.deep.equal({
      siteId: 'site-1', total: 2, kept: 1, dropped: 1,
    });
  });

  it('deduplicates a URL shared across broken links into a single HEAD check, then maps it back per-link', async () => {
    const ctx = buildContext({
      suggestions: [makeSuggestion('/a'), makeSuggestion('/b')],
    });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [
          {
            urlFrom: 'X',
            urlTo: 'https://example.com/a',
            suggestedUrls: ['https://example.com/shared', 'https://example.com/only-a'],
            aiRationale: 'ra',
          },
          {
            urlFrom: 'Y',
            urlTo: 'https://example.com/b',
            suggestedUrls: ['https://example.com/shared'],
            aiRationale: 'rb',
          },
        ],
      },
    }, ctx);

    // The shared URL is HEAD-checked exactly once: the handler dedups into a Set
    // before probing, so the three suggestions collapse to two unique URLs.
    expect(filterReachableUrlsStub).to.have.been.calledOnce;
    const probed = filterReachableUrlsStub.firstCall.args[0];
    expect(probed).to.have.members(['https://example.com/shared', 'https://example.com/only-a']);
    expect(probed).to.have.length(2);
  });
});
