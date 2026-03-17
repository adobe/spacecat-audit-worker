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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { SPACECAT_USER_AGENT } from '@adobe/spacecat-shared-utils';
import {
  detectCdnFromHeaders,
  detectCdnFromUrl,
} from '../../src/detect-cdn/cdn-detector.js';

use(sinonChai);

describe('cdn-detector', () => {
  describe('detectCdnFromHeaders', () => {
    it('returns "unknown" when headers is null', () => {
      expect(detectCdnFromHeaders(null)).to.equal('unknown');
    });

    it('returns "unknown" when headers is not an object', () => {
      expect(detectCdnFromHeaders('string')).to.equal('unknown');
      expect(detectCdnFromHeaders(123)).to.equal('unknown');
    });

    it('returns "Cloudflare" for cf-ray header', () => {
      expect(detectCdnFromHeaders({ 'cf-ray': 'abc123' })).to.equal('Cloudflare');
    });

    it('returns "Cloudflare" for cf-cache-status header', () => {
      expect(detectCdnFromHeaders({ 'cf-cache-status': 'HIT' })).to.equal('Cloudflare');
    });

    it('returns "Cloudflare" for server containing cloudflare', () => {
      expect(detectCdnFromHeaders({ server: 'cloudflare' })).to.equal('Cloudflare');
    });

    it('returns "Akamai" for x-akamai-* header', () => {
      expect(detectCdnFromHeaders({ 'x-akamai-transformed': '1' })).to.equal('Akamai');
    });

    it('returns "Fastly" for x-fastly-request-id', () => {
      expect(detectCdnFromHeaders({ 'x-fastly-request-id': 'abc' })).to.equal('Fastly');
    });

    it('returns "Fastly" for x-served-by', () => {
      expect(detectCdnFromHeaders({ 'x-served-by': 'cache' })).to.equal('Fastly');
    });

    it('returns "CloudFront" for x-amz-cf-id', () => {
      expect(detectCdnFromHeaders({ 'x-amz-cf-id': 'abc' })).to.equal('CloudFront');
    });

    it('returns "Azure Front Door / Azure CDN" for x-azure-ref', () => {
      expect(detectCdnFromHeaders({ 'x-azure-ref': 'ref' })).to.equal('Azure Front Door / Azure CDN');
    });

    it('returns "Google Cloud CDN" for x-goog-* header', () => {
      expect(detectCdnFromHeaders({ 'x-goog-metadata': '1' })).to.equal('Google Cloud CDN');
    });

    it('returns "Vercel" for x-vercel-id', () => {
      expect(detectCdnFromHeaders({ 'x-vercel-id': 'id' })).to.equal('Vercel');
    });

    it('returns "Netlify" for x-nf-request-id', () => {
      expect(detectCdnFromHeaders({ 'x-nf-request-id': 'id' })).to.equal('Netlify');
    });

    it('returns "Netlify" for server containing netlify', () => {
      expect(detectCdnFromHeaders({ server: 'Netlify' })).to.equal('Netlify');
    });

    it('returns "KeyCDN" for x-edge-location', () => {
      expect(detectCdnFromHeaders({ 'x-edge-location': 'us' })).to.equal('KeyCDN');
    });

    it('returns "KeyCDN" for server containing keycdn', () => {
      expect(detectCdnFromHeaders({ server: 'keycdn' })).to.equal('KeyCDN');
    });

    it('returns "Limelight" for x-llid', () => {
      expect(detectCdnFromHeaders({ 'x-llid': 'id' })).to.equal('Limelight');
    });

    it('returns "Limelight" for x-llrid', () => {
      expect(detectCdnFromHeaders({ 'x-llrid': 'id' })).to.equal('Limelight');
    });

    it('returns "CDNetworks" for x-cdn-request-id', () => {
      expect(detectCdnFromHeaders({ 'x-cdn-request-id': 'id' })).to.equal('CDNetworks');
    });

    it('returns "Bunny CDN" for x-bunny-* header', () => {
      expect(detectCdnFromHeaders({ 'x-bunny-cache': 'HIT' })).to.equal('Bunny CDN');
    });

    it('returns "StackPath" for server containing netdna', () => {
      expect(detectCdnFromHeaders({ server: 'NetDNA' })).to.equal('StackPath');
    });

    it('returns "Sucuri" for x-sucuri-id', () => {
      expect(detectCdnFromHeaders({ 'x-sucuri-id': 'id' })).to.equal('Sucuri');
    });

    it('returns "Imperva" for x-iinfo', () => {
      expect(detectCdnFromHeaders({ 'x-iinfo': 'v' })).to.equal('Imperva');
    });

    it('returns "Imperva" for x-cdn containing incapsula', () => {
      expect(detectCdnFromHeaders({ 'x-cdn': 'incapsula' })).to.equal('Imperva');
    });

    it('returns "Vercel" for server containing vercel', () => {
      expect(detectCdnFromHeaders({ server: 'vercel' })).to.equal('Vercel');
    });

    it('returns "Azure CDN" for x-ec-debug', () => {
      expect(detectCdnFromHeaders({ 'x-ec-debug': '1' })).to.equal('Azure CDN');
    });

    it('returns "Azure Front Door" for x-fd-healthprobe', () => {
      expect(detectCdnFromHeaders({ 'x-fd-healthprobe': '1' })).to.equal('Azure Front Door');
    });

    it('returns "Akamai" for akamai-origin-hop', () => {
      expect(detectCdnFromHeaders({ 'akamai-origin-hop': '1' })).to.equal('Akamai');
    });

    it('returns "Fastly" for fastly-ff', () => {
      expect(detectCdnFromHeaders({ 'fastly-ff': 'x' })).to.equal('Fastly');
    });

    it('returns "Fastly" for via containing fastly', () => {
      expect(detectCdnFromHeaders({ via: '1.1 fastly' })).to.equal('Fastly');
    });

    it('returns "CloudFront" for x-amz-cf-pop', () => {
      expect(detectCdnFromHeaders({ 'x-amz-cf-pop': 'LAX1' })).to.equal('CloudFront');
    });

    it('returns "CloudFront" for via containing cloudfront', () => {
      expect(detectCdnFromHeaders({ via: 'CloudFront' })).to.equal('CloudFront');
    });

    it('returns "Google Cloud CDN" for via containing google', () => {
      expect(detectCdnFromHeaders({ via: 'Google' })).to.equal('Google Cloud CDN');
    });

    it('treats non-string header value as empty (get returns "")', () => {
      expect(detectCdnFromHeaders({ 'cf-ray': 123 })).to.equal('unknown');
      expect(detectCdnFromHeaders({ 'content-type': undefined })).to.equal('unknown');
    });

    it('returns "unknown" when no CDN headers match', () => {
      expect(detectCdnFromHeaders({ 'content-type': 'text/html' })).to.equal('unknown');
      expect(detectCdnFromHeaders({})).to.equal('unknown');
    });

    it('uses lowercase header keys (implementation uses lowercase)', () => {
      expect(detectCdnFromHeaders({ 'CF-RAY': 'x' })).to.equal('unknown');
      expect(detectCdnFromHeaders({ 'cf-ray': 'x' })).to.equal('Cloudflare');
    });
  });

  describe('detectCdnFromUrl', () => {
    it('returns CDN from response headers when fetch succeeds', async () => {
      const headers = new Map([
        ['cf-ray', 'abc123'],
        ['server', 'cloudflare'],
      ]);
      const fetchFn = sinon.stub().resolves({
        headers: {
          forEach(cb) {
            headers.forEach((value, key) => cb(value, key));
          },
        },
      });
      const result = await detectCdnFromUrl('https://example.com', fetchFn);
      expect(result).to.deep.equal({ cdn: 'Cloudflare' });
      expect(fetchFn).to.have.been.calledOnce;
      expect(fetchFn.firstCall.args[0]).to.equal('https://example.com');
      expect(fetchFn.firstCall.args[1].method).to.equal('HEAD');
      expect(fetchFn.firstCall.args[1].redirect).to.equal('follow');
      expect(fetchFn.firstCall.args[1].headers['User-Agent']).to.equal(SPACECAT_USER_AGENT);
    });

    it('returns error when both HEAD and GET throw', async () => {
      const fetchFn = sinon.stub().rejects(new Error('network error'));
      const result = await detectCdnFromUrl('https://example.com', fetchFn);
      expect(result.cdn).to.equal('unknown');
      expect(result.error).to.equal('network error');
      expect(fetchFn).to.have.been.calledTwice;
      expect(fetchFn.firstCall.args[1].method).to.equal('HEAD');
      expect(fetchFn.secondCall.args[1].method).to.equal('GET');
    });

    it('when HEAD fails, retries with GET and returns CDN from GET response', async () => {
      const headers = new Map([['x-fastly-request-id', 'abc']]);
      const getResponse = {
        headers: { forEach(cb) { headers.forEach((v, k) => cb(v, k)); } },
        body: { cancel: sinon.stub() },
      };
      const fetchFn = sinon.stub()
        .onFirstCall()
        .rejects(new Error('unexpected end of file'))
        .onSecondCall()
        .resolves(getResponse);
      const result = await detectCdnFromUrl('https://t-mobile.com', fetchFn);
      expect(result).to.deep.equal({ cdn: 'Fastly' });
      expect(fetchFn).to.have.been.calledTwice;
      expect(fetchFn.firstCall.args[1].method).to.equal('HEAD');
      expect(fetchFn.secondCall.args[1].method).to.equal('GET');
      expect(getResponse.body.cancel).to.have.been.calledOnce;
    });

    it('when HEAD fails and GET succeeds, calls log.warn with message (branch coverage)', async () => {
      const log = { warn: sinon.stub() };
      const headers = new Map([['cf-ray', 'x']]);
      const getResponse = {
        headers: { forEach(cb) { headers.forEach((v, k) => cb(v, k)); } },
        body: { cancel: sinon.stub() },
      };
      const fetchFn = sinon.stub()
        .onFirstCall()
        .rejects(new Error('unexpected end of file'))
        .onSecondCall()
        .resolves(getResponse);
      const result = await detectCdnFromUrl('https://example.com', fetchFn, { log });
      expect(result).to.deep.equal({ cdn: 'Cloudflare' });
      expect(log.warn).to.have.been.calledOnce;
      expect(log.warn.firstCall.args[0]).to.include('HEAD request failed');
      expect(log.warn.firstCall.args[1]).to.equal('unexpected end of file');
      expect(log.warn.firstCall.args[2]).to.equal('https://example.com');
    });

    it('returns error message as string when both HEAD and GET throw with no .message', async () => {
      const fetchFn = sinon.stub().rejects('plain string error');
      const result = await detectCdnFromUrl('https://example.com', fetchFn);
      expect(result.cdn).to.equal('unknown');
      expect(result.error).to.equal('plain string error');
      expect(fetchFn).to.have.been.calledTwice;
    });

    it('uses custom timeout and userAgent when provided in options', async () => {
      const headers = new Map([['cf-ray', 'x']]);
      const fetchFn = sinon.stub().resolves({
        headers: { forEach(cb) { headers.forEach((v, k) => cb(v, k)); } },
      });
      await detectCdnFromUrl('https://example.com', fetchFn, {
        timeout: 5000,
        userAgent: 'CustomBot/1.0',
      });
      expect(fetchFn.firstCall.args[1].headers['User-Agent']).to.equal('CustomBot/1.0');
    });

    it('normalizes response headers to lowercase for detection', async () => {
      const headers = new Map([
        ['X-Fastly-Request-Id', 'abc'],
      ]);
      const fetchFn = sinon.stub().resolves({
        headers: {
          forEach(cb) {
            headers.forEach((value, key) => cb(value, key));
          },
        },
      });
      const result = await detectCdnFromUrl('https://example.com', fetchFn);
      expect(result).to.deep.equal({ cdn: 'Fastly' });
    });
  });
});
