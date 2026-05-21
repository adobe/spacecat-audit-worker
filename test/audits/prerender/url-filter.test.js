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
import { filterUrls } from '../../../src/prerender/url-filter.js';
import { DAILY_BATCH_SIZE } from '../../../src/prerender/utils/constants.js';

use(sinonChai);

describe('url-filter', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  function makeContext({ citabilityUrls = [], throws = false, noCitability = false } = {}) {
    const records = citabilityUrls.map((url) => ({ getUrl: () => url }));
    const allByIndexKeys = throws
      ? sandbox.stub().rejects(new Error('DB error'))
      : sandbox.stub().resolves(records);
    return {
      log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
      site: { getId: () => 'site-1' },
      dataAccess: noCitability ? {} : { PageCitability: { allByIndexKeys } },
    };
  }

  function makeStatus(deployedUrls = []) {
    return { pages: deployedUrls.map((url) => ({ url, isDeployedAtEdge: true })) };
  }

  // ─── CSV mode ─────────────────────────────────────────────────────────────

  describe('CSV mode', () => {
    it('returns deduped URLs from csvUrls', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: true, isSlack: false },
        { csvUrls: ['https://example.com/a', 'https://example.com/a', 'https://example.com/b'] },
        null,
      );

      expect(result.urls).to.deep.equal(['https://example.com/a', 'https://example.com/b']);
    });

    it('filters non-HTML URLs and reports filteredCount', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: true, isSlack: false },
        { csvUrls: ['https://example.com/page', 'https://example.com/image.png'] },
        null,
      );

      expect(result.urls).to.deep.equal(['https://example.com/page']);
      expect(result.filteredCount).to.equal(1);
    });

    it('returns correct zero metrics with isFirstRunOfCycle=true', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: true, isSlack: false },
        { csvUrls: ['https://example.com/a'] },
        null,
      );

      expect(result.metrics).to.deep.equal({
        currentOrganic: 0,
        currentIncludedUrls: 0,
        currentAgentic: 0,
        isFirstRunOfCycle: true,
        agenticNewThisCycle: 0,
        edgeDeployedCount: 0,
      });
    });

    it('ignores topPagesUrls/agenticUrls/includedURLs and does not query PageCitability', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: true, isSlack: false },
        {
          csvUrls: ['https://example.com/csv'],
          topPagesUrls: ['https://example.com/organic'],
          agenticUrls: ['https://example.com/agentic'],
          includedURLs: ['https://example.com/included'],
        },
        makeStatus(['https://example.com/csv']),
      );

      expect(result.urls).to.deep.equal(['https://example.com/csv']);
      expect(ctx.dataAccess.PageCitability.allByIndexKeys).to.not.have.been.called;
    });
  });

  // ─── Slack mode ───────────────────────────────────────────────────────────

  describe('Slack mode', () => {
    it('merges topPagesUrls and includedURLs, deduplicates by pathname', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: true },
        {
          topPagesUrls: ['https://example.com/a', 'https://example.com/b'],
          includedURLs: ['https://example.com/b', 'https://example.com/c'],
          agenticUrls: ['https://example.com/agentic'],
        },
        null,
      );

      expect(result.urls).to.have.members(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
    });

    it('excludes agenticUrls and does not query PageCitability', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: true },
        {
          topPagesUrls: ['https://example.com/organic'],
          includedURLs: [],
          agenticUrls: ['https://example.com/agentic'],
        },
        null,
      );

      expect(result.urls).to.deep.equal(['https://example.com/organic']);
      expect(ctx.dataAccess.PageCitability.allByIndexKeys).to.not.have.been.called;
    });

    it('returns correct metrics with organic and included counts', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: true },
        {
          topPagesUrls: ['https://example.com/a', 'https://example.com/b'],
          includedURLs: ['https://example.com/c'],
          agenticUrls: [],
        },
        null,
      );

      expect(result.metrics).to.deep.equal({
        currentOrganic: 2,
        currentIncludedUrls: 1,
        currentAgentic: 0,
        isFirstRunOfCycle: true,
        agenticNewThisCycle: 0,
        edgeDeployedCount: 0,
      });
    });
  });

  // ─── Normal mode ──────────────────────────────────────────────────────────

  describe('Normal mode', () => {
    it('passes through all URLs when no recent pathnames and no edge-deployed pages', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a'],
          agenticUrls: ['https://example.com/b'],
          includedURLs: ['https://example.com/c'],
        },
        makeStatus(),
      );

      expect(result.urls).to.have.members([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c',
      ]);
    });

    it('filters out recently processed URLs via PageCitability pathnames', async () => {
      const ctx = makeContext({ citabilityUrls: ['https://example.com/a'] });
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a', 'https://example.com/b'],
          agenticUrls: [],
          includedURLs: [],
        },
        makeStatus(),
      );

      expect(result.urls).to.deep.equal(['https://example.com/b']);
    });

    it('filters out edge-deployed URLs via status.pages and reports edgeDeployedCount', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a', 'https://example.com/b'],
          agenticUrls: [],
          includedURLs: [],
        },
        makeStatus(['https://example.com/a']),
      );

      expect(result.urls).to.deep.equal(['https://example.com/b']);
      expect(result.metrics.edgeDeployedCount).to.equal(1);
    });

    it('caps results at DAILY_BATCH_SIZE in organic→included→agentic priority order', async () => {
      const ctx = makeContext();
      const organicUrls = Array.from({ length: 200 }, (_, i) => `https://example.com/organic-${i}`);
      const includedUrls = Array.from({ length: 100 }, (_, i) => `https://example.com/included-${i}`);
      const agenticUrls = Array.from({ length: 100 }, (_, i) => `https://example.com/agentic-${i}`);

      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        { topPagesUrls: organicUrls, includedURLs: includedUrls, agenticUrls },
        makeStatus(),
      );

      // 200 organic + 100 included = 300; 20 agentic fill the remaining 20
      expect(result.urls).to.have.lengthOf(DAILY_BATCH_SIZE);
      expect(result.metrics.currentOrganic).to.equal(200);
      expect(result.metrics.currentIncludedUrls).to.equal(100);
      expect(result.metrics.currentAgentic).to.equal(20);
    });

    it('sets isFirstRunOfCycle=true when no organic URLs were filtered by recency', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a', 'https://example.com/b'],
          agenticUrls: [],
          includedURLs: [],
        },
        makeStatus(),
      );

      expect(result.metrics.isFirstRunOfCycle).to.equal(true);
    });

    it('sets isFirstRunOfCycle=false when some organic URLs are filtered by recency', async () => {
      const ctx = makeContext({ citabilityUrls: ['https://example.com/a'] });
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a', 'https://example.com/b'],
          agenticUrls: [],
          includedURLs: [],
        },
        makeStatus(),
      );

      expect(result.metrics.isFirstRunOfCycle).to.equal(false);
    });

    it('reports agenticNewThisCycle as agentic URLs that pass both recency and edge-deployed filters', async () => {
      const ctx = makeContext({ citabilityUrls: ['https://example.com/agentic-old'] });
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: [],
          agenticUrls: ['https://example.com/agentic-new', 'https://example.com/agentic-old'],
          includedURLs: [],
        },
        makeStatus(),
      );

      expect(result.metrics.agenticNewThisCycle).to.equal(1);
    });

    it('PageCitability.allByIndexKeys throws → logs warning and processes with empty recency set', async () => {
      const ctx = makeContext({ throws: true });
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a'],
          agenticUrls: [],
          includedURLs: [],
        },
        makeStatus(),
      );

      expect(result.urls).to.deep.equal(['https://example.com/a']);
      expect(ctx.log.warn).to.have.been.calledWithMatch(/Failed to load recently-processed pathnames/);
    });

    it('PageCitability not available → proceeds with empty recency set', async () => {
      const ctx = makeContext({ noCitability: true });
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a'],
          agenticUrls: [],
          includedURLs: [],
        },
        makeStatus(),
      );

      expect(result.urls).to.deep.equal(['https://example.com/a']);
    });

    it('null status is treated as no edge-deployed pages', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a'],
          agenticUrls: [],
          includedURLs: [],
        },
        null,
      );

      expect(result.urls).to.deep.equal(['https://example.com/a']);
      expect(result.metrics.edgeDeployedCount).to.equal(0);
    });

    it('status.pages entry with isDeployedAtEdge=false is not filtered', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a'],
          agenticUrls: [],
          includedURLs: [],
        },
        { pages: [{ url: 'https://example.com/a', isDeployedAtEdge: false }] },
      );

      expect(result.urls).to.deep.equal(['https://example.com/a']);
      expect(result.metrics.edgeDeployedCount).to.equal(0);
    });

    it('malformed URL in status.pages edge-deployed entry is skipped gracefully', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a'],
          agenticUrls: [],
          includedURLs: [],
        },
        {
          pages: [
            { url: 'not-a-url', isDeployedAtEdge: true },
            { url: 'https://example.com/other', isDeployedAtEdge: true },
          ],
        },
      );

      expect(result.urls).to.deep.equal(['https://example.com/a']);
      expect(result.metrics.edgeDeployedCount).to.equal(1);
    });

    it('trailing slash on edge-deployed pathname is normalized before comparison', async () => {
      const ctx = makeContext();
      const result = await filterUrls(
        ctx,
        { isCsv: false, isSlack: false },
        {
          topPagesUrls: ['https://example.com/a'],
          agenticUrls: [],
          includedURLs: [],
        },
        { pages: [{ url: 'https://example.com/a/', isDeployedAtEdge: true }] },
      );

      expect(result.urls).to.be.empty;
    });
  });
});
