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
  validateReciprocalHreflang,
  hreflangAuditRunner,
  generateSuggestions,
  opportunityAndSuggestions,
  opportunityAndSuggestionsForElmo,
  HREFLANG_CHECKS,
} from '../../src/hreflang/handler.js';
import { createOpportunityData, createOpportunityDataForElmo } from '../../src/hreflang/opportunity-data-mapper.js';
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

      expect(result.checks).to.be.an('array');
      expect(result.checks.length).to.equal(0);
    });

    it('should not flag missing hreflang tags as an issue', async () => {
      const html = '<html lang=""><head></head></html>';

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      expect(result.checks).to.be.an('array');
      expect(result.checks.length).to.equal(0);
    });

    it('should detect invalid language codes', async () => {
      const html = `
        <html lang="">
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
        === HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_TAG.check
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
        === HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_TAG.check
        && !check.success);
      expect(hasInvalidCode).to.be.false;
    });

    it('should detect missing x-default for international sites', async () => {
      const html = `
        <html lang="">
          <head>
            <link rel="alternate" hreflang="en" href="https://example.com/en">
            <link rel="alternate" hreflang="es" href="https://example.com/es">
            <link rel="alternate" hreflang="fr" href="https://example.com/fr">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      const missingXDefault = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_X_DEFAULT_MISSING.check
        && !check.success);
      expect(missingXDefault).to.be.true;
    });

    it('should pass when x-default exists for international sites', async () => {
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

      const missingXDefault = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_X_DEFAULT_MISSING.check
        && !check.success);
      expect(missingXDefault).to.be.false;
    });

    it('should not require x-default for single-language sites', async () => {
      const html = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="https://example.com/en">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/')
        .reply(200, html);

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      const missingXDefault = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_X_DEFAULT_MISSING.check
        && !check.success);
      expect(missingXDefault).to.be.false;
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

      expect(result.checks).to.be.an('array').that.is.empty;
      expect(result.url).to.be.null;
    });

    it('should handle fetch errors gracefully without reporting them as audit issues', async () => {
      nock(baseURL)
        .get('/')
        .replyWithError('Network error');

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      expect(result.checks).to.be.an('array');
      expect(result.checks).to.have.length(0);
    });

    it('should handle HTTP error responses gracefully (404, 500, etc.)', async () => {
      nock(baseURL)
        .get('/')
        .reply(404, 'Not Found');

      const result = await validatePageHreflang(`${baseURL}/`, mockLog);

      expect(result.checks).to.be.an('array');
      expect(result.checks).to.have.length(0);
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

      const missingXDefault = result.checks.some((check) => check.check
        === HREFLANG_CHECKS.HREFLANG_X_DEFAULT_MISSING.check
        && !check.success);
      expect(missingXDefault).to.be.false;
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

      // When hreflang tags exist, validation should proceed normally
      expect(result.checks).to.be.an('array');
    });

    describe('reciprocal validation', () => {
      it('should validate reciprocal hreflang links when checkReciprocal is true', async () => {
        const sourceUrl = 'https://example.com/en';
        const frenchUrl = 'https://example.com/fr';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="x-default" href="https://example.com/en">
            </head>
          </html>
        `;

        const frenchHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="x-default" href="https://example.com/en">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .reply(200, frenchHtml);

        const result = await validatePageHreflang(sourceUrl, mockLog, { checkReciprocal: true });

        expect(result.checks).to.be.an('array');
        expect(result.checks.length).to.equal(0); // No errors - proper reciprocal implementation
      });

      it('should detect missing reciprocal link', async () => {
        const sourceUrl = 'https://example.com/en';
        const frenchUrl = 'https://example.com/fr';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="x-default" href="https://example.com/en">
            </head>
          </html>
        `;

        // French page missing the reciprocal link back to English
        const frenchHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .reply(200, frenchHtml);

        const result = await validatePageHreflang(sourceUrl, mockLog, { checkReciprocal: true });

        const hasMissingReciprocal = result.checks.some((check) => check.check
          === HREFLANG_CHECKS.HREFLANG_MISSING_RECIPROCAL.check
          && !check.success);
        expect(hasMissingReciprocal).to.be.true;
      });

      it('should detect incomplete hreflang set', async () => {
        const sourceUrl = 'https://example.com/en';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="de" href="https://example.com/de">
              <link rel="alternate" hreflang="x-default" href="https://example.com/en">
            </head>
          </html>
        `;

        // French page missing German alternate
        const frenchHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="x-default" href="https://example.com/en">
            </head>
          </html>
        `;

        const germanHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="de" href="https://example.com/de">
              <link rel="alternate" hreflang="x-default" href="https://example.com/en">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .reply(200, frenchHtml)
          .get('/de')
          .reply(200, germanHtml);

        const result = await validatePageHreflang(sourceUrl, mockLog, { checkReciprocal: true });

        const hasIncompleteSet = result.checks.some((check) => check.check
          === HREFLANG_CHECKS.HREFLANG_INCOMPLETE_SET.check
          && !check.success);
        expect(hasIncompleteSet).to.be.true;
      });

      it('should handle fetch errors gracefully during reciprocal validation', async () => {
        const sourceUrl = 'https://example.com/en';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .replyWithError('Network error');

        const result = await validatePageHreflang(sourceUrl, mockLog, { checkReciprocal: true });

        // Should not throw error, just skip the failed page
        expect(result.checks).to.be.an('array');
      });

      it('should skip reciprocal validation when checkReciprocal is false', async () => {
        const sourceUrl = 'https://example.com/en';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml);
        // No mock for /fr - should not be called

        const result = await validatePageHreflang(sourceUrl, mockLog, { checkReciprocal: false });

        expect(result.checks).to.be.an('array');
        // Should not attempt to fetch French page
      });

      it('should skip reciprocal validation when no self-referencing hreflang exists', async () => {
        const sourceUrl = 'https://example.com/en';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="de" href="https://example.com/de">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml);

        const result = await validatePageHreflang(sourceUrl, mockLog, { checkReciprocal: true });

        expect(result.checks).to.be.an('array');
        // Should not perform reciprocal checks without self-reference
      });

      it('should handle HTTP 404 responses during reciprocal validation', async () => {
        const sourceUrl = 'https://example.com/en';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .reply(404, 'Not Found');

        const result = await validatePageHreflang(sourceUrl, mockLog, { checkReciprocal: true });

        // Should log warning but not report as audit issue
        expect(mockLog.warn).to.have.been.calledWith(
          sinon.match(/Failed to fetch/),
        );
        expect(result.checks).to.be.an('array');
      });

      it('should validate multiple alternate pages with proper concurrency control', async () => {
        const sourceUrl = 'https://example.com/en';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="de" href="https://example.com/de">
              <link rel="alternate" hreflang="es" href="https://example.com/es">
              <link rel="alternate" hreflang="x-default" href="https://example.com/en">
            </head>
          </html>
        `;

        const alternateHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="de" href="https://example.com/de">
              <link rel="alternate" hreflang="es" href="https://example.com/es">
              <link rel="alternate" hreflang="x-default" href="https://example.com/en">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .reply(200, alternateHtml)
          .get('/de')
          .reply(200, alternateHtml)
          .get('/es')
          .reply(200, alternateHtml);

        const result = await validatePageHreflang(sourceUrl, mockLog, {
          checkReciprocal: true,
          maxConcurrency: 2,
        });

        expect(result.checks).to.be.an('array');
        expect(result.checks.length).to.equal(0); // All alternates have proper reciprocal links
      });
    });

    describe('aggregation and deduplication', () => {
      it('should deduplicate URLs in aggregated results', async () => {
        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        // French page missing reciprocal link
        const frenchHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .reply(200, frenchHtml);

        const result = await validatePageHreflang('https://example.com/en', mockLog, {
          checkReciprocal: true,
        });

        // Should have checks with proper context
        const reciprocalChecks = result.checks.filter(
          (c) => c.check === HREFLANG_CHECKS.HREFLANG_MISSING_RECIPROCAL.check,
        );

        expect(reciprocalChecks.length).to.be.greaterThan(0);
        expect(reciprocalChecks[0]).to.have.property('alternateUrl');
        expect(reciprocalChecks[0]).to.have.property('sourceUrl');
        expect(reciprocalChecks[0]).to.have.property('sourceHreflang');
      });

      it('should handle pages with both missing reciprocal and incomplete set', async () => {
        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="de" href="https://example.com/de">
            </head>
          </html>
        `;

        // French page has reciprocal link but incomplete set (missing German)
        const frenchHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        const germanHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="de" href="https://example.com/de">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .reply(200, frenchHtml)
          .get('/de')
          .reply(200, germanHtml);

        const result = await validatePageHreflang('https://example.com/en', mockLog, {
          checkReciprocal: true,
        });

        // French page should have incomplete set error
        const incompleteChecks = result.checks.filter(
          (c) => c.check === HREFLANG_CHECKS.HREFLANG_INCOMPLETE_SET.check,
        );

        expect(incompleteChecks.some((c) => c.alternateUrl === 'https://example.com/fr')).to.be.true;
        
        // Verify it includes context about missing hreflangs
        const frenchCheck = incompleteChecks.find((c) => c.alternateUrl === 'https://example.com/fr');
        expect(frenchCheck.missingHreflangs).to.include('de');
      });
    });

    describe('context in error messages', () => {
      it('should include context information in reciprocal check failures', async () => {
        const sourceUrl = 'https://example.com/en';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        const frenchHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .reply(200, frenchHtml);

        const result = await validatePageHreflang(sourceUrl, mockLog, {
          checkReciprocal: true,
        });

        const reciprocalCheck = result.checks.find(
          (c) => c.check === HREFLANG_CHECKS.HREFLANG_MISSING_RECIPROCAL.check,
        );

        expect(reciprocalCheck).to.exist;
        expect(reciprocalCheck.sourceUrl).to.equal(sourceUrl);
        expect(reciprocalCheck.sourceHreflang).to.equal('en');
        expect(reciprocalCheck.alternateUrl).to.equal('https://example.com/fr');
        expect(reciprocalCheck.explanation).to.include('en');
      });

      it('should include missing hreflangs in incomplete set check', async () => {
        const sourceUrl = 'https://example.com/en';

        const sourceHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="de" href="https://example.com/de">
            </head>
          </html>
        `;

        // French page has reciprocal but missing German
        const frenchHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
            </head>
          </html>
        `;

        const germanHtml = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="https://example.com/en">
              <link rel="alternate" hreflang="fr" href="https://example.com/fr">
              <link rel="alternate" hreflang="de" href="https://example.com/de">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/en')
          .reply(200, sourceHtml)
          .get('/fr')
          .reply(200, frenchHtml)
          .get('/de')
          .reply(200, germanHtml);

        const result = await validatePageHreflang(sourceUrl, mockLog, {
          checkReciprocal: true,
        });

        const incompleteCheck = result.checks.find(
          (c) => c.check === HREFLANG_CHECKS.HREFLANG_INCOMPLETE_SET.check,
        );

        expect(incompleteCheck).to.exist;
        expect(incompleteCheck.missingHreflangs).to.be.an('array');
        expect(incompleteCheck.missingHreflangs).to.include('de');
      });
    });

    describe('edge cases for validateReciprocalHreflang', () => {
      it('should handle page with no hreflang links when checkReciprocal is true', async () => {
        const html = '<html><head></head></html>';

        nock('https://example.com')
          .get('/page')
          .reply(200, html);

        const result = await validatePageHreflang('https://example.com/page', mockLog, {
          checkReciprocal: true,
        });

        // Should have no reciprocal checks since there are no hreflang links
        const reciprocalChecks = result.checks.filter(
          (c) => c.check === HREFLANG_CHECKS.HREFLANG_MISSING_RECIPROCAL.check
            || c.check === HREFLANG_CHECKS.HREFLANG_INCOMPLETE_SET.check,
        );

        expect(reciprocalChecks).to.be.empty;
      });

      it('should handle invalid URLs in hreflang links gracefully', async () => {
        const html = `
          <html>
            <head>
              <link rel="alternate" hreflang="en" href="not-a-valid-url">
              <link rel="alternate" hreflang="fr" href="://invalid-scheme">
            </head>
          </html>
        `;

        nock('https://example.com')
          .get('/page')
          .reply(200, html);

        // Should not throw an error when processing invalid URLs
        const result = await validatePageHreflang('https://example.com/page', mockLog, {
          checkReciprocal: true,
        });

        // Should have a result with checks array
        expect(result).to.exist;
        expect(result.checks).to.be.an('array');
        
        // Invalid URLs are handled gracefully during URL parsing in extractHreflangLinks
        // They're converted to absolute URLs, and may result in unusual but valid URLs
        // The key is that it doesn't throw an error
        expect(result.url).to.equal('https://example.com/page');
      });
    });
  });

  describe('validateReciprocalHreflang', () => {
    it('should return empty checks when sourceHreflangLinks is null', async () => {
      const result = await validateReciprocalHreflang('https://example.com/page', null, mockLog);
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should return empty checks when sourceHreflangLinks is empty array', async () => {
      const result = await validateReciprocalHreflang('https://example.com/page', [], mockLog);
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should handle hreflang links with malformed URLs gracefully', async () => {
      // These invalid URLs will fail during URL parsing in the sourceHreflang detection
      const sourceHreflangLinks = [
        { hreflang: 'en', href: 'not a url at all' },
        { hreflang: 'fr', href: ':::invalid:::' },
      ];

      // Should not throw an error
      const result = await validateReciprocalHreflang(
        'https://example.com/page',
        sourceHreflangLinks,
        mockLog,
      );

      // Returns empty checks because no valid self-referencing hreflang was found
      expect(result).to.be.an('array').that.is.empty;
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
            <link rel="alternate" hreflang="x-default" href="https://example.com/">
          </head>
        </html>
      `;

      const htmlAbout = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="https://example.com/">
            <link rel="alternate" hreflang="es" href="https://example.com/about">
            <link rel="alternate" hreflang="x-default" href="https://example.com/">
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
        HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_TAG.check,
      );

      expect(result.auditResult).to.not.have.property('hreflang-missing');
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

      expect(result.auditResult.status).to.equal('success');
      expect(result.auditResult.message).to.include('No hreflang issues detected');
    });

    it('should deduplicate when same alternate URL fails from multiple source pages', async () => {
      // Both en and en-us pages reference fr page
      // fr page missing reciprocal links
      // Should only report fr page once
      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getUrl: () => `${baseURL}/en` },
        { getUrl: () => `${baseURL}/en-us` },
      ]);

      const enHtml = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="https://example.com/en">
            <link rel="alternate" hreflang="fr" href="https://example.com/fr">
          </head>
        </html>
      `;

      const enUsHtml = `
        <html>
          <head>
            <link rel="alternate" hreflang="en-US" href="https://example.com/en-us">
            <link rel="alternate" hreflang="fr" href="https://example.com/fr">
          </head>
        </html>
      `;

      // French page missing reciprocal links - will fail for both en and en-us
      const frHtml = `
        <html>
          <head>
            <link rel="alternate" hreflang="fr" href="https://example.com/fr">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/en')
        .reply(200, enHtml)
        .get('/en-us')
        .reply(200, enUsHtml)
        .get('/fr')
        .times(2) // Will be fetched twice (once from en, once from en-us)
        .reply(200, frHtml);

      const result = await hreflangAuditRunner(baseURL, context, site);

      // Should have reciprocal check failures
      const reciprocalCheck = result.auditResult[HREFLANG_CHECKS.HREFLANG_MISSING_RECIPROCAL.check];
      expect(reciprocalCheck).to.exist;
      expect(reciprocalCheck.success).to.be.false;

      // fr page should only appear ONCE in the URLs array (deduplicated)
      const frUrls = reciprocalCheck.urls.filter(
        (item) => (typeof item === 'string' ? item : item.url) === 'https://example.com/fr',
      );
      expect(frUrls.length).to.equal(1);
      
      // Verify the structure includes context
      expect(reciprocalCheck.urls[0]).to.have.property('url');
      expect(reciprocalCheck.urls[0]).to.have.property('context');
      expect(reciprocalCheck.urls[0].context).to.have.property('sourceUrl');
    });

    it('should handle aggregation with mixed reciprocal and non-reciprocal checks', async () => {
      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getUrl: () => `${baseURL}/page1` },
        { getUrl: () => `${baseURL}/page2` },
      ]);

      // Page 1: Invalid language code (non-reciprocal check)
      const page1Html = `
        <html>
          <head>
            <link rel="alternate" hreflang="invalid-lang" href="https://example.com/page1">
            <link rel="alternate" hreflang="en" href="https://example.com/en">
          </head>
        </html>
      `;

      // Page 2: Also has invalid language code
      const page2Html = `
        <html>
          <head>
            <link rel="alternate" hreflang="invalid-lang" href="https://example.com/page2">
            <link rel="alternate" hreflang="en" href="https://example.com/en">
          </head>
        </html>
      `;

      const enHtml = `
        <html>
          <head>
            <link rel="alternate" hreflang="en" href="https://example.com/en">
          </head>
        </html>
      `;

      nock(baseURL)
        .get('/page1')
        .reply(200, page1Html)
        .get('/page2')
        .reply(200, page2Html)
        .get('/en')
        .times(2)
        .reply(200, enHtml);

      const result = await hreflangAuditRunner(baseURL, context, site);

      // Should have invalid language tag errors
      const invalidLangCheck = result.auditResult[HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_TAG.check];
      expect(invalidLangCheck).to.exist;
      expect(invalidLangCheck.urls).to.be.an('array');
      expect(invalidLangCheck.urls.length).to.equal(2);
      
      // Non-reciprocal checks should store URLs as strings
      invalidLangCheck.urls.forEach((url) => {
        expect(typeof url).to.equal('string');
      });
    });
  });

  describe('createOpportunityData', () => {
    it('should return hreflang opportunity data with correct structure', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook', '');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'hreflang tag fixes ready to help reach the right audiences in every region');
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

  describe('createOpportunityDataForElmo', () => {
    it('should return hreflang opportunity data for Elmo with correct structure', () => {
      const result = createOpportunityDataForElmo();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook', '');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'hreflang tag fixes ready to help reach the right audiences in every region');
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
      expect(result.tags).to.include('llm');
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
      expect(result.data).to.have.property('additionalMetrics').that.is.an('array');
      expect(result.data.additionalMetrics).to.deep.include({
        value: 'hreflang',
        key: 'subtype',
      });
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
          'hreflang-invalid-language-tag': {
            success: false,
            explanation: 'Invalid language tag found',
            urls: ['https://example.com/page1', 'https://example.com/page2'],
          },
          'hreflang-x-default-missing': {
            success: false,
            explanation: 'Missing x-default hreflang tag',
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
        checkType: 'hreflang-invalid-language-tag',
        explanation: 'Invalid language tag found',
        url: 'https://example.com/page1',
        recommendedAction: 'Update hreflang attribute to use valid language tags (ISO 639-1 language codes and ISO 3166-1 Alpha 2 country codes).',
      });

      // Check last suggestion
      expect(result.suggestions[2]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'hreflang-x-default-missing',
        explanation: 'Missing x-default hreflang tag',
        url: 'https://example.com/page3',
        recommendedAction: 'Add x-default hreflang tag: <link rel="alternate" href="https://example.com/" hreflang="x-default" />',
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

    it('should generate suggestions with context for reciprocal check failures', () => {
      const auditData = {
        auditResult: {
          'hreflang-missing-reciprocal': {
            success: false,
            explanation: 'Missing reciprocal hreflang link',
            urls: [
              {
                url: 'https://example.com/fr',
                context: {
                  sourceUrl: 'https://example.com/en',
                  sourceHreflang: 'en',
                  alternateHreflang: 'fr',
                },
              },
            ],
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result.suggestions).to.be.an('array');
      expect(result.suggestions).to.have.length(1);
      expect(result.suggestions[0].url).to.equal('https://example.com/fr');
      expect(result.suggestions[0].context).to.exist;
      expect(result.suggestions[0].recommendedAction).to.include('https://example.com/en');
      expect(result.suggestions[0].recommendedAction).to.include('hreflang="en"');
    });

    it('should generate suggestions with context for incomplete set failures', () => {
      const auditData = {
        auditResult: {
          'hreflang-incomplete-set': {
            success: false,
            explanation: 'Incomplete hreflang set',
            urls: [
              {
                url: 'https://example.com/fr',
                context: {
                  sourceUrl: 'https://example.com/en',
                  missingHreflangs: ['de', 'es'],
                },
              },
            ],
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result.suggestions).to.be.an('array');
      expect(result.suggestions).to.have.length(1);
      expect(result.suggestions[0].recommendedAction).to.include('de, es');
    });

    it('should handle suggestions without context (backward compatibility)', () => {
      const auditData = {
        auditResult: {
          'hreflang-missing-reciprocal': {
            success: false,
            explanation: 'Missing reciprocal hreflang link',
            urls: ['https://example.com/fr'], // String URL without context
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result.suggestions).to.be.an('array');
      expect(result.suggestions).to.have.length(1);
      expect(result.suggestions[0].url).to.equal('https://example.com/fr');
      expect(result.suggestions[0].recommendedAction).to.include('Add reciprocal hreflang link');
    });

    it('should generate fallback recommendation for incomplete set without context', () => {
      const auditData = {
        auditResult: {
          'hreflang-incomplete-set': {
            success: false,
            explanation: 'Incomplete hreflang set',
            urls: [
              {
                url: 'https://example.com/fr',
                context: {}, // Context without missingHreflangs
              },
            ],
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result.suggestions).to.be.an('array');
      expect(result.suggestions).to.have.length(1);
      expect(result.suggestions[0].recommendedAction).to.include('complete set');
      expect(result.suggestions[0].recommendedAction).to.not.include('Add missing');
    });

    it('should generate suggestions for all check types', () => {
      const auditData = {
        auditResult: {
          'hreflang-invalid-language-tag': {
            success: false,
            explanation: 'Invalid language tag found',
            urls: ['https://example.com/page1'],
          },
          'hreflang-x-default-missing': {
            success: false,
            explanation: 'Missing x-default hreflang tag',
            urls: ['https://example.com/page2'],
          },
          'hreflang-outside-head': {
            success: false,
            explanation: 'Hreflang tags found outside the head section',
            urls: ['https://example.com/page3'],
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, mockContext);

      expect(result.suggestions).to.have.length(3);

      const actions = result.suggestions.map((s) => s.recommendedAction);
      expect(actions).to.include('Update hreflang attribute to use valid language tags (ISO 639-1 language codes and ISO 3166-1 Alpha 2 country codes).');
      expect(actions).to.include('Add x-default hreflang tag: <link rel="alternate" href="https://example.com/" hreflang="x-default" />');
      expect(actions).to.include('Move hreflang tags from the body to the <head> section of the HTML document.');
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
          'hreflang-invalid-language-tag': {
            success: false,
            explanation: 'Invalid language tag found',
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
          'hreflang-invalid-language-tag': {
            success: false,
            explanation: 'Invalid language tag found',
            urls: ['https://example.com/page1'],
          },
        },
        suggestions: [
          {
            type: 'CODE_CHANGE',
            checkType: 'hreflang-invalid-language-tag',
            explanation: 'Invalid language tag found',
            url: 'https://example.com/page1',
            recommendedAction: 'Update hreflang attribute to use valid language tags (ISO 639-1 language codes and ISO 3166-1 Alpha 2 country codes).',
          },
        ],
      };

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

  describe('opportunityAndSuggestionsForElmo', () => {
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

    it('should skip opportunity creation when no elmoSuggestions', async () => {
      const auditData = {
        auditResult: {
          'hreflang-invalid-language-tag': {
            success: false,
            explanation: 'Invalid language tag found',
            urls: ['https://example.com/page1'],
          },
        },
        elmoSuggestions: [],
      };

      const result = await opportunityAndSuggestionsForElmo(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(mockContext.log.info).to.have.been.calledWith(
        'Hreflang audit has no issues, skipping opportunity creation for Elmo',
      );
    });

    it('should create Elmo opportunity and sync suggestions when elmoSuggestions exist', async () => {
      const auditData = {
        siteId: 'site-123',
        id: 'audit-123',
        auditResult: {
          'hreflang-invalid-language-tag': {
            success: false,
            explanation: 'Invalid language tag found',
            urls: ['https://example.com/page1'],
          },
        },
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: '## Invalid Language Tag\n\n| Page Url | Explanation | Suggestion |\n|-------|-------|-------|\n| https://example.com/page1 | Invalid language tag found | Update hreflang attribute |\n',
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
            { key: 'subtype', value: 'hreflang' },
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
        'Hreflang opportunity created for Elmo with oppty id elmo-opportunity-123',
      );
      expect(fullMockContext.log.info).to.have.been.calledWith(
        'Hreflang opportunity created for Elmo and 1 suggestions synced for https://example.com',
      );
    });

    it('should use comparisonFn to find existing opportunities with matching subtype', async () => {
      const auditData = {
        siteId: 'site-123',
        id: 'audit-123',
        auditResult: {
          'hreflang-invalid-language-tag': {
            success: false,
            explanation: 'Invalid language tag found',
            urls: ['https://example.com/page1'],
          },
        },
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: '## Test\n\n| Page | Issue |\n',
          },
        ],
      };

      // Create existing opportunities - one matching, one not
      const matchingOpportunity = {
        getId: sinon.stub().returns('existing-match-123'),
        getType: sinon.stub().returns('generic-opportunity'),
        getData: sinon.stub().returns({
          additionalMetrics: [
            { key: 'subtype', value: 'hreflang' },
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
});
