/*
 * Copyright 2024 Adobe. All rights reserved.
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

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import {
  getTopPagesForSiteId, validateCanonicalTag, validateCanonicalFormat,
  validateCanonicalRecursively, canonicalAuditRunner, CANONICAL_CHECKS,
} from '../../src/canonical/handler.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

describe('Canonical URL Tests', () => {
  let log;

  beforeEach(() => {
    log = {
      info: sinon.stub(),
      error: sinon.stub(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getTopPagesForSiteId', () => {
    it('should return top pages for a given site ID', async () => {
      const dataAccess = {
        getTopPagesForSite: sinon.stub().resolves([{ getURL: () => 'http://example.com/page1' }]),
      };
      const siteId = 'testSiteId';
      const context = { log };

      const result = await getTopPagesForSiteId(dataAccess, siteId, context, log);

      expect(result).to.deep.equal([{ url: 'http://example.com/page1' }]);
      expect(log.info).to.have.been.called;
    });

    it('should handle error and return an empty array', async () => {
      const dataAccess = {
        getTopPagesForSite: sinon.stub().rejects(new Error('Test error')),
      };
      const siteId = 'testSiteId';
      const context = { log };

      const result = await getTopPagesForSiteId(dataAccess, siteId, context, log);

      expect(result).to.deep.equal([]);
      expect(log.error).to.have.been.calledWith('Error retrieving top pages for site testSiteId: Test error');
    });

    it('should log and return an empty array if no top pages are found', async () => {
      const dataAccess = {
        getTopPagesForSite: sinon.stub().resolves([]),
      };
      const siteId = 'testSiteId';
      const context = { log };

      const result = await getTopPagesForSiteId(dataAccess, siteId, context, log);

      expect(result).to.deep.equal([]);
      expect(log.info).to.have.been.calledWith('No top pages found');
    });
  });

  describe('validateCanonicalTag', () => {
    it('should handle missing canonical tag', async () => {
      const url = 'http://example.com';
      const html = '<!DOCTYPE html><html><head></head><body></body></html>';
      nock('http://example.com').get('/').reply(200, html);

      const result = await validateCanonicalTag(url, log);

      expect(result.canonicalUrl).to.be.null;
      expect(result.checks).to.deep.include({
        check: 'canonical-tag-exists',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_TAG_EXISTS.explanation,
      });
      expect(log.info).to.have.been.called;
    });

    it('should return an error when URL is undefined or null', async () => {
      const result = await validateCanonicalTag(null, log);

      expect(result.canonicalUrl).to.be.null;
      expect(result.checks).to.deep.include({
        check: 'url-defined',
        success: false,
        explanation: CANONICAL_CHECKS.URL_UNDEFINED.explanation,
      });
      expect(log.error).to.have.been.calledWith('URL is undefined or null');
    });

    it('should handle fetch error', async () => {
      const url = 'http://example.com';
      nock('http://example.com').get('/').replyWithError('Test error');

      const result = await validateCanonicalTag(url, log);

      expect(result.canonicalUrl).to.be.null;
      expect(result.checks).to.deep.include({
        check: 'canonical-url-fetch-error',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.explanation,
      });
    });

    it('should handle empty canonical tag', async () => {
      const url = 'http://example.com';
      const html = '<html><head><link rel="canonical" href=""></head><body></body></html>';
      nock(url).get('/').reply(200, html);

      const result = await validateCanonicalTag(url, log);

      expect(result.canonicalUrl).to.be.null;
      expect(result.checks).to.deep.include({
        check: 'canonical-tag-nonempty',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_TAG_NONEMPTY.explanation,
      });
      expect(log.info).to.have.been.calledWith(`Empty canonical tag found for URL: ${url}`);
    });

    it('should handle multiple canonical tags', async () => {
      const url = 'http://example.com';
      const html = '<html><head><link rel="canonical" href="http://example.com/page1"><link rel="canonical" href="http://example.com/page2"></head><body></body></html>';
      nock(url).get('/').reply(200, html);

      const result = await validateCanonicalTag(url, log);

      expect(result.checks).to.deep.include({
        check: 'canonical-tag-once',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_TAG_ONCE.explanation,
      });
    });

    it('should fail if the canonical tag is not in the head section', async () => {
      const url = 'http://example.com';
      const html = '<html><head></head><body><link rel="canonical" href="http://example.com"></body></html>';
      nock(url).get('/').reply(200, html);

      const result = await validateCanonicalTag(url, log);

      expect(result.checks).to.deep.include({
        check: 'canonical-tag-in-head',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_TAG_IN_HEAD.explanation,
      });
      expect(log.info).to.have.been.calledWith('Canonical tag is not in the head section');
    });
  });

  describe('validateCanonicalUrlFormat', () => {
    it('should validate canonical URL format successfully', () => {
      const canonicalUrl = 'https://example.com/page';
      const baseUrl = 'https://example.com';

      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include.members([
        { check: 'canonical-url-absolute', success: true },
        { check: 'canonical-url-same-protocol', success: true },
        { check: 'canonical-url-same-domain', success: true },
      ]);
    });

    it('should handle invalid canonical URL', () => {
      const canonicalUrl = {};
      const baseUrl = 'http://example.com';
      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include.members([{
        check: 'url-defined',
        success: false,
        explanation: CANONICAL_CHECKS.URL_UNDEFINED.explanation,
      }]);
    });

    it('should handle invalid base URL', () => {
      const canonicalUrl = 'https://example.com';
      const baseUrl = 'invalid-url';
      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include({
        check: 'url-defined',
        success: false,
        explanation: CANONICAL_CHECKS.URL_UNDEFINED.explanation,
      });
      expect(log.error).to.have.been.calledWith('Invalid URL: invalid-url');
    });

    it('should handle non-lowercase canonical URL', () => {
      const canonicalUrl = 'https://example.com/UpperCase';
      const baseUrl = 'https://example.com';
      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-lowercased',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.explanation,
      });
      expect(log.info).to.have.been.calledWith('Canonical URL is not lowercased: https://example.com/UpperCase');
    });

    it('should handle different domains', () => {
      const canonicalUrl = 'https://another.com';
      const baseUrl = 'https://example.com';
      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-same-domain',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_SAME_DOMAIN.explanation,
      });
      expect(log.info).to.have.been.calledWith('Canonical URL https://another.com does not have the same domain as base URL https://example.com');
    });

    it('should handle different protocols', () => {
      const canonicalUrl = 'https://example.com';
      const baseUrl = 'http://example.com';
      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-same-protocol',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_SAME_PROTOCOL.explanation,
      });
      expect(log.info).to.have.been.calledWith('Canonical URL  https://example.com uses a different protocol than base URL http://example.com');
    });

    it('should fail if the canonical URL is not absolute', () => {
      const canonicalUrl = '/relative/url';
      const baseUrl = 'http://example.com';

      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-absolute',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.explanation,
      });
    });

    it('should pass if the canonical URL points to itself', async () => {
      const url = 'http://example.com';
      const html = `<html><head><link rel="canonical" href="${url}"></head><body></body></html>`;
      nock(url).get('/').reply(200, html);

      const result = await validateCanonicalTag(url, log);

      expect(result.checks).to.deep.include.members([
        {
          check: 'canonical-tag-nonempty',
          success: true,
        },
        {
          check: 'canonical-tag-exists',
          success: true,
        }]);
      expect(log.info).to.have.been.calledWith(`Canonical URL ${url} references itself`);
    });

    it('should fail if the canonical URL does not point to itself', async () => {
      const url = 'http://example.com';
      const canonicalUrl = 'http://example.com/other-page';
      const html = `<html><head><link rel="canonical" href="${canonicalUrl}"></head><body></body></html>`;
      nock(url).get('/').reply(200, html);

      const result = await validateCanonicalTag(url, log);

      expect(result.checks).to.deep.include.members([{
        check: 'canonical-tag-nonempty',
        success: true,
      }]);
      expect(result.checks).to.deep.include.members([{
        check: 'canonical-self-referenced',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.explanation,
      }]);
      expect(log.info).to.have.been.calledWith(`Canonical URL ${canonicalUrl} does not reference itself`);
    });
  });

  describe('validateCanonicalRecursively', () => {
    it('should validate canonical URL contents successfully', async () => {
      const canonicalUrl = 'http://example.com/page';
      nock('http://example.com').get('/page').reply(200);

      const result = await validateCanonicalRecursively(canonicalUrl, log);

      expect(result).to.deep.include({ check: 'canonical-url-status-ok', success: true });
      expect(result).to.deep.include({ check: 'canonical-url-no-redirect', success: true });
    });

    it('should handle a fetch error correctly', async () => {
      const canonicalUrl = 'http://example.com/fetcherror';
      nock('http://example.com').get('/fetcherror').replyWithError('Network error'); // Simulate a network error

      const result = await validateCanonicalRecursively(canonicalUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-fetch-error',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.explanation,
      });
      expect(log.error).to.have.been.calledWith(`Error fetching canonical URL ${canonicalUrl}: Network error`);
    });
  });

  describe('canonicalAuditRunner', () => {
    it('should run canonical audit successfully', async () => {
      const baseURL = 'http://example.com';
      const context = { log, dataAccess: { getTopPagesForSite: sinon.stub().resolves([{ getURL: () => 'http://example.com/page1' }]) } };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(log.info).to.have.been.called;
    });

    it('should return early and log a message when no top pages are found', async () => {
      const baseURL = 'http://example.com';
      const context = {
        log,
        dataAccess: {
          getTopPagesForSite: sinon.stub().resolves([]), // Simulate no top pages found
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          check: 'top-pages',
          success: false,
          explanation: CANONICAL_CHECKS.TOPPAGES.explanation,
        },
      });
      expect(log.info).to.have.been.calledWith('No top pages found, ending audit.');
    });
  });
});
