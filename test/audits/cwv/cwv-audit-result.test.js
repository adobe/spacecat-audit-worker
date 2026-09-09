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

import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';
import { buildCWVAuditResult, isUrlGone } from '../../../src/cwv/cwv-audit-result.js';

describe('CWV Audit Result', () => {
  const sandbox = sinon.createSandbox();
  let fetchStub;
  let log;

  beforeEach(() => {
    log = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
    fetchStub = sandbox.stub(globalThis, 'fetch');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isUrlGone', () => {
    it('returns true when response status is 404 (gone)', async () => {
      fetchStub.resolves({ status: 404 });
      const result = await isUrlGone('https://example.com/404', log);
      expect(result).to.be.true;
      expect(fetchStub.calledOnceWith('https://example.com/404', sinon.match.has('method', 'HEAD'))).to.be.true;
    });

    it('returns true when response status is 410 (gone)', async () => {
      fetchStub.resolves({ status: 410 });
      const result = await isUrlGone('https://example.com/gone', log);
      expect(result).to.be.true;
    });

    it('returns FALSE when response status is 403 (bot-block, not gone)', async () => {
      fetchStub.resolves({ status: 403 });
      const result = await isUrlGone('https://example.com/forbidden', log);
      expect(result).to.be.false;
    });

    it('returns false when response status is 200', async () => {
      fetchStub.resolves({ status: 200 });
      const result = await isUrlGone('https://example.com/ok', log);
      expect(result).to.be.false;
    });

    it('returns false when response status is 500 (server error, not gone)', async () => {
      fetchStub.resolves({ status: 500 });
      const result = await isUrlGone('https://example.com/error', log);
      expect(result).to.be.false;
    });

    it('returns FALSE when fetch throws an ambiguous error (timeout/bot-block, not gone)', async () => {
      fetchStub.rejects(new Error('network error'));
      const result = await isUrlGone('https://example.com/timeout', log);
      expect(result).to.be.false;
    });

    it('returns FALSE when fetch aborts (AbortError timeout, not gone)', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      fetchStub.rejects(abortErr);
      const result = await isUrlGone('https://example.com/slow', log);
      expect(result).to.be.false;
    });

    it('returns true when the host does not resolve (ENOTFOUND, gone)', async () => {
      const err = new Error('getaddrinfo ENOTFOUND example.invalid');
      err.code = 'ENOTFOUND';
      fetchStub.rejects(err);
      const result = await isUrlGone('https://example.invalid/', log);
      expect(result).to.be.true;
    });

    it('returns true when the connection is refused (ECONNREFUSED, gone)', async () => {
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      fetchStub.rejects(err);
      const result = await isUrlGone('https://example.com/down', log);
      expect(result).to.be.true;
    });

    it('returns true when a hard network failure is wrapped under err.cause (undici)', async () => {
      const cause = new Error('getaddrinfo ENOTFOUND example.invalid');
      cause.code = 'ENOTFOUND';
      const err = new TypeError('fetch failed');
      err.cause = cause;
      fetchStub.rejects(err);
      const result = await isUrlGone('https://example.invalid/', log);
      expect(result).to.be.true;
    });
  });

  describe('buildCWVAuditResult', () => {
    const makeSite = (baseURL) => ({
      getId: () => 'site-1',
      getBaseURL: () => baseURL,
      getConfig: () => ({ getGroupedURLs: () => [] }),
    });

    const build = async (mockRumClient) => {
      const mockRumClientClass = { createFrom: sandbox.stub().returns(mockRumClient) };
      const { buildCWVAuditResult: fn } = await esmock('../../../src/cwv/cwv-audit-result.js', {
        '@adobe/spacecat-shared-rum-api-client': { default: mockRumClientClass },
      });
      return fn;
    };

    it('excludes URL entries that are genuinely gone (404)', async () => {
      const cwvDataFromRum = [
        { type: 'url', url: 'https://www.lexmark.com/ok', pageviews: 10000, organic: 5000, metrics: [] },
        { type: 'url', url: 'https://www.lexmark.com/etc.clientlibs/bad', pageviews: 8000, organic: 4000, metrics: [] },
      ];
      fetchStub
        .onFirstCall().resolves({ status: 200 })
        .onSecondCall().resolves({ status: 404 });

      const fn = await build({ query: sandbox.stub().resolves(cwvDataFromRum) });
      const context = { site: makeSite('https://www.lexmark.com'), finalUrl: 'www.lexmark.com', log, env: {} };
      const result = await fn(context);

      const cwvUrls = result.auditResult.cwv.filter((e) => e.type === 'url').map((e) => e.url);
      expect(cwvUrls).to.include('https://www.lexmark.com/ok');
      expect(cwvUrls).to.not.include('https://www.lexmark.com/etc.clientlibs/bad');
      expect(result.auditResult.cwv).to.have.length(1);
    });

    it('RETAINS a URL that returns 403 (bot-block) — regression for SITES-47218', async () => {
      const cwvDataFromRum = [
        { type: 'url', url: 'https://datacom.com/ok', pageviews: 10000, organic: 5000, metrics: [] },
        { type: 'url', url: 'https://datacom.com/blocked', pageviews: 8000, organic: 4000, metrics: [] },
      ];
      fetchStub
        .onFirstCall().resolves({ status: 200 })
        .onSecondCall().resolves({ status: 403 });

      const fn = await build({ query: sandbox.stub().resolves(cwvDataFromRum) });
      const context = { site: makeSite('https://datacom.com'), finalUrl: 'datacom.com', log, env: {} };
      const result = await fn(context);

      const cwvUrls = result.auditResult.cwv.map((e) => e.url);
      expect(cwvUrls).to.include('https://datacom.com/blocked');
      expect(result.auditResult.cwv).to.have.length(2);
    });

    it('keeps group entries without HEAD check', async () => {
      const cwvDataFromRum = [
        { type: 'url', url: 'https://www.example.com/', pageviews: 10000, organic: 5000, metrics: [] },
        { type: 'group', pattern: '/some/*', name: 'Some pages', pageviews: 5000, organic: 3000, metrics: [] },
      ];
      fetchStub.resolves({ status: 200 });

      const fn = await build({ query: sandbox.stub().resolves(cwvDataFromRum) });
      const context = { site: makeSite('https://www.example.com'), finalUrl: 'www.example.com', log, env: {} };
      const result = await fn(context);

      expect(result.auditResult.cwv).to.have.length(2);
      expect(result.auditResult.cwv.find((e) => e.type === 'group')).to.exist;
      expect(fetchStub.callCount).to.equal(1);
    });

    describe('tier-based top-pages limit', () => {
      const EntitlementStub = {
        PRODUCT_CODES: { ASO: 'aso-product-code' },
        TIERS: { PAID: 'PAID', PLG: 'PLG' },
      };

      // 12 non-homepage pages, all below the 7000-pageview threshold guard so only the
      // tier-based top-N limit (not the threshold rule) determines how many are kept.
      const nonHomepagePages = Array.from({ length: 12 }, (_, i) => ({
        type: 'url',
        url: `https://www.example.com/page-${i}`,
        pageviews: 6000 - i * 100,
        organic: 0,
        metrics: [],
      }));
      const homepage = {
        type: 'url', url: 'https://www.example.com', pageviews: 100000, organic: 0, metrics: [],
      };

      const site = {
        getId: () => 'site-1',
        getBaseURL: () => 'https://www.example.com',
        getConfig: () => ({ getGroupedURLs: () => [] }),
      };

      async function buildWithTierClient(tierClientStub) {
        return esmock('../../../src/cwv/cwv-audit-result.js', {
          '@adobe/spacecat-shared-rum-api-client': {
            default: {
              createFrom: sandbox.stub().returns({
                query: sandbox.stub().resolves([homepage, ...nonHomepagePages]),
              }),
            },
          },
          '@adobe/spacecat-shared-tier-client': { TierClient: tierClientStub },
          '@adobe/spacecat-shared-data-access': { Entitlement: EntitlementStub },
        });
      }

      beforeEach(() => {
        fetchStub.resolves({ status: 200 });
      });

      it('limits top pages to 3 for a PLG-tier site', async () => {
        const tierClientStub = {
          createForSite: sandbox.stub().resolves({
            checkValidEntitlement: sandbox.stub().resolves({
              entitlement: { getTier: () => 'PLG' },
            }),
          }),
        };
        const { buildCWVAuditResult: build } = await buildWithTierClient(tierClientStub);

        const result = await build({ site, finalUrl: 'www.example.com', log, env: {} });

        const urls = result.auditResult.cwv.filter((e) => e.type === 'url').map((e) => e.url);
        expect(urls).to.have.length(4); // homepage + top 3
        expect(urls).to.include(homepage.url);
        expect(urls).to.include(nonHomepagePages[0].url);
        expect(urls).to.include(nonHomepagePages[2].url);
        expect(urls).to.not.include(nonHomepagePages[3].url);
      });

      it('limits top pages to 10 for a paid-tier site', async () => {
        const tierClientStub = {
          createForSite: sandbox.stub().resolves({
            checkValidEntitlement: sandbox.stub().resolves({
              entitlement: { getTier: () => 'PAID' },
            }),
          }),
        };
        const { buildCWVAuditResult: build } = await buildWithTierClient(tierClientStub);

        const result = await build({ site, finalUrl: 'www.example.com', log, env: {} });

        const urls = result.auditResult.cwv.filter((e) => e.type === 'url').map((e) => e.url);
        expect(urls).to.have.length(11); // homepage + top 10
        expect(urls).to.include(nonHomepagePages[9].url);
        expect(urls).to.not.include(nonHomepagePages[10].url);
      });

      it('defaults to the paid limit when no entitlement is found', async () => {
        const tierClientStub = {
          createForSite: sandbox.stub().resolves({
            checkValidEntitlement: sandbox.stub().resolves({}),
          }),
        };
        const { buildCWVAuditResult: build } = await buildWithTierClient(tierClientStub);

        const result = await build({ site, finalUrl: 'www.example.com', log, env: {} });

        const urls = result.auditResult.cwv.filter((e) => e.type === 'url').map((e) => e.url);
        expect(urls).to.have.length(11); // homepage + top 10
      });

      it('defaults to the paid limit and logs a warning when tier lookup fails', async () => {
        const tierClientStub = {
          createForSite: sandbox.stub().rejects(new Error('tier lookup failed')),
        };
        const { buildCWVAuditResult: build } = await buildWithTierClient(tierClientStub);

        const result = await build({ site, finalUrl: 'www.example.com', log, env: {} });

        const urls = result.auditResult.cwv.filter((e) => e.type === 'url').map((e) => e.url);
        expect(urls).to.have.length(11); // homepage + top 10
        expect(log.warn.calledWithMatch(/Failed to determine ASO tier/)).to.be.true;
      });
    });

    describe('subpath-site base-path scoping (SITES-49656)', () => {
      const subpathSite = {
        getId: () => 'us',
        getBaseURL: () => 'https://www.example.gov/us',
        getConfig: () => ({ getGroupedURLs: () => [] }),
      };

      function buildForSubpath(cwvDataFromRum) {
        return esmock('../../../src/cwv/cwv-audit-result.js', {
          '@adobe/spacecat-shared-rum-api-client': {
            default: {
              createFrom: sandbox.stub().returns({
                query: sandbox.stub().resolves(cwvDataFromRum),
              }),
            },
          },
        });
      }

      beforeEach(() => {
        fetchStub.resolves({ status: 200 });
      });

      it('keeps only pages under the site base path and drops sibling-site pages', async () => {
        const cwvDataFromRum = [
          {
            type: 'url', url: 'https://www.example.gov/us', pageviews: 100000, organic: 0, metrics: [],
          },
          {
            type: 'url', url: 'https://www.example.gov/us/leadership.html', pageviews: 6000, organic: 0, metrics: [],
          },
          {
            type: 'url', url: 'https://www.example.gov/other.html', pageviews: 5900, organic: 0, metrics: [],
          },
          {
            type: 'url', url: 'https://www.example.gov/us-budget', pageviews: 5800, organic: 0, metrics: [],
          },
          {
            type: 'group', pattern: '/us/*', name: 'US pages', pageviews: 5000, organic: 0, metrics: [],
          },
        ];
        const { buildCWVAuditResult: build } = await buildForSubpath(cwvDataFromRum);

        const result = await build({
          site: subpathSite, finalUrl: 'www.example.gov/us', log, env: {},
        });

        const urls = result.auditResult.cwv.filter((e) => e.type === 'url').map((e) => e.url);
        expect(urls).to.include('https://www.example.gov/us');
        expect(urls).to.include('https://www.example.gov/us/leadership.html');
        // sibling agency page on the same domain but outside /us — must be dropped
        expect(urls).to.not.include('https://www.example.gov/other.html');
        // directory-boundary safety: /us-budget is a sibling, not under /us/
        expect(urls).to.not.include('https://www.example.gov/us-budget');
        // operator-configured group entries pass through untouched
        expect(result.auditResult.cwv.find((e) => e.type === 'group')).to.exist;
      });

      it('queries RUM by hostname (not the sub-path) so the domainkey resolves', async () => {
        const queryStub = sandbox.stub().resolves([]);
        const { buildCWVAuditResult: build } = await esmock('../../../src/cwv/cwv-audit-result.js', {
          '@adobe/spacecat-shared-rum-api-client': {
            default: { createFrom: sandbox.stub().returns({ query: queryStub }) },
          },
        });

        await build({
          site: subpathSite, finalUrl: 'www.example.gov/us', log, env: {},
        });

        // Sub-path finalUrl (www.example.gov/us) must be stripped to the hostname for
        // the RUM query — the per-URL results are scoped to /us separately.
        expect(queryStub.getCalls().some((c) => c.args[1]?.domain === 'www.example.gov'))
          .to.equal(true);
      });

      it('drops url entries whose URL cannot be parsed', async () => {
        const cwvDataFromRum = [
          {
            type: 'url', url: 'https://www.example.gov/us', pageviews: 100000, organic: 0, metrics: [],
          },
          {
            type: 'url', url: ':::not-a-url', pageviews: 6000, organic: 0, metrics: [],
          },
        ];
        const { buildCWVAuditResult: build } = await buildForSubpath(cwvDataFromRum);

        const result = await build({
          site: subpathSite, finalUrl: 'www.example.gov/us', log, env: {},
        });

        const urls = result.auditResult.cwv.filter((e) => e.type === 'url').map((e) => e.url);
        expect(urls).to.deep.equal(['https://www.example.gov/us']);
      });
    });
  });
});
