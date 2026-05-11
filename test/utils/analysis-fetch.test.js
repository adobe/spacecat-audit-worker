/*
 * Copyright 2026 Adobe. All rights reserved.
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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';

import { scrubUrlForLog } from '../../src/utils/analysis-fetch.js';

use(sinonChai);
use(chaiAsPromised);

describe('analysis-fetch helper', () => {
  let sandbox;
  let log;
  let fetchStub;
  let fetchAnalysisFromPresignedUrl;

  const validUrl = 'https://bucket.s3.amazonaws.com/path/analysis.json?X-Amz-Signature=secretsigvalue';

  const headers = (map = {}) => ({
    get: (k) => map[k.toLowerCase()] ?? null,
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() };
    fetchStub = sandbox.stub();
    ({ fetchAnalysisFromPresignedUrl } = await esmock('../../src/utils/analysis-fetch.js', {
      '@adobe/spacecat-shared-utils': { tracingFetch: fetchStub },
    }));
  });

  afterEach(() => sandbox.restore());

  describe('scrubUrlForLog', () => {
    it('strips query string and fragment so signed-URL credentials are not logged', () => {
      const scrubbed = scrubUrlForLog('https://b.s3.amazonaws.com/k?X-Amz-Signature=abc#frag');
      expect(scrubbed).to.equal('https://b.s3.amazonaws.com/k');
    });

    it('returns <invalid-url> for unparseable input', () => {
      expect(scrubUrlForLog('not a url')).to.equal('<invalid-url>');
    });
  });

  describe('fetchAnalysisFromPresignedUrl', () => {
    it('rejects non-https URLs before any fetch call (SSRF guard)', async () => {
      await expect(
        fetchAnalysisFromPresignedUrl('http://bucket.s3.amazonaws.com/x.json', { log, prefix: '[T]' }),
      ).to.be.rejectedWith(/must use https/);
      expect(fetchStub).to.not.have.been.called;
    });

    it('rejects non-S3 hostnames before any fetch call (SSRF guard)', async () => {
      await expect(
        fetchAnalysisFromPresignedUrl('https://internal.example/x.json', { log, prefix: '[T]' }),
      ).to.be.rejectedWith(/hostname is not an allowlisted S3 hostname/);
      expect(fetchStub).to.not.have.been.called;
    });

    it('logs the URL with query string scrubbed (signature credentials not leaked)', async () => {
      fetchStub.resolves({
        ok: true,
        headers: headers({ 'content-type': 'application/json' }),
        text: async () => '{"a":1}',
      });
      await fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]' });
      const logged = log.info.firstCall.args[0];
      expect(logged).to.match(/Fetching analysis from presigned URL/);
      expect(logged).to.not.match(/X-Amz-Signature/);
    });

    it('parses JSON body and returns the object', async () => {
      fetchStub.resolves({
        ok: true,
        headers: headers({ 'content-type': 'application/json' }),
        text: async () => '{"foo":"bar"}',
      });
      const result = await fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]' });
      expect(result).to.deep.equal({ foo: 'bar' });
    });

    it('throws when response.ok is false', async () => {
      fetchStub.resolves({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: headers(),
        text: async () => '',
      });
      await expect(
        fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]' }),
      ).to.be.rejectedWith(/analysis fetch failed: 404 Not Found/);
    });

    it('rejects body that exceeds maxBytes (DoS guard, pre-check via Content-Length)', async () => {
      fetchStub.resolves({
        ok: true,
        headers: headers({ 'content-type': 'application/json', 'content-length': '20000000' }),
        text: async () => '{}',
      });
      await expect(
        fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]', maxBytes: 1_000_000 }),
      ).to.be.rejectedWith(/analysis response too large.*declared 20000000/);
    });

    it('rejects body that exceeds maxBytes (DoS guard, post-buffer fallback)', async () => {
      const oversized = 'x'.repeat(2_000_000);
      fetchStub.resolves({
        ok: true,
        headers: headers({ 'content-type': 'application/json' }), // no content-length
        text: async () => oversized,
      });
      await expect(
        fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]', maxBytes: 1_000_000 }),
      ).to.be.rejectedWith(/analysis response too large.*2000000 bytes/);
    });

    it('rejects bodies with obviously-wrong content-type (e.g. text/html)', async () => {
      fetchStub.resolves({
        ok: true,
        headers: headers({ 'content-type': 'text/html' }),
        text: async () => '<html>',
      });
      await expect(
        fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]' }),
      ).to.be.rejectedWith(/unexpected content-type/);
    });

    it('rejects bodies that are not JSON', async () => {
      fetchStub.resolves({
        ok: true,
        headers: headers({ 'content-type': 'application/json' }),
        text: async () => 'this is not json',
      });
      await expect(
        fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]' }),
      ).to.be.rejectedWith(/analysis response is not JSON/);
    });

    it('accepts S3 path-style hostnames (s3.region.amazonaws.com)', async () => {
      fetchStub.resolves({
        ok: true,
        headers: headers({ 'content-type': 'application/json' }),
        text: async () => '{"ok":true}',
      });
      const url = 'https://s3.us-east-1.amazonaws.com/bucket/key.json';
      await expect(
        fetchAnalysisFromPresignedUrl(url, { log, prefix: '[T]' }),
      ).to.eventually.deep.equal({ ok: true });
    });

    it('rejects malformed URLs', async () => {
      await expect(
        fetchAnalysisFromPresignedUrl('https://[bad', { log, prefix: '[T]' }),
      ).to.be.rejectedWith(/is not a valid URL/);
    });

    it('tolerates a response with no headers object (defaults to empty content-type)', async () => {
      // Defensive: some non-spec-compliant fetch wrappers return a Response without
      // a `headers` getter. The `?.` chain must fall through to an empty string.
      fetchStub.resolves({
        ok: true,
        // no headers property
        text: async () => '{"a":1}',
      });
      const result = await fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]' });
      expect(result).to.deep.equal({ a: 1 });
    });

    it('translates AbortError (timeout) into a friendly timeout message', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      fetchStub.rejects(abortErr);
      await expect(
        fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]', timeoutMs: 100 }),
      ).to.be.rejectedWith(/analysis fetch timed out after 100ms/);
    });

    it('re-throws non-Abort fetch errors as-is', async () => {
      fetchStub.rejects(new Error('connection refused'));
      await expect(
        fetchAnalysisFromPresignedUrl(validUrl, { log, prefix: '[T]' }),
      ).to.be.rejectedWith(/connection refused/);
    });
  });
});
