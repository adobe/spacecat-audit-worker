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
 * Behavioural contracts: mode routing
 *
 * Covers how each step detects its operating mode and branches accordingly.
 * Mocks only external I/O (S3, DB) — never internal handler functions —
 * so these tests stay green through module extraction and refactoring.
 *
 * AI-only mode routing is fully covered in ../ai-only-mode.test.js which
 * already follows the external-mock-only pattern. Tests here focus on the
 * normal, CSV, and Slack paths that currently rely on esmock in handler.test.js.
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  importTopPages,
  submitForScraping,
} from '../../../../src/prerender/handler.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  statusKey,
  buildStatus,
  daysAgo,
} from './helpers.js';

use(sinonChai);

// ─── Step 1 ───────────────────────────────────────────────────────────────────

describe('Prerender behaviour — mode routing', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  describe('Step 1: importTopPages', () => {
    it('normal mode returns a top-pages trigger object', async () => {
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'site-abc', baseUrl: 'https://example.com' }),
        finalUrl: 'https://example.com',
      });

      const result = await importTopPages(ctx);

      expect(result.type).to.equal('top-pages');
      expect(result.siteId).to.equal('site-abc');
      expect(result.fullAuditRef).to.equal('scrapes/site-abc/');
      expect(result.auditResult).to.deep.equal({ status: 'preparing', finalUrl: 'https://example.com' });
      // auditContext must NOT be present when no CSV urls given
      expect(result).to.not.have.property('auditContext');
    });

    it('CSV mode forwards urls in the trigger so the import worker preserves them', async () => {
      const csvUrls = ['https://example.com/page-1', 'https://example.com/page-2'];
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'site-csv' }),
        finalUrl: 'https://example.com',
        auditContext: { urls: csvUrls },
      });

      const result = await importTopPages(ctx);

      expect(result.type).to.equal('top-pages');
      expect(result.auditContext.urls).to.deep.equal(csvUrls);
    });

    it('empty auditContext.urls is treated the same as no urls (no auditContext forwarded)', async () => {
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: 'site-empty' }),
        finalUrl: 'https://example.com',
        auditContext: { urls: [] },
      });

      const result = await importTopPages(ctx);

      expect(result).to.not.have.property('auditContext');
    });
  });

  // ─── Step 2 ─────────────────────────────────────────────────────────────────

  describe('Step 2: submitForScraping', () => {
    it('CSV mode returns rebased URLs immediately and never reads status.json', async () => {
      const site = buildSite({ id: 'site-csv', baseUrl: 'https://example.com' });
      const s3Client = buildS3Client(sandbox); // no keys configured — any S3 read would throw
      const ctx = buildContext(sandbox, {
        site,
        s3Client,
        auditContext: {
          urls: [
            'https://other-domain.com/page-1',
            'https://other-domain.com/page-2',
          ],
        },
      });

      const result = await submitForScraping(ctx);

      // URLs rebased to site's base domain
      expect(result.urls).to.be.an('array').with.length(2);
      result.urls.forEach(({ url }) => {
        expect(url).to.match(/^https:\/\/example\.com\//);
      });

      // status.json was never read
      expect(s3Client.send).to.not.have.been.called;
    });

    it('CSV mode does not set domainBlocked even when status.json would show scrapeForbidden', async () => {
      // This confirms CSV path bypasses the sticky bot-block check entirely.
      const siteId = 'site-csv-bypass';
      const s3Client = buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus({
          scrapeForbidden: true,
          scrapeForbiddenSince: daysAgo(1),
        }),
      });
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId }),
        s3Client,
        auditContext: { urls: ['https://example.com/page-1'] },
      });

      const result = await submitForScraping(ctx);

      expect(result.auditContext?.domainBlocked).to.be.undefined;
      expect(result.urls).to.have.length(1);
    });

    it('Slack mode bypasses the sticky bot-block check so operators can force a re-scrape', async () => {
      // Even with scrapeForbidden active, a Slack-triggered run must proceed.
      const siteId = 'site-slack-bypass';
      const s3Client = buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus({
          scrapeForbidden: true,
          scrapeForbiddenSince: daysAgo(1),
        }),
      });
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client,
        dataAccess: buildDataAccess(sandbox, {
          topPages: ['https://example.com/page-1', 'https://example.com/page-2'],
        }),
        auditContext: {
          slackContext: { channelId: 'C12345', threadId: 'T67890' },
        },
      });

      const result = await submitForScraping(ctx);

      expect(result.auditContext?.domainBlocked).to.be.undefined;
      // URLs present — scraping was not skipped
      expect(result.urls).to.be.an('array').with.length.greaterThan(0);
    });

    it('Slack mode does not apply PageCitability dedup or DAILY_BATCH_SIZE cap', async () => {
      // Slack runs return all available URLs regardless of recent processing or batch limits.
      // getTopOrganicUrlsFromSeo caps at TOP_ORGANIC_URLS_LIMIT=200, so we push above
      // DAILY_BATCH_SIZE=320 by combining organic (200) with includedURLs (150).
      const siteId = 'site-slack-all';
      const organicUrls = Array.from({ length: 200 }, (_, i) => `https://example.com/organic-${i}`);
      const includedUrls = Array.from({ length: 150 }, (_, i) => `https://example.com/included-${i}`);

      // All organic URLs appear in PageCitability as recently processed (1 day ago).
      // Normal mode would exclude all of them; Slack must include them.
      const citabilityRecords = organicUrls.map((url) => ({
        getUrl: () => url,
        getUpdatedAt: () => new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      }));

      const s3Client = buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
      });
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com', includedUrls }),
        s3Client,
        dataAccess: buildDataAccess(sandbox, {
          topPages: organicUrls,
          citabilityRecords,
        }),
        auditContext: {
          slackContext: { channelId: 'C12345' },
        },
      });

      const result = await submitForScraping(ctx);

      // organic(200, not deduped) + included(150) = 350 > DAILY_BATCH_SIZE(320)
      expect(result.urls.length).to.be.greaterThan(320);
    });

    it('normal mode reads status.json before deciding whether to scrape', async () => {
      // Confirms the normal path is taken when no CSV urls and no Slack context.
      const siteId = 'site-normal';
      const s3Client = buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(), // clean status — not blocked
      });
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client,
        dataAccess: buildDataAccess(sandbox, {
          topPages: ['https://example.com/page-1'],
        }),
      });

      await submitForScraping(ctx);

      // status.json was read (GetObjectCommand fired for the status key)
      const reads = s3Client.send.getCalls().filter(
        (c) => c.args[0]?.constructor?.name === 'GetObjectCommand'
          && c.args[0]?.input?.Key === statusKey(siteId),
      );
      expect(reads).to.have.length.greaterThan(0);
    });
  });
});
