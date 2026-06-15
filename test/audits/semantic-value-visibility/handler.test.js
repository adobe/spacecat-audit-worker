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

function makeFetchResponse(html, { ok = true, status = 200, contentLength = '0' } = {}) {
  const encoded = new TextEncoder().encode(html);
  return {
    ok,
    status,
    headers: { get: (h) => (h === 'content-length' ? contentLength : null) },
    body: {
      getReader: () => {
        let delivered = false;
        return {
          read: async () => {
            if (delivered) return { done: true, value: undefined };
            delivered = true;
            return { done: false, value: encoded };
          },
          cancel: () => {},
        };
      },
    },
  };
}

describe('Semantic Value Visibility Handler', function () {
  this.timeout(10000);

  let sandbox;
  let fetchStub;
  let site;
  let context;
  let sqsStub;
  let logStub;
  let getMergedAuditInputUrlsStub;
  let auditRunner;
  let sendToMystique;

  const auditUrl = 'https://example.com';
  const siteId = 'site-123';

  before(async () => {
    getMergedAuditInputUrlsStub = sinon.stub();

    ({ auditRunner, sendToMystique } = await esmock(
      '../../../src/semantic-value-visibility/handler.js',
      {
        '../../../src/utils/audit-input-urls.js': {
          getMergedAuditInputUrls: getMergedAuditInputUrlsStub,
          sortTopPagesByTraffic: (pages) => pages,
        },
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
        },
      },
    ));
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    getMergedAuditInputUrlsStub.reset();

    fetchStub = sandbox.stub(globalThis, 'fetch').rejects(new Error('unstubbed fetch call'));

    site = {
      getId: () => siteId,
      getDeliveryType: () => 'aem_edge',
    };

    sqsStub = { sendMessage: sandbox.stub().resolves() };
    logStub = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    context = {
      log: logStub,
      sqs: sqsStub,
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique-queue' },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('auditRunner', () => {
    it('should return qualifying URLs that contain <img> tags', async () => {
      const urls = [
        'https://example.com/page-with-img',
        'https://example.com/page-without-img',
        'https://example.com/another-with-img',
      ];

      getMergedAuditInputUrlsStub.resolves({
        urls,
        agenticUrls: urls,
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      fetchStub
        .withArgs('https://example.com/page-with-img')
        .resolves(makeFetchResponse('<html><body><img src="hero.jpg"></body></html>'))
        .withArgs('https://example.com/page-without-img')
        .resolves(makeFetchResponse('<html><body><p>No images here</p></body></html>'))
        .withArgs('https://example.com/another-with-img')
        .resolves(makeFetchResponse('<html><body><img src="banner.jpg" /></body></html>'));

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.have.members([
        'https://example.com/page-with-img',
        'https://example.com/another-with-img',
      ]);
      expect(result.auditResult.siteId).to.equal(siteId);
      expect(result.auditResult.status).to.equal('pending-mystique');
      expect(result.fullAuditRef).to.equal(auditUrl);
    });

    it('should return empty urls when no pages have <img> tags', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: ['https://example.com/text-only'],
        agenticUrls: ['https://example.com/text-only'],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      fetchStub.resolves(makeFetchResponse('<html><body><p>Text only</p></body></html>'));

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.deep.equal([]);
    });

    it('should skip URLs where fetch throws an error', async () => {
      const goodUrl = 'https://example.com/good';
      const badUrl = 'https://example.com/bad';

      getMergedAuditInputUrlsStub.resolves({
        urls: [goodUrl, badUrl],
        agenticUrls: [goodUrl, badUrl],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      fetchStub
        .withArgs(goodUrl).resolves(makeFetchResponse('<img src="hero.jpg">'))
        .withArgs(badUrl).rejects(new Error('connection refused'));

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.deep.equal([goodUrl]);
      expect(logStub.warn).to.have.been.calledWithMatch(
        '[semantic-value-visibility] Failed to fetch',
      );
    });

    it('should skip URLs that time out and log a distinct message', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: ['https://example.com/slow'],
        agenticUrls: [],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      const timeoutError = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
      fetchStub.rejects(timeoutError);

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.deep.equal([]);
      expect(logStub.warn).to.have.been.calledWithMatch('timed out after 10s');
    });

    it('should skip URLs that return a non-OK HTTP status', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: ['https://example.com/forbidden'],
        agenticUrls: [],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      fetchStub.resolves(makeFetchResponse('<img src="logo.png">', { ok: false, status: 403 }));

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.deep.equal([]);
      expect(logStub.warn).to.have.been.calledWithMatch('returned HTTP 403, skipping');
    });

    it('should skip URLs with a response body larger than 5MB', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: ['https://example.com/huge'],
        agenticUrls: [],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      fetchStub.resolves(makeFetchResponse('<img src="x.jpg">', { contentLength: String(6 * 1024 * 1024) }));

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.deep.equal([]);
      expect(logStub.warn).to.have.been.calledWithMatch('response too large');
    });

    it('should skip URLs when Content-Length is absent but streamed body exceeds 5MB', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: ['https://example.com/chunked-large'],
        agenticUrls: [],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      const largeHtml = `<img src="x.jpg">${'x'.repeat(6 * 1024 * 1024)}`;
      fetchStub.resolves(makeFetchResponse(largeHtml, { contentLength: null }));

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.deep.equal([]);
      expect(logStub.warn).to.have.been.calledWithMatch('response too large');
    });

    it('should qualify a URL when Content-Length header is absent', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: ['https://example.com/no-content-length'],
        agenticUrls: [],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      fetchStub.resolves(makeFetchResponse('<img src="x.jpg">', { contentLength: null }));

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.deep.equal(['https://example.com/no-content-length']);
    });

    it('should skip non-HTTPS URLs without making a network request', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: ['http://example.com/insecure'],
        agenticUrls: [],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.deep.equal([]);
      expect(logStub.warn).to.have.been.calledWithMatch('is not HTTPS, skipping');
      expect(fetchStub).not.to.have.been.called;
    });

    it('should collect qualifying URLs from multiple fetch batches (>10 URLs)', async () => {
      const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/page-${i}`);

      getMergedAuditInputUrlsStub.resolves({
        urls,
        agenticUrls: urls,
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      urls.slice(0, 10).forEach((u) => {
        fetchStub.withArgs(u).resolves(makeFetchResponse('<img src="hero.jpg">'));
      });
      urls.slice(10).forEach((u) => {
        fetchStub.withArgs(u).resolves(makeFetchResponse('<p>No images</p>'));
      });

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.have.members(urls.slice(0, 10));
    });

    it('should return empty urls when getMergedAuditInputUrls returns no URLs', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: [],
        agenticUrls: [],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult.urls).to.deep.equal([]);
      expect(result.auditResult.status).to.equal('pending-mystique');
    });

    it('should log URL input summary and qualifying count', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: ['https://example.com/page'],
        agenticUrls: ['https://example.com/page'],
        topPagesUrls: ['https://example.com/seo-page'],
        includedURLs: [],
        filteredCount: 1,
      });

      fetchStub.resolves(makeFetchResponse('<img src="x.jpg">'));

      await auditRunner(auditUrl, context, site);

      expect(logStub.info).to.have.been.calledWithMatch('[semantic-value-visibility] URL inputs:');
      expect(logStub.info).to.have.been.calledWithMatch('qualify');
    });

    it('should pass topOrganicLimit=50 to getMergedAuditInputUrls', async () => {
      getMergedAuditInputUrlsStub.resolves({
        urls: [],
        agenticUrls: [],
        topPagesUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      await auditRunner(auditUrl, context, site);

      const callArgs = getMergedAuditInputUrlsStub.getCall(0).args[0];
      expect(callArgs.topOrganicLimit).to.equal(50);
    });

    it('should call SiteTopPage when getTopPages callback is invoked', async () => {
      const fakeTopPage = { getUrl: () => 'https://example.com/top', getTraffic: () => 100 };
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([fakeTopPage]);

      getMergedAuditInputUrlsStub.callsFake(async ({ getTopPages, getAgenticUrls }) => {
        const pages = await getTopPages();
        expect(pages).to.have.length(1);
        await getAgenticUrls();
        return {
          urls: [],
          agenticUrls: [],
          topPagesUrls: [],
          includedURLs: [],
          filteredCount: 0,
        };
      });

      await auditRunner(auditUrl, context, site);

      expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
        siteId,
        'seo',
        'global',
      );
    });

    it('should use empty array when SiteTopPage returns undefined', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(undefined);

      getMergedAuditInputUrlsStub.callsFake(async ({ getTopPages }) => {
        const pages = await getTopPages();
        expect(pages).to.deep.equal([]);
        return {
          urls: [],
          agenticUrls: [],
          topPagesUrls: [],
          includedURLs: [],
          filteredCount: 0,
        };
      });

      await auditRunner(auditUrl, context, site);
    });

    it('should warn and return empty array when SiteTopPage accessor is unavailable', async () => {
      context.dataAccess.SiteTopPage = undefined;

      getMergedAuditInputUrlsStub.callsFake(async ({ getTopPages }) => {
        const pages = await getTopPages();
        expect(pages).to.deep.equal([]);
        return {
          urls: [],
          agenticUrls: [],
          topPagesUrls: [],
          includedURLs: [],
          filteredCount: 0,
        };
      });

      await auditRunner(auditUrl, context, site);

      expect(logStub.warn).to.have.been.calledWith(
        '[semantic-value-visibility] SiteTopPage accessor unavailable, falling back to agentic URLs only',
      );
    });
  });

  describe('sendToMystique', () => {
    it('should send one SQS message per qualifying URL', async () => {
      const urls = ['https://example.com/page1', 'https://example.com/page2'];
      const auditData = { id: 'audit-456', auditResult: { siteId, urls } };

      const result = await sendToMystique(auditUrl, auditData, context, site);

      expect(result).to.equal(auditData);
      expect(sqsStub.sendMessage).to.have.been.calledTwice;

      const firstMsg = sqsStub.sendMessage.getCall(0).args[1];
      expect(firstMsg).to.include({
        type: 'guidance:semantic-value-visibility',
        siteId,
        auditId: 'audit-456',
        deliveryType: 'aem_edge',
      });
      expect(firstMsg.data).to.deep.equal({ url: firstMsg.url });
    });

    it('should log a warning and return early when urls is empty', async () => {
      const auditData = { id: 'audit-456', auditResult: { siteId, urls: [] } };

      const result = await sendToMystique(auditUrl, auditData, context, site);

      expect(result).to.equal(auditData);
      expect(sqsStub.sendMessage).not.to.have.been.called;
      expect(logStub.warn).to.have.been.calledWith(
        '[semantic-value-visibility] No qualifying URLs to send to Mystique',
      );
    });

    it('should log a warning and return early when auditResult is missing', async () => {
      const auditData = { id: 'audit-456' };

      const result = await sendToMystique(auditUrl, auditData, context, site);

      expect(result).to.equal(auditData);
      expect(sqsStub.sendMessage).not.to.have.been.called;
      expect(logStub.warn).to.have.been.called;
    });

    it('should send messages to the correct SQS queue', async () => {
      const auditData = { auditResult: { urls: ['https://example.com/page'] } };

      await sendToMystique(auditUrl, auditData, context, site);

      expect(sqsStub.sendMessage).to.have.been.calledWith(
        'spacecat-to-mystique-queue',
        sinon.match.object,
      );
    });

    it('should include a timestamp in each message', async () => {
      const auditData = { auditResult: { urls: ['https://example.com/page'] } };

      await sendToMystique(auditUrl, auditData, context, site);

      const msg = sqsStub.sendMessage.getCall(0).args[1];
      expect(msg.time).to.be.a('string');
      expect(new Date(msg.time)).to.be.instanceOf(Date);
    });

    it('should log sent count out of total', async () => {
      const urls = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'];
      const auditData = { auditResult: { urls } };

      await sendToMystique(auditUrl, auditData, context, site);

      expect(logStub.info).to.have.been.calledWith(
        '[semantic-value-visibility] Sent 3/3 requests to Mystique',
      );
    });

    it('should log individual errors and continue when some SQS sends fail', async () => {
      const urls = ['https://example.com/ok', 'https://example.com/fail'];
      const auditData = { auditResult: { urls } };

      sqsStub.sendMessage
        .withArgs(sinon.match.any, sinon.match({ url: 'https://example.com/ok' })).resolves()
        .withArgs(sinon.match.any, sinon.match({ url: 'https://example.com/fail' }))
        .rejects(new Error('queue throttled'));

      const result = await sendToMystique(auditUrl, auditData, context, site);

      expect(result).to.equal(auditData);
      expect(logStub.error).to.have.been.calledWithMatch('Failed to send SQS message');
      expect(logStub.info).to.have.been.calledWithMatch('Sent 1/2 requests to Mystique');
    });
  });
});
