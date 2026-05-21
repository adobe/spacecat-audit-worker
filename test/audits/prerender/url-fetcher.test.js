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
import { TOP_AGENTIC_URLS_LIMIT, TOP_ORGANIC_URLS_LIMIT } from '../../../src/prerender/utils/constants.js';

use(sinonChai);

describe('url-fetcher', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  async function makeModule({
    agenticStub = sandbox.stub().resolves([]),
    preferredBaseStub = sandbox.stub().returns('https://example.com'),
  } = {}) {
    return esmock('../../../src/prerender/url-fetcher.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticLiveUrlsFromAthena: agenticStub,
        getPreferredBaseUrl: preferredBaseStub,
      },
    });
  }

  function makeContext(overrides = {}) {
    return {
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getIncludedURLs: sandbox.stub().returns([]),
          getFetchConfig: sandbox.stub().returns({}),
        }),
      },
      auditContext: {},
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
      log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
      env: {},
      ...overrides,
    };
  }

  // ─── CSV mode ─────────────────────────────────────────────────────────────

  describe('CSV mode', () => {
    it('returns rebased csvUrls and empty other arrays', async () => {
      const { fetchUrls } = await makeModule();
      const ctx = makeContext({ auditContext: { urls: ['https://other.com/page'] } });
      const result = await fetchUrls(ctx, { isCsv: true, isSlack: false });

      expect(result.csvUrls).to.deep.equal(['https://example.com/page']);
      expect(result.topPagesUrls).to.deep.equal([]);
      expect(result.agenticUrls).to.deep.equal([]);
      expect(result.includedURLs).to.deep.equal([]);
    });

    it('uses preferredBase when rebasing CSV URLs', async () => {
      const preferredBaseStub = sandbox.stub().returns('https://preferred.com');
      const { fetchUrls } = await makeModule({ preferredBaseStub });
      const ctx = makeContext({ auditContext: { urls: ['https://original.com/path'] } });
      const result = await fetchUrls(ctx, { isCsv: true, isSlack: false });

      expect(result.csvUrls).to.deep.equal(['https://preferred.com/path']);
    });

    it('returns empty csvUrls when auditContext.urls is absent', async () => {
      const { fetchUrls } = await makeModule();
      const ctx = makeContext({ auditContext: {} });
      const result = await fetchUrls(ctx, { isCsv: true, isSlack: false });

      expect(result.csvUrls).to.deep.equal([]);
    });

    it('does not fetch organic, agentic, or includedURLs', async () => {
      const agenticStub = sandbox.stub().resolves([]);
      const { fetchUrls } = await makeModule({ agenticStub });
      const ctx = makeContext({ auditContext: { urls: ['https://other.com/a'] } });
      await fetchUrls(ctx, { isCsv: true, isSlack: false });

      expect(agenticStub).to.not.have.been.called;
      expect(ctx.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;
    });

    it('handles malformed URL in auditContext.urls gracefully', async () => {
      const { fetchUrls } = await makeModule();
      const ctx = makeContext({ auditContext: { urls: ['not-a-valid-url'] } });
      const result = await fetchUrls(ctx, { isCsv: true, isSlack: false });

      expect(result.csvUrls).to.deep.equal(['not-a-valid-url']);
    });
  });

  // ─── Slack mode ───────────────────────────────────────────────────────────

  describe('Slack mode', () => {
    it('returns organic and includedURLs, no agentic', async () => {
      const agenticStub = sandbox.stub().resolves(['https://example.com/agentic']);
      const { fetchUrls } = await makeModule({ agenticStub });
      const topPages = [{ getUrl: () => 'https://example.com/organic' }];
      const ctx = makeContext();
      ctx.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);
      const result = await fetchUrls(ctx, { isCsv: false, isSlack: true });

      expect(result.topPagesUrls).to.deep.equal(['https://example.com/organic']);
      expect(result.agenticUrls).to.deep.equal([]);
      expect(result.csvUrls).to.deep.equal([]);
      expect(agenticStub).to.not.have.been.called;
    });

    it('returns includedURLs rebased to preferredBase', async () => {
      const preferredBaseStub = sandbox.stub().returns('https://example.com');
      const { fetchUrls } = await makeModule({ preferredBaseStub });
      const ctx = makeContext();
      ctx.site.getConfig = () => ({
        getIncludedURLs: () => ['https://other.com/included'],
      });
      const result = await fetchUrls(ctx, { isCsv: false, isSlack: true });

      expect(result.includedURLs).to.deep.equal(['https://example.com/included']);
    });
  });

  // ─── Normal mode ──────────────────────────────────────────────────────────

  describe('Normal mode', () => {
    it('fetches organic, includedURLs, and agentic URLs', async () => {
      const agenticStub = sandbox.stub().resolves(['https://example.com/agentic']);
      const { fetchUrls } = await makeModule({ agenticStub });
      const topPages = [{ getUrl: () => 'https://example.com/organic' }];
      const ctx = makeContext();
      ctx.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);
      ctx.site.getConfig = () => ({
        getIncludedURLs: () => ['https://example.com/included'],
      });
      const result = await fetchUrls(ctx, { isCsv: false, isSlack: false });

      expect(result.topPagesUrls).to.deep.equal(['https://example.com/organic']);
      expect(result.agenticUrls).to.deep.equal(['https://example.com/agentic']);
      expect(result.includedURLs).to.deep.equal(['https://example.com/included']);
      expect(result.csvUrls).to.deep.equal([]);
    });

    it('calls getTopAgenticLiveUrlsFromAthena with TOP_AGENTIC_URLS_LIMIT', async () => {
      const agenticStub = sandbox.stub().resolves([]);
      const { fetchUrls } = await makeModule({ agenticStub });
      const ctx = makeContext();
      await fetchUrls(ctx, { isCsv: false, isSlack: false });

      expect(agenticStub).to.have.been.calledWith(ctx.site, ctx, TOP_AGENTIC_URLS_LIMIT);
    });

    it('calls SiteTopPage with site id, seo source, global geo', async () => {
      const { fetchUrls } = await makeModule();
      const ctx = makeContext();
      await fetchUrls(ctx, { isCsv: false, isSlack: false });

      expect(ctx.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
        'site-1', 'seo', 'global',
      );
    });

    it('respects TOP_ORGANIC_URLS_LIMIT when slicing top pages', async () => {
      const { fetchUrls } = await makeModule();
      const manyPages = Array.from(
        { length: TOP_ORGANIC_URLS_LIMIT + 10 },
        (_, i) => ({ getUrl: () => `https://example.com/page-${i}` }),
      );
      const ctx = makeContext();
      ctx.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyPages);
      const result = await fetchUrls(ctx, { isCsv: false, isSlack: false });

      expect(result.topPagesUrls).to.have.lengthOf(TOP_ORGANIC_URLS_LIMIT);
    });

    it('warns and returns empty agenticUrls when agentic fetch throws', async () => {
      const agenticStub = sandbox.stub().rejects(new Error('Athena failure'));
      const { fetchUrls } = await makeModule({ agenticStub });
      const ctx = makeContext();
      const result = await fetchUrls(ctx, { isCsv: false, isSlack: false });

      expect(result.agenticUrls).to.deep.equal([]);
      expect(ctx.log.warn).to.have.been.calledWithMatch(/Failed to fetch agentic URLs/);
    });

    it('warns and returns empty topPagesUrls when SiteTopPage throws', async () => {
      const { fetchUrls } = await makeModule();
      const ctx = makeContext();
      ctx.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.rejects(new Error('DB failure'));
      const result = await fetchUrls(ctx, { isCsv: false, isSlack: false });

      expect(result.topPagesUrls).to.deep.equal([]);
      expect(ctx.log.warn).to.have.been.calledWithMatch(/Failed to load top pages for fallback/);
    });

    it('returns empty topPagesUrls when SiteTopPage is unavailable', async () => {
      const { fetchUrls } = await makeModule();
      const ctx = makeContext();
      ctx.dataAccess = {};
      const result = await fetchUrls(ctx, { isCsv: false, isSlack: false });

      expect(result.topPagesUrls).to.deep.equal([]);
    });

    it('rebases organic URLs to preferredBase', async () => {
      const preferredBaseStub = sandbox.stub().returns('https://preferred.com');
      const { fetchUrls } = await makeModule({ preferredBaseStub });
      const ctx = makeContext();
      ctx.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getUrl: () => 'https://original.com/path' },
      ]);
      const result = await fetchUrls(ctx, { isCsv: false, isSlack: false });

      expect(result.topPagesUrls).to.deep.equal(['https://preferred.com/path']);
    });

    it('returns empty includedURLs when getIncludedURLs is unavailable', async () => {
      const { fetchUrls } = await makeModule();
      const ctx = makeContext();
      ctx.site.getConfig = () => ({});
      const result = await fetchUrls(ctx, { isCsv: false, isSlack: false });

      expect(result.includedURLs).to.deep.equal([]);
    });
  });
});
