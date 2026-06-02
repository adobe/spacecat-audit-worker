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

describe('scrape-stats', () => {
  let sandbox;
  let getScrapeJobStats;
  let getObjectFromKeyStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    getObjectFromKeyStub = sandbox.stub().resolves(null);
    ({ getScrapeJobStats } = await esmock('../../../src/prerender/scrape-stats.js', {
      '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
    }));
  });

  afterEach(() => { sandbox.restore(); });

  function makeContext({
    scrapeUrls = [],
    scrapeUrlsThrows = false,
    domainBlocked = false,
    noScrapeUrl = false,
  } = {}) {
    const allByScrapeJobId = scrapeUrlsThrows
      ? sandbox.stub().rejects(new Error('DB error'))
      : sandbox.stub().resolves(scrapeUrls.map((url) => ({ getUrl: () => url })));

    return {
      log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
      dataAccess: noScrapeUrl ? {} : { ScrapeUrl: { allByScrapeJobId } },
      s3Client: {},
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      auditContext: domainBlocked ? { domainBlocked: true } : {},
    };
  }

  // ─── domainBlocked early exit ──────────────────────────────────────────────

  it('returns zero counts immediately when domainBlocked=true', async () => {
    const ctx = makeContext({ domainBlocked: true });
    const result = await getScrapeJobStats('job-1', [], 5, ctx);

    expect(result).to.deep.equal({
      urlsSubmittedForScraping: 0,
      scrapeForbiddenCount: 0,
      missingPages: [],
      submittedUrlSet: null,
    });
    expect(ctx.dataAccess.ScrapeUrl.allByScrapeJobId).to.not.have.been.called;
  });

  // ─── no scrapeJobId / no ScrapeUrl fallback ────────────────────────────────

  it('returns urlsToCheckLength fallback when scrapeJobId is null', async () => {
    const ctx = makeContext();
    const result = await getScrapeJobStats(null, [], 7, ctx);

    expect(result.urlsSubmittedForScraping).to.equal(7);
    expect(result.missingPages).to.deep.equal([]);
    expect(result.submittedUrlSet).to.be.null;
  });

  it('returns urlsToCheckLength fallback when ScrapeUrl is unavailable', async () => {
    const ctx = makeContext({ noScrapeUrl: true });
    const result = await getScrapeJobStats('job-1', [], 7, ctx);

    expect(result.urlsSubmittedForScraping).to.equal(7);
    expect(result.submittedUrlSet).to.be.null;
  });

  it('counts 403s from COMPLETE-status comparisonResults in the fallback path', async () => {
    const ctx = makeContext({ noScrapeUrl: true });
    const comparisons = [
      { url: 'https://example.com/a', hasScrapeMetadata: true, scrapeForbidden: true },
      { url: 'https://example.com/b', hasScrapeMetadata: true, scrapeForbidden: false },
    ];
    const result = await getScrapeJobStats(null, comparisons, 2, ctx);

    expect(result.scrapeForbiddenCount).to.equal(1);
  });

  // ─── Normal path (ScrapeUrl DB available) ─────────────────────────────────

  it('uses allScrapeUrls.length as urlsSubmittedForScraping', async () => {
    const ctx = makeContext({ scrapeUrls: ['https://example.com/a', 'https://example.com/b'] });
    const result = await getScrapeJobStats('job-1', [], 0, ctx);

    expect(result.urlsSubmittedForScraping).to.equal(2);
  });

  it('returns submittedUrlSet containing all scraped URLs', async () => {
    const ctx = makeContext({ scrapeUrls: ['https://example.com/a'] });
    const result = await getScrapeJobStats('job-1', [], 0, ctx);

    expect(result.submittedUrlSet).to.be.instanceof(Set);
    expect(result.submittedUrlSet.has('https://example.com/a')).to.be.true;
  });

  it('identifies missing pages absent from comparisonResults', async () => {
    const ctx = makeContext({ scrapeUrls: ['https://example.com/a', 'https://example.com/b'] });
    const comparisons = [{ url: 'https://example.com/a', hasScrapeMetadata: true, scrapeForbidden: false }];
    const result = await getScrapeJobStats('job-1', comparisons, 2, ctx);

    expect(result.missingPages).to.have.lengthOf(1);
    expect(result.missingPages[0].url).to.equal('https://example.com/b');
    expect(result.missingPages[0].scrapingStatus).to.equal('failed');
    expect(result.missingPages[0].needsPrerender).to.be.false;
  });

  it('reads scrape.json for missing pages and sets scrapeError when present', async () => {
    getObjectFromKeyStub.resolves({ error: { statusCode: 403, message: 'Forbidden' } });
    const ctx = makeContext({ scrapeUrls: ['https://example.com/missing'] });
    const result = await getScrapeJobStats('job-1', [], 0, ctx);

    expect(result.missingPages[0].scrapeError).to.deep.equal({ statusCode: 403, message: 'Forbidden' });
  });

  it('combines COMPLETE and FAILED-status 403s in scrapeForbiddenCount', async () => {
    getObjectFromKeyStub.resolves({ error: { statusCode: 403 } });
    const ctx = makeContext({ scrapeUrls: ['https://example.com/a', 'https://example.com/b'] });
    const comparisons = [
      { url: 'https://example.com/a', hasScrapeMetadata: true, scrapeForbidden: true },
    ];
    const result = await getScrapeJobStats('job-1', comparisons, 2, ctx);

    // 1 from COMPLETE + 1 from FAILED
    expect(result.scrapeForbiddenCount).to.equal(2);
  });

  it('handles missing scrape.json gracefully (getObjectFromKey throws)', async () => {
    getObjectFromKeyStub.rejects(new Error('NoSuchKey'));
    const ctx = makeContext({ scrapeUrls: ['https://example.com/missing'] });
    const result = await getScrapeJobStats('job-1', [], 0, ctx);

    expect(result.missingPages[0].scrapeError).to.be.undefined;
  });

  // ─── ScrapeUrl DB throws ───────────────────────────────────────────────────

  it('falls back to urlsToCheckLength and logs warning when ScrapeUrl.allByScrapeJobId throws', async () => {
    const ctx = makeContext({ scrapeUrlsThrows: true });
    const result = await getScrapeJobStats('job-1', [], 5, ctx);

    expect(result.urlsSubmittedForScraping).to.equal(5);
    expect(result.missingPages).to.deep.equal([]);
    expect(result.submittedUrlSet).to.be.null;
    expect(ctx.log.warn).to.have.been.calledWithMatch(/Failed to fetch ScrapeUrl stats/);
  });
});

