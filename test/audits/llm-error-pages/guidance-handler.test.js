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
import guidanceHandler from '../../../src/llm-error-pages/guidance-handler.js';

use(sinonChai);

function makeSuggestion(urlPath, existingData = {}) {
  let data = { url: urlPath, ...existingData };
  return {
    getData: () => data,
    setData: sinon.stub().callsFake((d) => { data = d; }),
  };
}

function makeContext(overrides = {}) {
  const site = {
    getId: () => 'site-1',
    getBaseURL: () => 'https://example.com',
    ...overrides.site,
  };

  const suggestions = overrides.suggestions ?? [];

  const opportunity = {
    getId: () => 'opp-1',
    getSuggestions: sinon.stub().resolves(suggestions),
    ...overrides.opportunity,
  };

  const dataAccess = {
    Site: {
      findById: sinon.stub().resolves(site),
      ...overrides.Site,
    },
    Audit: {
      findById: sinon.stub().resolves({ getId: () => 'audit-1' }),
      ...overrides.Audit,
    },
    Opportunity: {
      findById: sinon.stub().resolves(opportunity),
      ...overrides.Opportunity,
    },
    Suggestion: {
      saveMany: sinon.stub().resolves(),
      ...overrides.Suggestion,
    },
  };

  const log = {
    debug: sinon.stub(),
    info: sinon.stub(),
    warn: sinon.stub(),
    error: sinon.stub(),
    ...overrides.log,
  };

  return { log, dataAccess };
}

function makeMessage(brokenLinks = [], extra = {}) {
  return {
    siteId: 'site-1',
    auditId: 'audit-1',
    data: {
      opportunityId: 'opp-1',
      brokenLinks,
      ...extra,
    },
  };
}

