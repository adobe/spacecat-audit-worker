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
import { buildCWVAuditResult, isUrl4xxOrFailed } from '../../../src/cwv/cwv-audit-result.js';

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

  describe('isUrl4xxOrFailed', () => {
    it('returns true when response status is 404', async () => {
      fetchStub.resolves({ status: 404 });
      const result = await isUrl4xxOrFailed('https://example.com/404', log);
      expect(result).to.be.true;
      expect(fetchStub.calledOnceWith('https://example.com/404', sinon.match.has('method', 'HEAD'))).to.be.true;
    });

    it('returns true when response status is 403', async () => {
      fetchStub.resolves({ status: 403 });
      const result = await isUrl4xxOrFailed('https://example.com/forbidden', log);
      expect(result).to.be.true;
    });

    it('returns true when response status is 410', async () => {
      fetchStub.resolves({ status: 410 });
      const result = await isUrl4xxOrFailed('https://example.com/gone', log);
      expect(result).to.be.true;
    });

    it('returns false when response status is 200', async () => {
      fetchStub.resolves({ status: 200 });
      const result = await isUrl4xxOrFailed('https://example.com/ok', log);
      expect(result).to.be.false;
    });

    it('returns false when response status is 500 (5xx not 4xx)', async () => {
      fetchStub.resolves({ status: 500 });
      const result = await isUrl4xxOrFailed('https://example.com/error', log);
      expect(result).to.be.false;
    });

    it('returns true when fetch throws (e.g. timeout)', async () => {
      fetchStub.rejects(new Error('network error'));
      const result = await isUrl4xxOrFailed('https://example.com/timeout', log);
      expect(result).to.be.true;
    });
  });

  describe('buildCWVAuditResult', () => {
    it('excludes URL entries that return 4xx from audit result', async () => {
      const cwvDataFromRum = [
        { type: 'url', url: 'https://www.lexmark.com/ok', pageviews: 10000, organic: 5000, metrics: [] },
        { type: 'url', url: 'https://www.lexmark.com/etc.clientlibs/bad', pageviews: 8000, organic: 4000, metrics: [] },
      ];
      const mockRumClient = { query: sandbox.stub().resolves(cwvDataFromRum) };
      const mockRumClientClass = { createFrom: sandbox.stub().returns(mockRumClient) };

      fetchStub
        .onFirstCall().resolves({ status: 200 })
        .onSecondCall().resolves({ status: 404 });

      const { buildCWVAuditResult: build } = await esmock('../../../src/cwv/cwv-audit-result.js', {
        '@adobe/spacecat-shared-rum-api-client': { default: mockRumClientClass },
      });

      const site = {
        getId: () => 'site-1',
        getBaseURL: () => 'https://www.lexmark.com',
        getConfig: () => ({ getGroupedURLs: () => [] }),
      };
      const context = { site, finalUrl: 'www.lexmark.com', log, env: {} };

      const result = await build(context);

      const cwvUrls = result.auditResult.cwv.filter((e) => e.type === 'url').map((e) => e.url);
      expect(cwvUrls).to.include('https://www.lexmark.com/ok');
      expect(cwvUrls).to.not.include('https://www.lexmark.com/etc.clientlibs/bad');
      expect(result.auditResult.cwv).to.have.length(1);
    });

    it('keeps group entries without HEAD check', async () => {
      const cwvDataFromRum = [
        { type: 'url', url: 'https://www.example.com/', pageviews: 10000, organic: 5000, metrics: [] },
        { type: 'group', pattern: '/some/*', name: 'Some pages', pageviews: 5000, organic: 3000, metrics: [] },
      ];
      const mockRumClient = { query: sandbox.stub().resolves(cwvDataFromRum) };
      const mockRumClientClass = { createFrom: sandbox.stub().returns(mockRumClient) };

      fetchStub.resolves({ status: 200 });

      const { buildCWVAuditResult: build } = await esmock('../../../src/cwv/cwv-audit-result.js', {
        '@adobe/spacecat-shared-rum-api-client': { default: mockRumClientClass },
      });

      const site = {
        getId: () => 'site-1',
        getBaseURL: () => 'https://www.example.com',
        getConfig: () => ({ getGroupedURLs: () => [] }),
      };
      const context = { site, finalUrl: 'www.example.com', log, env: {} };

      const result = await build(context);

      expect(result.auditResult.cwv).to.have.length(2);
      expect(result.auditResult.cwv.find((e) => e.type === 'group')).to.exist;
      expect(fetchStub.callCount).to.equal(1);
    });
  });
});
