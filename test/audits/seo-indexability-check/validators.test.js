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
import chaiAsPromised from 'chai-as-promised';
import * as redirectChains from '../../../src/redirect-chains/handler.js';
import * as canonical from '../../../src/canonical/handler.js';
import * as sitemapCommon from '../../../src/sitemap/common.js';
import {
  validateHttpStatus,
  validateRedirects,
  validateCanonical,
  validateNoindex,
  validateRobotsTxt,
  validateUrl,
  validateUrls,
} from '../../../src/seo-indexability-check/validators.js';

use(sinonChai);
use(chaiAsPromised);

describe('SEO Indexability Check - Validators', () => {
  let sandbox;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('validateHttpStatus', () => {
    it('passes for 200 OK status', async () => {
      const mockResponse = { status: 200, ok: true };
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves(mockResponse);

      const result = await validateHttpStatus('https://example.com', log);

      expect(result.passed).to.be.true;
      expect(result.statusCode).to.equal(200);
      expect(result.blockerType).to.be.null;
    });

    it('blocks for 404 status', async () => {
      const mockResponse = { status: 404, ok: false };
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves(mockResponse);

      const result = await validateHttpStatus('https://example.com/not-found', log);

      expect(result.passed).to.be.false;
      expect(result.statusCode).to.equal(404);
      expect(result.blockerType).to.equal('http-error');
    });

    it('blocks for 500 status', async () => {
      const mockResponse = { status: 500, ok: false };
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves(mockResponse);

      const result = await validateHttpStatus('https://example.com/error', log);

      expect(result.passed).to.be.false;
      expect(result.statusCode).to.equal(500);
      expect(result.blockerType).to.equal('http-error');
    });

    it('handles errors gracefully', async () => {
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').rejects(new Error('Network error'));

      const result = await validateHttpStatus('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.statusCode).to.equal(0);
      expect(result.blockerType).to.equal('http-error');
      expect(result.error).to.equal('Network error');
      expect(log.error).to.have.been.calledOnce;
    });
  });

  describe('validateRedirects', () => {
    it('passes for no redirects', async () => {
      sandbox.stub(redirectChains, 'countRedirects').resolves({
        redirectCount: 0,
        redirectChain: 'https://example.com',
      });

      const result = await validateRedirects('https://example.com', log);

      expect(result.passed).to.be.true;
      expect(result.redirectCount).to.equal(0);
      expect(result.blockerType).to.be.null;
    });

    it('blocks for redirect chain', async () => {
      sandbox.stub(redirectChains, 'countRedirects').resolves({
        redirectCount: 3,
        redirectChain: 'https://example.com -> https://example.com/new -> https://example.com/final',
      });

      const result = await validateRedirects('https://example.com/old', log);

      expect(result.passed).to.be.false;
      expect(result.redirectCount).to.equal(3);
      expect(result.blockerType).to.equal('redirect-chain');
      expect(result.finalUrl).to.equal('https://example.com/final');
    });

    it('handles errors gracefully', async () => {
      sandbox.stub(redirectChains, 'countRedirects').rejects(new Error('Redirect check failed'));

      const result = await validateRedirects('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.blockerType).to.equal('redirect-chain');
      expect(result.error).to.equal('Redirect check failed');
      expect(log.error).to.have.been.calledOnce;
    });
  });

  describe('validateCanonical', () => {
    it('passes for self-referencing canonical', async () => {
      sandbox.stub(canonical, 'validateCanonicalTag').resolves({
        canonicalUrl: 'https://example.com',
        checks: { canonical: { valid: true } },
      });

      const result = await validateCanonical('https://example.com', log);

      expect(result.passed).to.be.true;
      expect(result.isSelfReferencing).to.be.true;
      expect(result.blockerType).to.be.null;
    });

    it('passes for missing canonical', async () => {
      sandbox.stub(canonical, 'validateCanonicalTag').resolves({
        canonicalUrl: null,
        checks: { canonical: { valid: false } },
      });

      const result = await validateCanonical('https://example.com', log);

      expect(result.passed).to.be.true;
      expect(result.isSelfReferencing).to.be.true;
      expect(result.blockerType).to.be.null;
    });

    it('blocks for canonical pointing elsewhere', async () => {
      sandbox.stub(canonical, 'validateCanonicalTag').resolves({
        canonicalUrl: 'https://example.com/other-page',
        checks: { canonical: { valid: false } },
      });

      const result = await validateCanonical('https://example.com/this-page', log);

      expect(result.passed).to.be.false;
      expect(result.isSelfReferencing).to.be.false;
      expect(result.blockerType).to.equal('canonical-mismatch');
      expect(result.canonicalUrl).to.equal('https://example.com/other-page');
    });

    it('handles errors gracefully (does not block)', async () => {
      sandbox.stub(canonical, 'validateCanonicalTag').rejects(new Error('Canonical check failed'));

      const result = await validateCanonical('https://example.com', log);

      expect(result.passed).to.be.true; // Don't block on canonical errors
      expect(result.blockerType).to.be.null;
      expect(result.error).to.equal('Canonical check failed');
      expect(log.error).to.have.been.calledOnce;
    });
  });

  describe('validateNoindex', () => {
    it('passes for indexable page (no noindex)', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        headers: new Map([['x-robots-tag', 'index, follow']]),
        text: sinon.stub().resolves('<html><head></head><body>Content</body></html>'),
      };
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves(mockResponse);

      const result = await validateNoindex('https://example.com', log);

      expect(result.passed).to.be.true;
      expect(result.hasNoindexHeader).to.be.false;
      expect(result.hasNoindexMeta).to.be.false;
      expect(result.blockerType).to.be.null;
    });

    it('blocks for noindex in X-Robots-Tag header', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        headers: new Map([['x-robots-tag', 'noindex']]),
        text: sinon.stub().resolves('<html><head></head><body>Content</body></html>'),
      };
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves(mockResponse);

      const result = await validateNoindex('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.hasNoindexHeader).to.be.true;
      expect(result.blockerType).to.equal('noindex');
    });

    it('blocks for noindex in meta robots tag', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        headers: new Map(),
        text: sinon.stub().resolves('<html><head><meta name="robots" content="noindex, nofollow"></head><body>Content</body></html>'),
      };
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves(mockResponse);

      const result = await validateNoindex('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.hasNoindexMeta).to.be.true;
      expect(result.blockerType).to.equal('noindex');
    });

    it('blocks for "none" directive in X-Robots-Tag header', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        headers: new Map([['x-robots-tag', 'none']]),
        text: sinon.stub().resolves('<html><head></head><body>Content</body></html>'),
      };
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves(mockResponse);

      const result = await validateNoindex('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.hasNoindexHeader).to.be.true;
      expect(result.blockerType).to.equal('noindex');
    });

    it('blocks for "none" directive in meta robots tag', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        headers: new Map(),
        text: sinon.stub().resolves('<html><head><meta name="robots" content="none"></head><body>Content</body></html>'),
      };
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves(mockResponse);

      const result = await validateNoindex('https://example.com', log);

      expect(result.passed).to.be.false;
      expect(result.hasNoindexMeta).to.be.true;
      expect(result.blockerType).to.equal('noindex');
    });

    it('handles errors gracefully (does not block)', async () => {
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').rejects(new Error('Fetch failed'));

      const result = await validateNoindex('https://example.com', log);

      expect(result.passed).to.be.true; // Don't block on noindex errors
      expect(result.blockerType).to.be.null;
      expect(result.error).to.equal('Fetch failed');
      expect(log.error).to.have.been.calledOnce;
    });
  });

  describe('validateRobotsTxt', () => {
    it('passes when robots.txt allows Googlebot and general crawlers', async () => {
      const robotsTxtContent = `User-agent: *
Allow: /`;
      
      sandbox.stub(global, 'fetch').resolves({
        text: sinon.stub().resolves(robotsTxtContent),
      });

      const result = await validateRobotsTxt('https://example.com/page', log);

      expect(result.passed).to.be.true;
      expect(result.blockerType).to.be.null;
      expect(result.details.googlebot).to.be.true;
      expect(result.details.general).to.be.true;
    });

    it('blocks when robots.txt disallows Googlebot', async () => {
      const robotsTxtContent = `User-agent: Googlebot
Disallow: /`;
      
      sandbox.stub(global, 'fetch').resolves({
        text: sinon.stub().resolves(robotsTxtContent),
      });

      const result = await validateRobotsTxt('https://example.com/page', log);

      expect(result.passed).to.be.false;
      expect(result.blockerType).to.equal('robots-txt-blocked');
      expect(result.details.googlebot).to.be.false;
    });

    it('blocks when robots.txt disallows all crawlers', async () => {
      const robotsTxtContent = `User-agent: *
Disallow: /`;
      
      sandbox.stub(global, 'fetch').resolves({
        text: sinon.stub().resolves(robotsTxtContent),
      });

      const result = await validateRobotsTxt('https://example.com/page', log);

      expect(result.passed).to.be.false;
      expect(result.blockerType).to.equal('robots-txt-blocked');
      expect(result.details.general).to.be.false;
    });

    it('handles missing robots.txt gracefully (does not block)', async () => {
      sandbox.stub(global, 'fetch').rejects(new Error('404 Not Found'));

      const result = await validateRobotsTxt('https://example.com/page', log);

      expect(result.passed).to.be.true; // Don't block when robots.txt is missing
      expect(result.blockerType).to.be.null;
      expect(result.error).to.equal('404 Not Found');
      expect(log.warn).to.have.been.calledOnce;
    });
  });

  describe('validateUrl', () => {
    it('passes for clean URL (all checks pass)', async () => {
      // Mock all validators to pass
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves({
        status: 200,
        ok: true,
        headers: new Map(),
        text: sinon.stub().resolves('<html><body>Content</body></html>'),
      });
      sandbox.stub(redirectChains, 'countRedirects').resolves({
        redirectCount: 0,
        redirectChain: 'https://example.com',
      });
      sandbox.stub(canonical, 'validateCanonicalTag').resolves({
        canonicalUrl: 'https://example.com',
        checks: { canonical: { valid: true } },
      });
      sandbox.stub(global, 'fetch').resolves({
        text: sinon.stub().resolves('User-agent: *\nAllow: /'),
      });

      const context = { log };
      const result = await validateUrl('https://example.com', context);

      expect(result.indexable).to.be.true;
      expect(result.blockers).to.be.empty;
      expect(result.checks).to.have.all.keys('httpStatus', 'redirects', 'canonical', 'noindex', 'robotsTxt');
    });

    it('blocks for multiple issues', async () => {
      // Mock multiple validators to fail
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback').resolves({
        status: 404,
        ok: false,
        headers: new Map([['x-robots-tag', 'noindex']]),
        text: sinon.stub().resolves('<html><body>Not Found</body></html>'),
      });
      sandbox.stub(redirectChains, 'countRedirects').resolves({
        redirectCount: 2,
        redirectChain: 'https://example.com -> https://example.com/new',
      });
      sandbox.stub(canonical, 'validateCanonicalTag').resolves({
        canonicalUrl: 'https://example.com',
        checks: { canonical: { valid: true } },
      });
      sandbox.stub(global, 'fetch').resolves({
        text: sinon.stub().resolves('User-agent: *\nDisallow: /'),
      });

      const context = { log };
      const result = await validateUrl('https://example.com/page', context);

      expect(result.indexable).to.be.false;
      expect(result.blockers).to.include('http-error');
      expect(result.blockers).to.include('redirect-chain');
      expect(result.blockers).to.include('noindex');
      expect(result.blockers).to.include('robots-txt-blocked');
    });
  });

  describe('validateUrls', () => {
    it('validates multiple URLs and preserves keyword data', async () => {
      // Mock all validators to pass for first URL, fail for second
      sandbox.stub(sitemapCommon, 'fetchWithHeadFallback')
        .onFirstCall().resolves({
          status: 200,
          ok: true,
          headers: new Map(),
          text: sinon.stub().resolves('<html><body>Content</body></html>'),
        })
        .onSecondCall().resolves({
          status: 404,
          ok: false,
          headers: new Map(),
          text: sinon.stub().resolves('<html><body>Not Found</body></html>'),
        });

      sandbox.stub(redirectChains, 'countRedirects')
        .resolves({ redirectCount: 0, redirectChain: '' });

      sandbox.stub(canonical, 'validateCanonicalTag')
        .resolves({ canonicalUrl: null, checks: { canonical: { valid: false } } });

      const urls = [
        {
          url: 'https://example.com/clean',
          primaryKeyword: 'test keyword 1',
          position: 5,
          trafficValue: 1000,
        },
        {
          url: 'https://example.com/blocked',
          primaryKeyword: 'test keyword 2',
          position: 10,
          trafficValue: 500,
        },
      ];

      const context = { log };
      const results = await validateUrls(urls, context);

      expect(results).to.have.lengthOf(2);
      expect(results[0].primaryKeyword).to.equal('test keyword 1');
      expect(results[0].indexable).to.be.true;
      expect(results[1].primaryKeyword).to.equal('test keyword 2');
      expect(results[1].indexable).to.be.false;
      expect(log.info).to.have.been.calledWith('Validating 2 URLs for indexability');
    });
  });
});

