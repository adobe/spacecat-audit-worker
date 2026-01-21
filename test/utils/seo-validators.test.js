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

describe('SEO Validators', function () {
  // Increase timeout for esmock loading
  this.timeout(10000);

  let context;
  let log;
  let sandbox;
  let seoValidators;
  let mockFetchWithHeadFallback;
  let mockCountRedirects;
  let mockValidateCanonicalTag;
  let mockLimitConcurrencyAllSettled;
  let mockTracingFetch;

  before(async () => {
    // Load module once with mocked dependencies
    // Create persistent mock functions that can be reset
    mockFetchWithHeadFallback = sinon.stub();
    mockCountRedirects = sinon.stub();
    mockValidateCanonicalTag = sinon.stub();
    mockTracingFetch = sinon.stub();
    mockLimitConcurrencyAllSettled = sinon.stub();

    seoValidators = await esmock('../../src/utils/seo-validators.js', {
      '../../src/sitemap/common.js': {
        fetchWithHeadFallback: mockFetchWithHeadFallback,
      },
      '../../src/redirect-chains/handler.js': {
        countRedirects: mockCountRedirects,
      },
      '../../src/canonical/handler.js': {
        validateCanonicalTag: mockValidateCanonicalTag,
      },
      '../../src/support/utils.js': {
        limitConcurrencyAllSettled: mockLimitConcurrencyAllSettled,
      },
      '@adobe/spacecat-shared-utils': {
        tracingFetch: mockTracingFetch,
      },
    });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };
    context = { log };

    // Reset all mocks and set default behaviors
    mockFetchWithHeadFallback.reset();
    mockFetchWithHeadFallback.resolves({
      ok: true,
      status: 200,
      headers: new Map(),
      text: () => Promise.resolve('<html><head><title>Test</title></head></html>'),
    });

    mockCountRedirects.reset();
    mockCountRedirects.resolves({
      redirectCount: 0,
      redirectChain: null,
    });

    mockValidateCanonicalTag.reset();
    mockValidateCanonicalTag.resolves({
      canonicalUrl: null,
    });

    mockTracingFetch.reset();
    mockTracingFetch.resolves({
      ok: true,
      text: () => Promise.resolve('User-agent: *\nAllow: /'),
    });

    mockLimitConcurrencyAllSettled.reset();
    mockLimitConcurrencyAllSettled.callsFake(async (items, fn) => {
      const results = await Promise.allSettled(items.map((item) => fn(item)));
      return results; // Return in allSettled format: { status, value/reason }
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('validateHttpStatus', () => {
    it('should pass for 200 status', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
      });

      const result = await seoValidators.validateHttpStatus('https://example.com', log);

      expect(result.passed).to.be.true;
      expect(result.statusCode).to.equal(200);
      expect(result.blockerType).to.be.null;
    });

    it('should fail for 404 status', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: false,
        status: 404,
      });

      const result = await seoValidators.validateHttpStatus('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.statusCode).to.equal(404);
      expect(result.blockerType).to.equal('http-error');
    });

    it('should fail for 500 status', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: false,
        status: 500,
      });

      const result = await seoValidators.validateHttpStatus('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.statusCode).to.equal(500);
      expect(result.blockerType).to.equal('http-error');
    });

    it('should handle network errors gracefully', async () => {
      mockFetchWithHeadFallback.rejects(new Error('Network error'));

      const result = await seoValidators.validateHttpStatus('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.error).to.include('Network error');
      expect(result.blockerType).to.equal('http-error');
    });
  });

  describe('validateRedirects', () => {
    it('should pass for no redirects', async () => {
      mockCountRedirects.resolves({
        redirectCount: 0,
        redirectChain: null,
      });

      const result = await seoValidators.validateRedirects('https://example.com', log);

      expect(result.passed).to.be.true;
      expect(result.redirectCount).to.equal(0);
      expect(result.blockerType).to.be.null;
    });

    it('should fail for redirect chains', async () => {
      mockCountRedirects.resolves({
        redirectCount: 2,
        redirectChain: 'https://example.com -> https://example.com/new -> https://example.com/final',
      });

      const result = await seoValidators.validateRedirects('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.redirectCount).to.equal(2);
      expect(result.blockerType).to.equal('redirect-chain');
    });

    it('should extract final URL from redirect chain', async () => {
      mockCountRedirects.resolves({
        redirectCount: 1,
        redirectChain: 'https://example.com -> https://example.com/final',
      });

      const result = await seoValidators.validateRedirects('https://example.com', log);

      expect(result.finalUrl).to.equal('https://example.com/final');
    });

    it('should handle errors gracefully', async () => {
      mockCountRedirects.rejects(new Error('Redirect check failed'));

      const result = await seoValidators.validateRedirects('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.error).to.include('Redirect check failed');
      expect(result.blockerType).to.equal('redirect-chain');
    });
  });

  describe('validateCanonical', () => {
    it('should pass for self-referencing canonical', async () => {
      mockValidateCanonicalTag.resolves({
        canonicalUrl: 'https://example.com',
      });

      const result = await seoValidators.validateCanonical('https://example.com', log, {});

      expect(result.passed).to.be.true;
      expect(result.canonicalUrl).to.equal('https://example.com');
      expect(result.blockerType).to.be.null;
    });

    it('should pass for no canonical tag', async () => {
      mockValidateCanonicalTag.resolves({
        canonicalUrl: null,
      });

      const result = await seoValidators.validateCanonical('https://example.com', log, {});

      expect(result.passed).to.be.true;
      expect(result.canonicalUrl).to.be.null;
    });

    it('should fail for canonical pointing elsewhere', async () => {
      mockValidateCanonicalTag.resolves({
        canonicalUrl: 'https://other.com/',
      });

      const result = await seoValidators.validateCanonical('https://example.com', log, {});

      expect(result.passed).to.be.false;
      expect(result.canonicalUrl).to.equal('https://other.com/');
      expect(result.blockerType).to.equal('canonical-mismatch');
    });

    it('should not block on errors (fail-safe)', async () => {
      mockValidateCanonicalTag.rejects(new Error('Canonical check failed'));

      const result = await seoValidators.validateCanonical('https://example.com', log, {});

      expect(result.passed).to.be.true; // Fail-safe
      expect(result.error).to.include('Canonical check failed');
    });
  });

  describe('validateNoindex', () => {
    it('should pass for no noindex directives', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html><head><title>Test</title></head></html>'),
      });

      const result = await seoValidators.validateNoindex('https://example.com', log);

      expect(result.passed).to.be.true;
      expect(result.blockerType).to.be.null;
    });

    it('should fail for noindex meta tag', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html><head><meta name="robots" content="noindex"></head></html>'),
      });

      const result = await seoValidators.validateNoindex('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.blockerType).to.equal('noindex');
      expect(result.hasNoindexMeta).to.be.true;
    });

    it('should fail for X-Robots-Tag header with noindex', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map([['x-robots-tag', 'noindex']]),
        text: () => Promise.resolve('<html><head><title>Test</title></head></html>'),
      });

      const result = await seoValidators.validateNoindex('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.blockerType).to.equal('noindex');
      expect(result.hasNoindexHeader).to.be.true;
    });

    it('should fail for "none" directive (meta tag)', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html><head><meta name="robots" content="none"></head></html>'),
      });

      const result = await seoValidators.validateNoindex('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.blockerType).to.equal('noindex');
      expect(result.hasNoindexMeta).to.be.true;
    });

    it('should fail for "none" directive (header)', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map([['x-robots-tag', 'none']]),
        text: () => Promise.resolve('<html><head><title>Test</title></head></html>'),
      });

      const result = await seoValidators.validateNoindex('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.blockerType).to.equal('noindex');
      expect(result.hasNoindexHeader).to.be.true;
    });

    it('should not block on errors (fail-safe)', async () => {
      mockFetchWithHeadFallback.rejects(new Error('Fetch failed'));

      const result = await seoValidators.validateNoindex('https://example.com', log);

      expect(result.passed).to.be.true; // Fail-safe
      expect(result.error).to.include('Fetch failed');
    });
  });

  describe('validateRobotsTxt', () => {
    it('should pass when Googlebot and general crawlers are allowed', async () => {
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const result = await seoValidators.validateRobotsTxt('https://example.com/page', log);

      expect(result.passed).to.be.true;
      expect(result.blockerType).to.be.null;
    });

    it('should fail when Googlebot is blocked (non-cached)', async () => {
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: Googlebot\nDisallow: /'),
      });

      const result = await seoValidators.validateRobotsTxt('https://blocked-domain.com/page', log);

      // robots-parser will actually parse this and block correctly
      expect(result.passed).to.be.false;
      expect(result.blockerType).to.equal('robots-txt-blocked');
      expect(result.details.googlebot).to.be.false;
      expect(result.details.cached).to.be.false;
    });

    it('should fail when general crawler is blocked (non-cached)', async () => {
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nDisallow: /'),
      });

      const result = await seoValidators.validateRobotsTxt('https://blocked-all.com/page', log);

      // robots-parser will actually parse this and block correctly
      expect(result.passed).to.be.false;
      expect(result.blockerType).to.equal('robots-txt-blocked');
      expect(result.details.general).to.be.false;
      expect(result.details.cached).to.be.false;
    });

    it('should use cache on second call to same domain (allowed)', async () => {
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      // First call - populates cache
      const result1 = await seoValidators.validateRobotsTxt('https://cached-domain.com/page1', log);
      expect(result1.details.cached).to.be.false;
      const firstCallCount = mockTracingFetch.callCount;

      // Second call - should use cache
      const result2 = await seoValidators.validateRobotsTxt('https://cached-domain.com/page2', log);
      expect(result2.details.cached).to.be.true;
      expect(result2.passed).to.be.true;
      expect(result2.blockerType).to.be.null;

      // Should not fetch robots.txt again
      expect(mockTracingFetch.callCount).to.equal(firstCallCount);
    });

    it('should use cache on second call to same domain (blocked)', async () => {
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nDisallow: /'),
      });

      // First call - populates cache with blocking rules
      const result1 = await seoValidators.validateRobotsTxt('https://cached-blocked.com/page1', log);
      expect(result1.details.cached).to.be.false;
      expect(result1.passed).to.be.false;
      const firstCallCount = mockTracingFetch.callCount;

      // Second call - should use cache and still block
      const result2 = await seoValidators.validateRobotsTxt('https://cached-blocked.com/page2', log);
      expect(result2.details.cached).to.be.true;
      expect(result2.passed).to.be.false;
      expect(result2.blockerType).to.equal('robots-txt-blocked');

      // Should not fetch robots.txt again
      expect(mockTracingFetch.callCount).to.equal(firstCallCount);
    });

    it('should fetch robots.txt for different domains', async () => {
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const result1 = await seoValidators.validateRobotsTxt('https://example.com/page', log);
      const result2 = await seoValidators.validateRobotsTxt('https://other.com/page', log);

      expect(result1).to.have.property('passed');
      expect(result2).to.have.property('passed');
      expect(mockTracingFetch.callCount).to.be.at.least(1);
    });

    it('should not block when robots.txt is missing (fail-safe)', async () => {
      mockTracingFetch.resolves({
        ok: false,
        status: 404,
      });

      const result = await seoValidators.validateRobotsTxt('https://example.com/page', log);

      expect(result.passed).to.be.true; // Fail-safe
    });

    it('should handle fetch errors gracefully', async () => {
      mockTracingFetch.rejects(new Error('Network error'));

      // Use a unique domain to bypass cache
      const result = await seoValidators.validateRobotsTxt('https://unique-error-domain.com/page', log);

      // robots.txt errors are fail-safe: allow if robots.txt can't be fetched
      expect(result.passed).to.be.true;
      expect(result.blockerType).to.be.null;
      expect(result.error).to.equal('Network error');
      // Verify error was logged
      expect(log.warn).to.have.been.called;
      const warnCall = log.warn.getCall(0);
      expect(warnCall.args[0]).to.include('robots.txt check failed');
      expect(warnCall.args[0]).to.include('Network error');
    });
  });

  describe('validateUrl', () => {
    it('should run all 5 checks in parallel', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html><head><title>Test</title></head></html>'),
      });
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const result = await seoValidators.validateUrl('https://example.com', context);

      expect(result).to.have.property('url', 'https://example.com');
      expect(result).to.have.property('indexable', true);
      expect(result.checks).to.have.property('httpStatus');
      expect(result.checks).to.have.property('redirects');
      expect(result.checks).to.have.property('canonical');
      expect(result.checks).to.have.property('noindex');
      expect(result.checks).to.have.property('robotsTxt');
      expect(result.blockers).to.be.an('array').that.is.empty;
    });

    it('should mark URL as non-indexable if any check fails', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: false,
        status: 404,
      });
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const result = await seoValidators.validateUrl('https://example.com', context);

      expect(result.indexable).to.be.false;
      expect(result.blockers).to.include('http-error');
    });

    it('should collect all blocking issues', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: false,
        status: 404,
        headers: new Map([['x-robots-tag', 'noindex']]),
        text: () => Promise.resolve('<html></html>'),
      });
      mockCountRedirects.resolves({
        redirectCount: 2,
        redirectChain: 'https://example.com -> https://example.com/new',
      });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nDisallow: /'),
      });

      const result = await seoValidators.validateUrl('https://example.com', context);

      expect(result.indexable).to.be.false;
      expect(result.blockers).to.have.length.at.least(2);
      expect(result.blockers).to.include('http-error');
    });
  });

  describe('validateUrls', () => {
    it('should validate multiple URLs', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      });
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const urls = [
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
      ];

      const results = await seoValidators.validateUrls(urls, context);

      expect(results).to.have.lengthOf(3);
      expect(results[0].url).to.equal('https://example.com/page1');
      expect(results[1].url).to.equal('https://example.com/page2');
      expect(results[2].url).to.equal('https://example.com/page3');
    });

    it('should use limitConcurrencyAllSettled for batch processing', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      });
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const urls = ['https://example.com/1', 'https://example.com/2'];
      await seoValidators.validateUrls(urls, context);

      expect(mockLimitConcurrencyAllSettled).to.have.been.calledOnce;
    });

    it('should handle empty array', async () => {
      const results = await seoValidators.validateUrls([], context);

      expect(results).to.be.an('array').that.is.empty;
    });

    it('should handle single URL', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      });
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const results = await seoValidators.validateUrls(['https://example.com'], context);

      expect(results).to.have.lengthOf(1);
      expect(results[0].url).to.equal('https://example.com');
    });

    it('should handle object URLs with properties', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      });
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const urls = [
        { url: 'https://example.com', ctr: 0.05, impressions: 100 },
      ];

      const results = await seoValidators.validateUrls(urls, context);

      expect(results[0]).to.have.property('url', 'https://example.com');
      expect(results[0]).to.have.property('ctr', 0.05);
      expect(results[0]).to.have.property('impressions', 100);
    });

    it('should handle validation failures and log errors', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      });
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      // Mock limitConcurrencyAllSettled to simulate some failures
      mockLimitConcurrencyAllSettled.callsFake(async (items, fn) => {
        const results = [];
        for (let i = 0; i < items.length; i += 1) {
          if (i === 1) {
            // Simulate a rejected promise for the second item
            results.push({ status: 'rejected', reason: new Error('Validation failed') });
          } else {
            // eslint-disable-next-line no-await-in-loop
            const result = await fn(items[i]);
            results.push({ status: 'fulfilled', value: result });
          }
        }
        return results;
      });

      const urls = [
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
      ];

      const results = await seoValidators.validateUrls(urls, context);

      // Should have logged the error for failed validation
      expect(log.error).to.have.been.calledWith('1 URL validations failed');
      // Should return only successful validations (2 out of 3)
      expect(results).to.have.lengthOf(2);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle a URL with multiple blocking issues', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: false,
        status: 404,
        headers: new Map([['x-robots-tag', 'noindex']]),
        text: () => Promise.resolve('<html><head><meta name="robots" content="noindex"></head></html>'),
      });
      mockCountRedirects.resolves({
        redirectCount: 3,
        redirectChain: 'https://example.com -> https://example.com/a -> https://example.com/b -> https://example.com/c',
      });
      mockValidateCanonicalTag.resolves({
        canonicalUrl: 'https://other.com/',
      });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: Googlebot\nDisallow: /'),
      });

      const result = await seoValidators.validateUrl('https://example.com', context);

      expect(result.indexable).to.be.false;
      expect(result.blockers.length).to.be.at.least(3);
      expect(result.blockers).to.include('http-error');
      expect(result.blockers).to.include('redirect-chain');
      expect(result.blockers).to.include('canonical-mismatch');
      // Note: noindex should also be in blockers
      expect(result.blockers).to.include('noindex');
    });

    it('should handle mixed results in batch validation', async () => {
      mockFetchWithHeadFallback.callsFake(async (url) => {
        if (url === 'https://example.com/good') {
          return {
            ok: true,
            status: 200,
            headers: new Map(),
            text: () => Promise.resolve('<html></html>'),
          };
        }
        return {
          ok: false,
          status: 404,
          headers: new Map(),
          text: () => Promise.resolve(''),
        };
      });
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const urls = [
        'https://example.com/good',
        'https://example.com/bad',
      ];

      const results = await seoValidators.validateUrls(urls, context);

      const cleanUrls = results.filter((r) => r.indexable);
      const blockedUrls = results.filter((r) => !r.indexable);

      expect(cleanUrls.length).to.be.at.least(1);
      expect(blockedUrls.length).to.be.at.least(1);
    });

    it('should preserve all input properties through validation', async () => {
      mockFetchWithHeadFallback.resolves({
        ok: true,
        status: 200,
        headers: new Map(),
        text: () => Promise.resolve('<html></html>'),
      });
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      const urls = [
        {
          url: 'https://example.com',
          customField1: 'value1',
          customField2: 123,
          nested: { data: 'test' },
        },
      ];

      const results = await seoValidators.validateUrls(urls, context);

      expect(results[0].customField1).to.equal('value1');
      expect(results[0].customField2).to.equal(123);
      expect(results[0].nested).to.deep.equal({ data: 'test' });
    });
  });

  describe('Error handling and fail-safe behavior', () => {
    it('should not throw unhandled errors', async () => {
      mockFetchWithHeadFallback.rejects(new Error('Catastrophic failure'));
      mockCountRedirects.rejects(new Error('Redirect error'));
      mockValidateCanonicalTag.rejects(new Error('Canonical error'));
      mockTracingFetch.rejects(new Error('Robots.txt error'));

      const result = await seoValidators.validateUrl('https://example.com', context);

      expect(result).to.be.an('object');
      expect(result.url).to.equal('https://example.com');
      // Implementation is conservative: errors cause blocking
      expect(result.indexable).to.be.false;
      expect(result.blockers).to.include('http-error');
    });

    it('should log errors but continue processing', async () => {
      mockFetchWithHeadFallback.rejects(new Error('Network timeout'));
      mockCountRedirects.resolves({ redirectCount: 0, redirectChain: null });
      mockValidateCanonicalTag.resolves({ canonicalUrl: null });
      mockTracingFetch.resolves({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nAllow: /'),
      });

      await seoValidators.validateUrl('https://example.com', context);

      expect(log.error).to.have.been.called;
    });

    it('should block on check failures (conservative approach)', async () => {
      mockFetchWithHeadFallback.rejects(new Error('Error'));

      const result = await seoValidators.validateHttpStatus('https://example.com', log);

      // Implementation is conservative: errors cause blocking to be safe
      expect(result.passed).to.be.false;
      expect(result.error).to.exist;
      expect(result.blockerType).to.equal('http-error');
    });
  });
});
