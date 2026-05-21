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

describe('html-comparator', () => {
  const sandbox = sinon.createSandbox();

  let getObjectFromKeyStub;
  let analyzeHtmlForPrerenderStub;
  let getS3PathStub;
  let mod;

  before(async () => {
    getObjectFromKeyStub = sandbox.stub();
    analyzeHtmlForPrerenderStub = sandbox.stub();
    getS3PathStub = sandbox.stub().returns('prerender/scrapes/job123/page/server-side.html');

    mod = await esmock('../../../src/prerender/html-comparator.js', {
      '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
      '../../../src/prerender/utils/html-comparator.js': {
        analyzeHtmlForPrerender: analyzeHtmlForPrerenderStub,
      },
      '../../../src/prerender/utils/utils.js': { getS3Path: getS3PathStub },
      '../../../src/prerender/utils/constants.js': { CONTENT_GAIN_THRESHOLD: 1.1 },
    });
  });

  beforeEach(() => {
    getObjectFromKeyStub.reset();
    analyzeHtmlForPrerenderStub.reset();
    getS3PathStub.reset();
    getS3PathStub.returns('prerender/scrapes/job123/page/server-side.html');
  });

  afterEach(() => {
    sandbox.restore();
  });

  function buildContext(overrides = {}) {
    return {
      log: {
        debug: sandbox.stub(),
        warn: sandbox.stub(),
        info: sandbox.stub(),
      },
      s3Client: {},
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      auditContext: { scrapeJobId: 'job-123' },
      ...overrides,
    };
  }

  describe('getScrapedHtmlFromS3', () => {
    it('happy path — all 3 S3 fetches succeed', async () => {
      const serverHtml = '<html>server</html>';
      const clientHtml = '<html>client</html>';
      const metadata = { isDeployedAtEdge: false };

      getObjectFromKeyStub.onCall(0).resolves(serverHtml);
      getObjectFromKeyStub.onCall(1).resolves(clientHtml);
      getObjectFromKeyStub.onCall(2).resolves(metadata);

      const ctx = buildContext();
      const result = await mod.getScrapedHtmlFromS3('https://example.com/page', ctx);

      expect(result.serverSideHtml).to.equal(serverHtml);
      expect(result.clientSideHtml).to.equal(clientHtml);
      expect(result.metadata).to.deep.equal(metadata);
    });

    it('partial S3 failures — rejected promises return null for that slot', async () => {
      const serverHtml = '<html>server</html>';

      getObjectFromKeyStub.onCall(0).resolves(serverHtml);
      getObjectFromKeyStub.onCall(1).rejects(new Error('NoSuchKey'));
      getObjectFromKeyStub.onCall(2).rejects(new Error('AccessDenied'));

      const ctx = buildContext();
      const result = await mod.getScrapedHtmlFromS3('https://example.com/page', ctx);

      expect(result.serverSideHtml).to.equal(serverHtml);
      expect(result.clientSideHtml).to.be.null;
      expect(result.metadata).to.be.null;
    });

    it('all fetches fail — all slots return null', async () => {
      getObjectFromKeyStub.rejects(new Error('S3 unavailable'));

      const ctx = buildContext();
      const result = await mod.getScrapedHtmlFromS3('https://example.com/page', ctx);

      expect(result.serverSideHtml).to.be.null;
      expect(result.clientSideHtml).to.be.null;
      expect(result.metadata).to.be.null;
    });

    it('auditContext is null — storageId is undefined (destructuring fallback)', async () => {
      getObjectFromKeyStub.resolves(null);

      const ctx = buildContext({ auditContext: null });
      const result = await mod.getScrapedHtmlFromS3('https://example.com/page', ctx);

      expect(result.serverSideHtml).to.be.null;
      expect(result.clientSideHtml).to.be.null;
      expect(result.metadata).to.be.null;
      // getS3Path should be called with undefined as the id
      expect(getS3PathStub).to.have.been.calledWith('https://example.com/page', undefined, sinon.match.string);
    });

    it('auditContext is undefined — storageId is undefined (destructuring fallback)', async () => {
      getObjectFromKeyStub.resolves(null);

      const ctx = buildContext({ auditContext: undefined });
      const result = await mod.getScrapedHtmlFromS3('https://example.com/page', ctx);

      expect(result.serverSideHtml).to.be.null;
      expect(result.metadata).to.be.null;
      expect(getS3PathStub).to.have.been.calledWith('https://example.com/page', undefined, sinon.match.string);
    });

    it('synchronous throw inside try block — catch returns all nulls and logs warn', async () => {
      // Force getS3Path to throw synchronously so the outer try/catch fires
      getS3PathStub.throws(new Error('path-construction-error'));

      const ctx = buildContext();
      const result = await mod.getScrapedHtmlFromS3('https://example.com/page', ctx);

      expect(result.serverSideHtml).to.be.null;
      expect(result.clientSideHtml).to.be.null;
      expect(result.metadata).to.be.null;
      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match(/Could not get scraped content for.*path-construction-error/),
      );
    });

    it('scrapeJsonData is null — metadata is null (falsy coalescing)', async () => {
      const serverHtml = '<html>server</html>';
      const clientHtml = '<html>client</html>';

      getObjectFromKeyStub.onCall(0).resolves(serverHtml);
      getObjectFromKeyStub.onCall(1).resolves(clientHtml);
      getObjectFromKeyStub.onCall(2).resolves(null);

      const ctx = buildContext();
      const result = await mod.getScrapedHtmlFromS3('https://example.com/page', ctx);

      expect(result.metadata).to.be.null;
    });

    it('logs debug message with the URL', async () => {
      getObjectFromKeyStub.resolves(null);

      const ctx = buildContext();
      await mod.getScrapedHtmlFromS3('https://example.com/page', ctx);

      expect(ctx.log.debug).to.have.been.calledWith(
        sinon.match(/Getting scraped content for URL: https:\/\/example\.com\/page/),
      );
    });
  });

  describe('compareHtmlContent', () => {
    it('happy path — both HTMLs present, analysis succeeds', async () => {
      const serverHtml = '<html>server</html>';
      const clientHtml = '<html>client</html>';
      const metadata = {
        isDeployedAtEdge: false,
        usedEarlyClientSideHtml: false,
        error: null,
      };
      const analysis = {
        needsPrerender: true,
        contentGainRatio: 1.5,
        wordCountBefore: 10,
        wordCountAfter: 20,
        citabilityScore: 0.8,
        wordDifference: 10,
      };

      getObjectFromKeyStub.onCall(0).resolves(serverHtml);
      getObjectFromKeyStub.onCall(1).resolves(clientHtml);
      getObjectFromKeyStub.onCall(2).resolves(metadata);
      analyzeHtmlForPrerenderStub.resolves(analysis);

      const ctx = buildContext();
      const result = await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(result.url).to.equal('https://example.com/page');
      expect(result.needsPrerender).to.be.true;
      expect(result.contentGainRatio).to.equal(1.5);
      expect(result.hasScrapeMetadata).to.be.true;
      expect(result.scrapeForbidden).to.be.false;
      expect(result.isDeployedAtEdge).to.be.false;
      expect(result.usedEarlyClientSideHtml).to.be.false;
      expect(result.error).to.be.undefined;
    });

    it('serverSideHtml is null — throws, catch returns error result', async () => {
      getObjectFromKeyStub.onCall(0).resolves(null);
      getObjectFromKeyStub.onCall(1).resolves('<html>client</html>');
      getObjectFromKeyStub.onCall(2).resolves(null);

      const ctx = buildContext();
      const result = await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(result.error).to.be.true;
      expect(result.needsPrerender).to.be.false;
      expect(result.url).to.equal('https://example.com/page');
      expect(result.hasScrapeMetadata).to.be.false;
      expect(result.scrapeForbidden).to.be.false;
    });

    it('clientSideHtml is null — throws, catch returns error result', async () => {
      getObjectFromKeyStub.onCall(0).resolves('<html>server</html>');
      getObjectFromKeyStub.onCall(1).resolves(null);
      getObjectFromKeyStub.onCall(2).resolves(null);

      const ctx = buildContext();
      const result = await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(result.error).to.be.true;
      expect(result.needsPrerender).to.be.false;
      expect(result.url).to.equal('https://example.com/page');
    });

    it('analyzeHtmlForPrerender throws — catch returns error result', async () => {
      getObjectFromKeyStub.onCall(0).resolves('<html>server</html>');
      getObjectFromKeyStub.onCall(1).resolves('<html>client</html>');
      getObjectFromKeyStub.onCall(2).resolves(null);
      analyzeHtmlForPrerenderStub.rejects(new Error('analysis-failure'));

      const ctx = buildContext();
      const result = await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(result.error).to.be.true;
      expect(result.needsPrerender).to.be.false;
      expect(ctx.log.debug).to.have.been.calledWith(
        sinon.match(/HTML analysis failed.*analysis-failure/),
      );
    });

    it('metadata is null — hasScrapeMetadata=false, scrapeForbidden=false, isDeployedAtEdge=false', async () => {
      getObjectFromKeyStub.onCall(0).resolves('<html>server</html>');
      getObjectFromKeyStub.onCall(1).resolves('<html>client</html>');
      getObjectFromKeyStub.onCall(2).resolves(null);
      analyzeHtmlForPrerenderStub.resolves({
        needsPrerender: false,
        contentGainRatio: 1.0,
        wordCountBefore: 10,
        wordCountAfter: 10,
      });

      const ctx = buildContext();
      const result = await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(result.hasScrapeMetadata).to.be.false;
      expect(result.scrapeForbidden).to.be.false;
      expect(result.isDeployedAtEdge).to.be.false;
      expect(result.usedEarlyClientSideHtml).to.be.false;
    });

    it('metadata.error.statusCode === 403 — scrapeForbidden=true', async () => {
      const metadata = { error: { statusCode: 403, message: 'Forbidden' } };
      getObjectFromKeyStub.onCall(0).resolves(null);
      getObjectFromKeyStub.onCall(1).resolves(null);
      getObjectFromKeyStub.onCall(2).resolves(metadata);

      const ctx = buildContext();
      const result = await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(result.scrapeForbidden).to.be.true;
      expect(result.hasScrapeMetadata).to.be.true;
      expect(result.error).to.be.true;
    });

    it('metadata.isDeployedAtEdge=true — reflected in result', async () => {
      const metadata = { isDeployedAtEdge: true, usedEarlyClientSideHtml: false };
      getObjectFromKeyStub.onCall(0).resolves('<html>server</html>');
      getObjectFromKeyStub.onCall(1).resolves('<html>client</html>');
      getObjectFromKeyStub.onCall(2).resolves(metadata);
      analyzeHtmlForPrerenderStub.resolves({
        needsPrerender: false,
        contentGainRatio: 1.0,
        wordCountBefore: 10,
        wordCountAfter: 10,
      });

      const ctx = buildContext();
      const result = await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(result.isDeployedAtEdge).to.be.true;
      expect(result.usedEarlyClientSideHtml).to.be.false;
    });

    it('metadata.usedEarlyClientSideHtml=true — reflected in result', async () => {
      const metadata = { isDeployedAtEdge: false, usedEarlyClientSideHtml: true };
      getObjectFromKeyStub.onCall(0).resolves('<html>server</html>');
      getObjectFromKeyStub.onCall(1).resolves('<html>client</html>');
      getObjectFromKeyStub.onCall(2).resolves(metadata);
      analyzeHtmlForPrerenderStub.resolves({
        needsPrerender: true,
        contentGainRatio: 1.2,
        wordCountBefore: 5,
        wordCountAfter: 15,
      });

      const ctx = buildContext();
      const result = await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(result.usedEarlyClientSideHtml).to.be.true;
      expect(result.isDeployedAtEdge).to.be.false;
    });

    it('error result from null HTMLs also reflects isDeployedAtEdge and usedEarlyClientSideHtml', async () => {
      const metadata = { isDeployedAtEdge: true, usedEarlyClientSideHtml: true };
      getObjectFromKeyStub.onCall(0).resolves(null);
      getObjectFromKeyStub.onCall(1).resolves(null);
      getObjectFromKeyStub.onCall(2).resolves(metadata);

      const ctx = buildContext();
      const result = await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(result.error).to.be.true;
      expect(result.isDeployedAtEdge).to.be.true;
      expect(result.usedEarlyClientSideHtml).to.be.true;
    });

    it('analyzeHtmlForPrerender called with CONTENT_GAIN_THRESHOLD=1.1', async () => {
      getObjectFromKeyStub.onCall(0).resolves('<html>server</html>');
      getObjectFromKeyStub.onCall(1).resolves('<html>client</html>');
      getObjectFromKeyStub.onCall(2).resolves(null);
      analyzeHtmlForPrerenderStub.resolves({
        needsPrerender: false,
        contentGainRatio: 1.0,
        wordCountBefore: 10,
        wordCountAfter: 10,
      });

      const ctx = buildContext();
      await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(analyzeHtmlForPrerenderStub).to.have.been.calledWith(
        '<html>server</html>',
        '<html>client</html>',
        1.1,
      );
    });

    it('logs debug message for comparison start', async () => {
      getObjectFromKeyStub.resolves(null);

      const ctx = buildContext();
      await mod.compareHtmlContent('https://example.com/page', ctx);

      expect(ctx.log.debug).to.have.been.calledWith(
        sinon.match(/Comparing HTML content for: https:\/\/example\.com\/page/),
      );
    });
  });

  describe('compareAllUrls', () => {
    function buildCompareAllCtx(overrides = {}) {
      return {
        log: {
          debug: sandbox.stub(),
          warn: sandbox.stub(),
          info: sandbox.stub(),
        },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        auditContext: { scrapeJobId: 'job-123' },
        site: {
          getBaseURL: () => 'https://example.com',
          getId: () => 'site-1',
        },
        ...overrides,
      };
    }

    it('returns [] immediately when isDomainBlocked is true', async () => {
      const ctx = buildCompareAllCtx({ scrapeResultPaths: new Map([['https://example.com/a', {}]]) });
      const result = await mod.compareAllUrls(ctx, true);
      expect(result).to.deep.equal([]);
      expect(getObjectFromKeyStub).to.not.have.been.called;
    });

    it('returns [] and logs warn when scrapeResultPaths is empty', async () => {
      const ctx = buildCompareAllCtx({ scrapeResultPaths: new Map() });
      const result = await mod.compareAllUrls(ctx, false);
      expect(result).to.deep.equal([]);
      expect(ctx.log.warn).to.have.been.calledWithMatch(/No COMPLETE scrape results/);
    });

    it('returns [] and logs warn when scrapeResultPaths is undefined', async () => {
      const ctx = buildCompareAllCtx({ scrapeResultPaths: undefined });
      const result = await mod.compareAllUrls(ctx, false);
      expect(result).to.deep.equal([]);
      expect(ctx.log.warn).to.have.been.calledWithMatch(/No COMPLETE scrape results/);
    });

    it('calls compareHtmlContent for each URL and returns results', async () => {
      getObjectFromKeyStub.resolves(null);
      analyzeHtmlForPrerenderStub.resolves({
        needsPrerender: false, contentGainRatio: 1.0, wordCountBefore: 10, wordCountAfter: 10,
      });

      const urls = ['https://example.com/a', 'https://example.com/b'];
      const ctx = buildCompareAllCtx({
        scrapeResultPaths: new Map(urls.map((u) => [u, {}])),
      });

      const results = await mod.compareAllUrls(ctx, false);

      expect(results).to.have.lengthOf(2);
      expect(results[0].url).to.equal('https://example.com/a');
      expect(results[1].url).to.equal('https://example.com/b');
      expect(ctx.log.info).to.have.been.calledWithMatch(/Found 2 URLs from scrape results/);
    });

    it('includes scrapeJobId=unknown in warn when auditContext is null', async () => {
      const ctx = buildCompareAllCtx({
        scrapeResultPaths: new Map(),
        auditContext: null,
      });
      await mod.compareAllUrls(ctx, false);
      expect(ctx.log.warn).to.have.been.calledWithMatch(/scrapeJobId=unknown/);
    });
  });
});
