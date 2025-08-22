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
  generateSuggestions,
  opportunityAndSuggestions,
  HREFLANG_CHECKS,
} from '../../src/hreflang/handler.js';
import { createOpportunityData } from '../../src/hreflang/opportunity-data-mapper.js';
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
      debug: sandbox.stub(),
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

      const hasHreflangExists = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_MISSING.check
        && check.success);
      expect(hasHreflangExists).to.be.true;
    });

    it('should detect missing hreflang tags', async () => {
      const html = '<html><head></head></html>';

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      const missingHreflang = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_MISSING.check
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

      const hasInvalidCode = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_CODE.check
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

      const hasInvalidCode = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_CODE.check
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

      const missingSelfRef = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_SELF_REFERENCE_MISSING.check
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

      const missingSelfRef = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_SELF_REFERENCE_MISSING.check
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

      const notInHead = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_OUTSIDE_HEAD.check
        && !check.success);
      expect(notInHead).to.be.true;
    });

    it('should handle undefined URL', async () => {
      const result = await validatePageHreflang(null, mockLog);

      const urlUndefined = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.URL_UNDEFINED.check
        && !check.success);
      expect(urlUndefined).to.be.true;
    });

    it('should handle fetch errors', async () => {
      nock(baseURL)
        .get('/')
        .replyWithError('Network error');

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      const fetchError = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.FETCH_ERROR.check
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

      const missingSelfRef = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_SELF_REFERENCE_MISSING.check
        && !check.success);
      expect(missingSelfRef).to.be.false;

      const hreflangExists = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_MISSING.check
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

      expect(mockLog.warn).to.have.been.calledWith(
        sinon.match(/Invalid hreflang URL/),
      );

      const hreflangExists = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_MISSING.check && check.success);
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

      expect(result.fullAuditRef).to.equal(baseURL);
      expect(scope.isDone()).to.be.true;
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

      expect(result.auditResult).to.have.property(
        HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_CODE.check,
      );
      expect(result.auditResult).to.have.property(HREFLANG_CHECKS.HREFLANG_MISSING.check);
      expect(result.auditResult[HREFLANG_CHECKS.HREFLANG_MISSING.check].urls).to.include(`${baseURL}/about`);
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

      expect(result.auditResult.status).to.equal('success');
      expect(result.auditResult.message).to.include('No hreflang issues detected');
    });

    it('should handle empty HTML responses', async () => {
      nock(baseURL)
        .get('/')
        .reply(200, '')
        .get('/about')
        .reply(200, '');

      const result = await hreflangAuditRunner(baseURL, context, site);

      expect(result.auditResult).to.have.property(HREFLANG_CHECKS.HREFLANG_MISSING.check);
      expect(result.auditResult[HREFLANG_CHECKS.HREFLANG_MISSING.check].urls).to.have.length(2);
    });
  });

  describe('createOpportunityData', () => {
    it('should return hreflang opportunity data with correct structure', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook', '');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Hreflang implementation issues affecting international SEO');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('steps').that.is.an('array');
      expect(result.guidance.steps).to.have.length.above(0);
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags).to.include('Traffic Acquisition');
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });
  });

  describe('generateSuggestions', () => {
    const auditUrl = 'https://example.com';
    let mockContext;
    // eslint-disable-next-line no-shadow
    let sandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockContext = new MockContextBuilder().withSandbox(sandbox).build();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should generate suggestions for hreflang issues', () => {
      const auditData = {
        auditResult: {
          'hreflang-missing': {
            success: false,
            explanation: 'No hreflang tags found',
            urls: ['https://example.com/page1', 'https://example.com/page2'],
          },
          'hreflang-invalid-language-code': {
            success: false,
            explanation: 'Invalid language code found',
            urls: ['https://example.com/page3'],
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result.suggestions).to.be.an('array');
      expect(result.suggestions).to.have.length(3);

      // Check first suggestion
      expect(result.suggestions[0]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'hreflang-missing',
        explanation: 'No hreflang tags found',
        url: 'https://example.com/page1',
        recommendedAction: 'Add hreflang tags to the <head> section to specify language and region targeting.',
      });

      // Check last suggestion
      expect(result.suggestions[2]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'hreflang-invalid-language-code',
        explanation: 'Invalid language code found',
        url: 'https://example.com/page3',
        recommendedAction: 'Update hreflang attribute to use valid ISO 639-1 language codes and ISO 3166-1 Alpha 2 country codes.',
      });
    });

    it('should skip suggestions generation when audit succeeded', () => {
      const auditData = {
        auditResult: {
          status: 'success',
          message: 'No hreflang issues detected',
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(result.suggestions).to.be.undefined;
      expect(mockContext.log.info).to.have.been.calledWith(
        'Hreflang audit for https://example.com has no issues or failed, skipping suggestions generation',
      );
    });

    it('should skip suggestions generation when audit failed with error', () => {
      const auditData = {
        auditResult: {
          error: 'Audit failed with error: Database error',
          success: false,
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(result.suggestions).to.be.undefined;
    });

    it('should generate suggestions for all check types', () => {
      const auditData = {
        auditResult: {
          'hreflang-missing': {
            success: false,
            explanation: 'No hreflang tags found',
            urls: ['https://example.com/page1'],
          },
          'hreflang-invalid-language-code': {
            success: false,
            explanation: 'Invalid language code found',
            urls: ['https://example.com/page2'],
          },
          'hreflang-self-reference-missing': {
            success: false,
            explanation: 'Missing self-referencing hreflang tag',
            urls: ['https://example.com/page3'],
          },
          'hreflang-outside-head': {
            success: false,
            explanation: 'Hreflang tags found outside the head section',
            urls: ['https://example.com/page4'],
          },
          'hreflang-fetch-error': {
            success: false,
            explanation: 'Error fetching the page content',
            urls: ['https://example.com/page5'],
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result.suggestions).to.have.length(5);

      const actions = result.suggestions.map((s) => s.recommendedAction);
      expect(actions).to.include('Add hreflang tags to the <head> section to specify language and region targeting.');
      expect(actions).to.include('Update hreflang attribute to use valid ISO 639-1 language codes and ISO 3166-1 Alpha 2 country codes.');
      expect(actions).to.include('Add a self-referencing hreflang tag that points to the current page with its own language/region.');
      expect(actions).to.include('Move hreflang tags from the body to the <head> section of the HTML document.');
      expect(actions).to.include('Ensure the page is accessible and fix any server or network issues preventing content retrieval.');
    });

    it('should return empty suggestions array when no failed checks', () => {
      const auditData = {
        auditResult: {
          'some-other-field': 'value',
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result.suggestions).to.be.an('array').that.is.empty;
    });

    it('should generate default recommended action for unknown check types', () => {
      const auditData = {
        auditResult: {
          'unknown-check-type': {
            success: false,
            explanation: 'Unknown issue found',
            urls: ['https://example.com/page1'],
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result.suggestions).to.have.length(1);
      expect(result.suggestions[0]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'unknown-check-type',
        explanation: 'Unknown issue found',
        url: 'https://example.com/page1',
        recommendedAction: 'Review and fix hreflang implementation according to international SEO best practices.',
      });
    });
  });

  describe('opportunityAndSuggestions', () => {
    const auditUrl = 'https://example.com';
    const mockContext = {
      log: {
        debug: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
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
      mockContext.log.debug.reset();
      mockContext.log.info.reset();
      mockContext.log.warn.reset();
      mockContext.log.error.reset();
      mockContext.dataAccess.Opportunity.allBySiteIdAndStatus.reset();
      mockContext.dataAccess.Opportunity.create.reset();
      mockContext.dataAccess.Opportunity.getSuggestions.reset();
      mockContext.dataAccess.Opportunity.addSuggestions.reset();
      mockContext.dataAccess.Suggestion.create.reset();
    });

    it('should skip opportunity creation when no suggestions', async () => {
      const auditData = {
        auditResult: {
          'hreflang-missing': {
            success: false,
            explanation: 'No hreflang tags found',
            urls: ['https://example.com/page1'],
          },
        },
        suggestions: [],
      };

      const result = await opportunityAndSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(mockContext.log.info).to.have.been.calledWith(
        'Hreflang audit has no issues, skipping opportunity creation',
      );
    });

    it('should create opportunity and sync suggestions when issues exist', async () => {
      const auditData = {
        siteId: 'site-123',
        auditResult: {
          'hreflang-missing': {
            success: false,
            explanation: 'No hreflang tags found',
            urls: ['https://example.com/page1'],
          },
        },
        suggestions: [
          {
            type: 'CODE_CHANGE',
            checkType: 'hreflang-missing',
            explanation: 'No hreflang tags found',
            url: 'https://example.com/page1',
            recommendedAction: 'Add hreflang tags to the <head> section',
          },
        ],
      };

      // Create a comprehensive mock context that allows the external functions to work
      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-123'),
        getSuggestions: sinon.stub().resolves([]),
        addSuggestions: sinon.stub().resolves({ createdItems: [], errors: [] }),
        save: sinon.stub().resolves(),
        getType: sinon.stub().returns('hreflang'),
        getStatus: sinon.stub().returns('NEW'),
        getData: sinon.stub().returns({}),
        setData: sinon.stub(),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub(),
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

      // Mock opportunity creation
      fullMockContext.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      fullMockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      const result = await opportunityAndSuggestions(auditUrl, auditData, fullMockContext);

      expect(result).to.deep.equal(auditData);
      expect(fullMockContext.log.info).to.have.been.calledWith(
        'Hreflang opportunity created and 1 suggestions synced for https://example.com',
      );
    });
  });
});
