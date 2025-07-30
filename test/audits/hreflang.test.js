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
import nock from 'nock';
import {
  validatePageHreflang,
  hreflangAuditRunner,
  HREFLANG_CHECKS,
} from '../../src/hreflang/handler.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

describe('Hreflang Audit', () => {
  const baseURL = 'https://example.com';
  let mockLog;
  let sandbox;

  before(() => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(() => {
    mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  describe('validatePageHreflang', () => {
    it('should pass validation for correct hreflang implementation', async () => {
      const html = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="https://example.com/en">
            <link rel="alternate" hreflang="es" href="https://example.com/es">
            <link rel="alternate" hreflang="x-default" href="https://example.com/">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // eslint-disable-next-line max-len
      const hasHreflangExists = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_EXISTS.check
        && check.success);
      expect(hasHreflangExists).to.be.true;
    });

    it('should detect missing hreflang tags', async () => {
      const html = '<html><head></head></html>';

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // eslint-disable-next-line max-len
      const missingHreflang = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_EXISTS.check
        && !check.success);
      expect(missingHreflang).to.be.true;
    });

    it('should detect invalid language codes', async () => {
      const html = `
        <html>
          <head>
            <link rel="alternate" hreflang="invalid-code" href="https://example.com/invalid">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // eslint-disable-next-line max-len
      const hasInvalidCode = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_CODE.check
        && !check.success);
      expect(hasInvalidCode).to.be.true;
    });

    it('should accept valid language codes', async () => {
      const html = `
        <html>
          <head>
            <link rel="alternate" hreflang="en-US" href="https://example.com/en-us">
            <link rel="alternate" hreflang="zh-Hans" href="https://example.com/zh-hans">
            <link rel="alternate" hreflang="x-default" href="https://example.com/">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // eslint-disable-next-line max-len
      const hasInvalidCode = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_CODE.check
        && !check.success);
      expect(hasInvalidCode).to.be.false;
    });

    it('should detect missing self-reference', async () => {
      const html = `
        <html>
          <head>
            <link rel="alternate" hreflang="es" href="https://example.com/es">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // eslint-disable-next-line max-len
      const missingSelfRef = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_SELF_REFERENCE_MISSING.check
        && !check.success);
      expect(missingSelfRef).to.be.true;
    });

    it('should pass when self-reference exists', async () => {
      const html = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="https://example.com/">
            <link rel="alternate" hreflang="es" href="https://example.com/es">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // eslint-disable-next-line max-len
      const missingSelfRef = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_SELF_REFERENCE_MISSING.check
        && !check.success);
      expect(missingSelfRef).to.be.false;
    });

    it('should detect hreflang tags outside head section', async () => {
      const html = `
        <html>
          <head></head>
          <body>
            <link rel="alternate" hreflang="en" href="https://example.com/en">
          </body>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // eslint-disable-next-line max-len
      const notInHead = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_NOT_IN_HEAD.check
        && !check.success);
      expect(notInHead).to.be.true;
    });

    it('should handle undefined URL', async () => {
      const result = await validatePageHreflang(null, mockLog);

      // eslint-disable-next-line max-len
      const urlUndefined = result.checks.some((check) => check.check === HREFLANG_CHECKS.URL_UNDEFINED.check
        && !check.success);
      expect(urlUndefined).to.be.true;
    });

    it('should handle fetch errors', async () => {
      nock(baseURL)
        .get('/')
        .replyWithError('Network error');

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // eslint-disable-next-line max-len
      const fetchError = result.checks.some((check) => check.check === HREFLANG_CHECKS.FETCH_ERROR.check
        && !check.success);
      expect(fetchError).to.be.true;
    });

    it('should handle empty href attributes', async () => {
      const html = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // Empty href resolves to the current URL, so self-reference should be found
      // eslint-disable-next-line max-len
      const missingSelfRef = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_SELF_REFERENCE_MISSING.check
        && !check.success);
      expect(missingSelfRef).to.be.false;

      // Should detect that hreflang exists (even with empty href)
      // eslint-disable-next-line max-len
      const hreflangExists = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_EXISTS.check
        && check.success);
      expect(hreflangExists).to.be.true;
    });

    it('should handle invalid hreflang URLs and log warnings', async () => {
      const invalidHref = 'http://\x00invalid';
      const html = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="${invalidHref}">
            <link rel="alternate" hreflang="es" href="https://example.com/es">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      // Should log warning for invalid URL with null character
      expect(mockLog.warn).to.have.been.calledWith(
        sinon.match(/Invalid hreflang URL/),
      );

      // Should still process the page and detect that hreflang exists
      // eslint-disable-next-line max-len
      const hreflangExists = result.checks.some((check) => check.check === HREFLANG_CHECKS.HREFLANG_EXISTS.check && check.success);
      expect(hreflangExists).to.be.true;
    });
  });

  describe('hreflangAuditRunner', () => {
    let site;
    let context;
    let mockDataAccess;

    beforeEach(() => {
      site = {
        getId: () => 'site-id',
        getBaseURL: () => baseURL,
      };

      mockDataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => `${baseURL}/` },
            { getUrl: () => `${baseURL}/about` },
          ]),
        },
      };

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          dataAccess: mockDataAccess,
        })
        .build();
    });

    it('should return success when no issues found', async () => {
      const htmlHome = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="https://example.com/">
            <link rel="alternate" hreflang="es" href="https://example.com/about">
          </head>
        </html>
      `;

      const htmlAbout = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="https://example.com/">
            <link rel="alternate" hreflang="es" href="https://example.com/about">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, htmlHome)
        .get('/about')
        .reply(200, htmlAbout);

      const result = await hreflangAuditRunner(baseURL, context, site);

      expect(result.auditResult.status).to.equal('success');
      expect(result.auditResult.message).to.include('No hreflang issues detected');
      expect(result.auditResult.pagesChecked).to.equal(2);
    });

    it('should handle no top pages', async () => {
      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const result = await hreflangAuditRunner(baseURL, context, site);

      expect(result.auditResult.check).to.equal(HREFLANG_CHECKS.TOPPAGES.check);
      expect(result.auditResult.success).to.be.false;
    });

    it('should limit to 200 pages as requested', async () => {
      const manyPages = Array.from({ length: 250 }, (_, i) => ({
        getUrl: () => `${baseURL}/page-${i}`,
      }));

      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyPages);

      // Mock all 200 page requests
      const scope = nock(baseURL);
      for (let i = 0; i < 200; i += 1) {
        scope.get(`/page-${i}`).reply(200, '<html><head></head></html>');
      }

      const result = await hreflangAuditRunner(baseURL, context, site);

      expect(result.auditResult.pagesChecked).to.equal(200);
    });

    it('should aggregate issues correctly', async () => {
      const htmlWithIssues = `
        <html>
          <head>
            <link rel="alternate" hreflang="invalid-code" href="https://example.com/invalid">
          </head>
        </html>
      `;

      const htmlNoHreflang = '<html><head></head></html>';

      nock(baseURL)
        .get('/')
        .reply(200, htmlWithIssues)
        .get('/about')
        .reply(200, htmlNoHreflang);

      const result = await hreflangAuditRunner(baseURL, context, site);

      // eslint-disable-next-line max-len
      expect(result.auditResult).to.have.property(HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_CODE.check);
      expect(result.auditResult).to.have.property(HREFLANG_CHECKS.HREFLANG_EXISTS.check);
      expect(result.auditResult[HREFLANG_CHECKS.HREFLANG_EXISTS.check].urls).to.include(`${baseURL}/about`);
    });

    it('should handle audit errors gracefully', async () => {
      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.rejects(new Error('Database error'));

      const result = await hreflangAuditRunner(baseURL, context, site);

      expect(result.auditResult.error).to.include('Database error');
      expect(result.auditResult.success).to.be.false;
    });

    it('should handle mixed successful and failed page requests', async () => {
      const successHtml = '<html><head><link rel="alternate" hreflang="en" href="https://example.com/"></head></html>';

      nock(baseURL)
        .get('/')
        .reply(200, successHtml)
        .get('/about')
        .replyWithError('Page not found');

      const result = await hreflangAuditRunner(baseURL, context, site);

      expect(result.auditResult).to.have.property(HREFLANG_CHECKS.FETCH_ERROR.check);
      expect(result.auditResult[HREFLANG_CHECKS.FETCH_ERROR.check].urls).to.include(`${baseURL}/about`);
    });

    it('should process exactly 200 pages when more are available', async () => {
      const manyPages = Array.from({ length: 300 }, (_, i) => ({
        getUrl: () => `${baseURL}/page-${i}`,
      }));

      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyPages);

      // Mock only 200 page requests (the limit)
      const scope = nock(baseURL);
      for (let i = 0; i < 200; i += 1) {
        scope.get(`/page-${i}`).reply(200, '<html><head></head></html>');
      }

      const result = await hreflangAuditRunner(baseURL, context, site);

      expect(result.auditResult.pagesChecked).to.equal(200);
      // Should not attempt to fetch page-200, page-201, etc.
      expect(scope.isDone()).to.be.true;
    });

    it('should handle empty HTML responses', async () => {
      nock(baseURL)
        .get('/')
        .reply(200, '')
        .get('/about')
        .reply(200, '');

      const result = await hreflangAuditRunner(baseURL, context, site);

      expect(result.auditResult).to.have.property(HREFLANG_CHECKS.HREFLANG_EXISTS.check);
      expect(result.auditResult[HREFLANG_CHECKS.HREFLANG_EXISTS.check].urls).to.have.length(2);
    });
  });
});