describe('LLM Error Pages – guidance-handler (DB)', () => {
  describe('happy path', () => {
    it('matches broken links to suggestions and bulk-saves enrichment', async () => {
      const suggestion = makeSuggestion('/products/item');
      const ctx = makeContext({ suggestions: [suggestion] });

      const message = makeMessage([{
        urlTo: 'https://example.com/products/item',
        suggestedUrls: ['/products', '/shop'],
        aiRationale: 'Best match',
        confidenceScore: 0.92,
      }]);

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(200);
      expect(suggestion.setData).to.have.been.calledOnce;
      const saved = suggestion.setData.firstCall.args[0];
      expect(saved.url).to.equal('/products/item');
      expect(saved.suggestedUrls).to.deep.equal(['/products', '/shop']);
      expect(saved.aiRationale).to.equal('Best match');
      expect(saved.confidenceScore).to.equal(0.92);
      expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.calledOnce;
    });

    it('preserves existing suggestion data fields during merge', async () => {
      const suggestion = makeSuggestion('/page', { hitCount: 42, periodIdentifier: 'w10-2025' });
      const ctx = makeContext({ suggestions: [suggestion] });

      const message = makeMessage([{
        urlTo: 'https://example.com/page',
        suggestedUrls: ['/new-page'],
        aiRationale: 'Found it',
        confidenceScore: 0.8,
      }]);

      await guidanceHandler(message, ctx);

      const saved = suggestion.setData.firstCall.args[0];
      expect(saved.hitCount).to.equal(42);
      expect(saved.periodIdentifier).to.equal('w10-2025');
      expect(saved.suggestedUrls).to.deep.equal(['/new-page']);
    });

    it('omits confidenceScore key when not provided by Mystique', async () => {
      const suggestion = makeSuggestion('/about');
      const ctx = makeContext({ suggestions: [suggestion] });

      const message = makeMessage([{
        urlTo: 'https://example.com/about',
        suggestedUrls: ['/about-us'],
        aiRationale: 'Same page, different slug',
      }]);

      await guidanceHandler(message, ctx);

      const saved = suggestion.setData.firstCall.args[0];
      expect(Object.keys(saved)).to.not.include('confidenceScore');
    });

    it('defaults aiRationale to empty string when absent', async () => {
      const suggestion = makeSuggestion('/contact');
      const ctx = makeContext({ suggestions: [suggestion] });

      const message = makeMessage([{
        urlTo: 'https://example.com/contact',
        suggestedUrls: ['/contact-us'],
      }]);

      await guidanceHandler(message, ctx);

      const saved = suggestion.setData.firstCall.args[0];
      expect(saved.aiRationale).to.equal('');
    });

    it('bulk-saves multiple matched suggestions in one call', async () => {
      const s1 = makeSuggestion('/a');
      const s2 = makeSuggestion('/b');
      const ctx = makeContext({ suggestions: [s1, s2] });

      const message = makeMessage([
        { urlTo: 'https://example.com/a', suggestedUrls: ['/a-new'], aiRationale: 'r1' },
        { urlTo: 'https://example.com/b', suggestedUrls: ['/b-new'], aiRationale: 'r2' },
      ]);

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(200);
      expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.calledOnce;
      const [saved] = ctx.dataAccess.Suggestion.saveMany.firstCall.args;
      expect(saved).to.have.length(2);
    });

    it('uses empty string as baseUrl fallback when getBaseURL is not defined', async () => {
      const suggestion = makeSuggestion('/page');
      const ctx = makeContext({
        site: { getId: () => 'site-1', getBaseURL: undefined }, // no getBaseURL
        suggestions: [suggestion],
      });

      const message = makeMessage([{
        urlTo: '/page',
        suggestedUrls: ['/new-page'],
        aiRationale: 'ok',
      }]);

      const resp = await guidanceHandler(message, ctx);
      expect(resp.status).to.equal(200);
    });
  });

  describe('skip / warn paths', () => {
    it('skips broken links with empty suggestedUrls and warns', async () => {
      const suggestion = makeSuggestion('/skip-me');
      const ctx = makeContext({ suggestions: [suggestion] });

      const message = makeMessage([{
        urlTo: 'https://example.com/skip-me',
        suggestedUrls: [],
        aiRationale: 'nothing',
      }]);

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(200);
      expect(suggestion.setData).to.not.have.been.called;
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
      expect(ctx.log.warn).to.have.been.calledWithMatch(/No suggested URLs/);
    });

    it('skips broken links with null suggestedUrls', async () => {
      const suggestion = makeSuggestion('/null-suggestions');
      const ctx = makeContext({ suggestions: [suggestion] });

      const message = makeMessage([{
        urlTo: 'https://example.com/null-suggestions',
        suggestedUrls: null,
        aiRationale: 'none',
      }]);

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(200);
      expect(suggestion.setData).to.not.have.been.called;
    });

    it('skips broken links where no suggestion matches the URL path', async () => {
      const suggestion = makeSuggestion('/other-path');
      const ctx = makeContext({ suggestions: [suggestion] });

      const message = makeMessage([{
        urlTo: 'https://example.com/unknown-page',
        suggestedUrls: ['/somewhere'],
        aiRationale: 'ok',
      }]);

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(200);
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
      expect(ctx.log.info).to.have.been.calledWithMatch(/No existing suggestion matched/);
    });

    it('returns ok and warns when nothing matched across all broken links', async () => {
      const ctx = makeContext({ suggestions: [] });

      const message = makeMessage([{
        urlTo: 'https://example.com/ghost',
        suggestedUrls: ['/something'],
        aiRationale: 'ok',
      }]);

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(200);
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
      expect(ctx.log.warn).to.have.been.calledWithMatch(/No suggestions matched/);
    });

    it('returns ok immediately when brokenLinks is empty', async () => {
      const ctx = makeContext({ suggestions: [] });
      const message = makeMessage([]);

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(200);
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });
  });

  describe('error responses', () => {
    it('returns 404 when site is not found', async () => {
      const ctx = makeContext({ Site: { findById: sinon.stub().resolves(null) } });
      const message = makeMessage();

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(404);
      expect(ctx.log.error).to.have.been.calledWithMatch(/Site not found/);
    });

    it('returns 404 when audit is not found', async () => {
      const ctx = makeContext({ Audit: { findById: sinon.stub().resolves(null) } });
      const message = makeMessage();

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(404);
    });

    it('returns 400 when opportunityId is missing from message', async () => {
      const ctx = makeContext();
      const message = {
        siteId: 'site-1',
        auditId: 'audit-1',
        data: { brokenLinks: [] }, // no opportunityId
      };

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(400);
      expect(ctx.log.error).to.have.been.calledWithMatch(/Missing opportunityId/);
    });

    it('returns 404 when opportunity is not found in DB', async () => {
      const ctx = makeContext({ Opportunity: { findById: sinon.stub().resolves(null) } });
      const message = makeMessage();

      const resp = await guidanceHandler(message, ctx);

      expect(resp.status).to.equal(404);
    });
  });
});
