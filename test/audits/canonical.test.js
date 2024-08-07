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
  validateCanonicalRecursively, canonicalAuditRunner,
} from '../../src/canonical/handler.js'; // Adjust the import path as necessary

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
    nock.cleanAll();
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
        explanation: 'The canonical tag is missing, which can lead to duplicate content issues and negatively affect SEO rankings.',
      });
      expect(log.info).to.have.been.called;
    });

    it('should handle fetch error', async () => {
      const url = 'http://example.com';
      nock('http://example.com').get('/').replyWithError('Test error');

      const result = await validateCanonicalTag(url, log);

      expect(result.canonicalUrl).to.be.null;
      expect(result.checks).to.deep.include({ check: 'canonical-url-fetch-error', success: false, explanation: 'There was an error fetching the canonical URL, which prevents validation of the canonical tag.' });
      // expect(log.error).to.have.been.calledWith('Error validating canonical tag for http://example.com: request to http://example.com/ failed, reason: Test error');
    });
  });

  describe('validateCanonicalUrlFormat', () => {
    it('should validate canonical URL format successfully', () => {
      const canonicalUrl = 'http://example.com/page';
      const baseUrl = 'http://example.com';

      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include({ check: 'canonical-url-absolute', success: true });
      expect(result).to.deep.include({ check: 'canonical-url-same-protocol', success: true });
      expect(result).to.deep.include({ check: 'canonical-url-same-domain', success: true });
      expect(result).to.deep.include({ check: 'canonical-url-lowercased', success: true });
    });

    it('should handle invalid canonical URL', () => {
      const canonicalUrl = 'invalid-url';
      const baseUrl = 'http://example.com';

      const result = validateCanonicalFormat(canonicalUrl, baseUrl, log);

      expect(result).to.deep.include({ check: 'url-defined', success: false, explanation: 'The URL is undefined or null, which prevents the canonical tag validation process.' });
      expect(log.error).to.have.been.calledWith('Invalid URL: invalid-url');
    });
  });

  describe('validateCanonicalUrlContentsRecursive', () => {
    it('should validate canonical URL contents successfully', async () => {
      const canonicalUrl = 'http://example.com/page';
      nock('http://example.com').get('/page').reply(200);

      const result = await validateCanonicalRecursively(canonicalUrl, log);

      expect(result).to.deep.include({ check: 'canonical-url-status-ok', success: true });
      expect(result).to.deep.include({ check: 'canonical-url-no-redirect', success: true });
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
  });
});
