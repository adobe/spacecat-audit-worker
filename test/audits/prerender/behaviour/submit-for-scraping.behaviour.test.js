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

/**
 * Behavioural contracts: submitForScraping (Step 2)
 *
 * submitForScraping decides which URLs get submitted to the scraper for a given
 * audit run. It has three early-exit gates, checked in this order — each one
 * returns immediately without falling through to URL candidate discovery:
 *
 *   1. AI-only mode (context.data.mode === 'ai-only')
 *        -> { status: 'skipped', mode }, no S3/DB access at all.
 *   2. Explicit CSV urls (auditContext.urls present and non-empty)
 *        -> dedups + scope-filters only that list. Bypasses every gate below
 *           (sticky bot block) and never touches organic/included/agentic
 *           sources or the suggestion cap.
 *   3. Sticky bot block (non-Slack runs only): status.json has scrapeForbidden
 *      with scrapeForbiddenSince inside a 3-day window
 *        -> { urls: [], auditContext: { domainBlocked: true } }.
 *        Slack-triggered runs bypass this so operators can force a re-scrape.
 *
 * When no gate trips, candidate URLs are assembled from organic (SEO top
 * pages), included (site config), and — non-Slack runs only — agentic (CDN
 * traffic) sources, then deduped and scope-filtered. Non-Slack runs are also
 * sliced to DAILY_BATCH_SIZE; Slack-triggered runs (without explicit urls)
 * submit the full merged set instead and skip agentic sourcing entirely.
 *
 * Note: submitForScraping does NOT enforce the active-suggestion cap
 * (LLMO-6533/LLMO-6638) — new URLs always flow through here. The cap is
 * enforced downstream in Step 3 (handler.js's evictOldestSuggestionsOverCap),
 * which evicts the least-recently-scraped suggestions once the site's
 * PRERENDER opportunity exceeds MAX_ACTIVE_SUGGESTIONS, so the freshest
 * incoming traffic displaces stale entries instead of being blocked here.
 *
 * The return shape is always:
 *   { urls: [{ url }], siteId, processingType: 'prerender', maxScrapeAge: 0,
 *     options: { pageLoadTimeout, storagePrefix }, auditContext }
 *
 * Not covered here (see their own behaviour files instead):
 *   - Site-scope filtering across every URL source -> site-scope-protection.behaviour.test.js
 *   - AI-only mode step 1/3 semantics -> ai-only-mode.test.js
 *   - Active-suggestion cap eviction -> handler.test.js
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { submitForScraping } from '../../../../src/prerender/submit-for-scraping.js';
import { DAILY_BATCH_SIZE } from '../../../../src/prerender/utils/constants.js';
import {
  buildContext,
  buildSite,
  buildDataAccess,
  buildS3Client,
  buildStatus,
  statusKey,
  daysAgo,
} from './helpers.js';

use(sinonChai);

/** Loads submitForScraping with Athena stubbed to return a fixed agentic URL list. */
async function withAgenticUrls(agenticUrls = []) {
  return esmock('../../../../src/prerender/submit-for-scraping.js', {
    '../../../../src/utils/agentic-urls.js': {
      getTopAgenticLiveUrlsFromAthena: async () => agenticUrls,
    },
  });
}

