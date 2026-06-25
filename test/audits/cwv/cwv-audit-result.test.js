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

    it('returns FALSE when fetch throws (transient/blocked, not gone)', async () => {
      fetchStub.rejects(new Error('network error'));
      const result = await isUrlGone('https://example.com/timeout', log);
      expect(result).to.be.false;
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

    it('does NOT exclude any URL when ALL candidates report gone (site-wide guard)', async () => {
      const cwvDataFromRum = [
        { type: 'url', url: 'https://blocked.com/a', pageviews: 10000, organic: 5000, metrics: [] },
        { type: 'url', url: 'https://blocked.com/b', pageviews: 8000, organic: 4000, metrics: [] },
      ];
      fetchStub.resolves({ status: 404 });

      const fn = await build({ query: sandbox.stub().resolves(cwvDataFromRum) });
      const context = { site: makeSite('https://blocked.com'), finalUrl: 'blocked.com', log, env: {} };
      const result = await fn(context);

      expect(result.auditResult.cwv).to.have.length(2);
      expect(log.warn.calledOnce).to.be.true;
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
  });
});
