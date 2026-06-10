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

import { filterReachableUrls } from '../../../src/llm-error-pages/url-health-check.js';

use(sinonChai);

describe('LLM Error Pages – url-health-check', () => {
  const sandbox = sinon.createSandbox();
  let fetchStub;
  let log;

  beforeEach(() => {
    fetchStub = sandbox.stub(global, 'fetch');
    log = {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
  });

  afterEach(() => sandbox.restore());

  it('returns [] for a non-array input (defensive)', async () => {
    const result = await filterReachableUrls(null, log);
    expect(result).to.deep.equal([]);
    expect(fetchStub).to.not.have.been.called;
  });

  it('returns [] for an empty array (no fetches issued)', async () => {
    const result = await filterReachableUrls([], log);
    expect(result).to.deep.equal([]);
    expect(fetchStub).to.not.have.been.called;
  });

  it('keeps URLs that respond with 2xx', async () => {
    fetchStub.resolves({ status: 200 });
    const result = await filterReachableUrls(['https://a.example/x', 'https://a.example/y'], log);
    expect(result).to.deep.equal(['https://a.example/x', 'https://a.example/y']);
    expect(fetchStub).to.have.been.calledTwice;
    // Sends HEAD, follows redirects, sets a UA.
    const opts = fetchStub.firstCall.args[1];
    expect(opts.method).to.equal('HEAD');
    expect(opts.redirect).to.equal('follow');
    expect(opts.headers['User-Agent']).to.be.a('string').and.to.have.length.above(0);
  });

  it('keeps URLs that respond with 3xx (under 400 after redirect handling)', async () => {
    fetchStub.resolves({ status: 301 });
    const result = await filterReachableUrls(['https://a.example/x'], log);
    expect(result).to.deep.equal(['https://a.example/x']);
  });

  it('drops URLs that respond 4xx', async () => {
    fetchStub.resolves({ status: 404 });
    const result = await filterReachableUrls(['https://a.example/missing'], log);
    expect(result).to.deep.equal([]);
  });

  it('drops URLs that respond 5xx', async () => {
    fetchStub.resolves({ status: 503 });
    const result = await filterReachableUrls(['https://a.example/down'], log);
    expect(result).to.deep.equal([]);
  });

  it('keeps URLs whose HEAD returns 405 (Method Not Allowed) — inconclusive', async () => {
    fetchStub.resolves({ status: 405 });
    const result = await filterReachableUrls(['https://a.example/no-head'], log);
    expect(result).to.deep.equal(['https://a.example/no-head']);
    expect(log.debug).to.have.been.calledWithMatch(/HEAD 405/);
  });

  it('keeps URLs when fetch throws (network error / timeout) — inconclusive', async () => {
    fetchStub.rejects(new Error('network unreachable'));
    const result = await filterReachableUrls(['https://offline.example/x'], log);
    expect(result).to.deep.equal(['https://offline.example/x']);
    expect(log.debug).to.have.been.calledWithMatch(/inconclusive/);
  });

  it('preserves input order and filters mixed results', async () => {
    fetchStub.onCall(0).resolves({ status: 200 }); // keep
    fetchStub.onCall(1).resolves({ status: 404 }); // drop
    fetchStub.onCall(2).resolves({ status: 200 }); // keep
    fetchStub.onCall(3).resolves({ status: 500 }); // drop

    const urls = ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4'];
    const result = await filterReachableUrls(urls, log);
    expect(result).to.deep.equal(['https://a/1', 'https://a/3']);
  });

  it('processes more than one concurrency batch (>10 URLs)', async () => {
    fetchStub.resolves({ status: 200 });
    const urls = Array.from({ length: 25 }, (_, i) => `https://a.example/${i}`);
    const result = await filterReachableUrls(urls, log);
    expect(result).to.have.length(25);
    expect(fetchStub).to.have.callCount(25);
  });

  it('does not crash when log.debug is missing on the 405 path (optional chaining branch)', async () => {
    fetchStub.resolves({ status: 405 });
    const minimalLog = {}; // no .debug
    const result = await filterReachableUrls(['https://a.example/x'], minimalLog);
    expect(result).to.deep.equal(['https://a.example/x']);
  });

  it('does not crash when log.debug is missing on the error/timeout path (optional chaining branch)', async () => {
    fetchStub.rejects(new Error('boom'));
    const minimalLog = {}; // no .debug
    const result = await filterReachableUrls(['https://a.example/x'], minimalLog);
    expect(result).to.deep.equal(['https://a.example/x']);
  });
});