describe('buildAuditResult', () => {
  let buildAuditResult;

  before(async () => {
    // buildAuditResult is a pure function — no esmock needed
    ({ buildAuditResult } = await import('../../../src/prerender/scrape-stats.js'));
  });

  const scrapeStats = {
    urlsSubmittedForScraping: 3,
    scrapeForbiddenCount: 1,
    missingPages: [{ url: 'https://example.com/missing', scrapingStatus: 'failed' }],
    submittedUrlSet: new Set(['https://example.com/a']),
  };
  const botBlockResult = { scrapeForbidden: false, scrapeForbiddenSince: null };

  it('computes urlsNeedingPrerender from comparisonResults', () => {
    const comparisons = [
      { url: 'https://example.com/a', needsPrerender: true, error: false },
      { url: 'https://example.com/b', needsPrerender: false, error: false },
    ];
    const { auditResult, urlsNeedingPrerender } = buildAuditResult(comparisons, scrapeStats, botBlockResult);
    expect(urlsNeedingPrerender).to.have.lengthOf(1);
    expect(auditResult.urlsNeedingPrerender).to.equal(1);
  });

  it('computes successfulComparisons excluding error results', () => {
    const comparisons = [
      { url: 'https://example.com/a', needsPrerender: false, error: false },
      { url: 'https://example.com/b', needsPrerender: false, error: true },
    ];
    const { successfulComparisons, auditResult } = buildAuditResult(comparisons, scrapeStats, botBlockResult);
    expect(successfulComparisons).to.have.lengthOf(1);
    expect(auditResult.urlsScrapedSuccessfully).to.equal(1);
  });

  it('removes hasScrapeMetadata and scrapeForbidden from cleanResults', () => {
    const comparisons = [
      {
        url: 'https://example.com/a',
        needsPrerender: false,
        error: false,
        hasScrapeMetadata: true,
        scrapeForbidden: true,
        contentGainRatio: 1.5,
      },
    ];
    const { auditResult } = buildAuditResult(comparisons, scrapeStats, botBlockResult);
    const result = auditResult.results[0];
    expect(result).to.not.have.property('hasScrapeMetadata');
    expect(result).to.not.have.property('scrapeForbidden');
    expect(result.contentGainRatio).to.equal(1.5);
  });

  it('computes scrapingErrorRate as percentage of failed URLs', () => {
    const comparisons = [
      { url: 'https://example.com/a', needsPrerender: false, error: false },
    ];
    const stats = { urlsSubmittedForScraping: 4, scrapeForbiddenCount: 0, missingPages: [] };
    // 1 successful out of 4 submitted → 3 failed → 75%
    const { auditResult } = buildAuditResult(comparisons, stats, botBlockResult);
    expect(auditResult.scrapingErrorRate).to.equal(75);
  });

  it('sets scrapingErrorRate to 0 when urlsSubmittedForScraping is 0', () => {
    const stats = { urlsSubmittedForScraping: 0, scrapeForbiddenCount: 0, missingPages: [] };
    const { auditResult } = buildAuditResult([], stats, botBlockResult);
    expect(auditResult.scrapingErrorRate).to.equal(0);
  });

  it('excludes isDeployedAtEdge URLs from scrapedUrlsSet', () => {
    const comparisons = [
      { url: 'https://example.com/deployed', needsPrerender: false, error: false, isDeployedAtEdge: true },
      { url: 'https://example.com/normal', needsPrerender: false, error: false, isDeployedAtEdge: false },
    ];
    const { scrapedUrlsSet } = buildAuditResult(comparisons, scrapeStats, botBlockResult);
    expect(scrapedUrlsSet.has('https://example.com/deployed')).to.be.false;
    expect(scrapedUrlsSet.has('https://example.com/normal')).to.be.true;
  });

  it('propagates scrapeForbidden and scrapeForbiddenSince from botBlockResult', () => {
    const botBlock = { scrapeForbidden: true, scrapeForbiddenSince: '2025-01-01T00:00:00Z' };
    const { auditResult } = buildAuditResult([], scrapeStats, botBlock);
    expect(auditResult.scrapeForbidden).to.be.true;
    expect(auditResult.scrapeForbiddenSince).to.equal('2025-01-01T00:00:00Z');
  });

  it('sets lastAuditSuccess to true', () => {
    const { auditResult } = buildAuditResult([], scrapeStats, botBlockResult);
    expect(auditResult.lastAuditSuccess).to.be.true;
  });

  it('includes missingPages from scrapeStats', () => {
    const { auditResult } = buildAuditResult([], scrapeStats, botBlockResult);
    expect(auditResult.missingPages).to.deep.equal(scrapeStats.missingPages);
  });
});
