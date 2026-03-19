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
import esmock from 'esmock';
import { SPACECAT_USER_AGENT } from '@adobe/spacecat-shared-utils';
import {
  detectCdnFromHeaders,
  detectCdnFromUrl,
  matchCdnByCname,
  matchCdnByAsn,
  getCnameChain,
  getCnameChainDoh,
  getOneIpDoh,
  getAsnForIp,
  detectCdnFromDnsFallback,
  matchCdnByKeywords,
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

    it('returns "CloudFront" for x-cache containing cloudfront (whichCDN-style)', () => {
      expect(detectCdnFromHeaders({ 'x-cache': 'Hit from cloudfront' })).to.equal('CloudFront');
    });

    it('returns "Fastly" when fastly-debug-digest is present', () => {
      expect(detectCdnFromHeaders({ 'fastly-debug-digest': 'abc' })).to.equal('Fastly');
    });

    it('returns CDN from x-cdn-forward keyword match', () => {
      expect(detectCdnFromHeaders({ 'x-cdn-forward': 'something fastly edge' })).to.equal('Fastly');
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
      const bodyCancel = sinon.stub();
      const fetchFn = sinon.stub().resolves({
        headers: {
          forEach(cb) {
            headers.forEach((value, key) => cb(value, key));
          },
        },
        body: { cancel: bodyCancel },
      });
      const result = await detectCdnFromUrl('https://example.com', fetchFn);
      expect(result).to.deep.equal({ cdn: 'Cloudflare' });
      expect(bodyCancel).to.have.been.calledOnce;
      expect(fetchFn).to.have.been.calledOnce;
      expect(fetchFn.firstCall.args[0]).to.equal('https://example.com');
      expect(fetchFn.firstCall.args[1].method).to.equal('HEAD');
      expect(fetchFn.firstCall.args[1].redirect).to.equal('follow');
      expect(fetchFn.firstCall.args[1].headers['User-Agent']).to.equal(SPACECAT_USER_AGENT);
    });

    it('returns error when both HEAD and GET throw', async () => {
      let n = 0;
      const fetchFn = sinon.stub().callsFake(() => {
        n += 1;
        if (n <= 2) {
          return Promise.reject(new Error('network error'));
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ Answer: [] }) });
      });
      const result = await detectCdnFromUrl('https://example.com', fetchFn);
      expect(result.cdn).to.equal('unknown');
      expect(result.error).to.equal('network error');
      expect(fetchFn.firstCall.args[1].method).to.equal('HEAD');
      expect(fetchFn.secondCall.args[1].method).to.equal('GET');
      expect(fetchFn.callCount).to.be.at.least(2);
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
      let n = 0;
      const fetchFn = sinon.stub().callsFake(() => {
        n += 1;
        if (n <= 2) {
          // Non-Error rejection: code uses String(reason) when .message is missing
          // eslint-disable-next-line prefer-promise-reject-errors -- intentional for coverage
          return Promise.reject('plain string error');
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ Answer: [] }) });
      });
      const result = await detectCdnFromUrl('https://example.com', fetchFn);
      expect(result.cdn).to.equal('unknown');
      expect(result.error).to.equal('plain string error');
      expect(fetchFn.callCount).to.be.at.least(2);
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

    it('when both HEAD and GET fail but DNS fallback finds CDN, preserves fetch error on result', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub()
            .onFirstCall()
            .resolves(['e123.fastly.net'])
            .onSecondCall()
            .rejects(Object.assign(new Error('ENODATA'), { code: 'ENODATA' })),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      let n = 0;
      const fetchFn = sinon.stub().callsFake(() => {
        n += 1;
        if (n <= 2) {
          return Promise.reject(new Error('connection reset'));
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ Answer: [] }) });
      });
      const result = await detector.detectCdnFromUrl('https://example.com', fetchFn);
      expect(result.cdn).to.equal('Fastly');
      expect(result.error).to.equal('connection reset');
    });

    it('when headers return unknown, uses CNAME fallback and returns CDN when chain matches', async () => {
      const dnsResolve = sinon.stub();
      dnsResolve.onFirstCall().resolves(['e123.akamaiedge.net']);
      dnsResolve.onSecondCall().rejects(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }));
      const mockDns = {
        promises: {
          resolve: dnsResolve,
          resolve4: sinon.stub().resolves(['93.184.216.34']),
        },
      };
      const emptyHeaders = new Map([['content-type', 'text/html']]);
      const fetchFn = sinon.stub()
        .onFirstCall()
        .resolves({
          headers: { forEach(cb) { emptyHeaders.forEach((v, k) => cb(v, k)); } },
        })
        // Fallback may call fetch for ipinfo; omit if CNAME matches first
        .onSecondCall();
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const result = await detector.detectCdnFromUrl('https://example.com', fetchFn);
      expect(result.cdn).to.equal('Akamai');
      expect(dnsResolve).to.have.been.calledWith(sinon.match.string, 'CNAME');
    });
  });

  describe('matchCdnByCname', () => {
    it('returns null for empty or non-array chain', () => {
      expect(matchCdnByCname([])).to.equal(null);
      expect(matchCdnByCname(null)).to.equal(null);
      expect(matchCdnByCname(undefined)).to.equal(null);
    });

    it('returns Cloudflare when chain contains cloudflare.com', () => {
      expect(matchCdnByCname(['example.com', 'xyz.cloudflare.com'])).to.equal('Cloudflare');
      expect(matchCdnByCname(['something.cloudflare.com'])).to.equal('Cloudflare');
    });

    it('returns Fastly when chain contains fastly.net', () => {
      expect(matchCdnByCname(['www.example.com', 'abc123.fastly.net'])).to.equal('Fastly');
    });

    it('returns CloudFront when chain contains cloudfront.net', () => {
      expect(matchCdnByCname(['d123.cloudfront.net'])).to.equal('CloudFront');
    });

    it('returns Akamai when chain contains akamaiedge.net', () => {
      expect(matchCdnByCname(['example.com', 'e123.akamaiedge.net'])).to.equal('Akamai');
    });

    it('returns Azure when chain contains azureedge.net', () => {
      expect(matchCdnByCname(['mysite.azureedge.net'])).to.equal('Azure Front Door / Azure CDN');
    });

    it('returns Google Cloud CDN when chain contains googleusercontent.com', () => {
      expect(matchCdnByCname(['x.googleusercontent.com'])).to.equal('Google Cloud CDN');
    });

    it('returns Alibaba when chain contains alicdn.com', () => {
      expect(matchCdnByCname(['cdn.example.com.alicdn.com'])).to.equal('Alibaba Cloud CDN');
    });

    it('returns null when no CDN domain matches', () => {
      expect(matchCdnByCname(['example.com', 'origin.example.com'])).to.equal(null);
    });
  });

  describe('matchCdnByAsn', () => {
    it('returns null for non-number or NaN', () => {
      expect(matchCdnByAsn(null)).to.equal(null);
      expect(matchCdnByAsn(undefined)).to.equal(null);
      expect(matchCdnByAsn('13335')).to.equal(null);
      expect(matchCdnByAsn(Number.NaN)).to.equal(null);
    });

    it('returns Cloudflare for AS13335', () => {
      expect(matchCdnByAsn(13335)).to.equal('Cloudflare');
    });

    it('returns Fastly for AS54113', () => {
      expect(matchCdnByAsn(54113)).to.equal('Fastly');
    });

    it('returns CloudFront for AS16509', () => {
      expect(matchCdnByAsn(16509)).to.equal('CloudFront');
    });

    it('returns Akamai for known Akamai ASNs', () => {
      expect(matchCdnByAsn(20940)).to.equal('Akamai');
      expect(matchCdnByAsn(16625)).to.equal('Akamai');
      expect(matchCdnByAsn(21342)).to.equal('Akamai');
    });

    it('returns Azure for AS8075', () => {
      expect(matchCdnByAsn(8075)).to.equal('Azure Front Door / Azure CDN');
    });

    it('returns Google Cloud CDN for AS15169', () => {
      expect(matchCdnByAsn(15169)).to.equal('Google Cloud CDN');
    });

    it('returns Alibaba for known Alibaba ASNs', () => {
      expect(matchCdnByAsn(24429)).to.equal('Alibaba Cloud CDN');
      expect(matchCdnByAsn(37963)).to.equal('Alibaba Cloud CDN');
    });

    it('returns null for unknown ASN', () => {
      expect(matchCdnByAsn(99999)).to.equal(null);
    });
  });

  describe('matchCdnByKeywords', () => {
    it('returns null for empty or non-string', () => {
      expect(matchCdnByKeywords('')).to.equal(null);
      expect(matchCdnByKeywords('   ')).to.equal(null);
      expect(matchCdnByKeywords(null)).to.equal(null);
    });

    it('matches whichCDN-style keywords case-insensitively', () => {
      expect(matchCdnByKeywords('Hit from cloudfront')).to.equal('CloudFront');
      expect(matchCdnByKeywords('something.edgecast.net')).to.equal('EdgeCast');
      expect(matchCdnByKeywords('server123.msecnd.net')).to.equal('Azure Front Door / Azure CDN');
    });

    it('returns null when no keyword pattern matches', () => {
      expect(matchCdnByKeywords('plain-internal-hostname-no-cdn')).to.equal(null);
    });
  });

  describe('getCnameChain', () => {
    it('returns hostname only when CNAME resolve returns empty', async () => {
      const chain = await getCnameChain('example.com');
      expect(chain).to.be.an('array');
      expect(chain[0]).to.equal('example.com');
    });

    it('strips trailing dot from hostname', async () => {
      const chain = await getCnameChain('example.com.');
      expect(chain[0]).to.equal('example.com');
    });

    it('breaks when resolve returns empty array (branch coverage)', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().resolves([]),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const chain = await detector.getCnameChain('example.com');
      expect(chain).to.deep.equal(['example.com']);
    });

    it('logs and breaks on resolve error other than ENODATA/ENOTFOUND', async () => {
      const log = { warn: sinon.stub() };
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const chain = await detector.getCnameChain('example.com', log);
      expect(chain).to.deep.equal(['example.com']);
      expect(log.warn).to.have.been.calledOnce;
      expect(log.warn.firstCall.args[0]).to.equal('[detect-cdn] CNAME resolve error');
    });

    it('breaks on ENOTFOUND without logging', async () => {
      const log = { warn: sinon.stub() };
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects(Object.assign(new Error('not found'), { code: 'ENOTFOUND' })),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const chain = await detector.getCnameChain('example.com', log);
      expect(chain).to.deep.equal(['example.com']);
      expect(log.warn).to.not.have.been.called;
    });
  });

  describe('getCnameChainDoh', () => {
    it('follows CNAME hops from Google DoH JSON', async () => {
      const fetchFn = sinon.stub();
      fetchFn.onFirstCall().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [{ type: 5, data: 'e123.fastly.net.' }] }),
      });
      fetchFn.onSecondCall().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [] }),
      });
      const chain = await getCnameChainDoh('www.example.com', fetchFn);
      expect(chain).to.deep.equal(['www.example.com', 'e123.fastly.net']);
      expect(fetchFn.firstCall.args[0]).to.include('dns.google/resolve');
    });

    it('stops when DoH CNAME data is non-string (normalizeDohName empty branch)', async () => {
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [{ type: 5, data: 12345 }] }),
      });
      const chain = await getCnameChainDoh('www.example.com', fetchFn);
      expect(chain).to.deep.equal(['www.example.com']);
    });
  });

  describe('getOneIpDoh', () => {
    it('returns first IPv4 from DoH A record answers', async () => {
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [{ type: 1, data: '93.184.216.34' }] }),
      });
      const ip = await getOneIpDoh('example.com', fetchFn);
      expect(ip).to.equal('93.184.216.34');
    });

    it('returns null when DoH returns no A record', async () => {
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [] }),
      });
      const ip = await getOneIpDoh('example.com', fetchFn);
      expect(ip).to.equal(null);
    });

    it('returns null when DoH response is not ok', async () => {
      const fetchFn = sinon.stub().resolves({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });
      const ip = await getOneIpDoh('example.com', fetchFn);
      expect(ip).to.equal(null);
    });

    it('returns null when DoH JSON has no Answer array (dohQuery normalizes body)', async () => {
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: () => Promise.resolve({ Status: 0 }),
      });
      const ip = await getOneIpDoh('example.com', fetchFn);
      expect(ip).to.equal(null);
    });

    it('logs when DoH fetch throws and log is provided', async () => {
      const log = { warn: sinon.stub() };
      const fetchFn = sinon.stub().rejects(new Error('DoH down'));
      const ip = await getOneIpDoh('example.com', fetchFn, log);
      expect(ip).to.equal(null);
      expect(log.warn).to.have.been.calledWith('[detect-cdn] DoH query failed', sinon.match.object);
    });
  });

  describe('getOneIp', () => {
    it('returns IP string when resolve4 succeeds (mocked to avoid network)', async () => {
      const mockDns = {
        promises: {
          resolve4: sinon.stub().resolves(['93.184.216.34']),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const ip = await detector.getOneIp('example.com');
      expect(ip).to.equal('93.184.216.34');
      expect(mockDns.promises.resolve4).to.have.been.calledOnceWith('example.com');
    });

    it('returns null when resolve4 fails', async () => {
      const mockDns = {
        promises: {
          resolve4: sinon.stub().rejects(new Error('ENOTFOUND')),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const ip = await detector.getOneIp('nonexistent.invalid');
      expect(ip).to.equal(null);
    });

    it('returns null when resolve4 fails and no log passed (branch coverage)', async () => {
      const mockDns = {
        promises: {
          resolve4: sinon.stub().rejects(new Error('ENOTFOUND')),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const ip = await detector.getOneIp('nonexistent.invalid', undefined);
      expect(ip).to.equal(null);
    });

    it('returns null when resolve4 returns empty array', async () => {
      const mockDns = {
        promises: {
          resolve4: sinon.stub().resolves([]),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const ip = await detector.getOneIp('example.com');
      expect(ip).to.equal(null);
    });

    it('returns null when resolve4 resolves to a falsy value', async () => {
      const mockDns = {
        promises: {
          resolve4: sinon.stub().resolves(undefined),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const ip = await detector.getOneIp('example.com');
      expect(ip).to.equal(null);
    });

    it('logs resolve4 error without err.code when log is provided', async () => {
      const log = { warn: sinon.stub() };
      const mockDns = {
        promises: {
          resolve4: sinon.stub().rejects(new Error('boom')),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const ip = await detector.getOneIp('example.com', log);
      expect(ip).to.equal(null);
      expect(log.warn).to.have.been.calledWith(
        '[detect-cdn] resolve4 error',
        { hostname: 'example.com', code: undefined },
      );
    });
  });

  describe('getAsnForIp', () => {
    it('returns ASN when ipinfo returns org with AS number', async () => {
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: sinon.stub().resolves({ org: 'AS54113 Fastly, Inc.' }),
      });
      const asn = await getAsnForIp('151.101.1.1', fetchFn);
      expect(asn).to.equal(54113);
    });

    it('returns null when ipinfo returns non-ok', async () => {
      const fetchFn = sinon.stub().resolves({ ok: false });
      const asn = await getAsnForIp('1.2.3.4', fetchFn);
      expect(asn).to.equal(null);
    });

    it('returns null when ipinfo org is missing', async () => {
      const fetchFn = sinon.stub().resolves({ ok: true, json: sinon.stub().resolves({}) });
      const asn = await getAsnForIp('1.2.3.4', fetchFn);
      expect(asn).to.equal(null);
    });

    it('returns null when org does not match AS number pattern', async () => {
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: sinon.stub().resolves({ org: 'Some Other Org' }),
      });
      const asn = await getAsnForIp('1.2.3.4', fetchFn);
      expect(asn).to.equal(null);
    });

    it('calls log.warn when fetch throws', async () => {
      const log = { warn: sinon.stub() };
      const fetchFn = sinon.stub().rejects(new Error('network error'));
      const asn = await getAsnForIp('1.2.3.4', fetchFn, { log });
      expect(asn).to.equal(null);
      expect(log.warn).to.have.been.calledWith('[detect-cdn] ASN lookup failed', sinon.match({ ip: '1.2.3.4' }));
    });
  });

  describe('detectCdnFromDnsFallback', () => {
    it('returns unknown for invalid URL', async () => {
      const result = await detectCdnFromDnsFallback('', sinon.stub());
      expect(result.cdn).to.equal('unknown');
    });

    it('returns unknown when hostname is empty (e.g. file:///)', async () => {
      const result = await detectCdnFromDnsFallback('file:///', sinon.stub());
      expect(result.cdn).to.equal('unknown');
    });

    it('accepts URL with scheme', async () => {
      const result = await detectCdnFromDnsFallback('https://example.com/path', sinon.stub());
      expect(result).to.have.property('cdn');
      expect(['unknown', 'Akamai', 'Cloudflare', 'Fastly', 'CloudFront']).to.include(result.cdn);
    });

    it('returns CDN from ASN when CNAME does not match', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().resolves([]),
          resolve4: sinon.stub().resolves(['151.101.1.1']),
          reverse: sinon.stub().resolves([]),
        },
      };
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: sinon.stub().resolves({ org: 'AS54113 Fastly, Inc.' }),
      });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn, { log });
      expect(result.cdn).to.equal('Fastly');
      expect(log.info).to.have.been.calledWith('[detect-cdn] Fallback: detected by ASN', { cdn: 'Fastly', asn: 54113 });
    });

    it('logs when detected by CNAME', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub()
            .onFirstCall()
            .resolves(['x.cloudflare.com'])
            .onSecondCall()
            .rejects({ code: 'ENODATA' }),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', sinon.stub(), { log });
      expect(result.cdn).to.equal('Cloudflare');
      expect(log.info).to.have.been.calledWith('[detect-cdn] Fallback: detected by CNAME', { cdn: 'Cloudflare', hostname: 'example.com' });
    });

    it('uses DoH CNAME when system DNS fails (ETIMEOUT)', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })),
          resolve4: sinon.stub().rejects(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })),
        },
      };
      const fetchFn = sinon.stub();
      fetchFn.onFirstCall().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [{ type: 5, data: 'edge.example.fastly.net.' }] }),
      });
      fetchFn.onSecondCall().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [] }),
      });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub(), warn: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn, { log });
      expect(result.cdn).to.equal('Fastly');
      expect(log.info).to.have.been.calledWith('[detect-cdn] Fallback: detected by CNAME (DoH)', { cdn: 'Fastly', hostname: 'example.com' });
    });

    it('uses DoH A record and ASN when system DNS has no CNAME match', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects({ code: 'ENODATA' }),
          resolve4: sinon.stub().rejects({ code: 'ETIMEOUT' }),
          reverse: sinon.stub().resolves([]),
        },
      };
      const fetchFn = sinon.stub();
      let call = 0;
      fetchFn.callsFake(async () => {
        call += 1;
        if (call === 1) {
          return { ok: true, json: () => ({ Answer: [] }) };
        }
        if (call === 2) {
          return { ok: true, json: () => ({ Answer: [{ type: 1, data: '151.101.1.1' }] }) };
        }
        return {
          ok: true,
          json: () => ({ org: 'AS54113 Fastly, Inc.' }),
        };
      });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn, { log });
      expect(result.cdn).to.equal('Fastly');
      expect(log.info).to.have.been.calledWith('[detect-cdn] Fallback: detected by ASN', { cdn: 'Fastly', asn: 54113 });
    });

    it('uses PTR reverse DNS when ASN does not map to a known CDN', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects({ code: 'ENODATA' }),
          resolve4: sinon.stub().resolves(['23.0.0.1']),
          reverse: sinon.stub().resolves(['a23-123-456.deploy.static.akamaitechnologies.com']),
        },
      };
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: sinon.stub().resolves({ org: 'AS99999 Some Unknown Network' }),
      });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub(), warn: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn, { log });
      expect(result.cdn).to.equal('Akamai');
      expect(log.info).to.have.been.calledWith(
        '[detect-cdn] Fallback: detected by PTR keywords {"cdn":"Akamai","ip":"23.0.0.1","ptr":"a23-123-456.deploy.static.akamaitechnologies.com"}',
      );
    });

    it('detects by CNAME domain signature on PTR hostname (no keyword hit)', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects({ code: 'ENODATA' }),
          resolve4: sinon.stub().resolves(['1.1.1.1']),
          reverse: sinon.stub().resolves(['cache-xyz.azureedge.net']),
        },
      };
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: sinon.stub().resolves({ org: 'AS64500 Unknown' }),
      });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn, { log });
      expect(result.cdn).to.equal('Azure Front Door / Azure CDN');
      expect(log.info).to.have.been.calledWith(
        '[detect-cdn] Fallback: detected by PTR CNAME signature {"cdn":"Azure Front Door / Azure CDN","ip":"1.1.1.1","ptr":"cache-xyz.azureedge.net"}',
      );
    });

    it('detects by keywords on system CNAME chain when domain signatures miss', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub()
            .onFirstCall()
            .resolves(['internal.my-fastly-cache.example.org'])
            .onSecondCall()
            .rejects(Object.assign(new Error('ENODATA'), { code: 'ENODATA' })),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', sinon.stub(), { log });
      expect(result.cdn).to.equal('Fastly');
      expect(log.info).to.have.been.calledWith(
        '[detect-cdn] Fallback: detected by DNS name keywords',
        { cdn: 'Fastly', hostname: 'example.com' },
      );
    });

    it('detects by keywords on DoH CNAME chain when signatures miss', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects(Object.assign(new Error('ETIMEOUT'), { code: 'ETIMEOUT' })),
          resolve4: sinon.stub().rejects(Object.assign(new Error('ETIMEOUT'), { code: 'ETIMEOUT' })),
        },
      };
      const fetchFn = sinon.stub();
      fetchFn.onFirstCall().resolves({
        ok: true,
        json: () => Promise.resolve({
          Answer: [{ type: 5, data: 'edge.my-fastly-internal.example.' }],
        }),
      });
      fetchFn.onSecondCall().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [] }),
      });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn, { log });
      expect(result.cdn).to.equal('Fastly');
      expect(log.info).to.have.been.calledWith(
        '[detect-cdn] Fallback: detected by DNS name keywords (DoH)',
        { cdn: 'Fastly', hostname: 'example.com' },
      );
    });

    it('returns unknown when no IP can be resolved for ASN/PTR path', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects({ code: 'ENODATA' }),
          resolve4: sinon.stub().rejects({ code: 'ENOTFOUND' }),
        },
      };
      const fetchFn = sinon.stub();
      fetchFn.onFirstCall().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [] }),
      });
      fetchFn.onSecondCall().resolves({
        ok: true,
        json: () => Promise.resolve({ Answer: [] }),
      });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn);
      expect(result.cdn).to.equal('unknown');
    });

    it('returns unknown when IP resolves but ASN and PTR hostnames do not match any CDN', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects({ code: 'ENODATA' }),
          resolve4: sinon.stub().resolves(['198.51.100.10']),
          reverse: sinon.stub().resolves(['router1.isp-internal.example']),
        },
      };
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: sinon.stub().resolves({ org: 'AS64500 Some ISP' }),
      });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn);
      expect(result.cdn).to.equal('unknown');
    });

    it('uses PTR when ASN lookup returns null (ipinfo non-ok)', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects({ code: 'ENODATA' }),
          resolve4: sinon.stub().resolves(['198.51.100.20']),
          reverse: sinon.stub().resolves(['a23-9.deploy.static.akamaitechnologies.com']),
        },
      };
      const fetchFn = sinon.stub().resolves({ ok: false, status: 429 });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn, { log });
      expect(result.cdn).to.equal('Akamai');
      expect(log.info).to.have.been.calledWith(sinon.match('[detect-cdn] Fallback: detected by PTR keywords'));
    });

    it('uses second PTR hostname when first PTR does not match CDN heuristics', async () => {
      const mockDns = {
        promises: {
          resolve: sinon.stub().rejects({ code: 'ENODATA' }),
          resolve4: sinon.stub().resolves(['23.0.0.1']),
          reverse: sinon.stub().resolves(['irrelevant.example.com', 'a23-456.deploy.static.akamaitechnologies.com']),
        },
      };
      const fetchFn = sinon.stub().resolves({
        ok: true,
        json: sinon.stub().resolves({ org: 'AS99999 Unknown' }),
      });
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const log = { info: sinon.stub() };
      const result = await detector.detectCdnFromDnsFallback('https://example.com', fetchFn, { log });
      expect(result.cdn).to.equal('Akamai');
      expect(log.info).to.have.been.calledWith(
        sinon.match('[detect-cdn] Fallback: detected by PTR keywords'),
      );
    });
  });

  describe('getPtrHostnames', () => {
    it('returns hostnames when reverse succeeds', async () => {
      const mockDns = {
        promises: {
          reverse: sinon.stub().resolves(['ptr.example.com']),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const ptrs = await detector.getPtrHostnames('8.8.8.8');
      expect(ptrs).to.deep.equal(['ptr.example.com']);
    });

    it('returns empty array and logs when reverse fails', async () => {
      const log = { warn: sinon.stub() };
      const mockDns = {
        promises: {
          reverse: sinon.stub().rejects(Object.assign(new Error('ENOTPTR'), { code: 'ENOTFOUND' })),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const ptrs = await detector.getPtrHostnames('10.0.0.1', log);
      expect(ptrs).to.deep.equal([]);
      expect(log.warn).to.have.been.calledWith('[detect-cdn] reverse DNS failed', sinon.match({ ip: '10.0.0.1' }));
    });

    it('returns empty array when reverse succeeds with no hostnames', async () => {
      const mockDns = {
        promises: {
          reverse: sinon.stub().resolves([]),
        },
      };
      const detector = await esmock('../../src/detect-cdn/cdn-detector.js', {
        'node:dns': mockDns,
      });
      const ptrs = await detector.getPtrHostnames('192.0.2.1');
      expect(ptrs).to.deep.equal([]);
    });
  });
});
