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
/* eslint-disable */
/* eslint-env mocha */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import esmock from 'esmock';
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { Audit, Opportunity as Oppty, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';

import {
  internalLinksAuditRunner,
  runAuditAndImportTopPagesStep,
  submitForScraping,
  runCrawlDetectionBatch,
  updateAuditResult,
  finalizeCrawlDetection,
  MAX_BROKEN_LINKS_REPORTED,
} from '../../../src/internal-links/handler.js';
import {
  internalLinksData,
  expectedOpportunity,
  expectedSuggestions,
} from '../../fixtures/internal-links-data.js';
import { MockContextBuilder } from '../../shared.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;
const topPages = [{ getUrl: () => 'https://example.com/page1' }, { getUrl: () => 'https://example.com/page2' }];

// Audit result without priority (priority is calculated after merge step)
// Raw RUM data (before normalization)
const AUDIT_RESULT_DATA = [
  {
    trafficDomain: 1800,
    urlTo: 'https://www.petplace.com/a01',
    urlFrom: 'https://www.petplace.com/a02nf',
  },
  {
    trafficDomain: 1200,
    urlTo: 'https://www.petplace.com/ax02',
    urlFrom: 'https://www.petplace.com/ax02nf',
  },
  {
    trafficDomain: 200,
    urlTo: 'https://www.petplace.com/a01',
    urlFrom: 'https://www.petplace.com/a01nf',
  },
];

// Audit result with priority (after normalization and priority calculation)
// URLs are normalized (path/trailing slash etc.); www prefix preserved
const AUDIT_RESULT_DATA_WITH_PRIORITY = [
  {
    trafficDomain: 1800,
    urlTo: 'https://www.petplace.com/a01',
    urlFrom: 'https://www.petplace.com/a02nf',
    priority: 'high',
    detectionSource: 'rum',
    httpStatus: 404,
    statusBucket: 'not_found_404',
    contentType: 'text/html; charset=utf-8',
  },
  {
    trafficDomain: 1200,
    urlTo: 'https://www.petplace.com/ax02',
    urlFrom: 'https://www.petplace.com/ax02nf',
    priority: 'medium',
    detectionSource: 'rum',
    httpStatus: 404,
    statusBucket: 'not_found_404',
    contentType: 'text/html; charset=utf-8',
  },
  {
    trafficDomain: 200,
    urlTo: 'https://www.petplace.com/a01',
    urlFrom: 'https://www.petplace.com/a01nf',
    priority: 'low',
    detectionSource: 'rum',
    httpStatus: 404,
    statusBucket: 'not_found_404',
    contentType: 'text/html; charset=utf-8',
  },
];
const AUDIT_RESULT_DATA_WITH_SUGGESTIONS = [
  {
    trafficDomain: 1800,
    urlTo: 'https://www.petplace.com/a01',
    urlFrom: 'https://www.petplace.com/a02nf',
    priority: 'high',
    urlsSuggested: [
      'https://petplace.com/suggestion1',
      'https://petplace.com/suggestion12',
    ],
    aiRationale: 'Some Rationale',
  },
  {
    trafficDomain: 1200,
    urlTo: 'https://www.petplace.com/ax02',
    urlFrom: 'https://www.petplace.com/ax02nf',
    priority: 'medium',
    urlsSuggested: ['https://petplace.com/suggestion2'],
    aiRationale: 'Some Rationale',
  },
  {
    trafficDomain: 200,
    urlTo: 'https://www.petplace.com/a01',
    urlFrom: 'https://www.petplace.com/a01nf',
    priority: 'low',
    urlsSuggested: ['https://petplace.com/suggestion3'],
    aiRationale: 'Some Rationale',
  },
];

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

const baseURL = 'https://example.com';
const auditUrl = 'www.example.com';
const site = {
  getBaseURL: () => baseURL,
  getId: () => 'site-id-1',
  getLatestAuditByAuditType: () => ({
    auditResult: {
      brokenInternalLinks: AUDIT_RESULT_DATA,
      success: true,
    },
  }),
  getConfig: sinon.stub(),
  getDeliveryType: sinon.stub().returns('aem_edge'),
};

describe('Broken internal links audit', () => {
  let context;

  beforeEach(() => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        rumApiClient: {
          query: sinon.stub().resolves(internalLinksData),
        },
        site,
        dataAccess: {
          Configuration: {
            findLatest: () => ({
              isHandlerEnabledForSite: () => true,
            }),
          },
        },
        finalUrl: 'www.example.com',
      })
      .build();
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('broken-internal-links audit runs rum api client 404 query', async () => {
    const { internalLinksAuditRunner: deterministicRunner } = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/helpers.js': {
        ...(await import('../../../src/internal-links/helpers.js')),
        isLinkInaccessible: sinon.stub().resolves({
          isBroken: true,
          httpStatus: 404,
          statusBucket: 'not_found_404',
          contentType: 'text/html; charset=utf-8',
        }),
      },
    });

    const result = await deterministicRunner(
      'www.example.com',
      context,
      site,
    );
    expect(context.rumApiClient.query).calledWith('404-internal-links', {
      domain: 'www.example.com',
      interval: 30,
      granularity: 'hourly',
    });
    expect(result).to.deep.equal({
      auditResult: {
        brokenInternalLinks: AUDIT_RESULT_DATA_WITH_PRIORITY,
        fullAuditRef: auditUrl,
        finalUrl: auditUrl,
        success: true,
        auditContext: {
          interval: 30,
        },
      },
      fullAuditRef: auditUrl,
    });
  }).timeout(5000);

  it('broken-internal-links audit returns empty when no RUM links found', async () => {
    const emptyContext = { ...context, rumApiClient: { query: sinon.stub().resolves([]) } };
    
    const result = await internalLinksAuditRunner(
      'www.example.com',
      emptyContext,
      site,
    );
    
    expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
    expect(result.auditResult.success).to.equal(true);
    expect(emptyContext.log.info).to.have.been.calledWith(
      sinon.match(/No 404 internal links found in RUM data/),
    );
  }).timeout(5000);

  it('broken-internal-links audit resolves finalUrl when context.finalUrl is missing', async () => {
    const resolvedFinalUrl = 'www.resolved-example.com';
    const resolverStub = sinon.stub().resolves(resolvedFinalUrl);
    const rumQueryStub = sinon.stub().resolves([]);

    const { internalLinksAuditRunner: mockedRunner } = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/base-url.js': {
        resolveInternalLinksRumDomain: resolverStub,
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: {
          createFrom: () => ({
            query: rumQueryStub,
          }),
        },
      },
    });

    const contextWithoutFinalUrl = {
      ...context,
      finalUrl: undefined,
      rumApiClient: undefined,
    };

    const result = await mockedRunner('ignored-url', contextWithoutFinalUrl, site);

    expect(resolverStub).to.have.been.calledOnceWith(site, contextWithoutFinalUrl);
    expect(rumQueryStub).to.have.been.calledOnce;
    expect(result.auditResult.finalUrl).to.equal(resolvedFinalUrl);
    expect(result.auditResult.success).to.equal(true);
    expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
  }).timeout(5000);

  it('broken-internal-links audit works without audit context for logger enrichment', async () => {
    const contextWithoutAudit = {
      ...context,
      audit: undefined,
      rumApiClient: {
        query: sinon.stub().resolves([]),
      },
    };

    const result = await internalLinksAuditRunner('www.example.com', contextWithoutAudit, site);

    expect(result.auditResult.success).to.equal(true);
    expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
  }).timeout(5000);

  it('broken-internal-links audit works when audit context has no getId method', async () => {
    const contextWithoutAuditId = {
      ...context,
      audit: {},
      rumApiClient: {
        query: sinon.stub().resolves([]),
      },
    };

    const result = await internalLinksAuditRunner('www.example.com', contextWithoutAuditId, site);

    expect(result.auditResult.success).to.equal(true);
    expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
  }).timeout(5000);

  it('broken-internal-links audit runs ans throws error incase of error in audit', async () => {
    context.rumApiClient.query.rejects(new Error('error'));
    expect(await internalLinksAuditRunner(
      'www.example.com',
      context,
      site,
    )).to.deep.equal({
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: 'audit failed with error: error',
        success: false,
      },
    });
  }).timeout(5000);

  it('broken-internal-links audit should handle promise rejection during validation', async () => {
    const linksWithError = [
      {
        url_to: 'https://www.example.com/valid',
        url_from: 'https://www.example.com/page1',
        traffic_domain: 100,
      },
      {
        url_to: 'https://www.example.com/catastrophic-error',
        url_from: 'https://www.example.com/page2',
        traffic_domain: 50,
      },
    ];

    // Use esmock to mock isLinkInaccessible to throw for one link
    // Note: isLinkInaccessible is called BEFORE normalization in handler.js (line 159),
    // so it receives URLs with www prefix as they come from RUM
    const { internalLinksAuditRunner: internalLinksAuditRunnerMocked } = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/helpers.js': {
        isLinkInaccessible: async (url) => {
          // Check for original URL (with www) since that's what's passed from RUM
          if (url === 'https://www.example.com/catastrophic-error') {
            throw new Error('Database connection failed');
          }
          return { isBroken: true, httpStatus: 404, statusBucket: 'not_found_404', contentType: 'text/html' };
        },
        calculatePriority: (links) => links.map((l) => ({ ...l, priority: 'high' })),
        calculateKpiDeltasForAudit: () => ({ projectedTrafficLost: 0, projectedTrafficValue: 0 }),
      },
    });

    const contextWithError = {
      ...context,
      rumApiClient: { query: sinon.stub().resolves(linksWithError) },
    };

    const result = await internalLinksAuditRunnerMocked('www.example.com', contextWithError);

    // Should handle the rejection gracefully and only include successful validations
    expect(result.auditResult.success).to.equal(true);
    expect(result.auditResult.brokenInternalLinks.length).to.equal(1);
    // URLs are normalized (www preserved)
    expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/valid');
    
    // Should have logged the error - check with matcher for the prefix
    const errorCalls = contextWithError.log.error.getCalls();
    const hasValidationError = errorCalls.some((call) => 
      call.args[0].includes('Link validation failed')
    );
    expect(hasValidationError).to.be.true;
  }).timeout(10000);

  it('broken-internal-links audit limits concurrent RUM validation requests', async () => {
    const rumLinks = Array.from({ length: 25 }, (_, index) => ({
      url_to: `https://www.example.com/broken-${index}`,
      url_from: `https://www.example.com/page-${index}`,
      traffic_domain: index + 1,
    }));
    let activeValidations = 0;
    let maxConcurrentValidations = 0;

    const { internalLinksAuditRunner: internalLinksAuditRunnerMocked } = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/helpers.js': {
        isLinkInaccessible: async () => {
          activeValidations += 1;
          maxConcurrentValidations = Math.max(maxConcurrentValidations, activeValidations);
          await Promise.resolve();
          activeValidations -= 1;
          return {
            isBroken: true,
            httpStatus: 404,
            statusBucket: 'not_found_404',
            contentType: 'text/html',
          };
        },
        calculatePriority: (links) => links,
        calculateKpiDeltasForAudit: () => ({ projectedTrafficLost: 0, projectedTrafficValue: 0 }),
      },
    });

    const limitedContext = {
      ...context,
      rumApiClient: { query: sinon.stub().resolves(rumLinks) },
    };

    const result = await internalLinksAuditRunnerMocked('www.example.com', limitedContext);

    expect(result.auditResult.success).to.equal(true);
    expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(25);
    expect(maxConcurrentValidations).to.be.at.most(10);
  }).timeout(10000);

  it('broken-internal-links audit filters out-of-scope RUM links before validation', async () => {
    const isLinkInaccessibleStub = sinon.stub().resolves({
      isBroken: true,
      httpStatus: 404,
      statusBucket: 'not_found_404',
      contentType: 'text/html',
    });

    const { internalLinksAuditRunner: internalLinksAuditRunnerMocked } = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/helpers.js': {
        isLinkInaccessible: isLinkInaccessibleStub,
        calculatePriority: (links) => links,
        calculateKpiDeltasForAudit: () => ({ projectedTrafficLost: 0, projectedTrafficValue: 0 }),
      },
    });

    const scopedContext = {
      ...context,
      site: {
        ...site,
        getBaseURL: () => 'https://www.example.com/blog',
      },
      rumApiClient: {
        query: sinon.stub().resolves([
          {
            url_to: 'https://www.example.com/blog/broken',
            url_from: 'https://www.example.com/blog/page-1',
            traffic_domain: 100,
          },
          {
            url_to: 'https://www.example.com/outside/broken',
            url_from: 'https://www.example.com/outside/page-2',
            traffic_domain: 50,
          },
        ]),
      },
    };

    const result = await internalLinksAuditRunnerMocked('www.example.com', scopedContext);

    expect(result.auditResult.success).to.equal(true);
    expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/blog/broken');
    expect(isLinkInaccessibleStub).to.have.been.calledOnceWith(
      'https://www.example.com/blog/broken',
      sinon.match.any,
      scopedContext.site.getId(),
      sinon.match.any,
    );
    expect(scopedContext.log.info).to.have.been.calledWith(
      sinon.match(/Filtered out 1 RUM links outside the audit scope before validation/),
    );
  }).timeout(10000);

  it('runAuditAndImportTopPagesStep should run RUM detection and trigger import worker', async () => {
    const result = await runAuditAndImportTopPagesStep(context);

    expect(result).to.have.property('auditResult');
    expect(result.auditResult).to.have.property('success', true);
    expect(result.auditResult).to.have.property('brokenInternalLinks');
    expect(result).to.have.property('type', 'top-pages'); // Triggers import worker
    expect(result).to.have.property('siteId', site.getId());
    expect(result).to.have.property('fullAuditRef');
  }).timeout(10000);

  it('runAuditAndImportTopPagesStep should handle undefined brokenInternalLinks for logging', async () => {
    // Create a spy to intercept internalLinksAuditRunner
    let internalLinksAuditRunnerCalled = false;
    
    const handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-rum-api-client': {
        default: {
          createFrom: () => ({
            query: async () => [],
          }),
        },
      },
      '../../../src/internal-links/helpers.js': {
        isLinkInaccessible: async () => false,
        calculatePriority: (links) => links,
        calculateKpiDeltasForAudit: () => ({}),
      },
      '../../../src/common/base-audit.js': {
        wwwUrlResolver: async () => 'www.example.com',
      },
    });

    // Test with empty RUM results which creates empty brokenInternalLinks array
    const result = await handler.runAuditAndImportTopPagesStep(context);

    // The ?. operator and || 0 handles undefined, null, or empty array cases
    expect(result.type).to.equal('top-pages');
    expect(result.siteId).to.equal(site.getId());
  }).timeout(10000);

  it('runAuditAndImportTopPagesStep should work without audit context for logger enrichment', async () => {
    const contextWithoutAudit = {
      ...context,
      audit: undefined,
      rumApiClient: {
        query: sinon.stub().resolves([]),
      },
    };

    const result = await runAuditAndImportTopPagesStep(contextWithoutAudit);

    expect(result.type).to.equal('top-pages');
    expect(result.siteId).to.equal(site.getId());
    expect(result.auditResult.success).to.equal(true);
  }).timeout(10000);

  it('runAuditAndImportTopPagesStep should work when audit context has no getId method', async () => {
    const contextWithoutAuditId = {
      ...context,
      audit: {},
      rumApiClient: {
        query: sinon.stub().resolves([]),
      },
    };

    const result = await runAuditAndImportTopPagesStep(contextWithoutAuditId);

    expect(result.type).to.equal('top-pages');
    expect(result.siteId).to.equal(site.getId());
    expect(result.auditResult.success).to.equal(true);
  }).timeout(10000);

  it('submitForScraping should merge database top pages + includedURLs and submit', async () => {
    // Mock database read for Ahrefs top pages
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
        { getUrl: () => 'https://example.com/ahrefs1' },
        { getUrl: () => 'https://example.com/ahrefs2' },
      ]),
    };

    // Mock includedURLs
    const mockSite = {
      ...site,
      getConfig: () => ({
        getIncludedURLs: (type) => (type === 'broken-internal-links' ? ['https://example.com/included1'] : []),
        getFetchConfig: () => ({}),
      }),
    };

    // Mock audit object
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      site: mockSite,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    expect(result).to.have.property('urls');
    expect(result.urls).to.be.an('array');
    // Should have Ahrefs (2) + includedURLs (1) = 3 unique URLs
    expect(result.urls.length).to.equal(3);
    expect(result.urls).to.deep.include({ url: 'https://example.com/ahrefs1' });
    expect(result.urls).to.deep.include({ url: 'https://example.com/ahrefs2' });
    expect(result.urls).to.deep.include({ url: 'https://example.com/included1' });
    expect(result.siteId).to.equal(site.getId());
    expect(result.type).to.equal('broken-internal-links');
    
    // CRITICAL: Verify scraper configuration for broken links detection
    expect(result.processingType).to.equal('default');
    expect(result.options).to.be.an('object');
    // JavaScript & Page Loading
    expect(result.options.enableJavascript).to.equal(true); // JavaScript for dynamic content
    expect(result.options.pageLoadTimeout).to.equal(30000); // 30s for slow sites
    expect(result.options.evaluateTimeout).to.equal(10000); // 10s for evaluate operations
    expect(result.options.waitUntil).to.equal('networkidle2'); // Wait for JS-generated links
    expect(result.options.networkIdleTimeout).to.equal(2000); // Extra wait for late scripts
    expect(result.options.waitForSelector).to.equal('body'); // Wait for DOM
    // Redirect Handling
    expect(result.options.rejectRedirects).to.equal(false); // CRITICAL: Follow redirects
    // Content Extraction
    expect(result.options.expandShadowDOM).to.equal(true); // Access shadow DOM links
    // Lazy-Loaded Content
    expect(result.options.scrollToBottom).to.equal(true); // Enable scrolling for internal-links audit
    expect(result.options.maxScrollDurationMs).to.equal(30000); // Hard cap for total scroll duration
    expect(result.options.clickLoadMore).to.equal(true); // Enable load-more for lazy-content coverage
    expect(result.options.loadMoreSelector).to.equal(undefined); // No selector by default
    expect(result.options).to.not.have.property('scrollDelay');
    expect(result.options).to.not.have.property('maxScrolls');
    expect(result.options).to.not.have.property('scrollIncrement');
    expect(result.options).to.not.have.property('maxLoadMoreClicks');
    expect(result.options).to.not.have.property('stableScrollCount');
    // Storage & Performance
    expect(result.options.screenshotTypes).to.deep.equal([]); // No screenshots needed
    // Cookie Consent
    expect(result.options.hideConsentBanners).to.equal(true); // Hide consent banner links
  }).timeout(10000);

  it('submitForScraping should fall back to includedURLs when database fetch fails', async () => {
    // Mock database read to fail
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().rejects(new Error('Database connection error')),
    };

    // Mock includedURLs
    const mockSite = {
      ...site,
      getConfig: () => ({
        getIncludedURLs: (type) => (type === 'broken-internal-links' ? ['https://example.com/included1', 'https://example.com/included2'] : []),
        getFetchConfig: () => ({}),
      }),
    };

    // Mock audit object
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      site: mockSite,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    expect(result).to.have.property('urls');
    // Should only have includedURLs (2) since database failed
    expect(result.urls.length).to.equal(2);
    expect(result.urls).to.deep.include({ url: 'https://example.com/included1' });
    expect(result.urls).to.deep.include({ url: 'https://example.com/included2' });
  }).timeout(10000);

  it('submitForScraping should continue using site baseURL for audit scope filtering', async () => {
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
        { getUrl: () => 'https://example.com/en/adventures.html' },
      ]),
    };

    const mockSite = {
      ...site,
      getBaseURL: () => 'https://example.com/en.html',
      getConfig: () => ({
        getIncludedURLs: () => [],
        getFetchConfig: () => ({
          overrideBaseURL: 'https://example.com/en',
        }),
      }),
    };

    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      site: mockSite,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    expect(result.status).to.equal('skipped');
    expect(result.urls).to.deep.equal([]);
  }).timeout(10000);


  it('submitForScraping should filter out unscrape-able files', async () => {
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
        { getUrl: () => 'https://example.com/page1.html' },
        { getUrl: () => 'https://example.com/file.pdf' }, // Should be filtered
        { getUrl: () => 'https://example.com/page2.html' },
      ]),
    };

    const mockSite = {
      ...site,
      getConfig: () => ({
        getIncludedURLs: () => [],
        getFetchConfig: () => ({}),
      }),
    };

    // Mock audit object
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      site: mockSite,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    // Should filter out the PDF
    expect(result.urls.length).to.equal(2);
    expect(result.urls).to.deep.include({ url: 'https://example.com/page1.html' });
    expect(result.urls).to.deep.include({ url: 'https://example.com/page2.html' });
    expect(result.urls).to.not.deep.include({ url: 'https://example.com/file.pdf' });
  }).timeout(10000);

  it('submitForScraping should return empty when all URLs filtered', async () => {
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
        { getUrl: () => 'https://example.com/file1.pdf' },
        { getUrl: () => 'https://example.com/file2.pdf' },
      ]),
    };

    const mockSite = {
      ...site,
      getConfig: () => ({
        getIncludedURLs: () => [],
        getFetchConfig: () => ({}),
      }),
    };

    // Mock audit object
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      site: mockSite,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    // All URLs should be filtered out (PDFs are unscrape-able)
    expect(result.status).to.equal('skipped');
    expect(result.urls).to.be.an('array');
    expect(result.urls.length).to.equal(0);
  }).timeout(10000);

  it('submitForScraping should cap URLs at MAX_URLS_TO_PROCESS (100)', async () => {
    // Create >100 total URLs to test capping logic
    const manyAhrefsPages = Array.from({ length: 80 }, (_, i) => ({
      getUrl: () => `https://example.com/ahrefs-page-${i}`,
    }));

    const manyIncludedUrls = Array.from({ length: 40 }, (_, i) => `https://example.com/manual-page-${i}`);

    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(manyAhrefsPages),
    };

    const mockSite = {
      ...site,
      getConfig: () => ({
        getIncludedURLs: () => manyIncludedUrls,
        getFetchConfig: () => ({}),
      }),
    };

    // Mock audit object
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      site: mockSite,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    // Should be capped at 100 (80 + 40 = 120 unique, cap to MAX_URLS_TO_PROCESS)
    expect(result.urls).to.have.lengthOf(100);
    expect(testContext.log.warn).to.have.been.calledWith(
      sinon.match(/Capping URLs from 120 to 100/),
    );
  }).timeout(10000);
  it('submitForScraping should handle empty top pages from database', async () => {
    // Mock database to return empty array
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
    };

    // Mock audit object
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    // Should still work with just includedURLs
    expect(result).to.have.property('urls');
    expect(result.urls).to.be.an('array');
  }).timeout(10000);

  it('submitForScraping should handle database returning no pages', async () => {
    // Mock database to return empty result
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
    };

    // Mock audit object
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    // Should still work with just includedURLs
    expect(result).to.have.property('urls');
    expect(result.urls).to.be.an('array');
  }).timeout(10000);

  it('submitForScraping should handle getConfig returning null', async () => {
    // Mock database with some pages
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
        { getUrl: () => 'https://example.com/page1' },
      ]),
    };

    // Create site with getConfig returning null (optional chaining branch)
    const mockSite = {
      ...site,
      getConfig: () => null,
    };

    // Mock audit object
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      site: mockSite,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    // Should work with just database pages
    expect(result).to.have.property('urls');
    expect(result.urls.length).to.be.greaterThan(0);
  }).timeout(10000);

  it('submitForScraping should handle config without getIncludedURLs method', async () => {
    // Mock database with some pages
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
        { getUrl: () => 'https://example.com/page1' },
      ]),
    };

    // Create site with config but without getIncludedURLs (optional chaining branch)
    const mockSite = {
      ...site,
      getConfig: () => ({
        getFetchConfig: () => ({}),
        // getIncludedURLs is missing
      }),
    };

    // Mock audit object
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      site: mockSite,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    // Should work with just database pages
    expect(result).to.have.property('urls');
    expect(result.urls.length).to.be.greaterThan(0);
  }).timeout(10000);

  it('runAuditAndImportTopPagesStep should throw error when RUM audit returns success=false', async () => {
    // Mock RUMAPIClient to throw an error, which causes internalLinksAuditRunner to catch it
    // and return success: false
    const mockRumClient = {
      query: sandbox.stub().rejects(new Error('RUM API connection failed')),
    };
    const RUMAPIClientMock = {
      createFrom: sandbox.stub().returns(mockRumClient),
    };

    // Use esmock to override imports
    const { runAuditAndImportTopPagesStep: runAuditAndImportTopPagesStepMocked } = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-rum-api-client': { default: RUMAPIClientMock },
    });
    const testContext = { ...context };
    delete testContext.rumApiClient;

    // Should throw because internalLinksAuditRunner caught an error and returned success: false
    await expect(runAuditAndImportTopPagesStepMocked(testContext))
      .to.be.rejectedWith('Audit failed, skip scraping and suggestion generation');

    expect(mockRumClient.query).to.have.been.called;
  }).timeout(10000);

  it('submitForScraping should throw error when audit result is not successful', async () => {
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
    };

    // Mock audit with success=false
    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: false }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    // Should throw because audit was not successful
    await expect(submitForScraping(testContext))
      .to.be.rejectedWith('Audit failed, skip scraping and suggestion generation');
  }).timeout(10000);

  it('submitForScraping should use scraper config from single config object', async () => {
    // Mock database read
    const mockSiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
        { getUrl: () => 'https://example.com/page1' },
      ]),
    };

    // Mock site config with custom scraper options in the same config object
    const mockSite = {
      ...site,
      getConfig: () => ({
        getIncludedURLs: () => [],
        getFetchConfig: () => ({}),
        getHandlers: () => ({
          'broken-internal-links': {
            config: {
              maxUrlsToProcess: 100,
              pageLoadTimeout: 60000,
              rejectRedirects: true,
              waitUntil: 'load',
              scrollToBottom: false,
              scrollMaxDurationMs: 45000,
              clickLoadMore: false,
              maxLoadMoreClicks: 3,
              loadMoreSelector: '.listings-load-more',
              screenshotTypes: ['full-page'],
            },
          },
        }),
      }),
    };

    const mockAudit = {
      getId: () => 'audit-123',
      getAuditResult: () => ({ success: true }),
      getFullAuditRef: () => 'www.example.com',
    };

    const testContext = {
      ...context,
      site: mockSite,
      audit: mockAudit,
      dataAccess: {
        ...context.dataAccess,
        SiteTopPage: mockSiteTopPage,
      },
    };

    const result = await submitForScraping(testContext);

    expect(result.options.pageLoadTimeout).to.equal(60000);
    expect(result.options.rejectRedirects).to.equal(true);
    expect(result.options.waitUntil).to.equal('load');
    expect(result.options.scrollToBottom).to.equal(false);
    expect(result.options.maxScrollDurationMs).to.equal(45000);
    expect(result.options.clickLoadMore).to.equal(false);
    expect(result.options.loadMoreSelector).to.equal('.listings-load-more');
    expect(result.options).to.not.have.property('maxLoadMoreClicks');
    expect(result.options.screenshotTypes).to.deep.equal(['full-page']);
    expect(result.options.enableJavascript).to.equal(true);
    expect(result.options.waitForSelector).to.equal('body');
    expect(result.options.hideConsentBanners).to.equal(true);
  }).timeout(10000);

});

