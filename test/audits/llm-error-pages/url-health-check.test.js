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

describe('LLM Error Pages – url-health-check', () => {
  const sandbox = sinon.createSandbox();
  let fetchStub;
  let isUrlSafeToFetchStub;
  let filterOutConfirmedBrokenUrls;
  let log;

  beforeEach(async () => {
    fetchStub = sandbox.stub();
    // Default: every URL is safe. Specific tests override this stub.
    isUrlSafeToFetchStub = sandbox.stub().resolves(true);
    log = {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    ({ filterOutConfirmedBrokenUrls } = await esmock(
      '../../../src/llm-error-pages/url-health-check.js',
      {
        '@adobe/spacecat-shared-utils': { tracingFetch: fetchStub },
        '../../../src/support/url-safety.js': { isUrlSafeToFetch: isUrlSafeToFetchStub },
      },
    ));
  });

  afterEach(() => sandbox.restore());

  it('returns [] for a non-array input (defensive)', async () => {
    const result = await filterOutConfirmedBrokenUrls(null, log);
    expect(result).to.deep.equal([]);
    expect(fetchStub).to.not.have.been.called;
  });

  it('returns [] for an empty array (no fetches issued)', async () => {
    const result = await filterOutConfirmedBrokenUrls([], log);
    expect(result).to.deep.equal([]);
    expect(fetchStub).to.not.have.been.called;
  });

  it('keeps URLs that respond with 2xx', async () => {
    fetchStub.resolves({ status: 200 });
    const result = await filterOutConfirmedBrokenUrls(
      ['https://a.example/x', 'https://a.example/y'],
      log,
    );
    expect(result).to.deep.equal(['https://a.example/x', 'https://a.example/y']);
    expect(fetchStub).to.have.been.calledTwice;
    // Sends HEAD, manual redirect, sets the Adobe UA.
    const opts = fetchStub.firstCall.args[1];
    expect(opts.method).to.equal('HEAD');
    expect(opts.redirect).to.equal('manual');
    expect(opts.headers['User-Agent']).to.match(/^AdobeSpacecat-LLMErrorPages\/1\.0/);
  });

  it('keeps URLs that respond with 3xx (manual redirect mode, status < 400)', async () => {
    // 3xx is still < 400 so the existing branch keeps it; the redirect is NOT
    // followed, so the SSRF guard already applied to the original URL cannot
    // be bypassed by an attacker-controlled redirect target.
    fetchStub.resolves({ status: 301 });
    const result = await filterOutConfirmedBrokenUrls(['https://a.example/x'], log);
    expect(result).to.deep.equal(['https://a.example/x']);
  });

  it('drops URLs that respond 4xx', async () => {
    fetchStub.resolves({ status: 404 });
    const result = await filterOutConfirmedBrokenUrls(['https://a.example/missing'], log);
    expect(result).to.deep.equal([]);
  });

  it('drops URLs that respond 5xx', async () => {
    fetchStub.resolves({ status: 503 });
    const result = await filterOutConfirmedBrokenUrls(['https://a.example/down'], log);
    expect(result).to.deep.equal([]);
  });

  it('keeps URLs whose HEAD returns 405 (Method Not Allowed) — inconclusive', async () => {
    fetchStub.resolves({ status: 405 });
    const result = await filterOutConfirmedBrokenUrls(['https://a.example/no-head'], log);
    expect(result).to.deep.equal(['https://a.example/no-head']);
    expect(log.debug).to.have.been.calledWithMatch(/HEAD 405/);
  });

  it('keeps URLs when fetch throws (network error / timeout) — inconclusive', async () => {
    fetchStub.rejects(new Error('network unreachable'));
    const result = await filterOutConfirmedBrokenUrls(['https://offline.example/x'], log);
    expect(result).to.deep.equal(['https://offline.example/x']);
    expect(log.debug).to.have.been.calledWithMatch(/inconclusive/);
  });

  it('keeps URL when HEAD times out (AbortError)', async () => {
    fetchStub.rejects(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const result = await filterOutConfirmedBrokenUrls(['https://slow.example/x'], log);
    expect(result).to.deep.equal(['https://slow.example/x']);
  });

  it('preserves input order and filters mixed results', async () => {
    fetchStub.onCall(0).resolves({ status: 200 }); // keep
    fetchStub.onCall(1).resolves({ status: 404 }); // drop
    fetchStub.onCall(2).resolves({ status: 200 }); // keep
    fetchStub.onCall(3).resolves({ status: 500 }); // drop

    // Distinct hosts so each gets its own per-host slot — the dispatch order
    // is then deterministic and the .onCall assertions line up with input order.
    const urls = [
      'https://h1.example/1',
      'https://h2.example/2',
      'https://h3.example/3',
      'https://h4.example/4',
    ];
    const result = await filterOutConfirmedBrokenUrls(urls, log);
    expect(result).to.deep.equal(['https://h1.example/1', 'https://h3.example/3']);
  });

  it('processes more than one global concurrency batch (>10 URLs)', async () => {
    fetchStub.resolves({ status: 200 });
    // Use distinct hosts so per-host cap doesn't serialize them all.
    const urls = Array.from({ length: 25 }, (_, i) => `https://h${i}.example/x`);
    const result = await filterOutConfirmedBrokenUrls(urls, log);
    expect(result).to.have.length(25);
    expect(fetchStub).to.have.callCount(25);
  });

  it('respects the per-host cap when many URLs share a host', async () => {
    fetchStub.resolves({ status: 200 });
    const urls = Array.from({ length: 12 }, (_, i) => `https://same.example/${i}`);
    const result = await filterOutConfirmedBrokenUrls(urls, log);
    expect(result).to.have.length(12);
    expect(fetchStub).to.have.callCount(12);
  });

  it('does not crash when log.debug is missing on the 405 path (optional chaining branch)', async () => {
    fetchStub.resolves({ status: 405 });
    const minimalLog = {}; // no .debug
    const result = await filterOutConfirmedBrokenUrls(['https://a.example/x'], minimalLog);
    expect(result).to.deep.equal(['https://a.example/x']);
  });

  it('does not crash when log.debug is missing on the error/timeout path (optional chaining branch)', async () => {
    fetchStub.rejects(new Error('boom'));
    const minimalLog = {}; // no .debug
    const result = await filterOutConfirmedBrokenUrls(['https://a.example/x'], minimalLog);
    expect(result).to.deep.equal(['https://a.example/x']);
  });

  it('drops URLs rejected by the SSRF guard without fetching them', async () => {
    fetchStub.resolves({ status: 200 });
    isUrlSafeToFetchStub.callsFake(async (url) => !url.includes('blocked'));
    const result = await filterOutConfirmedBrokenUrls(
      ['https://ok.example/x', 'https://blocked.internal/x'],
      log,
    );
    expect(result).to.deep.equal(['https://ok.example/x']);
    // Only the safe URL is HEAD-probed.
    expect(fetchStub).to.have.been.calledOnce;
    expect(fetchStub.firstCall.args[0]).to.equal('https://ok.example/x');
  });

  it('falls back gracefully when a URL is unparseable in safeOrigin (synthetic host key)', async () => {
    fetchStub.resolves({ status: 200 });
    // 'not a url' has no scheme — URL() throws and the scheduler uses a
    // synthetic per-index host key so dispatch still completes.
    const result = await filterOutConfirmedBrokenUrls(['not a url'], log);
    // isUrlSafeToFetch is stubbed to true here; the bad-URL case is exercised
    // for the safeOrigin null branch in the scheduler.
    expect(result).to.deep.equal(['not a url']);
  });
});
