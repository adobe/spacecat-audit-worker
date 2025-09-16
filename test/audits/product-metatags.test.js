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
import nock from 'nock';
import { productMetatagsAuditRunner } from '../../src/product-metatags/handler.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

describe('Product MetaTags Audit', () => {
  let context;

  beforeEach('setup', () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  describe('productMetatagsAuditRunner', () => {
    it('should extract SKU and thumbnail from meta tags', async () => {
      const baseURL = 'https://example.com/product';
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="sku" content="META-SKU-456">
          <meta property="og:image" content="https://www.example.com/meta-image.jpg">
        </head>
        <body>Product page</body>
        </html>
      `;

      nock('https://example.com')
        .get('/product')
        .reply(200, htmlContent);

      const result = await productMetatagsAuditRunner(baseURL, context);

      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result.auditResult).to.deep.equal({
        success: true,
        sku: 'META-SKU-456',
        thumbnailUrl: 'https://www.example.com/meta-image.jpg',
        extractionMethod: 'meta-tags',
      });
    });

    it('should try multiple image meta tags in order of preference', async () => {
      const baseURL = 'https://example.com/product';
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="sku" content="TEST-SKU">
          <meta name="thumbnail" content="https://www.example.com/thumbnail.jpg">
          <meta name="twitter:image" content="https://www.example.com/twitter.jpg">
          <meta property="og:image" content="https://www.example.com/og-image.jpg">
        </head>
        <body>Product page</body>
        </html>
      `;

      nock('https://example.com')
        .get('/product')
        .reply(200, htmlContent);

      const result = await productMetatagsAuditRunner(baseURL, context);

      // Should prefer og:image over other options
      expect(result.auditResult.thumbnailUrl).to.equal('https://www.example.com/og-image.jpg');
    });

    it('should handle missing data gracefully', async () => {
      const baseURL = 'https://example.com/product';
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Product without metadata</title>
        </head>
        <body>Just a regular page</body>
        </html>
      `;

      nock('https://example.com')
        .get('/product')
        .reply(200, htmlContent);

      const result = await productMetatagsAuditRunner(baseURL, context);

      expect(result.auditResult).to.deep.equal({
        success: true,
        sku: null,
        thumbnailUrl: null,
        extractionMethod: 'none',
      });
    });

    it('should handle HTTP errors gracefully', async () => {
      const baseURL = 'https://example.com/not-found';

      nock('https://example.com')
        .get('/not-found')
        .reply(404, 'Not Found');

      const result = await productMetatagsAuditRunner(baseURL, context);

      expect(result.auditResult).to.deep.equal({
        success: true,
        sku: null,
        thumbnailUrl: null,
        extractionMethod: null,
        error: 'HTTP 404: Not Found',
      });
    });

    it('should handle network errors gracefully', async () => {
      const baseURL = 'https://example.com/error';

      nock('https://example.com')
        .get('/error')
        .replyWithError('Network error');

      const result = await productMetatagsAuditRunner(baseURL, context);

      expect(result.auditResult).to.have.property('success', true);
      expect(result.auditResult).to.have.property('sku', null);
      expect(result.auditResult).to.have.property('thumbnailUrl', null);
      expect(result.auditResult).to.have.property('extractionMethod', null);
      expect(result.auditResult).to.have.property('error');
    });

    it('should handle pages with only SKU meta tag', async () => {
      const baseURL = 'https://example.com/product';
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="sku" content="SKU-ONLY-123">
        </head>
        <body>Product page</body>
        </html>
      `;

      nock('https://example.com')
        .get('/product')
        .reply(200, htmlContent);

      const result = await productMetatagsAuditRunner(baseURL, context);

      expect(result.auditResult.sku).to.equal('SKU-ONLY-123');
      expect(result.auditResult.thumbnailUrl).to.be.null;
      expect(result.auditResult.extractionMethod).to.equal('meta-tags');
    });

    it('should handle pages with only image meta tag', async () => {
      const baseURL = 'https://example.com/product';
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta property="og:image" content="https://www.example.com/image-only.jpg">
        </head>
        <body>Product page</body>
        </html>
      `;

      nock('https://example.com')
        .get('/product')
        .reply(200, htmlContent);

      const result = await productMetatagsAuditRunner(baseURL, context);

      expect(result.auditResult.sku).to.be.null;
      expect(result.auditResult.thumbnailUrl).to.equal('https://www.example.com/image-only.jpg');
      expect(result.auditResult.extractionMethod).to.equal('meta-tags');
    });

    it('should skip non-HTTP image URLs in meta tags', async () => {
      const baseURL = 'https://example.com/product';
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="sku" content="TEST-SKU">
          <meta property="og:image" content="/relative/path.jpg">
          <meta name="twitter:image" content="https://www.example.com/valid.jpg">
        </head>
        <body>Product page</body>
        </html>
      `;

      nock('https://example.com')
        .get('/product')
        .reply(200, htmlContent);

      const result = await productMetatagsAuditRunner(baseURL, context);

      // Should skip relative URL and use the HTTP URL
      expect(result.auditResult.thumbnailUrl).to.equal('https://www.example.com/valid.jpg');
    });
  });
});