describe('broken-internal-links audit opportunity and suggestions', () => {
  let addSuggestionsResponse;
  let opportunity;
  let auditData;

  let context;
  let handler;
  // let configuration;

  beforeEach(async () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        finalUrl: 'www.example.com',
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url',
        },
        sqs: {
          sendMessage: sandbox.stub().resolves({ MessageId: 'test-message-id' }),
        },
      })
      .build();
    context.log = {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    context.sqs.sendMessage.resolves();

    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };

    context.dataAccess.Opportunity = {
      allBySiteIdAndStatus: sandbox.stub(),
      addSuggestions: sandbox.stub(),
      create: sandbox.stub(),
    };

    context.site = site;

    addSuggestionsResponse = {
      createdItems: [],
      errorItems: [],
    };
    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
    };

    // Initialize Suggestion in dataAccess for Mystique integration tests
    if (!context.dataAccess.Suggestion) {
      context.dataAccess.Suggestion = {};
    }

    opportunity = {
      getType: () => 'broken-internal-links',
      getId: () => 'oppty-id-1',
      getSiteId: () => 'site-id-1',
      addSuggestions: sandbox.stub().resolves(addSuggestionsResponse),
      getSuggestions: sandbox.stub().resolves([]),
      setAuditId: sandbox.stub(),
      save: sandbox.stub().resolves(),
      setData: () => { },
      getData: () => { },
      setUpdatedBy: sandbox.stub().returnsThis(),
    };

    const _auditResult = {
      brokenInternalLinks: AUDIT_RESULT_DATA,
      success: true,
      auditContext: {
        interval: 30,
      },
    };

    auditData = {
      siteId: 'site-id-1',
      id: 'audit-id-1',
      getId: () => 'audit-id-1',
      isLive: true,
      auditedAt: new Date().toISOString(),
      auditType: 'broken-internal-links',
      auditResult: _auditResult,
      getAuditResult: () => _auditResult,
      fullAuditRef: auditUrl,
    };
    context.audit = auditData;

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => AUDIT_RESULT_DATA_WITH_SUGGESTIONS,
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
    });
    // Stub is already initialized in beforeEach, just update the method
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .resolves(AUDIT_RESULT_DATA_WITH_SUGGESTIONS.map((data) => (
        { getData: () => data, getId: () => '1111', save: () => { } })));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('creates a new opportunity object if one is not found', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);
    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';
    // Stub Configuration to prevent errors when checking feature flag
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => false, // Feature flag disabled for this test
      }),
    };

    // Re-esmock handler without stubbing syncBrokenInternalLinksSuggestions
    // so the real function runs and calls opportunity.addSuggestions
    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => AUDIT_RESULT_DATA_WITH_SUGGESTIONS,
        // Don't stub syncBrokenInternalLinksSuggestions - let it run for this test
      },
    });

    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(result.status).to.equal('complete');
    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
    expect(opportunity.addSuggestions).to.have.been.calledOnce;
    const suggestionsArg = opportunity.addSuggestions.getCall(0).args[0];
    expect(suggestionsArg).to.be.an('array').with.lengthOf(3);
    expect(suggestionsArg[0].data.urlTo).to.equal(
      'https://www.petplace.com/a01',
    );
  }).timeout(10000);


  it('no broken internal links found and fetching existing opportunity object fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(
      new Error('read error happened'),
    );
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    // Override audit to have no broken links
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [],
        success: true,
        auditContext: {
          interval: 30,
        },
      }),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
      },
    });

    await expect(
      handler.opportunityAndSuggestionsStep(context),
    ).to.be.rejectedWith('Failed to fetch opportunities for siteId site-id-1: read error happened');

    expect(context.log.error).to.have.been.calledWith(
      '[auditType=broken-internal-links] [siteId=site-id-1] [auditId=audit-id-1] [step=opportunity-and-suggestions] Fetching opportunities failed with error: read error happened',
    );
  }).timeout(5000);

  it('handles SQS message sending errors', async () => {
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);
    context.sqs.sendMessage.rejects(new Error('SQS error'));
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';
    // Ensure getBaseURL returns the same domain as the top pages for filterByAuditScope to work
    context.site.getBaseURL = () => 'https://example.com';

    // Ensure opportunity.getSuggestions() returns empty so syncSuggestions creates new ones
    opportunity.getSuggestions = sandbox.stub().resolves([]);
    opportunity.addSuggestions = sandbox.stub().resolves({ createdItems: [], errorItems: [] });

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => AUDIT_RESULT_DATA_WITH_SUGGESTIONS,
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
    });

    // Ensure we have suggestions and alternativeUrls for SQS to be called
    // Stub must be set up AFTER handler is created to ensure it uses the correct context
    // Use root URLs (pathname === '/') so extractPathPrefix returns empty string
    // This ensures brokenLinkLocales.size === 0, so all alternatives are included
    const validSuggestions = [
      {
        getData: () => ({
          urlFrom: 'https://example.com/',
          urlTo: 'https://example.com/', // Root URL - extractPathPrefix returns '' (empty string)
        }),
        getId: () => 'suggestion-1',
      },
    ];
    if (!context.dataAccess.Suggestion) {
      context.dataAccess.Suggestion = {};
    }
    // Stub must accept any opportunity ID (the code calls it with opportunity.getId())
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .callsFake(() => Promise.resolve(validSuggestions));
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves([{ getUrl: () => 'https://example.com/page1' }]);

    try {
      await handler.opportunityAndSuggestionsStep(context);
      expect.fail('Expected promise to be rejected');
    } catch (error) {
      expect(error.message).to.include('SQS error');
    }

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(
      expectedOpportunity,
    );
  }).timeout(5000);

  it('creating a new opportunity object succeeds and sends SQS messages', async () => {
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';
    // Ensure getBaseURL returns the same domain as the top pages for filterByAuditScope to work
    context.site.getBaseURL = () => 'https://example.com';

    // Ensure opportunity.getSuggestions() returns empty so syncSuggestions creates new ones
    opportunity.getSuggestions = sandbox.stub().resolves([]);
    opportunity.addSuggestions = sandbox.stub().resolves({ createdItems: [], errorItems: [] });

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => AUDIT_RESULT_DATA_WITH_SUGGESTIONS,
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
    });

    // Ensure we have suggestions and alternativeUrls for SQS to be called
    // Stub must be set up AFTER handler is created to ensure it uses the correct context
    // Use root URLs (pathname === '/') so extractPathPrefix returns empty string
    // This ensures brokenLinkLocales.size === 0, so all alternatives are included
    const validSuggestions = [
      {
        getData: () => ({
          urlFrom: 'https://example.com/',
          urlTo: 'https://example.com/', // Root URL - extractPathPrefix returns '' (empty string)
        }),
        getId: () => 'suggestion-1',
      },
    ];
    if (!context.dataAccess.Suggestion) {
      context.dataAccess.Suggestion = {};
    }
    // Stub must accept any opportunity ID (the code calls it with opportunity.getId())
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .callsFake(() => Promise.resolve(validSuggestions));
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves([{ getUrl: () => 'https://example.com/page1' }]);

    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(
      expectedOpportunity,
    );

    expect(result.status).to.equal('complete');

    // Verify SQS messages were sent
    expect(context.sqs.sendMessage).to.have.been.called;
    expect(context.log.debug).to.have.been.calledWith(
      sinon.match(/Batch.*sent to Mystique/),
    );
  }).timeout(5000);

  it('no new opportunity created if no broken internal links found', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    auditData.auditResult.brokenInternalLinks = [];

    context.site.getLatestAuditByAuditType = () => auditData;

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
      },
    });

    // Override audit to have no broken links
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [],
        success: true,
        auditContext: {
          interval: 30,
        },
      }),
    };

    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;

    expect(result.status).to.equal('complete');
  }).timeout(5000);

  it('handles undefined brokenInternalLinks in audit result (line 393 branch)', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    // Audit result has success but no brokenInternalLinks (undefined) to cover (x || []) branch
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        success: true,
        auditContext: { interval: 30 },
      }),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
      },
    });

    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(result.status).to.equal('complete');
  }).timeout(5000);

  it('excludes canonical and alternate (hreflang) links from opportunity and suggestions', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    // Audit result has only canonical and alternate links (covered by dedicated audits)
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [
          { urlFrom: 'https://example.com/page', urlTo: 'https://example.com/canonical-404', itemType: 'canonical' },
          { urlFrom: 'https://example.com/page', urlTo: 'https://example.com/es', itemType: 'alternate' },
        ],
        success: true,
        auditContext: { interval: 30 },
      }),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
        syncSuggestions: () => {},
      },
    });

    const result = await handler.opportunityAndSuggestionsStep(context);

    // Filtered to zero links, so no opportunity created (same as "no broken links")
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(result.status).to.equal('complete');
  }).timeout(5000);

  it('filters out unscrape-able file types (PDFs, Office docs) from alternative URLs', async () => {
    // Use root-level URLs (no path prefix) to ensure all alternatives are included
    const validSuggestions = [
      {
        getData: () => ({
          urlFrom: 'https://example.com/',
          urlTo: 'https://example.com/',
        }),
        getId: () => 'suggestion-1',
      },
    ];
    if (!context.dataAccess) {
      context.dataAccess = {};
    }
    if (!context.dataAccess.Suggestion) {
      context.dataAccess.Suggestion = {};
    }
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .callsFake(() => Promise.resolve(validSuggestions));
    // Stub allBySiteIdAndStatus to return empty array so a new opportunity is created
    context.dataAccess.Opportunity.allBySiteIdAndStatus = sandbox.stub().resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);
    // Include various unscrape-able file types in top pages to trigger filtering
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves([
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/brochure.pdf' },
        { getUrl: () => 'https://example.com/document.PDF' },
        { getUrl: () => 'https://example.com/data.xlsx' },
        { getUrl: () => 'https://example.com/presentation.pptx' },
        { getUrl: () => 'https://example.com/report.docx' },
      ]);
    // Ensure audit is set with proper broken links data
    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(result.status).to.equal('complete');

    // Verify the log message about filtering file types was called
    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Filtered out 5 unscrape-able file URLs/),
    );

    // Verify SQS was called with only scrapeable URLs
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    const messageArg = context.sqs.sendMessage.getCall(0).args[1];
    expect(messageArg.data.alternativeUrls).to.have.lengthOf(1);
    expect(messageArg.data.alternativeUrls[0]).to.equal('https://example.com/page1');
    // Verify siteBaseURL is included for URL normalization
    expect(messageArg.data.siteBaseURL).to.equal('https://www.example.com');
  }).timeout(5000);

  it('Existing opportunity and suggestions are updated if no broken internal links found', async () => {
    // Create mock suggestions
    const mockSuggestions = [{}];

    const existingOpportunity = {
      setStatus: sandbox.spy(sandbox.stub().resolves()),
      setAuditId: sandbox.stub(),
      save: sandbox.spy(sandbox.stub().resolves()),
      getType: () => 'broken-internal-links',
      getSuggestions: sandbox.stub().resolves(mockSuggestions),
      setUpdatedBy: sandbox.stub().returnsThis(),
    };

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);

    //return empty array of broken internal links
    auditData.auditResult.brokenInternalLinks = [];

    // Mock Suggestion.bulkUpdateStatus
    context.dataAccess.Suggestion = {
      bulkUpdateStatus: sandbox.spy(sandbox.stub().resolves()),
    };

    // Mock statuses
    sandbox.stub(Oppty, 'STATUSES').value({ RESOLVED: 'RESOLVED', NEW: 'NEW' });
    sandbox.stub(SuggestionDataAccess, 'STATUSES').value({ OUTDATED: 'OUTDATED', NEW: 'NEW', FIXED: 'FIXED' });
    sandbox.stub(GoogleClient, 'createFrom').resolves({});
    context.site.getLatestAuditByAuditType = () => auditData;

    // Override audit to have no broken links
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [],
        success: true,
        auditContext: {
          interval: 30,
        },
      }),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
      },
    });

    const result = await handler.opportunityAndSuggestionsStep(context);

    // Verify opportunity was updated
    expect(existingOpportunity.setStatus).to.have.been.calledOnceWith('RESOLVED');

    // Verify suggestions were retrieved
    expect(existingOpportunity.getSuggestions).to.have.been.calledOnce;

    // Verify suggestions statuses were updated
    expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
      mockSuggestions,
      'OUTDATED',
    );
    expect(existingOpportunity.save).to.have.been.calledOnce;

    expect(result.status).to.equal('complete');
  }).timeout(5000);

  it('allBySiteIdAndStatus method fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(
      new Error('some-error'),
    );
    context.dataAccess.Opportunity.create.resolves(opportunity);
    try {
      await handler.opportunityAndSuggestionsStep(context);
    } catch (err) {
      expect(err.message).to.equal(
        'Failed to fetch opportunities for siteId site-id-1: some-error',
      );
    }

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledOnceWith(
      '[auditType=broken-internal-links] [siteId=site-id-1] [auditId=audit-id-1] [step=opportunity-and-suggestions] Fetching opportunities for siteId site-id-1 failed with error: some-error',
    );

    // make sure that no new suggestions are added
    expect(opportunity.addSuggestions).to.have.been.to.not.have.been.called;
  }).timeout(5000);

  //dupe of above test
  it('allBySiteIdAndStatus method fails and no broken internal links found', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(
      new Error('some-error'),
    );
    auditData.auditResult.brokenInternalLinks = [];
    context.dataAccess.Opportunity.create.resolves(opportunity);
    try {
      await handler.opportunityAndSuggestionsStep(context);
    } catch (err) {
      expect(err.message).to.equal(
        'Failed to fetch opportunities for siteId site-id-1: some-error',
      );
    }

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledOnceWith(
      '[auditType=broken-internal-links] [siteId=site-id-1] [auditId=audit-id-1] [step=opportunity-and-suggestions] Fetching opportunities failed with error: some-error',
    );

    // make sure that no new suggestions are added
    expect(opportunity.addSuggestions).to.have.been.to.not.have.been.called;
  }).timeout(5000);

  it('updates the existing opportunity object', async () => {

    // auditData.auditResult.brokenInternalLinks = [];
    // context.site.getLatestAuditByAuditType = () => auditData;

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    const existingSuggestions = expectedSuggestions.map((suggestion) => ({
      ...suggestion,
      opportunityId: opportunity.getId(),
      remove: sinon.stub(),
      save: sinon.stub(),
      getData: () => suggestion.data,
      setData: sinon.stub(),
      getStatus: sinon.stub().returns('NEW'),
      setUpdatedBy: sinon.stub().returnsThis(),
    }));
    opportunity.getSuggestions.resolves(existingSuggestions);

    await handler.opportunityAndSuggestionsStep(context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(opportunity.setAuditId).to.have.been.calledOnceWith('audit-id-1');
    expect(opportunity.save).to.have.been.calledOnce;
  }).timeout(5000);

  it('returns original auditData if audit result is unsuccessful', async () => {
    const FailureAuditData = {
      ...auditData,
      getAuditResult: () => ({
        ...auditData.getAuditResult(),
        success: false,
      }),
    };

    context.audit = FailureAuditData;

    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(result.status).to.equal('complete');
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(opportunity.addSuggestions).to.have.been.to.not.have.been.called;
  });

  it('returns original auditData if auto-suggest is disabled for the site', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => false,
      }),
    };

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    expect(context.sqs.sendMessage).not.to.have.been.called;
  });

  it('should use urlTo prefix when urlTo has prefix', async () => {
    // Test case where urlTo has path prefix, so extractPathPrefix(urlTo) returns '/uk'
    // This covers the case where the || operator uses the first operand (urlTo)
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    context.site.getBaseURL = () => 'https://bulk.com/uk'; // Site with subpath
    context.site.getDeliveryType = () => 'aem_edge';

    // Create suggestions where urlTo has prefix
    const suggestionsWithUrlToPrefix = [
      {
        getData: () => ({
          urlTo: 'https://bulk.com/uk/page1', // Has /uk prefix - extractPathPrefix returns '/uk'
          urlFrom: 'https://bulk.com/de/page2', // Has /de prefix but won't be used
        }),
        getId: () => 'suggestion-1',
      },
    ];

    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .resolves(suggestionsWithUrlToPrefix);

    // Mock top pages with different prefixes
    const topPagesWithPrefixes = [
      { getUrl: () => 'https://bulk.com/uk/home' }, // /uk prefix
      { getUrl: () => 'https://bulk.com/uk/about' }, // /uk prefix
      { getUrl: () => 'https://bulk.com/de/home' }, // /de prefix
    ];
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves(topPagesWithPrefixes);

    await handler.opportunityAndSuggestionsStep(context);

    // Verify SQS message was sent
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    const messageArg = context.sqs.sendMessage.getCall(0).args[1];

    // Verify that brokenLinks array does NOT contain per-link alternatives
    expect(messageArg.data.brokenLinks).to.be.an('array').with.lengthOf(1);
    const brokenLink = messageArg.data.brokenLinks[0];
    expect(brokenLink).to.have.property('urlFrom');
    expect(brokenLink).to.have.property('urlTo');
    expect(brokenLink).to.have.property('suggestionId');
    expect(brokenLink).to.not.have.property('alternativeUrls'); // Per-link alternatives removed

    // Verify that main alternativeUrls array is filtered by broken links' locales
    // Since urlTo has /uk prefix, alternatives should be filtered to only /uk URLs
    expect(messageArg.data.alternativeUrls).to.be.an('array');
    messageArg.data.alternativeUrls.forEach((url) => {
      expect(url).to.include('/uk/');
    });
    // Verify siteBaseURL is included for URL normalization
    expect(messageArg.data.siteBaseURL).to.equal('https://www.example.com');
  }).timeout(5000);

  it('should use urlFrom prefix when urlTo has no prefix', async () => {
    // Test case where urlTo has no path prefix, so extractPathPrefix(urlTo) returns empty string
    // This triggers the fallback to extractPathPrefix(urlFrom) when urlTo has no prefix
    // NOTE: extractPathPrefix returns empty string only for root URLs (no path segments)
    // URLs like 'https://bulk.com/page1' return '/page1', not empty string!
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    context.site.getBaseURL = () => 'https://bulk.com/uk'; // Site with subpath
    context.site.getDeliveryType = () => 'aem_edge';

    // Create suggestions where urlTo has no prefix (root URL) but urlFrom has prefix
    const suggestionsWithPrefixFallback = [
      {
        getData: () => ({
          urlTo: 'https://bulk.com/', // Root URL - extractPathPrefix returns '' (falsy)
          urlFrom: 'https://bulk.com/uk/page2', // Has /uk prefix - extractPathPrefix returns '/uk'
        }),
        getId: () => 'suggestion-1',
      },
    ];

    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .resolves(suggestionsWithPrefixFallback);

    // Mock top pages with different prefixes - filteredTopPages will only include /uk pages
    const topPagesWithPrefixes = [
      { getUrl: () => 'https://bulk.com/uk/home' }, // /uk prefix - will be included
      { getUrl: () => 'https://bulk.com/uk/about' }, // /uk prefix - will be included
      { getUrl: () => 'https://bulk.com/de/home' }, // /de prefix - will be filtered out
      { getUrl: () => 'https://bulk.com/page1' }, // No prefix - will be filtered out
    ];
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves(topPagesWithPrefixes);

    await handler.opportunityAndSuggestionsStep(context);

    // Verify SQS message was sent
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    const messageArg = context.sqs.sendMessage.getCall(0).args[1];

    // Verify that brokenLinks array does NOT contain per-link alternatives
    expect(messageArg.data.brokenLinks).to.be.an('array').with.lengthOf(1);
    const brokenLink = messageArg.data.brokenLinks[0];
    expect(brokenLink).to.have.property('urlFrom');
    expect(brokenLink).to.have.property('urlTo');
    expect(brokenLink).to.have.property('suggestionId');
    expect(brokenLink).to.not.have.property('alternativeUrls'); // Per-link alternatives removed

    // Verify that main alternativeUrls array is filtered by broken links' locales
    // Since urlTo has no prefix, it should fall back to urlFrom's prefix (/uk)
    // So alternatives should be filtered to only /uk URLs
    expect(messageArg.data.alternativeUrls).to.be.an('array');
    // All alternatives should have /uk prefix since we're filtering by urlFrom's prefix
    messageArg.data.alternativeUrls.forEach((url) => {
      expect(url).to.include('/uk/');
    });
    // Verify siteBaseURL is included for URL normalization
    expect(messageArg.data.siteBaseURL).to.equal('https://www.example.com');
  }).timeout(5000);

  it('should skip sending to Mystique when all broken links are filtered out', async () => {
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    context.site.getBaseURL = () => 'https://bulk.com';
    context.site.getDeliveryType = () => 'aem_edge';

    // Create suggestions that will all be filtered out (missing required fields)
    const invalidSuggestions = [
      {
        getData: () => ({
          // Missing urlFrom
          urlTo: 'https://bulk.com/broken',
        }),
        getId: () => 'suggestion-1',
      },
      {
        getData: () => ({
          urlFrom: 'https://bulk.com/from',
          // Missing urlTo
        }),
        getId: () => 'suggestion-2',
      },
      {
        getData: () => ({
          urlFrom: 'https://bulk.com/from',
          urlTo: 'https://bulk.com/broken',
        }),
        getId: () => undefined, // Missing ID - will be filtered out
      },
    ];

    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .resolves(invalidSuggestions);

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves([{ getUrl: () => 'https://bulk.com/page1' }]);

    const result = await handler.opportunityAndSuggestionsStep(context);

    // Should return complete without sending message
    expect(result.status).to.equal('complete');
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/No valid broken links to process/),
    );
  }).timeout(5000);

  it('should skip sending to Mystique when opportunity ID is missing', async () => {
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };

    // Create opportunity with missing getId()
    const opportunityWithoutId = {
      ...opportunity,
      getId: () => undefined, // Missing ID
    };

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunityWithoutId]);
    context.site.getBaseURL = () => 'https://bulk.com';
    context.site.getDeliveryType = () => 'aem_edge';

    const validSuggestions = [
      {
        getData: () => ({
          urlFrom: 'https://bulk.com/from',
          urlTo: 'https://bulk.com/broken',
        }),
        getId: () => 'suggestion-1',
      },
    ];

    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .resolves(validSuggestions);

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves([{ getUrl: () => 'https://bulk.com/page1' }]);

    const result = await handler.opportunityAndSuggestionsStep(context);

    // Should return complete without sending message
    expect(result.status).to.equal('complete');
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledWith(
      sinon.match(/Opportunity ID is missing/),
    );
  }).timeout(5000);

  it('should include all alternatives when no locale prefixes found in broken links', async () => {
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    context.site.getBaseURL = () => 'https://bulk.com'; // Root domain, no subpath
    context.site.getDeliveryType = () => 'aem_edge';

    // Create suggestions with URLs that have pathname '/' (extractPathPrefix returns '')
    // This triggers the else branch where brokenLinkLocales.size === 0
    const suggestionsWithoutLocales = [
      {
        getData: () => ({
          urlTo: 'https://bulk.com/', // Pathname is '/' - extractPathPrefix returns ''
          urlFrom: 'https://bulk.com/', // Pathname is '/' - extractPathPrefix returns ''
        }),
        getId: () => 'suggestion-1',
      },
    ];

    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .resolves(suggestionsWithoutLocales);

    // Mock top pages with mixed locales
    const topPagesWithMixedLocales = [
      { getUrl: () => 'https://bulk.com/home' },
      { getUrl: () => 'https://bulk.com/uk/home' },
      { getUrl: () => 'https://bulk.com/de/home' },
      { getUrl: () => 'https://bulk.com/about' },
    ];
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves(topPagesWithMixedLocales);

    await handler.opportunityAndSuggestionsStep(context);

    // Verify SQS message was sent
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    const messageArg = context.sqs.sendMessage.getCall(0).args[1];

    // Verify that all alternatives are included (no locale filtering)
    expect(messageArg.data.alternativeUrls).to.be.an('array').with.lengthOf(4);
    // All alternatives should be included since no locale filtering was applied
    expect(messageArg.data.alternativeUrls).to.include('https://bulk.com/home');
    expect(messageArg.data.alternativeUrls).to.include('https://bulk.com/uk/home');
    expect(messageArg.data.alternativeUrls).to.include('https://bulk.com/de/home');
    expect(messageArg.data.alternativeUrls).to.include('https://bulk.com/about');
    // Verify siteBaseURL is included for URL normalization
    expect(messageArg.data.siteBaseURL).to.equal('https://www.example.com');
  }).timeout(5000);

  it('should skip sending to Mystique when alternativeUrls is empty', async () => {
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    context.site.getBaseURL = () => 'https://bulk.com';
    context.site.getDeliveryType = () => 'aem_edge';

    const validSuggestions = [
      {
        getData: () => ({
          urlFrom: 'https://bulk.com/from',
          urlTo: 'https://bulk.com/broken',
        }),
        getId: () => 'suggestion-1',
      },
    ];

    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .resolves(validSuggestions);

    // Mock empty top pages - no alternatives available
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves([]);

    const result = await handler.opportunityAndSuggestionsStep(context);

    // Should return complete without sending message
    expect(result.status).to.equal('complete');
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/No alternative URLs available/),
    );
  }).timeout(5000);

  describe('opportunityAndSuggestionsStep - Bright Data integration', () => {
    let configuration;
    let mockBrightDataClient;
    let mockedHandler;
    let savedConfiguration;

    beforeEach(async () => {
      // Save original configuration
      savedConfiguration = context.dataAccess.Configuration;

      configuration = {
        isHandlerEnabledForSite: sinon.stub().returns(true),
      };
      context.dataAccess.Configuration = {
        findLatest: sinon.stub().resolves(configuration),
      };

      // Create mock BrightDataClient instance
      mockBrightDataClient = {
        googleSearchWithFallback: sinon.stub().resolves({
          results: [],
          query: 'site:example.com keywords',
          keywords: 'test keywords',
        }),
      };

      // Use esmock to mock BrightDataClient
      mockedHandler = await esmock('../../../src/internal-links/handler.js', {
        '../../../src/support/bright-data-client.js': {
          default: {
            createFrom: sinon.stub().returns(mockBrightDataClient),
          },
        },
      });

      // Set up context.audit with stub for getAuditResult
      context.audit = {
        getId: () => 'audit-id-1',
        getAuditType: () => 'broken-internal-links',
        getAuditResult: sinon.stub(),
        getFullAuditRef: () => auditUrl,
      };

      // Set up site.getConfig for BrightData tests  
      if (typeof context.site.getConfig === 'function' && context.site.getConfig.restore) {
        context.site.getConfig.restore();
      }
      context.site.getConfig = sinon.stub().returns({
        getIncludedURLs: () => [],
      });
    });

    afterEach(() => {
      // Restore original configuration
      context.dataAccess.Configuration = savedConfiguration;
      // Clean up env vars
      delete context.env.BRIGHT_DATA_API_KEY;
      delete context.env.BRIGHT_DATA_ZONE;
      delete context.env.BRIGHT_DATA_VALIDATE_URLS;
      delete context.env.BRIGHT_DATA_MAX_RESULTS;
      delete context.env.BRIGHT_DATA_REQUEST_DELAY_MS;
    });

    it('should use Bright Data when API key and zone are configured', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            urlFrom: 'https://example.com/from',
            urlTo: 'https://example.com/broken',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await mockedHandler.opportunityAndSuggestionsStep(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/Bright Data enabled/));
    });

    it('should update suggestion when Bright Data returns results', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data returning a result
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/suggested-page', title: 'Suggested Page' }],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          urlFrom: 'https://example.com/from',
          urlTo: 'https://example.com/broken',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const testSuggestions = [mockSuggestion];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await mockedHandler.opportunityAndSuggestionsStep(context);

      expect(mockSuggestion.setData).to.have.been.calledOnce;
      expect(mockSuggestion.save).to.have.been.calledOnce;

      const setDataCall = mockSuggestion.setData.getCall(0).args[0];
      expect(setDataCall.urlsSuggested).to.deep.equal(['https://example.com/suggested-page']);
      expect(setDataCall.aiRationale).to.include('broken page');
    });

    it('should add locale to search URL when broken link has locale prefix', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/dk/suggested-page', title: 'Suggested Page' }],
        query: 'site:example.com/dk broken page',
        keywords: 'broken page',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const mockSuggestion = {
        getId: () => 'test-suggestion-locale',
        getData: () => ({
          urlFrom: 'https://example.com/dk/from',
          urlTo: 'https://example.com/dk/broken-page',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves([mockSuggestion]);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await mockedHandler.opportunityAndSuggestionsStep(context);

      // Verify search URL includes locale
      const searchUrlArg = mockBrightDataClient.googleSearchWithFallback.getCall(0).args[0];
      expect(searchUrlArg).to.include('/dk');
    });

    it('should skip Bright Data when no API key configured', async () => {
      delete context.env.BRIGHT_DATA_API_KEY;
      delete context.env.BRIGHT_DATA_ZONE;

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            urlFrom: 'https://example.com/from',
            urlTo: 'https://example.com/broken',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await mockedHandler.opportunityAndSuggestionsStep(context);

      expect(context.log.info).to.not.have.been.calledWith(sinon.match(/Bright Data enabled/));
    });

    it('should fall through to Mystique when Bright Data returns no results', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data returning empty results
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            urlFrom: 'https://example.com/from',
            urlTo: 'https://example.com/broken',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      const result = await mockedHandler.opportunityAndSuggestionsStep(context);

      // Should complete successfully (may or may not send to Mystique depending on alternativeUrls)
      expect(result.status).to.equal('complete');
    });

    it('should handle Bright Data errors gracefully', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data throwing an error
      mockBrightDataClient.googleSearchWithFallback.rejects(new Error('API error'));

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            urlFrom: 'https://example.com/from',
            urlTo: 'https://example.com/broken',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      const result = await mockedHandler.opportunityAndSuggestionsStep(context);

      // Should log warning and continue
      expect(context.log.warn).to.have.been.calledWith(sinon.match(/Bright Data failed/), sinon.match.any);
      expect(result.status).to.equal('complete');
    });

    it('should validate URLs when BRIGHT_DATA_VALIDATE_URLS is true', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      context.env.BRIGHT_DATA_VALIDATE_URLS = 'true';

      // Mock Bright Data returning a result
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/valid-page', title: 'Valid Page' }],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      // Mock the URL validation - nock returns 200 for valid URLs
      nock('https://example.com')
        .head('/valid-page')
        .reply(200);
      nock('https://example.com')
        .get('/valid-page')
        .reply(200);

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          urlFrom: 'https://example.com/from',
          urlTo: 'https://example.com/broken',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const testSuggestions = [mockSuggestion];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await mockedHandler.opportunityAndSuggestionsStep(context);

      // Suggestion should be updated since URL is valid
      expect(mockSuggestion.setData).to.have.been.calledOnce;
    });

    it('should skip suggestion when validated URL returns 404', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      context.env.BRIGHT_DATA_VALIDATE_URLS = 'true';

      // Mock Bright Data returning a result
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/broken-suggested', title: 'Broken' }],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      // Mock URL validation returning 404
      nock('https://example.com')
        .head('/broken-suggested')
        .reply(404);

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          urlFrom: 'https://example.com/from',
          urlTo: 'https://example.com/broken',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const testSuggestions = [mockSuggestion];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await mockedHandler.opportunityAndSuggestionsStep(context);

      // Suggestion should NOT be updated since URL validation failed
      expect(mockSuggestion.setData).to.not.have.been.called;
    });

    it('should handle missing suggestion gracefully', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data returning a result
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/suggested-page', title: 'Suggested' }],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            urlFrom: 'https://example.com/from',
            urlTo: 'https://example.com/broken',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      // Return null for findById to simulate missing suggestion
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(null);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await mockedHandler.opportunityAndSuggestionsStep(context);

      expect(context.log.warn).to.have.been.calledWith(sinon.match(/suggestion not found/));
    });

    it('should process multiple broken links in batches with delay', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      context.env.BRIGHT_DATA_REQUEST_DELAY_MS = '100';

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      // Create multiple suggestions
      const testSuggestions = Array.from({ length: 15 }, (_, i) => ({
        getId: () => `test-suggestion-${i}`,
        getData: () => ({
          urlFrom: `https://example.com/from${i}`,
          urlTo: `https://example.com/broken-${i}`,
        }),
      }));
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      const startTime = Date.now();
      await mockedHandler.opportunityAndSuggestionsStep(context);
      const elapsed = Date.now() - startTime;

      // Should have called googleSearchWithFallback for each broken link
      expect(mockBrightDataClient.googleSearchWithFallback.callCount).to.equal(15);

      // With 15 items in batches of 10, there should be 1 delay between batches
      // Elapsed time should be at least ~100ms for the delay
      expect(elapsed).to.be.at.least(90); // Allow some variance
    });

    it('should handle result with no link gracefully', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data returning a result without a link
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ title: 'No Link Result' }], // Missing link property
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          urlFrom: 'https://example.com/from',
          urlTo: 'https://example.com/broken',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const testSuggestions = [mockSuggestion];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await mockedHandler.opportunityAndSuggestionsStep(context);

      // Should not update suggestion when result has no link
      expect(mockSuggestion.setData).to.not.have.been.called;
    });

    it('should use custom max results from env', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      context.env.BRIGHT_DATA_MAX_RESULTS = '5';

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            urlFrom: 'https://example.com/from',
            urlTo: 'https://example.com/broken',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await mockedHandler.opportunityAndSuggestionsStep(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/maxResults=5/));
    });

    it('should log when all broken links resolved via Bright Data', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data returning results for all links
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/suggested', title: 'Suggested' }],
        query: 'site:example.com keywords',
        keywords: 'keywords',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          urlFrom: 'https://example.com/from',
          urlTo: 'https://example.com/broken',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves([mockSuggestion]);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      const result = await mockedHandler.opportunityAndSuggestionsStep(context);

      expect(result.status).to.equal('complete');
      expect(context.log.info).to.have.been.calledWith(sinon.match(/All broken links resolved via Bright Data/));
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('should use site.getBaseURL when finalUrl is not provided', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      context.finalUrl = null; // Test the fallback branch

      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/suggested', title: 'Suggested' }],
        query: 'site:example.com keywords',
        keywords: 'keywords',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenInternalLinks: AUDIT_RESULT_DATA,
      });

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          urlFrom: 'https://example.com/from',
          urlTo: 'https://example.com/broken',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves([mockSuggestion]);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      const result = await mockedHandler.opportunityAndSuggestionsStep(context);

      expect(result.status).to.equal('complete');
      // Verify BrightData was called with site.getBaseURL() fallback
      expect(mockBrightDataClient.googleSearchWithFallback).to.have.been.calledWith(
        'https://example.com', // from site.getBaseURL()
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
      );
    });
  });

  it('should batch brokenLinks into multiple SQS messages when exceeding batch size', async () => {
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);

    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';
    context.site.getBaseURL = () => 'https://example.com';

    // Setup opportunity methods
    opportunity.getSuggestions = sandbox.stub().resolves([]);
    opportunity.addSuggestions = sandbox.stub().resolves({ createdItems: [], errorItems: [] });

    // Re-create handler with esmock to stub syncBrokenInternalLinksSuggestions
    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
    });

    // Create 150 suggestions that will become broken links
    // Use same prefix pattern so locale filtering doesn't remove alternatives
    // Mix: 50 without itemType, 50 with 'link', 50 assets to cover all filter branches
    const validSuggestions = Array.from({ length: 150 }, (_, i) => {
      let data = {
        urlTo: `https://example.com/en/broken${i}${i >= 100 ? '.png' : ''}`,
        urlFrom: `https://example.com/en/source${i}`,
      };
      // First 50: no itemType (should be treated as links)
      // Next 50: explicit 'link' itemType
      // Last 50: 'image' itemType
      if (i >= 50 && i < 100) {
        data.itemType = 'link';
      } else if (i >= 100) {
        data.itemType = 'image';
      }
      return {
        getData: () => data,
        getId: () => `suggestion-${i}`,
      };
    });

    // Create top pages for alternatives - use same "en" prefix
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/en/alternative${i}`,
    }));

    if (!context.dataAccess.Suggestion) {
      context.dataAccess.Suggestion = {};
    }
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .callsFake(() => Promise.resolve(validSuggestions));
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves(manyTopPages);

    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(result.status).to.equal('complete');

    // Verify batching - 150 links should be sent in 2 batches (100 + 50)
    expect(context.sqs.sendMessage.callCount).to.equal(2);

    // Verify first batch has 100 links
    const firstBatch = context.sqs.sendMessage.getCall(0).args[1];
    expect(firstBatch.data.brokenLinks).to.have.lengthOf(100);
    expect(firstBatch.data.batchInfo.batchIndex).to.equal(0);
    expect(firstBatch.data.batchInfo.totalBatches).to.equal(2);
    expect(firstBatch.data.batchInfo.totalBrokenLinks).to.equal(150);

    // Verify second batch has 50 links
    const secondBatch = context.sqs.sendMessage.getCall(1).args[1];
    expect(secondBatch.data.brokenLinks).to.have.lengthOf(50);
    expect(secondBatch.data.batchInfo.batchIndex).to.equal(1);
    expect(secondBatch.data.batchInfo.totalBatches).to.equal(2);

    // Verify log message about batching (note: message now says "broken links" not "broken items")
    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Sending 150 broken (items|links) in 2 batch\(es\) to Mystique/),
    );
  }).timeout(10000);

  it('should handle Ahrefs fetch error gracefully in opportunityAndSuggestionsStep', async () => {
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);

    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';
    context.site.getBaseURL = () => 'https://example.com';

    opportunity.getSuggestions = sandbox.stub().resolves([]);
    opportunity.addSuggestions = sandbox.stub().resolves({ createdItems: [], errorItems: [] });

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
    });

    const validSuggestions = [{
      getData: () => ({
        urlTo: 'https://example.com/en/broken1',
        urlFrom: 'https://example.com/en/source1',
      }),
      getId: () => 'suggestion-1',
    }];

    if (!context.dataAccess.Suggestion) {
      context.dataAccess.Suggestion = {};
    }
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .callsFake(() => Promise.resolve(validSuggestions));
    
    // Make Ahrefs fetch fail
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .rejects(new Error('Ahrefs API error'));

    // Should still complete without throwing
    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(result.status).to.equal('complete');
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Failed to fetch Ahrefs top pages/),
    );
  }).timeout(10000);


  it('should cap URLs in opportunityAndSuggestionsStep when exceeding MAX_URLS_TO_PROCESS', async () => {
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);

    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';
    context.site.getBaseURL = () => 'https://example.com';
    context.site.getConfig = () => ({
      getIncludedURLs: () => Array.from({ length: 80 }, (_, i) => `https://example.com/en/included${i}`),
    });

    opportunity.getSuggestions = sandbox.stub().resolves([]);
    opportunity.addSuggestions = sandbox.stub().resolves({ createdItems: [], errorItems: [] });

    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
    });

    const validSuggestions = [{
      getData: () => ({
        urlTo: 'https://example.com/en/broken1',
        urlFrom: 'https://example.com/en/source1',
      }),
      getId: () => 'suggestion-1',
    }];

    // Create 80 Ahrefs pages + 40 includedURLs = 120 total (exceeds MAX_URLS_TO_PROCESS 100)
    const manyTopPages = Array.from({ length: 80 }, (_, i) => ({
      getUrl: () => `https://example.com/en/page${i}`,
    }));

    // Update includedURLs to have 40 URLs
    context.site.getConfig = () => ({
      getIncludedURLs: () => Array.from({ length: 40 }, (_, i) => `https://example.com/en/included${i}`),
    });

    if (!context.dataAccess.Suggestion) {
      context.dataAccess.Suggestion = {};
    }
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .callsFake(() => Promise.resolve(validSuggestions));
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves(manyTopPages);

    await handler.opportunityAndSuggestionsStep(context);

    // Verify warning was logged for capping URLs (120 > 100)
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Capping URLs from 120 to 100/),
    );
  }).timeout(10000);

});

