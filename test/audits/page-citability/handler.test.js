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
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Page Citability Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockPageCitability;
  let clock;
  let handler;
  let getObjectFromKeyStub;

  const baseURL = 'https://example.com';
  const siteId = 'test-site-id';
  const scraperBucket = 'test-scraper-bucket';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    
    clock = sinon.useFakeTimers({
      now: new Date('2025-01-15T10:00:00Z'),
      toFake: ['Date'],
    });

    getObjectFromKeyStub = sandbox.stub();

    handler = await esmock('../../../src/page-citability/handler.js', {
      '../../../src/utils/s3-utils.js': {
        getObjectFromKey: getObjectFromKeyStub,
      },
    });

    mockSite = {
      getSiteId: sandbox.stub().returns(siteId),
      getId: sandbox.stub().returns(siteId),
      getBaseURL: sandbox.stub().returns(baseURL),
    };

    mockAudit = {
      getFullAuditRef: sandbox.stub().returns(`${baseURL}/audit-ref`),
    };

    mockPageCitability = {
      allBySiteId: sandbox.stub().resolves([]),
      create: sandbox.stub().resolves(),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: mockSite,
        audit: mockAudit,
        finalUrl: baseURL,
        s3Client: {
          send: sandbox.stub().resolves(),
        },
        athenaClient: {
          query: sandbox.stub().resolves([]),
          execute: sandbox.stub().resolves(),
        },
        scrapeResultPaths: new Map(),
        env: { 
          S3_SCRAPER_BUCKET_NAME: scraperBucket,
          AWS_REGION: 'us-east-1',
        },
        dataAccess: { PageCitability: mockPageCitability },
        log: {
          info: sandbox.stub(),
          warn: sandbox.stub(),
          error: sandbox.stub(),
          debug: sandbox.stub(),
        },
      })
      .build();
  });

  afterEach(() => {
    clock.restore();
    sandbox.restore();
  });

  describe('Extract URLs Step', () => {
    it('should extract URLs from Athena and filter out existing citability scores', async () => {
      context.athenaClient.query.resolves([
        { url: '/page1', total_hits: 100 },
        { url: '/page2', total_hits: 80 },
        { url: '/page3', total_hits: 60 },
      ]);
      mockPageCitability.allBySiteId.resolves([
        { getUrl: () => '/page1' },
      ]);

      const result = await handler.steps['extract-urls'].handler(context);

      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls[0].url).to.equal(`${baseURL}/page2`);
      expect(result.urls[1].url).to.equal(`${baseURL}/page3`);
      expect(result.auditResult.urlCount).to.equal(2);
      expect(result.processingType).to.equal('page-citability');
      expect(result.siteId).to.equal(siteId);
      expect(result.fullAuditRef).to.equal(baseURL);
    });

    it('should handle dash path URLs correctly', async () => {
      context.athenaClient.query.resolves([
        { url: '-', total_hits: 100 },
        { url: '/page1', total_hits: 80 },
      ]);

      const result = await handler.steps['extract-urls'].handler(context);

      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls[0].url).to.equal(`${baseURL}/`);
      expect(result.urls[1].url).to.equal(`${baseURL}/page1`);
    });

    it('should return empty result when no URLs found or all URLs already analyzed', async () => {
      // Test no URLs found
      context.athenaClient.query.resolves([]);
      let result = await handler.steps['extract-urls'].handler(context);

      expect(result.auditResult.urlCount).to.equal(0);
      expect(result.urls).to.deep.equal([{ url: baseURL }]);
      expect(result.processingType).to.equal('page-citability');

      // Test all URLs already analyzed
      context.athenaClient.query.resolves([
        { url: '/page1', total_hits: 100 },
        { url: '/page2', total_hits: 80 },
      ]);
      mockPageCitability.allBySiteId.resolves([
        { getUrl: () => '/page1' },
        { getUrl: () => '/page2' },
      ]);

      result = await handler.steps['extract-urls'].handler(context);

      expect(result.auditResult.urlCount).to.equal(0);
      expect(result.urls).to.deep.equal([{ url: baseURL }]);
    });
  });

  describe('Analyze Citability Step', () => {
    it('should handle empty scrapeResultPaths', async () => {
      context.scrapeResultPaths = new Map();
      const result = await handler.steps['analyze-citability'].handler(context);

      expect(result.auditResult.successfulPages).to.equal(0);
      expect(result.auditResult.failedPages).to.equal(0);
      expect(result.fullAuditRef).to.equal(`${baseURL}/audit-ref`);
    });

    it('should process URLs successfully and create citability records', async () => {
      context.scrapeResultPaths = new Map([
        [`${baseURL}/page1`, 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        botView: { rawPage: '<html><body><p>Bot content with text</p></body></html>' },
        humanView: { rawPage: '<html><body><p>Human content with different text</p></body></html>' }
      });

      const result = await handler.steps['analyze-citability'].handler(context);

      expect(result.auditResult.successfulPages).to.equal(1);
      expect(result.auditResult.failedPages).to.equal(0);
      expect(result.fullAuditRef).to.equal(`${baseURL}/audit-ref`);
      expect(mockPageCitability.create).to.have.been.calledOnce;
      expect(mockPageCitability.create).to.have.been.calledWith(
        sinon.match({
          siteId: siteId,
          url: `${baseURL}/page1`,
          citabilityScore: sinon.match.number,
          contentRatio: sinon.match.number,
          wordDifference: sinon.match.number,
          botWords: sinon.match.number,
          normalWords: sinon.match.number,
        })
      );
    });

    it('should handle missing HTML content gracefully', async () => {
      context.scrapeResultPaths = new Map([
        [`${baseURL}/page1`, 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        botView: { rawPage: null },
        humanView: { rawPage: '<html><body><p>Human content</p></body></html>' }
      });

      const result = await handler.steps['analyze-citability'].handler(context);

      expect(result.auditResult.successfulPages).to.equal(0);
      expect(result.auditResult.failedPages).to.equal(1);
      expect(result.fullAuditRef).to.equal(`${baseURL}/audit-ref`);
      expect(mockPageCitability.create).to.not.have.been.called;
    });

    it('should handle error scenarios gracefully', async () => {
      context.scrapeResultPaths = new Map([
        [`${baseURL}/page1`, 's3-key-1'],
        [`${baseURL}/page2`, 's3-key-2'],
      ]);

      const result = await handler.steps['analyze-citability'].handler(context);

      expect(result.auditResult.successfulPages).to.equal(0);
      expect(result.auditResult.failedPages).to.equal(2);
      expect(result.fullAuditRef).to.equal(`${baseURL}/audit-ref`);
    });

    it('should process URLs in batches', async () => {
      const urls = Array.from({ length: 15 }, (_, i) => [
        `${baseURL}/page${i + 1}`,
        `s3-key-${i + 1}`,
      ]);
      context.scrapeResultPaths = new Map(urls);

      const result = await handler.steps['analyze-citability'].handler(context);

      expect(result.auditResult.successfulPages).to.equal(0);
      expect(result.auditResult.failedPages).to.equal(15);
    });
  });

  describe('Handler Export', () => {
    it('should export a valid audit handler with correct structure', () => {
      expect(handler).to.be.an('object');
      expect(handler).to.have.property('steps');
      expect(handler.steps).to.be.an('object');
      expect(Object.keys(handler.steps)).to.have.lengthOf(2);
      expect(handler.steps).to.have.property('extract-urls');
      expect(handler.steps).to.have.property('analyze-citability');
    });

    it('should have URL resolver configured', () => {
      expect(handler).to.have.property('urlResolver');
      expect(handler.urlResolver).to.be.a('function');
    });

    it('should have steps configured with correct handlers', () => {
      expect(handler.steps['extract-urls']).to.have.property('handler');
      expect(handler.steps['extract-urls'].handler).to.be.a('function');
      expect(handler.steps['analyze-citability']).to.have.property('handler');
      expect(handler.steps['analyze-citability'].handler).to.be.a('function');
    });
  });

  describe('Date handling', () => {
    it('should generate correct date filters for last 7 days', async () => {
      context.athenaClient.query.resolves([
        { url: '/page1', total_hits: 100 },
      ]);

      await handler.steps['extract-urls'].handler(context);

      expect(context.athenaClient.query).to.have.been.calledOnce;
      const [query] = context.athenaClient.query.firstCall.args;
      expect(query).to.include('year =');
      expect(query).to.include('month =');
      expect(query).to.include('day >=');
    });
  });
});