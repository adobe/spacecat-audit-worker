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
 * Behavioural contracts: bot-block detection
 *
 * Stage 1 (sticky, Step 2): status.json within 3-day window → skip scraping.
 * Stage 2 (reactive, Step 3): ratio≥0.5 + confidence≥0.99 + known CDN → write scrapeForbidden.
 *
 * Stage 1 tests import submitForScraping directly (no esmock needed — detectBotBlocker not called).
 * Stage 2 tests use esmock to control detectBotBlocker return value.
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { submitForScraping } from '../../../../src/prerender/handler.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  buildSuggestion,
  buildOpportunity,
  buildUrlS3Content,
  statusKey,
  buildStatus,
  daysAgo,
  captureStatusWrite,
} from './helpers.js';

use(sinonChai);

// ─── Stage 1: sticky bot-block (Step 2) ──────────────────────────────────────

describe('Prerender behaviour — bot-block', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  describe('Stage 1: sticky pre-scrape check (Step 2)', () => {
    it('scrapeForbiddenSince within 3-day window → returns empty urls and domainBlocked flag', async () => {
      const siteId = 'site-sticky-block';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            scrapeForbidden: true,
            scrapeForbiddenSince: daysAgo(1),
          }),
        }),
        dataAccess: buildDataAccess(sandbox),
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.deep.equal([]);
      expect(result.auditContext.domainBlocked).to.equal(true);
    });

    it('scrapeForbiddenSince older than 3 days → sticky block expires, proceeds to scrape', async () => {
      const siteId = 'site-expired-block';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            scrapeForbidden: true,
            scrapeForbiddenSince: daysAgo(4),
          }),
        }),
        dataAccess: buildDataAccess(sandbox, {
          topPages: ['https://example.com/page-1'],
        }),
      });

      const result = await submitForScraping(ctx);

      // expired → scraping proceeds (urls list is not empty)
      expect(result.urls).to.be.an('array').with.length.greaterThan(0);
      expect(result).to.not.have.nested.property('auditContext.domainBlocked');
    });

    it('scrapeForbidden=false → no sticky block regardless of scrapeForbiddenSince', async () => {
      const siteId = 'site-not-blocked';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({
            scrapeForbidden: false,
            scrapeForbiddenSince: daysAgo(1),
          }),
        }),
        dataAccess: buildDataAccess(sandbox, {
          topPages: ['https://example.com/page-1'],
        }),
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.be.an('array').with.length.greaterThan(0);
    });

    it('scrapeForbidden=true but scrapeForbiddenSince absent → treated as no block', async () => {
      const siteId = 'site-no-since';
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(siteId)]: buildStatus({ scrapeForbidden: true }),
        }),
        dataAccess: buildDataAccess(sandbox, {
          topPages: ['https://example.com/page-1'],
        }),
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.be.an('array').with.length.greaterThan(0);
    });
  });

  // ─── Stage 2: reactive post-scrape detection (Step 3) ──────────────────────

  describe('Stage 2: reactive post-scrape detection (Step 3)', () => {
    let processContentAndGenerateOpportunities;
    let detectBotBlockerStub;

    beforeEach(async () => {
      detectBotBlockerStub = sandbox.stub();
      ({ processContentAndGenerateOpportunities } = await esmock(
        '../../../../src/prerender/handler.js',
        {
          '@adobe/spacecat-shared-utils': { detectBotBlocker: detectBotBlockerStub },
        },
      ));
    });

    function buildReactiveCtx(siteId, scrapeJobId = 'job-reactive') {
      const url1 = 'https://example.com/page-1';
      const url2 = 'https://example.com/page-2';
      return buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, {
          ...buildUrlS3Content(scrapeJobId, url1, {
            scrapeJson: { error: { statusCode: 403 } },
          }),
          ...buildUrlS3Content(scrapeJobId, url2, {
            scrapeJson: { error: { statusCode: 403 } },
          }),
        }),
        dataAccess: buildDataAccess(sandbox, {
          scrapeUrls: [url1, url2],
        }),
        scrapeResultPaths: new Map([[url1, {}], [url2, {}]]),
        auditContext: { scrapeJobId },
      });
    }

    it('ratio≥0.5 + confidence≥0.99 + known CDN → writes scrapeForbidden=true to status.json', async () => {
      const siteId = 'site-reactive-known';
      detectBotBlockerStub.resolves({ crawlable: false, confidence: 0.99, type: 'cloudflare' });

      const ctx = buildReactiveCtx(siteId);
      await processContentAndGenerateOpportunities(ctx);

      const written = captureStatusWrite(ctx.s3Client);
      expect(written).to.have.property('scrapeForbidden', true);
      expect(written).to.have.property('scrapeForbiddenSince').that.is.a('string');
    });

    it('ratio≥0.5 + known CDN but confidence<0.99 → no block', async () => {
      const siteId = 'site-low-confidence';
      detectBotBlockerStub.resolves({ crawlable: false, confidence: 0.95, type: 'cloudflare' });

      const ctx = buildReactiveCtx(siteId);
      await processContentAndGenerateOpportunities(ctx);

      const written = captureStatusWrite(ctx.s3Client);
      expect(written).to.have.property('scrapeForbidden', false);
    });

    it('ratio<0.5 → detectBotBlocker never called, no block written', async () => {
      const siteId = 'site-low-ratio';
      const scrapeJobId = 'job-low-ratio';
      // 1 out of 4 URLs is 403 → ratio = 0.25 < 0.5
      const urls = [
        'https://example.com/p1',
        'https://example.com/p2',
        'https://example.com/p3',
        'https://example.com/p4',
      ];
      const s3Map = {
        ...buildUrlS3Content(scrapeJobId, urls[0], { scrapeJson: { error: { statusCode: 403 } } }),
        ...buildUrlS3Content(scrapeJobId, urls[1]),
        ...buildUrlS3Content(scrapeJobId, urls[2]),
        ...buildUrlS3Content(scrapeJobId, urls[3]),
      };
      const ctx = buildContext(sandbox, {
        site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
        s3Client: buildS3Client(sandbox, s3Map),
        dataAccess: buildDataAccess(sandbox, { scrapeUrls: urls }),
        scrapeResultPaths: new Map(urls.map((u) => [u, {}])),
        auditContext: { scrapeJobId },
      });

      await processContentAndGenerateOpportunities(ctx);

      expect(detectBotBlockerStub).to.not.have.been.called;
      const written = captureStatusWrite(ctx.s3Client);
      expect(written).to.have.property('scrapeForbidden', false);
    });

    it('detectBotBlocker throws → warning logged, no block, audit completes', async () => {
      const siteId = 'site-detector-throws';
      detectBotBlockerStub.rejects(new Error('Network unavailable'));

      const ctx = buildReactiveCtx(siteId);
      const result = await processContentAndGenerateOpportunities(ctx);

      // Audit must complete (not propagate the error)
      expect(result).to.have.property('status', 'complete');
      // Handler logs a warning about the detectBotBlocker failure
      expect(ctx.log.warn).to.have.been.calledWithMatch(/detectBotBlocker failed/);
      const written = captureStatusWrite(ctx.s3Client);
      expect(written).to.have.property('scrapeForbidden', false);
    });
  });
});