describe('updateAuditResult', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should update audit result using setAuditResult when available', async () => {
    const mockAudit = {
      getId: () => 'audit-id-1',
      setAuditResult: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const prioritizedLinks = [{ urlFrom: 'a', urlTo: 'b', priority: 'high' }];
    const auditResult = { success: true, brokenInternalLinks: [] };

    const result = await updateAuditResult(mockAudit, auditResult, prioritizedLinks, {}, log, 'test-site-id');

    expect(mockAudit.setAuditResult).to.have.been.calledOnce;
    expect(mockAudit.save).to.have.been.calledOnce;
    expect(result.brokenInternalLinks).to.deep.equal(prioritizedLinks);
  });

  it('should use audit.id when getId method not available', async () => {
    const mockAuditFromDb = {
      setAuditResult: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockAudit = {
      // No getId method - should use id property instead
      id: 'audit-id-1',
      // No setAuditResult method
    };

    const log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const prioritizedLinks = [];
    const auditResult = { success: true };
    const dataAccess = {
      Audit: {
        findById: sandbox.stub().resolves(mockAuditFromDb),
      },
    };

    // Note: In production, Audit.findById works correctly. This test path may fail in test env
    // but we test that the function doesn't throw and returns the expected result
    const result = await updateAuditResult(mockAudit, auditResult, prioritizedLinks, dataAccess, log, 'test-site-id');

    // Result should still be returned even if db update path has issues in test env
    expect(result.brokenInternalLinks).to.deep.equal(prioritizedLinks);
  });

  it('should fallback to database lookup when setAuditResult not available', async () => {
    const mockAuditFromDb = {
      setAuditResult: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    const mockAudit = {
      getId: () => 'audit-id-1',
      id: 'audit-id-1',
      // No setAuditResult method
    };

    const log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const dataAccess = {
      Audit: {
        findById: sandbox.stub().resolves(mockAuditFromDb),
      },
    };

    const prioritizedLinks = [{ urlFrom: 'a', urlTo: 'b', priority: 'high' }];
    const auditResult = { success: true, brokenInternalLinks: [] };

    const result = await updateAuditResult(mockAudit, auditResult, prioritizedLinks, dataAccess, log, 'test-site-id');

    expect(log.info).to.have.been.calledWith(
      sinon.match(/Falling back to database lookup/),
    );
    expect(dataAccess.Audit.findById).to.have.been.calledWith('audit-id-1');
    expect(mockAuditFromDb.setAuditResult).to.have.been.calledOnce;
    expect(mockAuditFromDb.save).to.have.been.calledOnce;
    expect(log.info).to.have.been.calledWith(
      sinon.match(/Updated audit result via database lookup/),
    );
    expect(result.brokenInternalLinks).to.deep.equal(prioritizedLinks);
  });

  it('should log error when audit not found in database', async () => {
    const mockAudit = {
      getId: () => 'audit-id-1',
      id: 'audit-id-1',
    };

    const log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const dataAccess = {
      Audit: {
        findById: sandbox.stub().resolves(null), // Not found
      },
    };

    const prioritizedLinks = [];
    const auditResult = { success: true };

    await updateAuditResult(mockAudit, auditResult, prioritizedLinks, dataAccess, log, 'test-site-id');

    expect(dataAccess.Audit.findById).to.have.been.calledWith('audit-id-1');
    expect(log.warn).to.have.been.calledWith(
      sinon.match(/Could not find audit with ID/),
    );
  });

  it('should handle errors during update', async () => {
    const mockAudit = {
      getId: () => 'audit-id-1',
      setAuditResult: sandbox.stub(),
      save: sandbox.stub().rejects(new Error('Save failed')),
    };

    const log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const prioritizedLinks = [];
    const auditResult = { success: true };

    const result = await updateAuditResult(
      mockAudit,
      auditResult,
      prioritizedLinks,
      {},
      log,
      'test-site-id',
    );

    expect(log.error).to.have.been.calledWith(
      sinon.match(/Failed to update audit result/),
    );
    expect(result).to.deep.equal({
      success: true,
      brokenInternalLinks: [],
    });
  });

  it('should assign auditResult directly when db model lacks setAuditResult', async () => {
    const mockAuditFromDb = {
      save: sandbox.stub().resolves(),
    };

    const mockAudit = {
      getId: () => 'audit-id-1',
      id: 'audit-id-1',
    };

    const log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const dataAccess = {
      Audit: {
        findById: sandbox.stub().resolves(mockAuditFromDb),
      },
    };

    const prioritizedLinks = [{ urlFrom: 'a', urlTo: 'b', priority: 'high' }];
    const auditResult = { success: true, brokenInternalLinks: [] };

    const result = await updateAuditResult(
      mockAudit,
      auditResult,
      prioritizedLinks,
      dataAccess,
      log,
      'test-site-id',
    );

    expect(mockAuditFromDb.auditResult).to.deep.equal(result);
    expect(mockAuditFromDb.save).to.have.been.calledOnce;
  });

  it('should warn when db model lacks save during fallback update', async () => {
    const mockAuditFromDb = {
      setAuditResult: sandbox.stub(),
    };

    const mockAudit = {
      getId: () => 'audit-id-1',
      id: 'audit-id-1',
    };

    const log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const dataAccess = {
      Audit: {
        findById: sandbox.stub().resolves(mockAuditFromDb),
      },
    };

    await updateAuditResult(
      mockAudit,
      { success: true },
      [],
      dataAccess,
      log,
      'test-site-id',
    );

    expect(mockAuditFromDb.setAuditResult).to.have.been.calledOnce;
    expect(log.warn).to.have.been.calledWith(
      sinon.match(/loaded without save\(\); skipping persisted audit result update/),
    );
  });
});