describe('Prerender behaviour — submitForScraping', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('returns the stable {urls, siteId, processingType, maxScrapeAge, options} shape', async () => {
    const mockHandler = await withAgenticUrls();
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: 'shape-site', baseUrl: 'https://example.com' }),
      dataAccess: buildDataAccess(sandbox, { topPages: ['https://example.com/page-1'] }),
    });

    const result = await mockHandler.submitForScraping(ctx);

    expect(result).to.include({
      siteId: 'shape-site',
      processingType: 'prerender',
      maxScrapeAge: 0,
    });
    expect(result.options).to.deep.equal({ pageLoadTimeout: 20000, storagePrefix: 'prerender' });
    expect(result.urls).to.be.an('array');
  });

  describe('gate 1: AI-only mode', () => {
    it('skips immediately without touching S3 or dataAccess', async () => {
      const s3Client = buildS3Client(sandbox);
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'ai-only-site' }),
        s3Client,
        data: { mode: 'ai-only' },
      });

      const result = await submitForScraping(ctx);

      expect(result).to.deep.equal({ status: 'skipped', mode: 'ai-only' });
      expect(s3Client.send).to.not.have.been.called;
      expect(ctx.dataAccess.Opportunity.allBySiteIdAndStatus).to.not.have.been.called;
    });
  });

  describe('gate 2: explicit CSV urls (auditContext.urls)', () => {
    it('submits only the explicit list, deduped and scope-filtered', async () => {
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'csv-site', baseUrl: 'https://example.com/uk' }),
        auditContext: {
          urls: [
            'https://example.com/uk/page-1',
            'https://example.com/uk/page-1/',
            'https://example.com/fr/page-2',
          ],
        },
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.deep.equal([{ url: 'https://example.com/uk/page-1' }]);
    });

    it('filters out non-HTML URLs (pdf, images, etc.) from the explicit list', async () => {
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'csv-nonhtml-site', baseUrl: 'https://example.com' }),
        auditContext: {
          urls: [
            'https://example.com/page-1',
            'https://example.com/file.pdf',
            'https://example.com/image.png',
          ],
        },
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.deep.equal([{ url: 'https://example.com/page-1' }]);
    });

    it('collapses URLs differing only by tracking params (e.g. utm_source)', async () => {
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'csv-tracking-site', baseUrl: 'https://example.com' }),
        auditContext: {
          urls: [
            'https://example.com/page-1?utm_source=newsletter',
            'https://example.com/page-1?utm_source=social',
          ],
        },
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.have.length(1);
    });

    it('preserves URLs differing by non-tracking query params as distinct pages', async () => {
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'csv-querydistinct-site', baseUrl: 'https://example.com' }),
        auditContext: {
          urls: [
            'https://example.com/page-1?filter=a',
            'https://example.com/page-1?filter=b',
          ],
        },
      });

      const result = await submitForScraping(ctx);

      expect(result.urls.map((u) => u.url)).to.have.members([
        'https://example.com/page-1?filter=a',
        'https://example.com/page-1?filter=b',
      ]);
    });

    it('bypasses the sticky bot block gate', async () => {
      const siteId = 'csv-bypass-sticky';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            scrapeForbidden: true,
            scrapeForbiddenSince: daysAgo(1),
          }),
        }),
        auditContext: { urls: ['https://example.com/page-1'] },
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.deep.equal([{ url: 'https://example.com/page-1' }]);
      expect(result.auditContext?.domainBlocked).to.be.undefined;
    });

  });

  describe('gate 3: sticky bot block', () => {
    it('non-Slack run within the 3-day window returns no URLs and marks domainBlocked', async () => {
      const siteId = 'sticky-site';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            scrapeForbidden: true,
            scrapeForbiddenSince: daysAgo(1),
          }),
        }),
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.deep.equal([]);
      expect(result.auditContext).to.deep.equal({ domainBlocked: true });
    });

    it('Slack-triggered run bypasses the block and still submits URLs', async () => {
      const mockHandler = await withAgenticUrls();
      const siteId = 'sticky-slack-site';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            scrapeForbidden: true,
            scrapeForbiddenSince: daysAgo(1),
          }),
        }),
        dataAccess: buildDataAccess(sandbox, { topPages: ['https://example.com/page-1'] }),
        auditContext: { slackContext: { channelId: 'C0123' } },
      });

      const result = await mockHandler.submitForScraping(ctx);

      expect(result.urls.map((u) => u.url)).to.include('https://example.com/page-1');
    });

    it('outside the 3-day window, does not block even without Slack', async () => {
      const mockHandler = await withAgenticUrls();
      const siteId = 'old-sticky-site';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            scrapeForbidden: true,
            scrapeForbiddenSince: daysAgo(4),
          }),
        }),
        dataAccess: buildDataAccess(sandbox, { topPages: ['https://example.com/page-1'] }),
      });

      const result = await mockHandler.submitForScraping(ctx);

      expect(result.auditContext?.domainBlocked).to.be.undefined;
    });
  });

  describe('URL source assembly (no gate tripped)', () => {
    it('non-Slack: merges organic, included, and agentic sources', async () => {
      const mockHandler = await withAgenticUrls(['https://example.com/agentic-1']);
      const ctx = buildContext(sandbox, {
        site: buildSite({
          id: 'assembly-site',
          baseUrl: 'https://example.com',
          includedUrls: ['https://example.com/included-1'],
        }),
        dataAccess: buildDataAccess(sandbox, { topPages: ['https://example.com/organic-1'] }),
      });

      const result = await mockHandler.submitForScraping(ctx);
      const urls = result.urls.map((u) => u.url);

      expect(urls).to.include.members([
        'https://example.com/organic-1',
        'https://example.com/included-1',
        'https://example.com/agentic-1',
      ]);
    });

    it('non-Slack: slices merged candidates to DAILY_BATCH_SIZE', async () => {
      const manyAgenticUrls = Array.from(
        { length: DAILY_BATCH_SIZE + 50 },
        (_, i) => `https://example.com/agentic-${i}`,
      );
      const mockHandler = await withAgenticUrls(manyAgenticUrls);
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'batch-site', baseUrl: 'https://example.com' }),
        dataAccess: buildDataAccess(sandbox),
      });

      const result = await mockHandler.submitForScraping(ctx);

      expect(result.urls).to.have.length(DAILY_BATCH_SIZE);
    });

    it('Slack-triggered (no explicit urls): merges organic + included, skips agentic and daily-batch slicing', async () => {
      const mockHandler = await withAgenticUrls(['https://example.com/agentic-should-be-ignored']);
      const ctx = buildContext(sandbox, {
        site: buildSite({
          id: 'slack-assembly-site',
          baseUrl: 'https://example.com',
          includedUrls: ['https://example.com/included-1'],
        }),
        dataAccess: buildDataAccess(sandbox, { topPages: ['https://example.com/organic-1'] }),
        auditContext: { slackContext: { channelId: 'C0123' } },
      });

      const result = await mockHandler.submitForScraping(ctx);
      const urls = result.urls.map((u) => u.url);

      expect(urls).to.include.members([
        'https://example.com/organic-1',
        'https://example.com/included-1',
      ]);
      expect(urls).to.not.include('https://example.com/agentic-should-be-ignored');
    });
  });

  describe('deduplication and non-HTML filtering across sources', () => {
    it('non-Slack: filters out non-HTML URLs from organic/included/agentic sources', async () => {
      const mockHandler = await withAgenticUrls([
        'https://example.com/agentic.pdf',
        'https://example.com/agentic-ok',
      ]);
      const ctx = buildContext(sandbox, {
        site: buildSite({
          id: 'nonhtml-auto-site',
          baseUrl: 'https://example.com',
          includedUrls: [
            'https://example.com/included.jpg',
            'https://example.com/included-ok',
          ],
        }),
        dataAccess: buildDataAccess(sandbox, {
          topPages: ['https://example.com/organic.docx', 'https://example.com/organic-ok'],
        }),
      });

      const result = await mockHandler.submitForScraping(ctx);
      const urls = result.urls.map((u) => u.url);

      expect(urls).to.include.members([
        'https://example.com/organic-ok',
        'https://example.com/included-ok',
        'https://example.com/agentic-ok',
      ]);
      expect(urls).to.not.include.members([
        'https://example.com/organic.docx',
        'https://example.com/included.jpg',
        'https://example.com/agentic.pdf',
      ]);
    });

    it('non-Slack: dedups the same URL appearing in both organic and agentic sources', async () => {
      const sharedUrl = 'https://example.com/shared-page';
      const mockHandler = await withAgenticUrls([sharedUrl]);
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'cross-dedup-site', baseUrl: 'https://example.com' }),
        dataAccess: buildDataAccess(sandbox, { topPages: [sharedUrl] }),
      });

      const result = await mockHandler.submitForScraping(ctx);
      const urls = result.urls.map((u) => u.url);

      expect(urls.filter((u) => u === sharedUrl)).to.have.length(1);
    });

    it('non-Slack: organic dedup collapses query-param variants to a single pathname', async () => {
      const mockHandler = await withAgenticUrls();
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'organic-dedup-site', baseUrl: 'https://example.com' }),
        dataAccess: buildDataAccess(sandbox, {
          topPages: ['https://example.com/page?a=1', 'https://example.com/page?b=2'],
        }),
      });

      const result = await mockHandler.submitForScraping(ctx);

      expect(result.urls).to.have.length(1);
    });

    it('non-Slack: included URLs preserve distinct non-tracking query params', async () => {
      const mockHandler = await withAgenticUrls();
      const ctx = buildContext(sandbox, {
        site: buildSite({
          id: 'included-dedup-site',
          baseUrl: 'https://example.com',
          includedUrls: [
            'https://example.com/page?filter=a',
            'https://example.com/page?filter=b',
          ],
        }),
        dataAccess: buildDataAccess(sandbox),
      });

      const result = await mockHandler.submitForScraping(ctx);
      const urls = result.urls.map((u) => u.url);

      expect(urls).to.include.members([
        'https://example.com/page?filter=a',
        'https://example.com/page?filter=b',
      ]);
    });
  });

  describe('recency and edge-deployed filtering (non-Slack only)', () => {
    it('non-Slack: excludes organic URLs recently processed within the window', async () => {
      const mockHandler = await withAgenticUrls();
      const siteId = 'recent-site';
      const recentUrl = 'https://example.com/recent-page';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            pages: [{ url: recentUrl, scrapedAt: new Date().toISOString() }],
          }),
        }),
        dataAccess: buildDataAccess(sandbox, {
          topPages: [recentUrl, 'https://example.com/fresh-page'],
        }),
      });

      const result = await mockHandler.submitForScraping(ctx);
      const urls = result.urls.map((u) => u.url);

      expect(urls).to.not.include(recentUrl);
      expect(urls).to.include('https://example.com/fresh-page');
    });

    it('non-Slack: excludes URLs marked isDeployedAtEdge in status.json', async () => {
      const mockHandler = await withAgenticUrls();
      const siteId = 'edge-deployed-site';
      const deployedUrl = 'https://example.com/deployed-page';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            pages: [{ url: deployedUrl, isDeployedAtEdge: true, scrapedAt: daysAgo(30) }],
          }),
        }),
        dataAccess: buildDataAccess(sandbox, {
          topPages: [deployedUrl, 'https://example.com/normal-page'],
        }),
      });

      const result = await mockHandler.submitForScraping(ctx);
      const urls = result.urls.map((u) => u.url);

      expect(urls).to.not.include(deployedUrl);
      expect(urls).to.include('https://example.com/normal-page');
    });

    it('Slack-triggered bypasses both recency and edge-deployed filtering', async () => {
      const mockHandler = await withAgenticUrls();
      const siteId = 'slack-bypass-filters-site';
      const recentDeployedUrl = 'https://example.com/recent-deployed-page';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            pages: [{
              url: recentDeployedUrl, isDeployedAtEdge: true, scrapedAt: new Date().toISOString(),
            }],
          }),
        }),
        dataAccess: buildDataAccess(sandbox, { topPages: [recentDeployedUrl] }),
        auditContext: { slackContext: { channelId: 'C0123' } },
      });

      const result = await mockHandler.submitForScraping(ctx);

      expect(result.urls.map((u) => u.url)).to.include(recentDeployedUrl);
    });
  });

  describe('agentic source resilience', () => {
    it('non-Slack: Athena failure for agentic URLs does not block organic/included submission', async () => {
      const mockHandler = await esmock('../../../../src/prerender/submit-for-scraping.js', {
        '../../../../src/utils/agentic-urls.js': {
          getTopAgenticLiveUrlsFromAthena: async () => {
            throw new Error('athena down');
          },
        },
      });
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'athena-fail-site', baseUrl: 'https://example.com' }),
        dataAccess: buildDataAccess(sandbox, { topPages: ['https://example.com/organic-1'] }),
      });

      const result = await mockHandler.submitForScraping(ctx);

      expect(result.urls.map((u) => u.url)).to.include('https://example.com/organic-1');
    });
  });
});
