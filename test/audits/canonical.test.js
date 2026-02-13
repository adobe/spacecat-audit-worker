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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import esmock from 'esmock';
import canonicalAudit, {
  validateCanonicalFormat,
  validateCanonicalRecursively,
  generateCanonicalSuggestion,
  importTopPages,
  submitForScraping,
  processScrapedContent,
  getPreviewAuthOptions,
} from '../../src/canonical/handler.js';
import { getTopPagesForSiteId } from '../../src/utils/data-access.js';
import { CANONICAL_CHECKS } from '../../src/canonical/constants.js';
import { createOpportunityData, createOpportunityDataForElmo } from '../../src/canonical/opportunity-data-mapper.js';

use(sinonChai);
use(chaiAsPromised);

describe('Canonical URL Tests', () => {
  let log;
  // Helper function to generate valid rawBody (>= 300 chars) for tests
  const createValidRawBody = (content = '') => {
    const baseContent = content || '<html><head><title>Test Page</title></head><body><h1>Test Content</h1><p>This is a test page with enough content to pass the rawBody length check.</p></body></html>';
    if (baseContent.length < 300) {
      return baseContent + ' '.repeat(300 - baseContent.length);
    }
    return baseContent;
  };

  beforeEach(() => {
    log = {
      debug: sinon.stub(),
      info: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
    };
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  describe('getPreviewAuthOptions', () => {
    it('should return empty options for non-preview pages', async () => {
      const testSite = {
        getId: sinon.stub().returns('test-site-id'),
        getBaseURL: sinon.stub().returns('https://example.com'),
      };
      
      const options = await getPreviewAuthOptions(false, 'https://example.com', testSite, context, context.log);
      
      expect(options).to.deep.equal({});
    });

    it('should retrieve authentication token for preview pages', async () => {
      const testSite = {
        getId: sinon.stub().returns('test-site-id'),
        getBaseURL: sinon.stub().returns('https://main--site--owner.aem.page'),
      };
      
      const testLog = {
        info: sinon.stub(),
        error: sinon.stub(),
      };
      
      const mockRetrievePageAuthentication = sinon.stub().resolves('test-token-123');
      
      const { getPreviewAuthOptions: getPreviewAuthOptionsMocked } = await esmock(
        '../../src/canonical/handler.js',
        {
          '@adobe/spacecat-shared-ims-client': {
            retrievePageAuthentication: mockRetrievePageAuthentication,
          },
        },
      );

      const options = await getPreviewAuthOptionsMocked(true, 'https://main--site--owner.aem.page', testSite, context, testLog);
      
      expect(options).to.have.property('headers');
      expect(options.headers.Authorization).to.equal('token test-token-123');
      expect(mockRetrievePageAuthentication).to.have.been.calledOnce;
      // Authentication log was removed
    });

    it('should handle authentication errors gracefully', async () => {
      const testSite = {
        getId: sinon.stub().returns('test-site-id'),
        getBaseURL: sinon.stub().returns('https://main--site--owner.aem.page'),
      };
      
      const testLog = {
        info: sinon.stub(),
        error: sinon.stub(),
      };
      
      const authError = new Error('Authentication failed');
      const mockRetrievePageAuthentication = sinon.stub().rejects(authError);
      
      const { getPreviewAuthOptions: getPreviewAuthOptionsMocked } = await esmock(
        '../../src/canonical/handler.js',
        {
          '@adobe/spacecat-shared-ims-client': {
            retrievePageAuthentication: mockRetrievePageAuthentication,
          },
        },
      );

      const options = await getPreviewAuthOptionsMocked(true, 'https://main--site--owner.aem.page', testSite, context, testLog);
      
      expect(options).to.deep.equal({});
      expect(testLog.error).to.have.been.calledWith(
        sinon.match(/Error retrieving page authentication.*Authentication failed/),
      );
    });
  });

  describe('getTopPagesForSiteId', () => {
    it('should return top pages for a given site ID', async () => {
      const dataAccess = {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([{ getUrl: () => 'http://example.com/page1' }]) },
      };
      const siteId = 'testSiteId';
      const context = { log };

      const result = await getTopPagesForSiteId(dataAccess, siteId, context, log);

      expect(result).to.deep.equal([{ url: 'http://example.com/page1' }]);
      expect(log.info).to.have.been.called;
    });

    it('should handle null result and return an empty array', async () => {
      const dataAccess = {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves(null) },
      };
      const siteId = 'testSiteId';
      const context = { log };

      const result = await getTopPagesForSiteId(dataAccess, siteId, context, log);

      expect(result).to.deep.equal([]);
      expect(log.info).to.have.been.calledWith('No top pages found');
    });

    it('should log the error and propagate the exception when retrieving top pages fails', async () => {
      const dataAccess = {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().rejects(new Error('Test error')) },
      };
      const siteId = 'testSiteId';
      const context = { log };

      try {
        await getTopPagesForSiteId(dataAccess, siteId, context, log);
      } catch (error) {
        expect(error.message).to.equal('Test error');
      }

      expect(log.error).to.have.been.calledWith('Error retrieving top pages for site testSiteId: Test error');
    });

    it('should log and return an empty array if no top pages are found', async () => {
      const dataAccess = {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) },
      };
      const siteId = 'testSiteId';
      const context = { log };

      const result = await getTopPagesForSiteId(dataAccess, siteId, context, log);

      expect(result).to.deep.equal([]);
      expect(log.info).to.have.been.calledWith('No top pages found');
    });
  });

  /* REMOVED: validateCanonicalTag tests - function deleted from handler.js
  describe('validateCanonicalTag', () => {
  */

  describe('validateCanonicalUrlFormat', () => {
    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should handle missing canonical tag', async () => {
          const url = 'http://example.com';
          const html = '<!DOCTYPE html><html lang="en"><head><title>test</title></head><body></body></html>';
          nock('http://example.com').get('/').reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          expect(result.canonicalUrl).to.be.null;
          expect(result.checks).to.deep.include({
            check: 'canonical-tag-missing',
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.explanation,
          });
          expect(log.info).to.have.been.called;
        });
    */

    it('should handle invalid base URL correctly', () => {
      const canonicalUrl = 'https://example.com';
      const baseUrl = 'invalid-url';
      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.be.an('array').that.is.empty;
      expect(log.error).to.have.been.calledWith(`Invalid URL: ${baseUrl}`);
    });

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should return an error when URL is undefined or null', async () => {
          const result = await validateCanonicalTag(null, log);
    
          expect(result.canonicalUrl).to.be.null;
          expect(result.checks).to.be.an('array').that.is.empty;
          expect(log.error).to.have.been.calledWith('URL is undefined or null, cannot validate canonical tags');
        });
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
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
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should handle invalid canonical URL correctly', async () => {
          const url = 'http://example.com';
          const html = '<html lang="en"><head><link rel="canonical" href="invalid-url"><title>test</title></head><body></body></html>';
          nock(url).get('/').reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          expect(result.checks).to.deep.include({
            check: 'canonical-url-invalid',
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_URL_INVALID.explanation,
          });
          expect(log.info).to.have.been.calledWith('Invalid canonical URL found for page http://example.com');
        });
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should handle empty canonical tag', async () => {
          const url = 'http://example.com';
          const html = '<html lang="en"><head><link rel="canonical" href=""><title>test</title></head><body></body></html>';
          nock(url).get('/').reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          expect(result.canonicalUrl).to.be.null;
          expect(result.checks).to.deep.include({
            check: 'canonical-tag-empty',
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.explanation,
          });
          expect(log.info).to.have.been.calledWith(`Empty canonical tag found for URL: ${url}`);
        });
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should handle multiple canonical tags', async () => {
          const url = 'http://example.com';
          const html = '<html lang="en"><head><link rel="canonical" href="http://example.com/page1"><link rel="canonical" href="http://example.com/page2"><title>test</title></head><body></body></html>';
          nock(url).get('/').reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          expect(result.checks).to.deep.include({
            check: 'canonical-tag-multiple',
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_MULTIPLE.explanation,
          });
        });
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should fail if the canonical tag is not in the head section', async () => {
          const url = 'http://example.com';
          const html = '<html lang="en"><head><title>test</title></head><body><link rel="canonical" href="http://example.com"></body></html>';
          nock(url).get('/').reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          expect(result.checks).to.deep.include({
            check: 'canonical-tag-outside-head',
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.explanation,
          });
          expect(log.info).to.have.been.calledWith('Canonical tag is not in the head section (detected via Cheerio)');
        });
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should follow redirects and validate canonical tag on the final destination page', async () => {
          const originalUrl = 'http://example.com/old';
          const finalUrl = 'http://example.com/new';
          const finalHtml = `<html lang="en"><head><link rel="canonical" href="${finalUrl}"><title>test</title></head><body></body></html>`;
    
          nock('http://example.com')
            .get('/old')
            .reply(301, undefined, { Location: finalUrl });
    
          nock('http://example.com')
            .get('/new')
            .reply(200, finalHtml);
    
          const result = await validateCanonicalTag(originalUrl, log);
    
          expect(result.canonicalUrl).to.equal(finalUrl);
          expect(result.checks).to.deep.include({
            check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
            success: true,
          });
        });
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should resolve relative canonical against the final destination after redirect', async () => {
          const originalUrl = 'https://example.com/a';
          const finalUrl = 'https://example.com/b';
          const html = '<html lang="en"><head><link rel="canonical" href="/b"><title>test</title></head><body></body></html>';
    
          nock('https://example.com')
            .get('/a')
            .reply(301, undefined, { Location: finalUrl });
    
          nock('https://example.com')
            .get('/b')
            .reply(200, html);
    
          const result = await validateCanonicalTag(originalUrl, log);
    
          expect(result.canonicalUrl).to.equal(finalUrl);
          expect(result.checks).to.deep.include({
            check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
            success: true,
          });
        });
    */
  });
  // END validateCanonicalTag tests */

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

      expect(result).to.be.an('array').that.is.empty;
      expect(log.error).to.have.been.calledWith('[canonical] Canonical URL is not a string: object');
    });

    it('should handle invalid base URL', () => {
      const canonicalUrl = 'https://example.com';
      const baseUrl = 'invalid-url';
      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.be.an('array').that.is.empty;
      expect(log.error).to.have.been.calledWith('Invalid URL: invalid-url');
    });

    it('should handle uppercase canonical URL', () => {
      const canonicalUrl = 'HTTPS://EXAMPLE.COM/UPPERCASE';
      const baseUrl = 'https://example.com';
      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-lowercased',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.explanation,
      });
      // Log message for uppercase was removed
    });

    it('should pass if canonical URL is in lowercase', () => {
      const canonicalUrl = 'https://example.com/lowercase';
      const baseUrl = 'https://example.com';

      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-lowercased',
        success: true,
      });
    });

    it('should handle redirection scenario and stop at the first redirect', async () => {
      const canonicalUrl = 'http://example.com/page1';
      const redirectUrl = 'http://example.com/page2';

      nock('http://example.com')
        .get('/page1')
        .reply(301, null, { Location: redirectUrl });

      nock('http://example.com')
        .get('/page2')
        .reply(200);

      const result = await validateCanonicalRecursively(canonicalUrl, log);

      expect(result).to.deep.include.members([
        {
          check: 'canonical-url-no-redirect',
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.explanation,
        },
      ]);
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
      // Log message for different domains was removed
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
      // Log message for different protocols was removed
    });

    it('should pass when canonical URL and base URL are identical, regardless of the www prefix', () => {
      const cases = [
        { canonicalUrl: 'https://www.example.com', baseUrl: 'https://example.com' },
        { canonicalUrl: 'https://example.com', baseUrl: 'https://www.example.com' },
      ];

      cases.forEach(({ canonicalUrl, baseUrl }) => {
        const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

        expect(result).to.deep.include({
          check: 'canonical-url-same-domain',
          success: true,
        });
      });
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

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should pass if the canonical URL points to itself', async () => {
          const url = 'http://example.com';
          const html = `<html lang="en"><head><link rel="canonical" href="${url}"><title>test</title></head><body></body></html>`;
          nock(url).get('/').reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          expect(result.checks).to.deep.include.members([
            {
              check: 'canonical-tag-empty',
              success: true,
            },
            {
              check: 'canonical-tag-missing',
              success: true,
            }]);
          expect(log.info).to.have.been.calledWith(`Canonical URL ${url} references itself`);
        });
    */

    it('should handle try-catch for invalid canonical URL', () => {
      const invalidCanonicalUrl = 'http://%';
      const baseUrl = 'https://example.com';

      const result = validateCanonicalFormat(invalidCanonicalUrl, baseUrl, log);

      expect(result).to.deep.include.members([{
        check: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.check,
        success: true,
      }]);

      expect(log.error).to.have.been.calledWith(`[canonical] Invalid canonical URL: ${invalidCanonicalUrl}`);
    });

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should fail if the canonical URL does not point to itself', async () => {
          const url = 'http://example.com';
          const canonicalUrl = 'http://example.com/other-page';
          const html = `<html lang="en"><head><link rel="canonical" href="${canonicalUrl}"><title>test</title></head><body></body></html>`;
          nock(url).get('/').reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          expect(result.checks).to.deep.include.members([{
            check: 'canonical-tag-empty',
            success: true,
          }]);
          expect(result.checks).to.deep.include.members([{
            check: 'canonical-self-referenced',
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.explanation,
          }]);
          expect(log.info).to.have.been.calledWith(`Canonical URL ${canonicalUrl} does not reference itself`);
        });
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should pass self-reference check when canonical URL strips query parameters', async () => {
            const url = 'https://example.com/products/category/item-name?id=12345&ref=abc';
            const canonicalUrl = 'https://example.com/products/category/item-name';
            const html = `<html lang="en"><head><link rel="canonical" href="${canonicalUrl}"><title>test</title></head><body></body></html>`;
    
            nock('https://example.com')
                .get('/products/category/item-name?id=12345&ref=abc')
                .reply(200, html);
    
            const result = await validateCanonicalTag(url, log);
    
            expect(result.canonicalUrl).to.equal(canonicalUrl);
            expect(result.checks).to.deep.include({
                check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
                success: true,
            });
            expect(log.info).to.have.been.calledWith(`Canonical URL ${canonicalUrl} references itself`);
        });
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should handle canonical URL with unusual format during comparison', async () => {
          const url = 'https://example.com/page?param=value';
          // Use a relative canonical URL that becomes absolute but might have edge cases
          const html = '<html lang="en"><head><link rel="canonical" href="/page"><title>test</title></head><body></body></html>';
    
          nock('https://example.com').get('/page').query({ param: 'value' }).reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          // Should handle the URL normalization and comparison gracefully
          expect(result.canonicalUrl).to.equal('https://example.com/page');
          expect(result.checks).to.deep.include({
            check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
            success: true,
          });
        });
    */

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should handle edge case with URL that has special encoded characters', async () => {
          const url = 'https://example.com/page%20with%20spaces';
          const canonicalUrl = 'https://example.com/page%20with%20spaces';
          const html = `<html lang="en"><head><link rel="canonical" href="${canonicalUrl}"><title>test</title></head><body></body></html>`;
    
          nock('https://example.com').get('/page%20with%20spaces').reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          expect(result.canonicalUrl).to.equal(canonicalUrl);
          expect(result.checks).to.deep.include({
            check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
            success: true,
          });
        });
    */
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
      nock('http://example.com').get('/fetcherror').replyWithError('Network error');

      const result = await validateCanonicalRecursively(canonicalUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-fetch-error',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.explanation,
      });
      expect(log.error).to.have.been.calledWith(`Error fetching canonical URL ${canonicalUrl}: Network error`);
    });

    it('should detect and handle redirect loop correctly', async () => {
      const options = {
        redirect: 'manual',
      };
      const canonicalUrl = 'http://example.com/redirect-loop';
      const visitedUrls = new Set([canonicalUrl]);

      const result = await validateCanonicalRecursively(canonicalUrl, log, options, visitedUrls);

      expect(result).to.deep.include({
        check: 'canonical-url-no-redirect',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.explanation,
      });
      // Log message for redirect loop was removed
    });

    it('should handle 4xx error response correctly', async () => {
      const canonicalUrl = 'http://example.com/404';
      nock('http://example.com').get('/404').reply(404);

      const result = await validateCanonicalRecursively(canonicalUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-4xx',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_4XX.explanation,
      });
      expect(log.info).to.have.been.calledWith(`Canonical URL ${canonicalUrl} returned a 4xx error: 404`);
    });

    it('should handle 5xx error response correctly', async () => {
      const canonicalUrl = 'http://example.com/500';
      nock('http://example.com').get('/500').reply(500);

      const result = await validateCanonicalRecursively(canonicalUrl, log);

      expect(result).to.deep.include({
        check: 'canonical-url-5xx',
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_5XX.explanation,
      });
    });

    /* REMOVED: Test references deleted validateCanonicalTag function
        it('should correctly resolve relative canonical URL with base URL', async () => {
          const url = 'https://example.com/some-page';
          const href = '/canonical-page';
          const expectedCanonicalUrl = 'https://example.com/canonical-page';
    
          const html = `
        <html lang="en">
          <head>
            <link rel="canonical" href="${href}"><title>test</title>
          </head>
          <body>
            <h1>Test Page</h1>
          </body>
        </html>
      `;
    
          nock('https://example.com')
            .get('/some-page')
            .reply(200, html);
    
          const result = await validateCanonicalTag(url, log);
    
          // ensure that the resolved canonical URL is correct
          expect(result.canonicalUrl).to.equal(expectedCanonicalUrl);
          expect(result.checks).to.deep.include({
            check: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.check,
            success: true,
          });
          expect(result.checks).to.deep.include({
            check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.explanation,
          });
          expect(log.info).to.have.been.calledWith(`Canonical URL ${expectedCanonicalUrl} does not reference itself`);
        });
    */

    it('should handle unexpected status code response correctly', async () => {
      const canonicalUrl = 'http://example.com/300';
      nock('http://example.com').get('/300').reply(300);

      const result = await validateCanonicalRecursively(canonicalUrl, log);

      expect(result).to.deep.include({
        check: 'unexpected-status-code',
        success: false,
        explanation: CANONICAL_CHECKS.UNEXPECTED_STATUS_CODE.explanation,
      });
      expect(log.info).to.have.been.calledWith(`Unexpected status code 300 for canonical URL: ${canonicalUrl}`);
    });
  });

  /* REMOVED: canonicalAuditRunner tests - function deleted from handler.js
  describe('canonicalAuditRunner', () => {
    it('should run canonical audit successfully', async () => {
      const baseURL = 'https://example.com';
      const pageURL = 'https://example.com/page1';
      const html = `<html lang="en"><head><link rel="canonical" href="${pageURL}"><title>test</title></head><body></body></html>`;

      nock('https://example.com').get('/page1').twice().reply(200, html);
      const getTopPagesForSiteStub = sinon.stub().resolves([{ getUrl: () => pageURL }]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.deep.equal({
        status: 'success',
        message: 'No canonical issues detected',
      });
      expect(getTopPagesForSiteStub).to.have.been.calledOnceWith('testSiteId', 'ahrefs', 'global');
      expect(log.info).to.have.been.called;
    });

    it('should return early and log a message when no top pages are found', async () => {
      const baseURL = 'http://example.com';
      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) },
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

    it('should log a simplified error and return a failed audit result if an exception occurs', async () => {
      const baseURL = 'http://example.com';
      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().rejects(new Error('Test Error')) },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      // verify that the returned audit result indicates a failure with an error message
      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          error: 'Audit failed with error: Test Error',
          success: false,
        },
      });
    });

    it('should call retrievePageAuthentication for preview pages to get the auth token', async () => {
      const baseURL = 'http://example.page';
      const html = `<html lang="en"><head><link rel="canonical" href="${baseURL}"><title>test</title></head><body></body></html>`;

      const capturedStatus = {};
      // eslint-disable-next-line func-names
      nock('http://example.page').get('/page1').reply(function (uri, requestBody) {
        // `this` is the interceptor context
        capturedStatus.uri = uri;
        capturedStatus.requestBody = requestBody;
        capturedStatus.headers = this.req.headers;
        return [200, html];
      });

      const captured1 = {};
      // eslint-disable-next-line func-names
      nock('http://example.page').get('/page1').reply(function (uri, requestBody) {
        // `this` is the interceptor context
        captured1.uri = uri;
        captured1.requestBody = requestBody;
        captured1.headers = this.req.headers;
        return [200, html];
      });
      const captured2 = {};
      // eslint-disable-next-line func-names
      nock(baseURL).get('/').reply(function (uri, requestBody) {
        // `this` is the interceptor context
        captured2.uri = uri;
        captured2.requestBody = requestBody;
        captured2.headers = this.req.headers;
        return [200, html];
      });
      const getTopPagesForSiteStub = sinon.stub().resolves([{ getUrl: () => 'http://example.page/page1' }]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const retrievePageAuthenticationStub = sinon.stub().resolves('token1234');
      const { canonicalAuditRunner: canonicalAuditRunnerInstance } = await esmock(
        '../../src/canonical/handler.js',
        {
          '@adobe/spacecat-shared-ims-client': { retrievePageAuthentication: retrievePageAuthenticationStub },
        },
      );

      await canonicalAuditRunnerInstance(baseURL, context, site);

      expect(log.info).to.have.been.calledWith('Retrieving page authentication for pageUrl http://example.page');
      expect(retrievePageAuthenticationStub).to.have.been.calledOnceWith(site, context);
      expect(capturedStatus.headers).to.have.property('authorization');
      expect(capturedStatus.headers.authorization).to.equal('token token1234');
      expect(captured1.headers).to.have.property('authorization');
      expect(captured1.headers.authorization).to.equal('token token1234');
      expect(captured2.headers).to.have.property('authorization');
      expect(captured2.headers.authorization).to.equal('token token1234');
    });

    it('should silently ignore any errors from retrievePageAuthentication', async () => {
      const baseURL = 'http://example.page';
      const html = `<html lang="en"><head><link rel="canonical" href="${baseURL}"><title>test</title></head><body></body></html>`;

      // First request: status check
      nock('http://example.page').get('/page1').reply(200, html);
      // Second request: canonical tag validation
      nock('http://example.page').get('/page1').reply(200, html);
      nock(baseURL).get('/').reply(200, html);
      const getTopPagesForSiteStub = sinon.stub().resolves([{ getUrl: () => 'http://example.page/page1' }]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const retrievePageAuthenticationStub = sinon.stub().rejects(new Error('Something went wrong'));
      const { canonicalAuditRunner: canonicalAuditRunnerInstance } = await esmock(
        '../../src/canonical/handler.js',
        {
          '@adobe/spacecat-shared-ims-client': { retrievePageAuthentication: retrievePageAuthenticationStub },
        },
      );

      await canonicalAuditRunnerInstance(baseURL, context, site);

      expect(log.info).to.have.been.calledWith('Retrieving page authentication for pageUrl http://example.page');
      expect(retrievePageAuthenticationStub).to.have.been.calledOnceWith(site, context);
      expect(log.error).to.have.been.calledWith('Error retrieving page authentication for pageUrl http://example.page: Something went wrong');
    });

    it('should skip login/authentication pages from canonical checks', async () => {
      const baseURL = 'https://example.com';
      const pageURL = 'https://example.com/page1';
      const html = `<html lang="en"><head><link rel="canonical" href="${pageURL}"><title>test</title></head><body></body></html>`;

      nock('https://example.com').get('/page1').twice().reply(200, html);

      const getTopPagesForSiteStub = sinon.stub().resolves([
        { getUrl: () => 'https://example.com/login' },
        { getUrl: () => 'https://example.com/signin' },
        { getUrl: () => 'https://example.com/auth' },
        { getUrl: () => 'https://example.com/auth/user' },
        { getUrl: () => 'https://example.com/oauth/callback' },
        { getUrl: () => 'https://example.com/sso' },
        { getUrl: () => pageURL },
      ]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.deep.equal({
        status: 'success',
        message: 'No canonical issues detected',
      });

      // Verify log entries for skipped pages
      expect(log.info).to.have.been.calledWith('Skipping canonical checks for auth/login page: https://example.com/login');
      expect(log.info).to.have.been.calledWith('Skipping canonical checks for auth/login page: https://example.com/signin');
      expect(log.info).to.have.been.calledWith('Skipping canonical checks for auth/login page: https://example.com/auth');
      expect(log.info).to.have.been.calledWith('Skipping canonical checks for auth/login page: https://example.com/auth/user');
      expect(log.info).to.have.been.calledWith('Skipping canonical checks for auth/login page: https://example.com/oauth/callback');
      expect(log.info).to.have.been.calledWith('Skipping canonical checks for auth/login page: https://example.com/sso');
    });

    it('should skip PDF files from canonical checks', async () => {
      const baseURL = 'https://example.com';
      const pageURL = 'https://example.com/page1';
      const html = `<html lang="en"><head><link rel="canonical" href="${pageURL}"><title>test</title></head><body></body></html>`;

      nock('https://example.com').get('/page1').twice().reply(200, html);

      const getTopPagesForSiteStub = sinon.stub().resolves([
        { getUrl: () => 'https://example.com/document.pdf' },
        { getUrl: () => 'https://example.com/guide.PDF' },
        { getUrl: () => 'https://example.com/files/report.pdf' },
        { getUrl: () => pageURL },
      ]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.deep.equal({
        status: 'success',
        message: 'No canonical issues detected',
      });

      // Verify log entries for skipped PDF files
      expect(log.info).to.have.been.calledWith('Skipping canonical checks for PDF file: https://example.com/document.pdf');
      expect(log.info).to.have.been.calledWith('Skipping canonical checks for PDF file: https://example.com/guide.PDF');
      expect(log.info).to.have.been.calledWith('Skipping canonical checks for PDF file: https://example.com/files/report.pdf');
    });

    it('should handle malformed URLs in shouldSkipAuthPage and isPdfUrl catch blocks gracefully', async () => {
      const baseURL = 'https://example.com';
      const pageURL = 'https://example.com/page1';
      const html = `<html lang="en"><head><link rel="canonical" href="${pageURL}"><title>test</title></head><body></body></html>`;

      nock('https://example.com').get('/page1').twice().reply(200, html);

      const getTopPagesForSiteStub = sinon.stub().resolves([
        { getUrl: () => '://invalid' },
        { getUrl: () => 'ht!tp://bad-protocol.com' },
        { getUrl: () => pageURL },
      ]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('auditResult');
    });

    it('should skip audit when all pages return non-200 status', async () => {
      const baseURL = 'https://example.com';

      // Mock pages that all return non-200 status
      nock('https://example.com').get('/page1').reply(404, 'Not Found');
      nock('https://example.com').get('/page2').reply(500, 'Server Error');
      nock('https://example.com').get('/page3').reply(403, 'Forbidden');

      const getTopPagesForSiteStub = sinon.stub().resolves([
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/page2' },
        { getUrl: () => 'https://example.com/page3' },
      ]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.deep.equal({
        status: 'success',
        message: 'No pages with 200 status found to analyze for canonical tags',
      });
      expect(log.info).to.have.been.calledWith('No pages returned 200 status, ending audit without creating opportunities.');
    });

    it('should skip pages that redirect to auth/login pages', async () => {
      const baseURL = 'https://example.com';
      const pageURL = 'https://example.com/billing/manage-payment';
      const signinURL = 'https://example.com/auth/signin';
      const signinHtml = '<html><head><title>Sign In</title></head><body>Please login</body></html>';

      // Mock redirect: billing page → signin page
      nock('https://example.com')
        .get('/billing/manage-payment')
        .reply(302, '', { Location: signinURL });

      nock('https://example.com')
        .get('/auth/signin')
        .reply(200, signinHtml);

      const getTopPagesForSiteStub = sinon.stub().resolves([
        { getUrl: () => pageURL },
      ]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.deep.equal({
        status: 'success',
        message: 'No pages with 200 status found to analyze for canonical tags',
      });

      // Verify the redirect was detected and logged
      expect(log.info).to.have.been.calledWith(
        sinon.match(/redirected to auth page.*signin/),
      );
    });

    it('should skip pages that redirect to various auth patterns', async () => {
      const baseURL = 'https://example.com';
      const loginHtml = '<html><head><title>Login</title></head><body>Login page</body></html>';

      // Test multiple auth URL patterns
      const testCases = [
        { page: '/account/settings', redirect: '/login' },
        { page: '/billing', redirect: '/signin' },
        { page: '/dashboard', redirect: '/authenticate' },
        { page: '/profile', redirect: '/oauth/authorize' },
        { page: '/admin', redirect: '/sso' },
        { page: '/settings', redirect: '/auth' },
        { page: '/private', redirect: '/auth/login' },
      ];

      testCases.forEach(({ page, redirect }) => {
        nock('https://example.com')
          .get(page)
          .reply(302, '', { Location: redirect });

        nock('https://example.com')
          .get(redirect)
          .reply(200, loginHtml);
      });

      const getTopPagesForSiteStub = sinon.stub().resolves(
        testCases.map(({ page }) => ({ getUrl: () => `https://example.com${page}` })),
      );

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result.auditResult).to.deep.equal({
        status: 'success',
        message: 'No pages with 200 status found to analyze for canonical tags',
      });

      // Verify all redirects were detected
      testCases.forEach(({ redirect }) => {
        expect(log.info).to.have.been.calledWith(
          sinon.match(new RegExp(`redirected to auth page.*${redirect}`)),
        );
      });
    });

    it('should skip pages that redirect to auth patterns anywhere in URL path', async () => {
      const baseURL = 'https://example.com';
      const loginHtml = '<html><head><title>Login</title></head><body>Login page</body></html>';

      // Test auth patterns that appear in the middle or end of URL path
      const testCases = [
        { page: '/myaccount', redirect: '/user/login/redirect' },
        { page: '/dashboard', redirect: '/company/signin/page' },
        { page: '/api/data', redirect: '/services/authenticate/form' },
        { page: '/checkout', redirect: '/payment/oauth/callback' },
      ];

      testCases.forEach(({ page, redirect }) => {
        nock('https://example.com')
          .get(page)
          .reply(302, '', { Location: redirect });

        nock('https://example.com')
          .get(redirect)
          .reply(200, loginHtml);
      });

      const getTopPagesForSiteStub = sinon.stub().resolves(
        testCases.map(({ page }) => ({ getUrl: () => `https://example.com${page}` })),
      );

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result.auditResult).to.deep.equal({
        status: 'success',
        message: 'No pages with 200 status found to analyze for canonical tags',
      });

      // Verify all redirects were detected (includes() should catch patterns anywhere)
      testCases.forEach(({ page }) => {
        expect(log.info).to.have.been.calledWith(
          sinon.match(new RegExp(`Page.*${page}.*redirected to auth page`)),
        );
      });
    });

    it('should skip redundant fetch for self-referenced canonical URLs', async () => {
      const baseURL = 'https://example.com';
      const pageURL = 'https://example.com/page1';
      const html = `<html lang="en"><head><link rel="canonical" href="${pageURL}"><title>test</title></head><body></body></html>`;

      // Optimization: self-referenced URL fetched twice (pre-flight + audit)
      nock('https://example.com').get('/page1').twice().reply(200, html);

      const getTopPagesForSiteStub = sinon.stub().resolves([{ getUrl: () => pageURL }]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result.auditResult).to.deep.equal({
        status: 'success',
        message: 'No canonical issues detected',
      });

      expect(nock.isDone()).to.be.true;
    });

    it('should fetch canonical URL when NOT self-referenced', async () => {
      const baseURL = 'https://example.com';
      const pageURL = 'https://example.com/page1';
      const canonicalURL = 'https://example.com/canonical-page';

      const pageHtml = `<html lang="en"><head><link rel="canonical" href="${canonicalURL}"><title>test</title></head><body></body></html>`;
      const canonicalHtml = `<html lang="en"><head><link rel="canonical" href="${canonicalURL}"><title>canonical</title></head><body></body></html>`;

      // No optimization: page fetched twice (pre-flight + audit), canonical fetched once
      nock('https://example.com').get('/page1').twice().reply(200, pageHtml);
      nock('https://example.com').get('/canonical-page').once().reply(200, canonicalHtml);

      const getTopPagesForSiteStub = sinon.stub().resolves([{ getUrl: () => pageURL }]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('auditResult');

      // Result varies by audit logic; key assertion is both URLs fetched
      if (Array.isArray(result.auditResult)) {
        expect(result.auditResult).to.have.lengthOf.at.least(1);
        const hasSelfRefError = result.auditResult.some((r) => r.type === 'canonical-self-referenced');
        expect(hasSelfRefError).to.be.true;
      } else {
        expect(result.auditResult).to.have.property('status');
      }

      expect(nock.isDone()).to.be.true;
    });

    it('should handle URL normalization with trailing slashes', async () => {
      const baseURL = 'https://example.com';
      const pageURL = 'https://example.com/page1';
      const canonicalURLWithSlash = 'https://example.com/page1/';

      const html = `<html lang="en"><head><link rel="canonical" href="${canonicalURLWithSlash}"><title>test</title></head><body></body></html>`;

      // Normalization: /page1 and /page1/ treated as same URL, fetched twice (pre-flight + audit)
      nock('https://example.com').get('/page1').twice().reply(200, html);

      const getTopPagesForSiteStub = sinon.stub().resolves([{ getUrl: () => pageURL }]);

      const context = {
        log,
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: getTopPagesForSiteStub },
        },
      };
      const site = { getId: () => 'testSiteId' };

      const result = await canonicalAuditRunner(baseURL, context, site);

      expect(result).to.be.an('object');
      expect(result.auditResult).to.deep.equal({
        status: 'success',
        message: 'No canonical issues detected',
      });

      expect(nock.isDone()).to.be.true;
    });
  });
  // END canonicalAuditRunner tests */

  describe('generateCanonicalSuggestion', () => {
    const testUrl = 'https://example.com/test-page';
    const baseURL = 'https://example.com';

    // shorter alias for the canonical checks
    const checks = {
      TAG_MISSING: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.check,
      TAG_MULTIPLE: CANONICAL_CHECKS.CANONICAL_TAG_MULTIPLE.check,
      TAG_EMPTY: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.check,
      TAG_OUTSIDE_HEAD: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.check,
      SELF_REFERENCED: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
      URL_ABSOLUTE: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.check,
      URL_SAME_DOMAIN: CANONICAL_CHECKS.CANONICAL_URL_SAME_DOMAIN.check,
      URL_SAME_PROTOCOL: CANONICAL_CHECKS.CANONICAL_URL_SAME_PROTOCOL.check,
      URL_LOWERCASED: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.check,
      URL_STATUS_OK: CANONICAL_CHECKS.CANONICAL_URL_STATUS_OK.check,
      URL_NO_REDIRECT: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
      URL_4XX: CANONICAL_CHECKS.CANONICAL_URL_4XX.check,
      URL_5XX: CANONICAL_CHECKS.CANONICAL_URL_5XX.check,
      URL_FETCH_ERROR: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.check,
      URL_INVALID: CANONICAL_CHECKS.CANONICAL_URL_INVALID.check,
    };

    it('should generate suggestion for CANONICAL_TAG_MISSING', () => {
      const result = generateCanonicalSuggestion(checks.TAG_MISSING);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_TAG_MISSING.suggestion);
    });

    it('should generate suggestion for CANONICAL_TAG_MULTIPLE', () => {
      const result = generateCanonicalSuggestion(checks.TAG_MULTIPLE);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_TAG_MULTIPLE.suggestion);
    });

    it('should generate suggestion for CANONICAL_TAG_EMPTY', () => {
      const result = generateCanonicalSuggestion(checks.TAG_EMPTY);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.suggestion);
    });

    it('should generate suggestion for CANONICAL_TAG_OUTSIDE_HEAD', () => {
      const result = generateCanonicalSuggestion(checks.TAG_OUTSIDE_HEAD);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_STATUS_OK', () => {
      const result = generateCanonicalSuggestion(checks.URL_STATUS_OK);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_STATUS_OK.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_NO_REDIRECT', () => {
      const result = generateCanonicalSuggestion(checks.URL_NO_REDIRECT);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_4XX', () => {
      const result = generateCanonicalSuggestion(checks.URL_4XX);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_4XX.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_5XX', () => {
      const result = generateCanonicalSuggestion(checks.URL_5XX);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_5XX.suggestion);
    });

    it('should generate suggestion for CANONICAL_SELF_REFERENCED', () => {
      const result = generateCanonicalSuggestion(checks.SELF_REFERENCED);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_ABSOLUTE', () => {
      const result = generateCanonicalSuggestion(checks.URL_ABSOLUTE);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_SAME_DOMAIN', () => {
      const result = generateCanonicalSuggestion(checks.URL_SAME_DOMAIN);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_SAME_DOMAIN.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_SAME_PROTOCOL', () => {
      const result = generateCanonicalSuggestion(checks.URL_SAME_PROTOCOL);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_SAME_PROTOCOL.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_LOWERCASED', () => {
      const result = generateCanonicalSuggestion(checks.URL_LOWERCASED);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_FETCH_ERROR', () => {
      const result = generateCanonicalSuggestion(checks.URL_FETCH_ERROR);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.suggestion);
    });

    it('should generate suggestion for CANONICAL_URL_INVALID', () => {
      const result = generateCanonicalSuggestion(checks.URL_INVALID);
      expect(result).to.equal(CANONICAL_CHECKS.CANONICAL_URL_INVALID.suggestion);
    });

    it('should return fallback message for unknown check type', () => {
      const unknownCheckType = 'unknown-check-type';
      const result = generateCanonicalSuggestion(unknownCheckType);
      expect(result).to.equal('Review and fix the canonical tag implementation according to SEO best practices.');
    });

    it('should return fallback message when check object has no suggestion function', () => {
      const result = generateCanonicalSuggestion(CANONICAL_CHECKS.TOPPAGES.check);
      expect(result).to.equal('Review and fix the canonical tag implementation according to SEO best practices.');
    });
  });

  describe('createOpportunityData', () => {
    it('should return canonical opportunity data with correct structure', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Canonical URLs to clarify your SEO strategy to search engines are ready');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('steps').that.is.an('array');
      expect(result.guidance.steps).to.have.length.above(0);
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags).to.include('Traffic Acquisition');
      expect(result.tags).to.include('SEO');
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });
  });

  describe('createOpportunityDataForElmo', () => {
    it('should return canonical opportunity data for Elmo with correct structure', () => {
      const result = createOpportunityDataForElmo();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Canonical URLs to clarify your SEO strategy to search engines are ready');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('recommendations').that.is.an('array');
      expect(result.guidance.recommendations).to.have.length.above(0);
      expect(result.guidance.recommendations[0]).to.have.property('insight');
      expect(result.guidance.recommendations[0]).to.have.property('recommendation');
      expect(result.guidance.recommendations[0]).to.have.property('type', 'CONTENT');
      expect(result.guidance.recommendations[0]).to.have.property('rationale');
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags).to.include('Traffic Acquisition');
      expect(result.tags).to.include('SEO');
      expect(result.tags).to.include('llm');
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
      expect(result.data).to.have.property('additionalMetrics').that.is.an('array');
      expect(result.data.additionalMetrics).to.deep.include({
        value: 'canonical',
        key: 'subtype',
      });
    });
  });

  // REMOVED: generateSuggestions, opportunityAndSuggestions, opportunityAndSuggestionsForElmo functions
  // have been deleted from handler.js - they are now part of processScrapedContent
  /* eslint-disable */
  /*
  describe('generateSuggestions', () => {
    const auditUrl = 'https://example.com';
    const mockContext = {
      log: {
        info: sinon.stub(),
        error: sinon.stub(),
      },
    };

    beforeEach(() => {
      mockContext.log.info.reset();
    });

    it('should return audit data as-is when auditResult is not an array', () => {
      const auditData = {
        auditResult: {
          status: 'success',
          message: 'No canonical issues detected',
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(mockContext.log.info).to.have.been.calledWith(
        'Canonical audit for https://example.com has no issues or failed, skipping suggestions generation',
      );
    });

    it('should generate suggestions from canonical audit results', () => {
      const auditData = {
        auditResult: [
          {
            type: 'canonical-self-referenced',
            explanation: 'The canonical URL should point to itself',
            affectedUrls: [
              {
                url: 'https://example.com/page1',
                suggestion: 'Update canonical URL to point to itself',
              },
              {
                url: 'https://example.com/page2',
                suggestion: 'Update canonical URL to point to itself',
              },
            ],
          },
          {
            type: 'canonical-url-fetch-error',
            explanation: 'Error fetching canonical URL',
            affectedUrls: [
              {
                url: 'https://example.com/page3',
                suggestion: 'Check if the URL is accessible',
              },
            ],
          },
        ],
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.have.property('suggestions').that.is.an('array');
      expect(result.suggestions).to.have.length(3);

      // Check first suggestion
      expect(result.suggestions[0]).to.deep.equal({
        type: 'CODE_CHANGE',
        checkType: 'canonical-self-referenced',
        explanation: 'The canonical URL should point to itself',
        url: 'https://example.com/page1',
        suggestion: 'Update canonical URL to point to itself',
        recommendedAction: 'Update canonical URL to point to itself',
      });

      // Check second suggestion
      expect(result.suggestions[1]).to.deep.equal({
        type: 'CODE_CHANGE',
        checkType: 'canonical-self-referenced',
        explanation: 'The canonical URL should point to itself',
        url: 'https://example.com/page2',
        suggestion: 'Update canonical URL to point to itself',
        recommendedAction: 'Update canonical URL to point to itself',
      });

      // Check third suggestion
      expect(result.suggestions[2]).to.deep.equal({
        type: 'CODE_CHANGE',
        checkType: 'canonical-url-fetch-error',
        explanation: 'Error fetching canonical URL',
        url: 'https://example.com/page3',
        suggestion: 'Check if the URL is accessible',
        recommendedAction: 'Check if the URL is accessible',
      });

      expect(mockContext.log.info).to.have.been.calledWith(
        'Generated 3 canonical suggestions for https://example.com',
      );
    });

    it('should handle empty auditResult array', () => {
      const auditData = {
        auditResult: [],
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.have.property('suggestions').that.is.an('array').and.is.empty;
      expect(mockContext.log.info).to.have.been.calledWith(
        'Generated 0 canonical suggestions for https://example.com',
      );
    });
  });

  describe('opportunityAndSuggestions', () => {
    const auditUrl = 'https://example.com';
    const mockContext = {
      log: {
        debug: sinon.stub(),
        info: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub(),
      },
      dataAccess: {
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub(),
          create: sinon.stub(),
          getId: sinon.stub().returns('opportunity-123'),
          getSuggestions: sinon.stub(),
          addSuggestions: sinon.stub(),
        },
        Suggestion: {
          create: sinon.stub(),
        },
      },
    };

    beforeEach(() => {
      mockContext.log.info.reset();
      mockContext.log.error.reset();
      mockContext.dataAccess.Opportunity.allBySiteIdAndStatus.reset();
      mockContext.dataAccess.Opportunity.create.reset();
      mockContext.dataAccess.Opportunity.getSuggestions.reset();
      mockContext.dataAccess.Opportunity.addSuggestions.reset();
      mockContext.dataAccess.Suggestion.create.reset();
    });

    it('should skip opportunity creation when auditResult is not an array', async () => {
      const auditData = {
        auditResult: {
          status: 'success',
          message: 'No canonical issues detected',
        },
      };

      const result = await opportunityAndSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(mockContext.log.info).to.have.been.calledWith(
        'Canonical audit has no issues, skipping opportunity creation',
      );
    });

    it('should skip opportunity creation when no suggestions exist', async () => {
      const auditData = {
        auditResult: [
          {
            type: 'canonical-self-referenced',
            explanation: 'The canonical URL should point to itself',
            affectedUrls: [],
          },
        ],
        suggestions: [],
      };

      const result = await opportunityAndSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(mockContext.log.info).to.have.been.calledWith(
        'Canonical audit has no issues, skipping opportunity creation',
      );
    });

    it('should create opportunity and sync suggestions when issues exist', async () => {
      const auditData = {
        siteId: 'site-123',
        auditResult: [
          {
            type: 'canonical-self-referenced',
            explanation: 'The canonical URL should point to itself',
            affectedUrls: [
              {
                url: 'https://example.com/page1',
                suggestion: 'Update canonical URL',
              },
            ],
          },
        ],
        suggestions: [
          {
            type: 'CODE_CHANGE',
            checkType: 'canonical-self-referenced',
            explanation: 'The canonical URL should point to itself',
            url: 'https://example.com/page1',
            suggestion: 'Update canonical URL',
            recommendedAction: 'Update canonical URL',
          },
        ],
      };

      // Mock opportunity creation
      mockContext.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      mockContext.dataAccess.Opportunity.create.resolves(mockContext.dataAccess.Opportunity);
      mockContext.dataAccess.Opportunity.getSuggestions.resolves([]);
      mockContext.dataAccess.Opportunity.addSuggestions.resolves({ createdItems: [] });

      const result = await opportunityAndSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(mockContext.dataAccess.Opportunity.create).to.have.been.calledOnce;
      expect(mockContext.log.info).to.have.been.calledWith(
        'Canonical opportunity created and 1 suggestions synced for https://example.com',
      );
    });
  });

  describe('opportunityAndSuggestionsForElmo', () => {
    const auditUrl = 'https://example.com';
    const mockContext = {
      log: {
        debug: sinon.stub(),
        info: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub(),
      },
      dataAccess: {
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub(),
          create: sinon.stub(),
          getId: sinon.stub().returns('elmo-opportunity-123'),
          getSuggestions: sinon.stub(),
          addSuggestions: sinon.stub(),
        },
        Suggestion: {
          create: sinon.stub(),
        },
      },
    };

    beforeEach(() => {
      mockContext.log.info.reset();
      mockContext.log.error.reset();
      mockContext.dataAccess.Opportunity.allBySiteIdAndStatus.reset();
      mockContext.dataAccess.Opportunity.create.reset();
      mockContext.dataAccess.Opportunity.getSuggestions.reset();
      mockContext.dataAccess.Opportunity.addSuggestions.reset();
      mockContext.dataAccess.Suggestion.create.reset();
    });

    it('should skip opportunity creation when no elmoSuggestions', async () => {
      const auditData = {
        auditResult: [
          {
            type: 'canonical-self-referenced',
            explanation: 'The canonical URL should point to itself',
            affectedUrls: [
              {
                url: 'https://example.com/page1',
                suggestion: 'Update canonical URL to point to itself',
              },
            ],
          },
        ],
        elmoSuggestions: [],
      };

      const result = await opportunityAndSuggestionsForElmo(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(mockContext.log.info).to.have.been.calledWith(
        'Canonical audit has no issues, skipping opportunity creation for Elmo',
      );
    });

    it('should create Elmo opportunity and sync suggestions when elmoSuggestions exist', async () => {
      const auditData = {
        siteId: 'site-123',
        id: 'audit-123',
        auditResult: [
          {
            type: 'canonical-self-referenced',
            explanation: 'The canonical URL should point to itself',
            affectedUrls: [
              {
                url: 'https://example.com/page1',
                suggestion: 'Update canonical URL',
              },
            ],
          },
        ],
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: '## Canonical Self-Referenced\n\n| Page Url | Explanation | Suggestion |\n|-------|-------|-------|\n| https://example.com/page1 | The canonical URL should point to itself | Update canonical URL |\n',
          },
        ],
      };

      const mockOpportunity = {
        getId: sinon.stub().returns('elmo-opportunity-123'),
        getSuggestions: sinon.stub().resolves([]),
        addSuggestions: sinon.stub().resolves({ createdItems: [], errors: [] }),
        save: sinon.stub().resolves(),
        getType: sinon.stub().returns('generic-opportunity'),
        getStatus: sinon.stub().returns('NEW'),
        getData: sinon.stub().returns({
          additionalMetrics: [
            { key: 'subtype', value: 'canonical' },
          ],
        }),
        setData: sinon.stub(),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        setAuditId: sinon.stub(),
      };

      const fullMockContext = {
        ...mockContext,
        siteId: 'site-123',
        dataAccess: {
          Site: {
            findById: sinon.stub().resolves({ getId: () => 'site-123' }),
          },
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
            create: sinon.stub().resolves(mockOpportunity),
          },
          Suggestion: {
            allByOpportunityId: sinon.stub().resolves([]),
            bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
          },
        },
      };

      const result = await opportunityAndSuggestionsForElmo(auditUrl, auditData, fullMockContext);

      expect(result).to.deep.equal(auditData);
      expect(fullMockContext.log.info).to.have.been.calledWith(
        'Canonical opportunity created for Elmo with oppty id elmo-opportunity-123',
      );
      expect(fullMockContext.log.info).to.have.been.calledWith(
        'Canonical opportunity created for Elmo and 1 suggestions synced for https://example.com',
      );
    });

    it('should use comparisonFn to find existing opportunities with matching subtype', async () => {
      const auditData = {
        siteId: 'site-123',
        id: 'audit-123',
        auditResult: [
          {
            type: 'canonical-self-referenced',
            explanation: 'Test',
            affectedUrls: [{ url: 'https://example.com/page1' }],
          },
        ],
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: '## Test\n',
          },
        ],
      };

      // Create existing opportunities - one matching, one not
      const matchingOpportunity = {
        getId: sinon.stub().returns('existing-match-123'),
        getType: sinon.stub().returns('generic-opportunity'),
        getData: sinon.stub().returns({
          additionalMetrics: [
            { key: 'subtype', value: 'canonical' },
          ],
        }),
        getStatus: sinon.stub().returns('NEW'),
        setData: sinon.stub(),
        setAuditId: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
        getSuggestions: sinon.stub().resolves([]),
        addSuggestions: sinon.stub().resolves({ createdItems: [], errors: [] }),
      };

      const nonMatchingOpportunity = {
        getId: sinon.stub().returns('non-match-456'),
        getType: sinon.stub().returns('generic-opportunity'),
        getData: sinon.stub().returns({
          additionalMetrics: [
            { key: 'subtype', value: 'other' },
          ],
        }),
      };

      const fullMockContext = {
        ...mockContext,
        siteId: 'site-123',
        dataAccess: {
          Site: {
            findById: sinon.stub().resolves({ getId: () => 'site-123' }),
          },
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([matchingOpportunity, nonMatchingOpportunity]),
          },
          Suggestion: {
            allByOpportunityId: sinon.stub().resolves([]),
            bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
          },
        },
      };

      const result = await opportunityAndSuggestionsForElmo(auditUrl, auditData, fullMockContext);

      expect(result).to.deep.equal(auditData);
      expect(matchingOpportunity.setAuditId).to.have.been.calledWith('audit-123');
      expect(matchingOpportunity.save).to.have.been.called;
    });

    it('should handle comparisonFn with opportunity lacking additionalMetrics', async () => {
      const auditData = {
        siteId: 'site-123',
        id: 'audit-123',
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: '## Test\n',
          },
        ],
      };

      // Opportunity without additionalMetrics
      const opportunityNoMetrics = {
        getId: sinon.stub().returns('no-metrics-123'),
        getType: sinon.stub().returns('generic-opportunity'),
        getData: sinon.stub().returns({}),
      };

      // Opportunity with null additionalMetrics
      const opportunityNullMetrics = {
        getId: sinon.stub().returns('null-metrics-456'),
        getType: sinon.stub().returns('generic-opportunity'),
        getData: sinon.stub().returns({ additionalMetrics: null }),
      };

      const mockOpportunity = {
        getId: sinon.stub().returns('new-oppty-789'),
        getSuggestions: sinon.stub().resolves([]),
        setAuditId: sinon.stub(),
        save: sinon.stub().resolves(),
        addSuggestions: sinon.stub().resolves({ createdItems: [], errors: [] }),
      };

      const fullMockContext = {
        ...mockContext,
        siteId: 'site-123',
        dataAccess: {
          Site: {
            findById: sinon.stub().resolves({ getId: () => 'site-123' }),
          },
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([opportunityNoMetrics, opportunityNullMetrics]),
            create: sinon.stub().resolves(mockOpportunity),
          },
          Suggestion: {
            allByOpportunityId: sinon.stub().resolves([]),
            bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
          },
        },
      };

      const result = await opportunityAndSuggestionsForElmo(auditUrl, auditData, fullMockContext);

      expect(result).to.deep.equal(auditData);
      // Should have created a new opportunity since existing ones don't match
      expect(fullMockContext.dataAccess.Opportunity.create).to.have.been.called;
    });
  });
  */
  /* eslint-enable */

  describe('Multi-Step Audit Functions', () => {
    let context;
    let site;

    beforeEach(() => {
      context = {
        log: {
          info: sinon.stub(),
          error: sinon.stub(),
          warn: sinon.stub(),
          debug: sinon.stub(),
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub(),
          },
        },
        s3Client: {},
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        },
      };

      site = {
        getId: sinon.stub().returns('test-site-id'),
        getBaseURL: sinon.stub().returns('https://example.com'),
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('importTopPages', () => {
      it('should return initial audit status', async () => {
        const testContext = {
          ...context,
          site,
          finalUrl: 'https://example.com',
        };

        const result = await importTopPages(testContext);

        expect(result).to.deep.equal({
          type: 'top-pages',
          siteId: 'test-site-id',
          auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
          fullAuditRef: 'scrapes/test-site-id/',
        });
      });
    });

    describe('submitForScraping', () => {
      it('should return error when dataAccess is missing', async () => {
        const testContext = {
          site,
          log,
          finalUrl: 'https://example.com',
          dataAccess: undefined,
        };

        const result = await submitForScraping(testContext);

        expect(result).to.deep.equal({
          auditResult: {
            status: 'PROCESSING_FAILED',
            error: 'Missing SiteTopPage data access',
          },
          fullAuditRef: 'https://example.com',
        });
        expect(log.info).to.have.been.calledWith('[canonical] Missing SiteTopPage data access');
      });

      it('should return error when SiteTopPage is missing from dataAccess', async () => {
        const testContext = {
          site,
          log,
          finalUrl: 'https://example.com',
          dataAccess: {},
        };

        const result = await submitForScraping(testContext);

        expect(result).to.deep.equal({
          auditResult: {
            status: 'PROCESSING_FAILED',
            error: 'Missing SiteTopPage data access',
          },
          fullAuditRef: 'https://example.com',
        });
        expect(log.info).to.have.been.calledWith('[canonical] Missing SiteTopPage data access');
      });

      it('should submit top pages for scraping', async () => {
        context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
          { getUrl: () => 'https://example.com/page1' },
          { getUrl: () => 'https://example.com/page2' },
        ]);

        const testContext = {
          ...context,
          site,
          finalUrl: 'https://example.com',
        };

        const result = await submitForScraping(testContext);

        // SCRAPE_CLIENT steps should NOT return auditResult/fullAuditRef
        // These fields are only for final steps or immediate audit persistence
        expect(result).to.not.have.property('auditResult');
        expect(result).to.not.have.property('fullAuditRef');
        expect(result).to.have.property('urls');
        expect(result.urls).to.have.lengthOf(2);
        expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page1' });
        expect(result.urls[1]).to.deep.equal({ url: 'https://example.com/page2' });
        expect(result).to.have.property('siteId', 'test-site-id');
        expect(result).to.have.property('type', 'default');
        expect(result).to.have.property('allowCache', false);
        expect(result).to.have.property('maxScrapeAge', 0);
        expect(result.options).to.deep.equal({
          waitTimeoutForMetaTags: 5000,
        });
        // Start log was removed, check for filtering log instead
      expect(context.log.info).to.have.been.calledWith('[canonical] After filtering: 2 pages will be scraped - ["https://example.com/page1","https://example.com/page2"]');
      });

      it('should handle no top pages found', async () => {
        context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

        const testContext = {
          ...context,
          site,
          finalUrl: 'https://example.com',
        };

        const result = await submitForScraping(testContext);

        expect(result).to.deep.equal({
          auditResult: {
            status: 'NO_OPPORTUNITIES',
            message: 'No top pages found, skipping audit',
          },
          fullAuditRef: 'https://example.com',
        });
        expect(context.log.info).to.have.been.calledWith('[canonical] No top pages found for site test-site-id, skipping scraping');
      });

      it('should handle null top pages result', async () => {
        context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(null);

        const testContext = {
          ...context,
          site,
          finalUrl: 'https://example.com',
        };

        const result = await submitForScraping(testContext);

        expect(result).to.deep.equal({
          auditResult: {
            status: 'NO_OPPORTUNITIES',
            message: 'No top pages found, skipping audit',
          },
          fullAuditRef: 'https://example.com',
        });
        expect(context.log.info).to.have.been.calledWith('[canonical] No top pages found for site test-site-id, skipping scraping');
      });

      it('should filter out auth/login pages', async () => {
        context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
          { getUrl: () => 'https://example.com/page1' },
          { getUrl: () => 'https://example.com/login' },
          { getUrl: () => 'https://example.com/signin' },
          { getUrl: () => 'https://example.com/sign-in' },
          { getUrl: () => 'https://example.com/authenticate' },
          { getUrl: () => 'https://example.com/oauth/callback' },
          { getUrl: () => 'https://example.com/sso' },
          { getUrl: () => 'https://example.com/okta/loginwidget.html' },
          { getUrl: () => 'https://example.com/register' },
          { getUrl: () => 'https://example.com/signup' },
          { getUrl: () => 'https://example.com/install/activate/home.html' },
          { getUrl: () => 'https://example.com/auth' },
          { getUrl: () => 'https://example.com/auth/provider' },
        ]);

        const testContext = {
          ...context,
          site,
          finalUrl: 'https://example.com',
        };

        const result = await submitForScraping(testContext);

        expect(result.urls).to.have.lengthOf(1);
        expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page1' });
        // Auth page filtering logs were removed
      });

      it('should filter out PDF files', async () => {
        context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
          { getUrl: () => 'https://example.com/page1' },
          { getUrl: () => 'https://example.com/document.pdf' },
          { getUrl: () => 'https://example.com/files/guide.PDF' },
        ]);

        const testContext = {
          ...context,
          site,
          finalUrl: 'https://example.com',
        };

        const result = await submitForScraping(testContext);

        expect(result.urls).to.have.lengthOf(1);
        expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page1' });
        // PDF filtering logs were removed
      });

      it('should filter out both auth pages and PDFs', async () => {
        context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
          { getUrl: () => 'https://example.com/page1' },
          { getUrl: () => 'https://example.com/login' },
          { getUrl: () => 'https://example.com/document.pdf' },
          { getUrl: () => 'https://example.com/page2' },
        ]);

        const testContext = {
          ...context,
          site,
          finalUrl: 'https://example.com',
        };

        const result = await submitForScraping(testContext);

        expect(result.urls).to.have.lengthOf(2);
        expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page1' });
        expect(result.urls[1]).to.deep.equal({ url: 'https://example.com/page2' });
        // Auth page and PDF filtering logs were removed
      });

      it('should handle malformed URLs gracefully in filter functions', async () => {
        context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
          { getUrl: () => 'https://example.com/page1' },
          { getUrl: () => 'not-a-valid-url' },
          { getUrl: () => 'another-invalid-url' },
          { getUrl: () => 'https://example.com/page2' },
        ]);

        const testContext = {
          ...context,
          site,
          finalUrl: 'https://example.com',
        };

        const result = await submitForScraping(testContext);

        // Malformed URLs should not be filtered out (catch blocks return false)
        expect(result.urls).to.have.lengthOf(4);
        expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page1' });
        expect(result.urls[1]).to.deep.equal({ url: 'not-a-valid-url' });
        expect(result.urls[2]).to.deep.equal({ url: 'another-invalid-url' });
        expect(result.urls[3]).to.deep.equal({ url: 'https://example.com/page2' });
      });
    });

    /* REMOVED: validateCanonicalFromHTML tests - function deleted from handler.js
    describe('validateCanonicalFromHTML', () => {
      it('should validate canonical tag from HTML string', async () => {
        const html = '<html><head><link rel="canonical" href="https://example.com/page"></head></html>';
        const url = 'https://example.com/page';

        const result = await validateCanonicalFromHTML(url, html, log);

        expect(result).to.have.property('canonicalUrl', 'https://example.com/page');
        expect(result).to.have.property('checks');
        expect(result.checks).to.be.an('array');
      });

      it('should handle missing HTML content', async () => {
        const result = await validateCanonicalFromHTML('https://example.com', null, log);

        expect(result).to.deep.equal({
          canonicalUrl: null,
          checks: [],
        });
        expect(log.error).to.have.been.calledWith('No HTML content provided for URL: https://example.com');
      });

      it('should detect canonical tag in HEAD', async () => {
        const html = '<html><head><link rel="canonical" href="https://example.com/page"></head></html>';
        const url = 'https://example.com/page';

        const result = await validateCanonicalFromHTML(url, html, log);

        expect(result.checks).to.deep.include({
          check: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.check,
          success: true,
        });
      });

      it('should detect canonical tag outside HEAD', async () => {
        const html = '<html><head></head><body><link rel="canonical" href="https://example.com/page"></body></html>';
        const url = 'https://example.com/page';

        const result = await validateCanonicalFromHTML(url, html, log);

        expect(result.checks).to.deep.include({
          check: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.explanation,
        });
      });
    });
    // END validateCanonicalFromHTML tests */

    describe('processScrapedContent', () => {
      it('should return NO_OPPORTUNITIES when no scraped content found', async () => {
        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map(), // Empty Map = no scraped content
        };

        const result = await processScrapedContent(testContext);

        expect(result).to.deep.equal({
          auditResult: {
            status: 'NO_OPPORTUNITIES',
            message: 'No scraped content found',
          },
          fullAuditRef: 'https://example.com',
        });
        expect(context.log.info).to.have.been.calledWith('[canonical] No scrapeResultPaths found for site test-site-id');
      });

      it('should process scraped content and detect canonical issues', async function () {
        this.timeout(5000);
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1,
              href: 'https://example.com/other-page',
              inHead: true,
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href="https://example.com/other-page"></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
              create: sinon.stub().resolves({
                getId: () => 'test-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
              addSuggestions: sinon.stub().resolves({ createdItems: [] }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              createMany: sinon.stub().resolves([]),
              removeMany: sinon.stub().resolves([]),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(result.auditResult).to.be.an('array');
        expect(result.auditResult.length).to.be.greaterThan(0);
        expect(result.auditResult[0]).to.have.property('type', 'canonical-self-referenced');
        expect(result.auditResult[0]).to.have.property('affectedUrls');
        expect(result.auditResult[0].affectedUrls[0]).to.have.property('url', 'https://example.com/page1');
      });

      it('should include explanation in suggestion data when syncing suggestions', async function () {
        this.timeout(5000);
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1,
              href: 'https://example.com/other-page',
              inHead: true,
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href="https://example.com/other-page"></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);
        const addSuggestionsStub = sinon.stub().resolves({ createdItems: [] });

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
              create: sinon.stub().resolves({
                getId: () => 'test-oppty-id',
                getSiteId: () => 'test-site-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: addSuggestionsStub,
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              createMany: sinon.stub().resolves([]),
              removeMany: sinon.stub().resolves([]),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        await processScrapedContentMocked(testContext);

        // Verify that addSuggestions was called with suggestions containing explanation
        expect(addSuggestionsStub).to.have.been.called;
        const suggestionArg = addSuggestionsStub.getCall(0).args[0];
        expect(suggestionArg).to.be.an('array');
        expect(suggestionArg.length).to.be.greaterThan(0);
        
        // Check that at least one suggestion has explanation field
        const suggestionWithExplanation = suggestionArg.find((s) => s.data && s.data.explanation);
        expect(suggestionWithExplanation).to.exist;
        expect(suggestionWithExplanation.data.explanation).to.be.a('string');
        expect(suggestionWithExplanation.data.explanation).to.not.be.empty;
        expect(suggestionWithExplanation.data).to.have.property('checkType');
        expect(suggestionWithExplanation.data).to.have.property('url', 'https://example.com/page1');
        expect(suggestionWithExplanation.data).to.have.property('suggestion');
      });

      it('should return success when no canonical issues detected', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1,
              href: 'https://example.com/page1',
              inHead: true,
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href="https://example.com/page1"></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.deep.equal({
          fullAuditRef: 'https://example.com',
          auditResult: {
            status: 'success',
            message: 'No canonical issues detected',
          },
        });
      });

      it('should handle scraped content with exactly one canonical tag (success path)', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1, // Exactly 1 - should pass the CANONICAL_TAG_MULTIPLE check
              href: 'https://example.com/page1',
              inHead: true,
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href="https://example.com/page1"></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        // Should return success because canonical tag is valid
        expect(result.auditResult).to.deep.equal({
          status: 'success',
          message: 'No canonical issues detected',
        });
      });

      it('should handle error when processing scraped content fails', async () => {
        const mockGetObjectFromKey = sinon.stub().rejects(new Error('S3 fetch failed'));

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        // Should handle the error gracefully and skip the failed page
        expect(result).to.have.property('auditResult');
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/Error processing scraped content from.*S3 fetch failed/),
        );
      });

      it('should create Elmo opportunity with comparisonFn for matching subtype', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 2, // Multiple canonical tags - issue
              href: 'https://example.com/page1',
              inHead: true,
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href="https://example.com/page1"></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        // Mock existing opportunity with matching subtype
        const existingOpportunity = {
          getId: sinon.stub().returns('existing-oppty-id'),
          getType: sinon.stub().returns('generic-opportunity'),
          getData: sinon.stub().returns({
            additionalMetrics: [
              { key: 'subtype', value: 'canonical' },
            ],
          }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
          setAuditId: sinon.stub(),
          setUpdatedBy: sinon.stub(),
          save: sinon.stub().resolves(),
          getSuggestions: sinon.stub().resolves([]),
          addSuggestions: sinon.stub().resolves({ createdItems: [], errors: [] }),
        };

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([existingOpportunity]),
              create: sinon.stub().resolves({
                getId: () => 'test-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(existingOpportunity.setAuditId).to.have.been.calledWith('test-audit-id');
        expect(existingOpportunity.save).to.have.been.called;
      });

      it('should handle Elmo opportunity with missing additionalMetrics', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: false, // Missing canonical - issue
              count: 0,
              href: '',
              inHead: false,
            },
            rawBody: createValidRawBody('<html><head><title>Test</title></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        // Mock opportunities without additionalMetrics
        const opportunityNoMetrics = {
          getId: sinon.stub().returns('no-metrics-id'),
          getType: sinon.stub().returns('generic-opportunity'),
          getData: sinon.stub().returns({}), // No additionalMetrics
        };

        const opportunityNullMetrics = {
          getId: sinon.stub().returns('null-metrics-id'),
          getType: sinon.stub().returns('generic-opportunity'),
          getData: sinon.stub().returns({ additionalMetrics: null }), // Null additionalMetrics
        };

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([opportunityNoMetrics, opportunityNullMetrics]),
              create: sinon.stub().resolves({
                getId: () => 'new-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        // Should create a new opportunity since existing ones don't match
        expect(testContext.dataAccess.Opportunity.create).to.have.been.called;
      });

      it('should handle Elmo opportunity with non-array additionalMetrics', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1,
              href: '',  // Empty href - issue
              inHead: true,
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href=""></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        // Mock opportunity with non-array additionalMetrics
        const opportunityBadMetrics = {
          getId: sinon.stub().returns('bad-metrics-id'),
          getType: sinon.stub().returns('generic-opportunity'),
          getData: sinon.stub().returns({ additionalMetrics: 'not-an-array' }), // Not an array
        };

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([opportunityBadMetrics]),
              create: sinon.stub().resolves({
                getId: () => 'new-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        // Should create a new opportunity since existing one doesn't match (invalid metrics)
        expect(testContext.dataAccess.Opportunity.create).to.have.been.called;
      });

      it('should handle malformed canonical URL during normalization', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1,
              href: 'not-a-valid-url:::///malformed', // Malformed URL
              inHead: true,
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href="not-a-valid-url:::///malformed"></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
              create: sinon.stub().resolves({
                getId: () => 'test-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        // Should handle the malformed URL and still process (fallback to lowercase)
        expect(result).to.have.property('auditResult');
        expect(result.auditResult).to.be.an('array');
      });

      it('should detect canonical URL with whitespace only as empty', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1,
              href: '   ', // Whitespace only
              inHead: true,
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href="   "></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
              create: sinon.stub().resolves({
                getId: () => 'test-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(result.auditResult).to.be.an('array');
        // Should detect empty canonical
        const emptyCheck = result.auditResult.find((r) => r.type === 'canonical-tag-empty');
        expect(emptyCheck).to.exist;
        expect(emptyCheck.affectedUrls).to.have.length.greaterThan(0);
      });

      it('should handle scraped content with missing URL', async () => {
        const scrapedContent = {
          // No url field and no finalUrl
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: false,
              count: 0,
              href: '',
              inHead: false,
            },
            rawBody: createValidRawBody('<html><head></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
              create: sinon.stub().resolves({
                getId: () => 'test-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        // Should still process even with missing URL (uses key from map)
        expect(result).to.have.property('auditResult');
      });

      it('should handle canonical tag in head (success case)', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1,
              href: 'https://example.com/page1',
              inHead: true, // In head - should pass
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href="https://example.com/page1"></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        // Should return success because all checks pass
        expect(result.auditResult).to.deep.equal({
          status: 'success',
          message: 'No canonical issues detected',
        });
      });

      it('should detect canonical tag outside head', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1,
              href: 'https://example.com/page1',
              inHead: false, // Outside head - should fail this check
            },
            rawBody: createValidRawBody('<html><head></head><body><link rel="canonical" href="https://example.com/page1"><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
              create: sinon.stub().resolves({
                getId: () => 'test-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(result.auditResult).to.be.an('array');
        // Should detect canonical outside head
        const outsideHeadIssue = result.auditResult.find((r) => r.type === 'canonical-tag-outside-head');
        expect(outsideHeadIssue).to.exist;
        expect(outsideHeadIssue.affectedUrls).to.have.length.greaterThan(0);
      });

      it('should handle missing S3 bucket configuration', async () => {
        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          env: {}, // No S3_SCRAPE_BUCKET_NAME
        };

        const result = await processScrapedContent(testContext);

        expect(result).to.have.property('auditResult');
        expect(result.auditResult.status).to.equal('PROCESSING_FAILED');
        expect(result.auditResult.error).to.include('Missing S3 bucket configuration');
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/Missing S3 bucket configuration/),
        );
      });

      it('should handle missing canonical metadata in scraped content', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            // No canonical metadata
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(context.log.warn).to.have.been.calledWith(
          sinon.match(/No canonical metadata in S3 object/),
        );
      });

      it('should use url as fallback when finalUrl is missing', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          // No finalUrl property
          isPreview: false,
          scrapeResult: {
            canonical: {
              exists: true,
              count: 1,
              href: 'https://example.com/page1',
              inHead: true,
            },
            rawBody: createValidRawBody('<html><head><link rel="canonical" href="https://example.com/page1"></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(result.auditResult).to.deep.equal({
          status: 'success',
          message: 'No canonical issues detected',
        });
      });

      it('should skip pages that redirected to auth/login pages', async () => {
        const scrapedContent = {
          url: 'https://example.com/secure-page',
          finalUrl: 'https://example.com/login', // Redirected to login
          scrapeResult: {
            canonical: {
              exists: false,
              count: 0,
              href: null,
              inHead: false,
            },
            rawBody: createValidRawBody('<html><head><title>Login</title></head><body><p>Content for testing canonical URL validation.</p></body></html>'),
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/secure-page', 'scrapes/job-id/secure-page/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(result.auditResult).to.deep.equal({
          status: 'success',
          message: 'No canonical issues detected',
        });
        expect(context.log.info).to.have.been.calledWith(
          '[canonical] Skipping https://example.com/secure-page - redirected to auth page: https://example.com/login',
        );
      });

      it('should skip pages that redirected to PDF files', async () => {
        const scrapedContent = {
          url: 'https://example.com/document',
          finalUrl: 'https://example.com/files/document.pdf', // Redirected to PDF
          scrapeResult: {
            canonical: {
              exists: false,
              count: 0,
              href: null,
              inHead: false,
            },
            rawBody: createValidRawBody(''), // Empty string for PDF redirect test - will be padded to 300 chars
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/document', 'scrapes/job-id/document/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
            '../../src/common/opportunity-utils.js': {
              checkGoogleConnection: sinon.stub().resolves(false),
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(result.auditResult).to.deep.equal({
          status: 'success',
          message: 'No canonical issues detected',
        });
        expect(context.log.info).to.have.been.calledWith(
          '[canonical] Skipping https://example.com/document - redirected to PDF: https://example.com/files/document.pdf',
        );
      });

      it('should skip pages with empty rawBody (length < 300)', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            canonical: {
              exists: false,
              count: 0,
              href: null,
              inHead: false,
            },
            rawBody: '<body></body>', // Only 13 characters, should be skipped
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
              create: sinon.stub().resolves({
                getId: () => 'test-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(result.auditResult).to.deep.equal({
          status: 'success',
          message: 'No canonical issues detected',
        });
        // Verify line 390 is executed: log.warn with exact message including key and rawBody length
        expect(context.log.warn).to.have.been.calledOnce;
        expect(context.log.warn).to.have.been.calledWith(
          '[canonical] Scrape result is empty for scrapes/job-id/page1/scrape.json (rawBody length: 13)',
        );
      });

      it('should skip pages with rawBody length 0', async () => {
        const scrapedContent = {
          url: 'https://example.com/page1',
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            canonical: {
              exists: false,
              count: 0,
              href: null,
              inHead: false,
            },
            rawBody: '', // Empty string, length 0, should be skipped
          },
        };

        const mockGetObjectFromKey = sinon.stub().resolves(scrapedContent);

        const testContext = {
          ...context,
          site,
          s3Client: {},
          scrapeResultPaths: new Map([
            ['https://example.com/page1', 'scrapes/job-id/page1/scrape.json'],
          ]),
          audit: {
            getId: () => 'test-audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteId: sinon.stub().resolves([]),
              allBySiteIdAndStatus: sinon.stub().resolves([]),
              create: sinon.stub().resolves({
                getId: () => 'test-oppty-id',
                getSuggestions: sinon.stub().resolves([]),
                addSuggestions: sinon.stub().resolves({ createdItems: [] }),
              }),
            },
            Suggestion: {
              allByOpportunityId: sinon.stub().resolves([]),
              bulkCreate: sinon.stub().resolves({ createdItems: [], errors: [] }),
            },
          },
        };

        const { processScrapedContent: processScrapedContentMocked } = await esmock(
          '../../src/canonical/handler.js',
          {
            '../../src/utils/s3-utils.js': {
              getObjectFromKey: mockGetObjectFromKey,
            },
          },
        );

        const result = await processScrapedContentMocked(testContext);

        expect(result).to.have.property('auditResult');
        expect(result.auditResult).to.deep.equal({
          status: 'success',
          message: 'No canonical issues detected',
        });
        // Verify line 390 is executed: log.warn with exact message including key and rawBody length 0
        expect(context.log.warn).to.have.been.calledWith(
          '[canonical] Scrape result is empty for scrapes/job-id/page1/scrape.json (rawBody length: 0)',
        );
      });
    });
  });

  describe('Default Export - Canonical Audit Builder', () => {
    it('should export the built audit with all steps and post-processors', () => {
      expect(canonicalAudit).to.be.an('object');
      expect(canonicalAudit).to.have.property('steps');
      expect(canonicalAudit).to.have.property('stepNames');
      expect(canonicalAudit.stepNames).to.include('importTopPages');
      expect(canonicalAudit.stepNames).to.include('submitForScraping');
      expect(canonicalAudit.stepNames).to.include('processScrapedContent');
      expect(canonicalAudit).to.have.property('run');
      expect(canonicalAudit.run).to.be.a('function');
    });
  });
});