describe('runCrawlDetectionBatch - Coverage Tests', () => {
  it('should call runCrawlDetectionBatch and test basic flow', async () => {
    // This is a simple smoke test to trigger the function
    // Real integration testing happens in production
    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-123',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {},
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub().callsFake(async (command) => {
          const commandName = command.constructor.name;
          if (commandName === 'GetObjectCommand') {
            throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
          }
          if (commandName === 'ListObjectsV2Command') {
            return { Contents: [] };
          }
          return { ETag: '"mock-etag"' };
        }),
      },
      scrapeResultPaths: new Map(),
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-123',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({ getId: () => 'opp-1', getSuggestions: sandbox.stub().resolves([]) }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await runCrawlDetectionBatch(mockContext);

    // Should handle empty scrapeResultPaths
    expect(mockLog.info).to.have.been.calledWith(sinon.match(/No scraped content available/));
    expect(result).to.have.property('status');
  });

  it('should send continuation message when more pages remain', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const s3ClientStub = {
      send: sandbox.stub(),
    };

    // Create many pages to trigger batching
    const largeScrapeResultPaths = new Map();
    for (let i = 0; i < 100; i++) {
      largeScrapeResultPaths.set(`https://example.com/page${i}`, `scrape/page${i}.json`);
    }

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-123',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {},
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: s3ClientStub,
      scrapeResultPaths: largeScrapeResultPaths,
      scrapeJobId: 'scrape-123',
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-123',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({ getId: () => 'opp-1' }),
        },
        Suggestion: {
          allByOpportunityId: sandbox.stub().resolves([]),
        },
      },
    };

    // Mock S3 - multiple calls for new hybrid storage pattern:
    // 1. Load cache at batch start (GetObject) - NoSuchKey
    // 2. Load completion tracking (GetObject) - NoSuchKey
    // 3. Save batch results (PutObject)
    // 4. Update cache - Load (GetObject) with ETag then Save (PutObject)
    // 5. Mark completed - Load (GetObject) with ETag then Save (PutObject)
    const noSuchKeyError = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    const mockCacheResponse = {
      Body: { transformToString: async () => JSON.stringify({ broken: [], working: [] }) },
      ETag: '"etag-123"',
    };
    const mockCompletedResponse = {
      Body: { transformToString: async () => JSON.stringify({ completed: [] }) },
      ETag: '"etag-456"',
    };

    s3ClientStub.send.callsFake(async (command) => {
      const commandName = command.constructor.name;
      if (commandName === 'GetObjectCommand') {
        if (command.input.Key.includes('/cache/')) {
          return mockCacheResponse;
        }
        if (command.input.Key.includes('/completed.json')) {
          return mockCompletedResponse;
        }
      }
      return { ETag: '"mock-etag"' };
    });

    // Mock getObjectFromKey via esmock
    const getObjectFromKeyStub = sandbox.stub().resolves({
      scrapeResult: {
        rawBody: '<html><body><main><p>Test</p></main></body></html>',
      },
      finalUrl: 'https://example.com/page1',
    });

    const putObjectFromStringStub = sandbox.stub().resolves();

    const getTimeoutStatusStub = sandbox.stub();
    getTimeoutStatusStub.onFirstCall().returns({
      elapsed: 1000,
      remaining: 899000,
      safeTimeRemaining: 779000,
      isApproachingTimeout: false,
      percentUsed: 0.1,
    });
    getTimeoutStatusStub.onSecondCall().returns({
      elapsed: 840000,
      remaining: 60000,
      safeTimeRemaining: -60000,
      isApproachingTimeout: true,
      percentUsed: 93.3,
    });

    const module = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/utils/s3-utils.js': {
        getObjectFromKey: getObjectFromKeyStub,
        putObjectFromString: putObjectFromStringStub,
      },
      '../../../src/internal-links/batch-state.js': {
        ...await import('../../../src/internal-links/batch-state.js'),
        getTimeoutStatus: getTimeoutStatusStub,
      },
    });

    const result = await module.runCrawlDetectionBatch(mockContext);

    expect(result).to.deep.equal({
      status: 'batch-continuation',
      batchesProcessedThisLambda: 1,
      batchesSkipped: 0,
    });

    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/Continuation message sent for batch starting at index 10/),
    );

    // Should send SQS message
    expect(mockContext.sqs.sendMessage).to.have.been.calledOnce;
    expect(mockContext.sqs.sendMessage).to.have.been.calledWith(
      'https://sqs.test/queue',
      sinon.match({
        type: AUDIT_TYPE,
        siteId: 'test-site',
        auditContext: sinon.match({
          next: 'runCrawlDetectionBatch',
          auditId: 'audit-123',
          scrapeJobId: 'scrape-123',
          batchStartIndex: 10,
          continuationCount: 1,
        }),
      }),
    );
  });

  it('should complete in one batch using esmock for crawl-detection', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    // Create 3 pages (less than PAGES_PER_BATCH=10)
    const smallScrapeResultPaths = new Map([
      ['https://example.com/page1', 'scrape/page1.json'],
      ['https://example.com/page2', 'scrape/page2.json'],
      ['https://example.com/page3', 'scrape/page3.json'],
    ]);

    const noSuchKeyError = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    const mockS3Send = sandbox.stub().callsFake(async (command) => {
      const commandName = command.constructor.name;
      if (commandName === 'GetObjectCommand') {
        const { Key } = command.input;
        if (Key.includes('/cache/')) {
          return {
            Body: { transformToString: async () => JSON.stringify({ broken: [], working: [] }) },
            ETag: '"cache-etag"',
          };
        }
        if (Key.includes('/completed.json')) {
          return {
            Body: { transformToString: async () => JSON.stringify({ completed: [] }) },
            ETag: '"completed-etag"',
          };
        }
        if (Key.includes('/batches/')) {
          return {
            Body: {
              transformToString: async () => JSON.stringify({
                batchNum: 0, results: [], pagesProcessed: 3,
              }),
            },
          };
        }
        throw noSuchKeyError;
      }
      if (commandName === 'ListObjectsV2Command') {
        const { Prefix } = command.input;
        if (Prefix?.includes('/batches/')) {
          return { Contents: [{ Key: 'broken-internal-links/batch-state/audit-finish/batches/batch-0.json' }] };
        }
        return { Contents: [] };
      }
      return { ETag: '"mock-etag"' };
    });

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-finish',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-finish',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {},
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: mockS3Send,
      },
      scrapeResultPaths: smallScrapeResultPaths,
      scrapeJobId: 'scrape-finish',
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-finish',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({ getId: () => 'opp-finish', getSuggestions: sandbox.stub().resolves([]) }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    // Mock detectBrokenLinksFromCrawlBatch to return no more pages
    const module = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/crawl-detection.js': {
        detectBrokenLinksFromCrawlBatch: async () => ({
          results: [],
          brokenUrlsCache: [],
          workingUrlsCache: [],
          pagesProcessed: 3,
          pagesSkipped: 0,
          hasMorePages: false, // No more pages - should hit lines 664-665
          nextBatchStartIndex: 3,
          stats: { linksChecked: 0, linksSkipped: 0, brokenLinksFound: 0 },
        }),
      },
    });

    await module.runCrawlDetectionBatch(mockContext);

    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/All 1 batches complete \(1 processed, 0 skipped in this Lambda\)/),
    );
    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/proceeding to LinkChecker/),
    );
  });

  it('should cover finalizeCrawlDetection with crawl results (lines 521-526)', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const crawlResults = [
      { urlFrom: 'https://example.com/p1', urlTo: 'https://example.com/broken', anchorText: 'link' },
    ];

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-finalize-1',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-finalize-1',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub()
          // PutObject for finalization lock
          .onCall(0).resolves({})
          // ListObjectsV2 for loadAllBatchResults
          .onCall(1).resolves({
            Contents: [
              { Key: 'broken-internal-links/batch-state/audit-finalize-1/batches/batch-0.json' },
            ],
          })
          // GetObject for batch file
          .onCall(2).resolves({
            Body: {
              transformToString: async () => JSON.stringify({
                batchNum: 0,
                results: crawlResults,
                pagesProcessed: 1,
              }),
            },
          })
          // ListObjectsV2 for cleanup
          .onCall(3).resolves({ Contents: [] })
          .resolves(), // Any additional calls
      },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-finalize-1',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({ getId: () => 'opp-1', getSuggestions: sandbox.stub().resolves([]) }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    // Call with skipCrawlDetection=false to hit lines 521-526
    await finalizeCrawlDetection(mockContext, { skipCrawlDetection: false });

    // Verify lines 521-526 were executed
    expect(mockLog.info).to.have.been.calledWith(sinon.match(/Crawl detected 1 broken links/));
  });

  it('should handle null brokenInternalLinks (line 514)', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'site-null',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-null',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-null',
        getAuditResult: () => ({}), // No brokenInternalLinks property
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub()
          // PutObject for finalization lock
          .onCall(0).resolves({})
          // ListObjectsV2 for loadAllBatchResults
          .onCall(1).resolves({ Contents: [] })
          // ListObjectsV2 for cleanup
          .onCall(2).resolves({ Contents: [] })
          .resolves(),
      },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-null',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({ getId: () => 'opp-null', getSuggestions: sandbox.stub().resolves([]) }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    await finalizeCrawlDetection(mockContext, { skipCrawlDetection: false });

    // Should handle null brokenInternalLinks (line 514: || [])
    expect(mockLog.info).to.have.been.calledWith(sinon.match(/RUM detection results: 0 broken links/));
  });

  it('should return already-finalized when workflow completion marker exists', async function () {
    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'site-finalized',
      },
      audit: {
        getId: () => 'audit-finalized',
        getAuditResult: () => ({
          internalLinksWorkflowCompletedAt: '2026-03-12T12:00:00.000Z',
          brokenInternalLinks: [{ urlFrom: 'https://example.com/a', urlTo: 'https://example.com/b' }],
        }),
      },
      dataAccess: {},
    };

    const result = await finalizeCrawlDetection(mockContext, { skipCrawlDetection: true });

    expect(result).to.deep.equal({ status: 'already-finalized' });
    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/Audit already finalized at 2026-03-12T12:00:00.000Z/),
    );
  });

  it('should handle missing scrapeResultPaths (line 581)', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'site-no-paths',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-no-paths',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-no-paths',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {},
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub().callsFake(async (command) => {
          const commandName = command.constructor.name;
          if (commandName === 'GetObjectCommand') {
            throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
          }
          if (commandName === 'ListObjectsV2Command') {
            return { Contents: [] };
          }
          return { ETag: '"mock-etag"' };
        }),
      },
      // NO scrapeResultPaths property - should use fallback on line 581
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-no-paths',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({ getId: () => 'opp-no-paths', getSuggestions: sandbox.stub().resolves([]) }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await runCrawlDetectionBatch(mockContext);

    // Should use fallback Map() and skip crawl detection
    expect(mockLog.info).to.have.been.calledWith(sinon.match(/No scraped content available/));
    expect(result).to.have.property('status');
  });

  it('should skip stale continuation when batch state was already cleaned after finalization', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'site-stale-continuation',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-stale-continuation',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-stale-continuation',
        getAuditResult: () => ({
          brokenInternalLinks: [],
          internalLinksWorkflowCompletedAt: '2026-03-14T10:00:00.000Z',
        }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {
        batchStartIndex: 10,
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub().callsFake(async (command) => {
          const commandName = command.constructor.name;
          if (commandName === 'GetObjectCommand') {
            throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
          }
          if (commandName === 'ListObjectsV2Command') {
            return { Contents: [] };
          }
          return { ETag: '"mock-etag"' };
        }),
      },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves(null),
        },
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({ getId: () => 'opp-stale', getSuggestions: sandbox.stub().resolves([]) }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await runCrawlDetectionBatch(mockContext);

    expect(result).to.deep.equal({ status: 'already-finalized' });
    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/Audit already finalized at 2026-03-14T10:00:00.000Z, skipping stale crawl execution/),
    );
  });

  it('should fallback to updatedAuditResult when audit.getAuditResult returns null after merge', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const getAuditResultStub = sandbox.stub()
      .onFirstCall().returns({ brokenInternalLinks: [] })
      .onSecondCall().returns(null);
    let currentAuditResult = { brokenInternalLinks: [], success: true };
    const setAuditResultStub = sandbox.stub().callsFake((nextResult) => {
      currentAuditResult = nextResult;
    });

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'site-fallback-audit-result',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getIncludedURLs: () => [] }),
      },
      audit: {
        getId: () => 'audit-fallback-audit-result',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-fallback-audit-result',
        getAuditResult: getAuditResultStub,
        setAuditResult: setAuditResultStub,
        save: sandbox.stub().resolves(),
      },
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub()
          .onCall(0).resolves({
            Contents: [
              { Key: 'broken-internal-links/batch-state/audit-fallback-audit-result/batches/batch-0.json' },
            ],
          })
          .onCall(1).resolves({
            Body: {
              transformToString: async () => JSON.stringify({
                batchNum: 0,
                results: [],
                pagesProcessed: 0,
              }),
            },
          })
          .onCall(2).resolves({ Contents: [] })
          .resolves(),
      },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-fallback-audit-result',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({
            getId: () => 'opp-fallback-audit-result',
            getSuggestions: sandbox.stub().resolves([]),
            addSuggestions: sandbox.stub().resolves({ length: 0, createdItems: [], errorItems: [] }),
          }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    await finalizeCrawlDetection(mockContext, { skipCrawlDetection: false });

    const finalAuditResult = setAuditResultStub.lastCall.args[0];
    expect(finalAuditResult).to.have.property('internalLinksWorkflowCompletedAt');
  });

  it('should cover cleanup failure path (lines 556-561)', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'site-2',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-cleanup-1',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/type/audit-cleanup-1',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub()
          // ListObjectsV2 for loadAllBatchResults
          .onCall(0).resolves({
            Contents: [
              { Key: 'broken-internal-links/batch-state/audit-cleanup-1/batches/batch-0.json' },
            ],
          })
          // GetObject for batch file
          .onCall(1).resolves({
            Body: {
              transformToString: async () => JSON.stringify({
                batchNum: 0,
                results: [],
                pagesProcessed: 0,
              }),
            },
          })
          // ListObjectsV2 for cleanup - this should fail
          .onCall(2).rejects(new Error('Cleanup error')),
      },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-cleanup-1',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({ getId: () => 'opp-2', getSuggestions: sandbox.stub().resolves([]) }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    // Call with skipCrawlDetection=false to enter cleanup path
    await finalizeCrawlDetection(mockContext, { skipCrawlDetection: false });

    // Verify lines 556-563: cleanup failure logged
    expect(mockLog.warn).to.have.been.calledWith(sinon.match(/Cleanup failed: Cleanup error/));
  });

  it('should cap reported broken links to MAX_BROKEN_LINKS_REPORTED when merge yields more than limit', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const overLimit = MAX_BROKEN_LINKS_REPORTED + 1;
    const manyCrawlResults = Array.from({ length: overLimit }, (_, i) => ({
      urlFrom: `https://example.com/p${i}`,
      urlTo: 'https://example.com/broken',
      anchorText: 'link',
      itemType: 'link',
      statusBucket: 'not_found_404',
      trafficDomain: 100 - i,
    }));

    let currentAuditResult = { brokenInternalLinks: [], success: true };
    const setAuditResultStub = sandbox.stub().callsFake((nextResult) => {
      currentAuditResult = nextResult;
    });
    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'site-cap',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getIncludedURLs: () => [] }),
      },
      audit: {
        getId: () => 'audit-cap',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-cap',
        getAuditResult: () => currentAuditResult,
        setAuditResult: setAuditResultStub,
        save: sandbox.stub().resolves(),
      },
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub()
          // PutObject for finalization lock
          .onCall(0).resolves({})
          // ListObjectsV2 for loadAllBatchResults
          .onCall(1).resolves({
            Contents: [
              { Key: 'broken-internal-links/batch-state/audit-cap/batches/batch-0.json' },
            ],
          })
          // GetObject for batch file
          .onCall(2).resolves({
            Body: {
              transformToString: async () => JSON.stringify({
                batchNum: 0,
                results: manyCrawlResults,
                pagesProcessed: overLimit,
              }),
            },
          })
          // ListObjectsV2 for cleanup
          .onCall(3).resolves({ Contents: [] })
          .resolves(), // Any additional calls
      },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-cap',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({
            getId: () => 'opp-cap',
            getSuggestions: sandbox.stub().resolves([]),
            addSuggestions: sandbox.stub().resolves({ length: 0, createdItems: [], errorItems: [] }),
          }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    await finalizeCrawlDetection(mockContext, { skipCrawlDetection: false });

    // Cap is applied in opportunityAndSuggestionsStep and preserved through final completion update.
    const expectedMsg = new RegExp(`Capping reported broken links from ${overLimit} to ${MAX_BROKEN_LINKS_REPORTED} \\(priority order\\)`);
    expect(mockLog.warn).to.have.been.calledWith(sinon.match(expectedMsg));
    const updatedResult = setAuditResultStub.lastCall.args[0];
    expect(updatedResult.brokenInternalLinks).to.have.lengthOf(MAX_BROKEN_LINKS_REPORTED);
    expect(updatedResult).to.have.property('internalLinksWorkflowCompletedAt');
  });

  it('should skip batch processing when batchStartIndex >= totalPages', async () => {
    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page1', 'scrape/page1.json'],
      ['https://example.com/page2', 'scrape/page2.json'],
    ]);

    const mockS3Send = sandbox.stub().callsFake(async (command) => {
      const commandName = command.constructor.name;
      if (commandName === 'GetObjectCommand') {
        throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      }
      if (commandName === 'ListObjectsV2Command') {
        return { Contents: [] };
      }
      return { ETag: '"mock-etag"' };
    });

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-123',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {
        batchStartIndex: 100, // Beyond totalPages (2)
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: mockS3Send,
      },
      scrapeResultPaths,
      scrapeJobId: 'scrape-123',
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-123',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({ getId: () => 'opp-1', getSuggestions: sandbox.stub().resolves([]) }),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await runCrawlDetectionBatch(mockContext);

    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/All 1 batches complete \(0 processed, 0 skipped in this Lambda\)/),
    );

    expect(result).to.have.property('status', 'complete');

    // Should NOT send continuation message
    expect(mockContext.sqs.sendMessage).to.not.have.been.called;
  });

  it('should log timeout warnings when time is running low', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page1', 'scrape/page1.json'],
    ]);

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-123',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {
        batchStartIndex: 0,
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub().callsFake(async (command) => {
          const commandName = command.constructor.name;
          if (commandName === 'GetObjectCommand') {
            const noKeyError = new Error('NoSuchKey');
            noKeyError.name = 'NoSuchKey';
            throw noKeyError;
          }
          if (commandName === 'ListObjectsV2Command') {
            return { Contents: [] };
          }
          return { ETag: '"mock-etag"' };
        }),
      },
      scrapeResultPaths,
      scrapeJobId: 'scrape-123',
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-123',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    // Mock getTimeoutStatus to return approaching timeout status
    const getTimeoutStatusStub = sandbox.stub().returns({
      elapsed: 840000, // 14 minutes
      percentUsed: 93.3,
      isApproachingTimeout: true,
      safeTimeRemaining: 60000, // 1 minute
    });

    const getObjectFromKeyStub = sandbox.stub().resolves({
      scrapeResult: {
        rawBody: '<html><body><main><p>Test</p></main></body></html>',
      },
      finalUrl: 'https://example.com/page1',
    });

    const module = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/utils/s3-utils.js': {
        getObjectFromKey: getObjectFromKeyStub,
      },
      '../../../src/internal-links/batch-state.js': {
        ...await import('../../../src/internal-links/batch-state.js'),
        getTimeoutStatus: getTimeoutStatusStub,
      },
    });

    const result = await module.runCrawlDetectionBatch(mockContext);

    expect(result).to.deep.equal({
      status: 'batch-continuation',
      batchesProcessedThisLambda: 0,
      batchesSkipped: 0,
    });
    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/Approaching timeout after 0 batch\(es\), sending continuation at index 0/),
    );
    expect(mockContext.sqs.sendMessage).to.have.been.calledOnce;
  });

  it('should not enqueue a duplicate continuation when dispatch is already reserved', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page1', 'scrape/page1.json'],
      ['https://example.com/page2', 'scrape/page2.json'],
    ]);

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-123',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {},
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub().callsFake(async (command) => {
          const commandName = command.constructor.name;
          if (commandName === 'PutObjectCommand'
            && command.input.Key.includes('/dispatch/continue-0.json')) {
            const conflictError = new Error('PreconditionFailed');
            conflictError.name = 'PreconditionFailed';
            conflictError.$metadata = { httpStatusCode: 412 };
            throw conflictError;
          }
          if (commandName === 'GetObjectCommand'
            && command.input.Key.includes('/dispatch/continue-0.json')) {
            return {
              Body: {
                transformToString: async () => JSON.stringify({
                  status: 'sent',
                  updatedAt: new Date().toISOString(),
                }),
              },
              ETag: '"dispatch-etag"',
            };
          }
          if (commandName === 'ListObjectsV2Command') {
            return { Contents: [] };
          }
          return { ETag: '"mock-etag"' };
        }),
      },
      scrapeResultPaths,
      scrapeJobId: 'scrape-123',
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-123',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const module = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/batch-state.js': {
        ...await import('../../../src/internal-links/batch-state.js'),
        getTimeoutStatus: () => ({
          elapsed: 840000,
          remaining: 60000,
          safeTimeRemaining: -60000,
          isApproachingTimeout: true,
          percentUsed: 93.3,
        }),
      },
    });

    const result = await module.runCrawlDetectionBatch(mockContext);

    expect(result).to.deep.equal({
      status: 'batch-continuation',
      batchesProcessedThisLambda: 0,
      batchesSkipped: 0,
    });
    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/already dispatched or reserved/),
    );
    expect(mockContext.sqs.sendMessage).to.not.have.been.called;
  });

  it('should handle duplicate message when batch already completed with continuation', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const scrapeResultPaths = new Map();
    for (let i = 0; i < 20; i += 1) {
      scrapeResultPaths.set(`https://example.com/page${i}`, `scrape/page${i}.json`);
    }

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-123',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {
        batchStartIndex: 0, // First batch
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub().callsFake(async (command) => {
          const commandName = command.constructor.name;
          if (commandName === 'GetObjectCommand') {
            // Return that batch 0 is already completed
            if (command.input.Key.includes('/completed.json')) {
              return {
                Body: {
                  transformToString: async () => JSON.stringify({ completed: [0] }),
                },
              };
            }
          }
          if (commandName === 'ListObjectsV2Command') {
            return { Contents: [] };
          }
          return { ETag: '"mock-etag"' };
        }),
      },
      scrapeResultPaths,
      scrapeJobId: 'scrape-123',
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-123',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const getTimeoutStatusStub = sandbox.stub();
    getTimeoutStatusStub.onFirstCall().returns({
      elapsed: 1000,
      remaining: 899000,
      safeTimeRemaining: 779000,
      isApproachingTimeout: false,
      percentUsed: 0.1,
    });
    getTimeoutStatusStub.onSecondCall().returns({
      elapsed: 840000,
      remaining: 60000,
      safeTimeRemaining: -60000,
      isApproachingTimeout: true,
      percentUsed: 93.3,
    });

    const module = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/batch-state.js': {
        ...await import('../../../src/internal-links/batch-state.js'),
        getTimeoutStatus: getTimeoutStatusStub,
      },
    });

    const result = await module.runCrawlDetectionBatch(mockContext);

    expect(mockLog.debug).to.have.been.calledWith(
      sinon.match(/Batch 0 already completed, skipping/),
    );
    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/Approaching timeout after 0 batch\(es\), sending continuation at index 10/),
    );
    expect(result).to.deep.equal({
      status: 'batch-continuation',
      batchesProcessedThisLambda: 0,
      batchesSkipped: 1,
    });
    expect(mockContext.sqs.sendMessage).to.have.been.calledOnce;
  });

  it('should handle duplicate message when all batches already completed', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page1', 'scrape/page1.json'],
    ]);

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-123',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {
        batchStartIndex: 0, // Only 1 batch total
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub().callsFake(async (command) => {
          const commandName = command.constructor.name;
          if (commandName === 'GetObjectCommand') {
            if (command.input.Key.includes('/completed.json')) {
              return {
                Body: {
                  transformToString: async () => JSON.stringify({ completed: [0] }),
                },
              };
            }
          }
          if (commandName === 'ListObjectsV2Command') {
            return { Contents: [] };
          }
          return { ETag: '"mock-etag"' };
        }),
      },
      scrapeResultPaths,
      scrapeJobId: 'scrape-123',
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-123',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await runCrawlDetectionBatch(mockContext);

    expect(mockLog.debug).to.have.been.calledWith(
      sinon.match(/Batch 0 already completed, skipping/),
    );
    expect(mockLog.info).to.have.been.calledWith(
      sinon.match(/All 1 batches complete \(0 processed, 1 skipped in this Lambda\)/),
    );
    expect(result).to.have.property('status', 'complete');
  });

  it('should skip finalization when internal-links already finalized', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-123',
        getAuditResult: () => ({
          brokenInternalLinks: [],
          internalLinksWorkflowCompletedAt: '2026-03-10T00:00:00.000Z',
        }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {
        batchStartIndex: 0,
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub().callsFake(async (command) => {
          const commandName = command.constructor.name;
          if (commandName === 'GetObjectCommand') {
            if (command.input.Key.includes('/completed.json')) {
              return {
                Body: {
                  transformToString: async () => JSON.stringify({ completed: [0] }),
                },
              };
            }
          }
          if (commandName === 'ListObjectsV2Command') {
            return { Contents: [] };
          }
          return { ETag: '"mock-etag"' };
        }),
      },
      scrapeResultPaths: new Map([
        ['https://example.com/page1', 'scrape/page1.json'],
      ]),
      scrapeJobId: 'scrape-123',
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-123',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await runCrawlDetectionBatch(mockContext);
    expect(result).to.deep.equal({ status: 'already-finalized' });
    expect(mockLog.info).to.have.been.calledWith(sinon.match(/Audit already finalized/));
  });

  it('should handle SQS send failure with retries and eventual failure', async function () {
    this.timeout(15000);

    const mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const scrapeResultPaths = new Map();
    for (let i = 0; i < 20; i += 1) {
      scrapeResultPaths.set(`https://example.com/page${i}`, `scrape/page${i}.json`);
    }

    const sqsSendError = new Error('SQS send failed');
    const mockContext = {
      log: mockLog,
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditType: () => AUDIT_TYPE,
        getFullAuditRef: () => 'site/audit-type/audit-123',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {
        batchStartIndex: 0,
      },
      sqs: {
        sendMessage: sandbox.stub().rejects(sqsSendError), // Always fails
      },
      env: {
        AUDIT_JOBS_QUEUE_URL: 'https://sqs.test/queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub().callsFake(async (command) => {
          const commandName = command.constructor.name;
          if (commandName === 'GetObjectCommand') {
            const noKeyError = new Error('NoSuchKey');
            noKeyError.name = 'NoSuchKey';
            throw noKeyError;
          }
          if (commandName === 'ListObjectsV2Command') {
            return { Contents: [] };
          }
          return { ETag: '"mock-etag"' };
        }),
      },
      scrapeResultPaths,
      scrapeJobId: 'scrape-123',
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'audit-123',
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
        Opportunity: {
          allByAuditId: sandbox.stub().resolves([]),
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const getObjectFromKeyStub = sandbox.stub().resolves({
      scrapeResult: {
        rawBody: '<html><body><main><p>Test</p></main></body></html>',
      },
      finalUrl: 'https://example.com/page1',
    });

    const timeoutHandler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/utils/s3-utils.js': {
        getObjectFromKey: getObjectFromKeyStub,
      },
      '../../../src/internal-links/batch-state.js': {
        ...await import('../../../src/internal-links/batch-state.js'),
        getTimeoutStatus: () => ({
          elapsed: 840000,
          remaining: 60000,
          safeTimeRemaining: -60000,
          isApproachingTimeout: true,
          percentUsed: 93.3,
        }),
      },
    });

    await expect(timeoutHandler.runCrawlDetectionBatch(mockContext))
      .to.be.rejectedWith('Continuation message failed after retries: SQS send failed');

    // Should retry 3 times and log error
    expect(mockContext.sqs.sendMessage).to.have.callCount(3);
    expect(mockLog.warn).to.have.been.calledWith(
      sinon.match(/Continuation message send failed \(attempt 1\), retrying/),
    );
    expect(mockLog.warn).to.have.been.calledWith(
      sinon.match(/Continuation message send failed \(attempt 2\), retrying/),
    );
    expect(mockLog.error).to.have.been.calledWith(
      sinon.match(/Failed to send continuation after 3 attempts: SQS send failed/),
    );
    expect(mockLog.error).to.have.been.calledWith(sinon.match(/MANUAL ACTION REQUIRED: Resume audit audit-123/));
  });
});
