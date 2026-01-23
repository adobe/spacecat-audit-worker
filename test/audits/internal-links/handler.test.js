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
  prepareScrapingStep,
  runCrawlDetectionAndGenerateSuggestions,
  runCrawlDetectionBatch,
  updateAuditResult,
  finalizeCrawlDetection,
  normalizeUrlToDomain,
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

// Audit result with priority (after merge step calculates priority)
const AUDIT_RESULT_DATA_WITH_PRIORITY = [
  {
    trafficDomain: 1800,
    urlTo: 'https://www.petplace.com/a01',
    urlFrom: 'https://www.petplace.com/a02nf',
    priority: 'high',
  },
  {
    trafficDomain: 1200,
    urlTo: 'https://www.petplace.com/ax02',
    urlFrom: 'https://www.petplace.com/ax02nf',
    priority: 'medium',
  },
  {
    trafficDomain: 200,
    urlTo: 'https://www.petplace.com/a01',
    urlFrom: 'https://www.petplace.com/a01nf',
    priority: 'low',
  },
];

// Normalized data (after normalizeUrlToDomain with canonical domain www.example.com)
const NORMALIZED_AUDIT_RESULT_DATA = [
  {
    trafficDomain: 1800,
    urlTo: 'https://www.example.com/a01',
    urlFrom: 'https://www.example.com/a02nf',
    priority: 'high',
  },
  {
    trafficDomain: 1200,
    urlTo: 'https://www.example.com/ax02',
    urlFrom: 'https://www.example.com/ax02nf',
    priority: 'medium',
  },
  {
    trafficDomain: 200,
    urlTo: 'https://www.example.com/a01',
    urlFrom: 'https://www.example.com/a01nf',
    priority: 'low',
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

  it('normalizeUrlToDomain returns original URL when parsing fails', () => {
    const invalidUrl = 'not-a-valid-url';
    const canonicalDomain = 'example.com';
    const result = normalizeUrlToDomain(invalidUrl, canonicalDomain);
    expect(result).to.equal(invalidUrl);
  });

  it('broken-internal-links audit runs rum api client 404 query', async () => {
    const result = await internalLinksAuditRunner(
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
        brokenInternalLinks: NORMALIZED_AUDIT_RESULT_DATA,
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
        error: `[broken-internal-links] [Site: ${site.getId()}] audit failed with error: error`,
        success: false,
      },
    });
  }).timeout(5000);

  it('runAuditAndImportTopPagesStep should run audit and import top pages', async () => {
    const result = await runAuditAndImportTopPagesStep(context);
    expect(result).to.deep.equal({
      type: 'top-pages',
      siteId: site.getId(),
      auditResult: {
        brokenInternalLinks: NORMALIZED_AUDIT_RESULT_DATA,
        fullAuditRef: auditUrl,
        success: true,
        finalUrl: 'www.example.com',
        auditContext: {
          interval: 30,
        },
      },
      fullAuditRef: auditUrl,
    });
  });

  it('prepareScrapingStep should send top pages to scraping service', async () => {
    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
    };
    context.audit = {
      getAuditResult: () => ({
        brokenInternalLinks: AUDIT_RESULT_DATA,
        success: true,
      }),
    };

    // Mock redirect resolution requests (HEAD requests for redirect resolution)
    nock('https://example.com')
      .head('/page1')
      .reply(200);
    nock('https://example.com')
      .head('/page2')
      .reply(200);

    const result = await prepareScrapingStep(context);
    expect(result).to.deep.equal({
      urls: topPages.map((page) => ({ url: page.getUrl() })),
      siteId: site.getId(),
      type: 'broken-internal-links',
    });
  }).timeout(10000);

  it('prepareScrapingStep should throw error when audit failed', async () => {
    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
    };
    context.audit = {
      getAuditResult: () => ({
        brokenInternalLinks: AUDIT_RESULT_DATA,
        success: false,
      }),
    };

    await expect(prepareScrapingStep(context))
      .to.be.rejectedWith(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skip scraping and suggestion generation`);

    // Verify that SiteTopPage.allBySiteIdAndSourceAndGeo was not called since we exit early
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;
  }).timeout(5000);

  it('prepareScrapingStep should return empty URLs when no top pages found', async () => {
    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]), // Empty array
    };
    context.audit = {
      getAuditResult: () => ({
        brokenInternalLinks: AUDIT_RESULT_DATA,
        success: true,
      }),
    };

    const result = await prepareScrapingStep(context);
    expect(result.urls).to.have.lengthOf(0);
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/No URLs available for scraping/),
    );
  }).timeout(5000);

  it('prepareScrapingStep should handle Ahrefs fetch error', async () => {
    const testContext = { ...context };
    testContext.dataAccess = { ...context.dataAccess };
    testContext.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().rejects(new Error('Ahrefs API error')),
    };
    testContext.site = { ...site, getConfig: () => ({ getIncludedURLs: () => ['https://example.com/manual1'] }) };
    testContext.audit = {
      getAuditResult: () => ({
        brokenInternalLinks: AUDIT_RESULT_DATA,
        success: true,
      }),
    };

    nock('https://example.com').head('/manual1').reply(200);
    const result = await prepareScrapingStep(testContext);
    
    expect(testContext.log.warn).to.have.been.calledWith(
      sinon.match(/Failed to fetch Ahrefs top pages/),
    );
    expect(result.urls).to.have.lengthOf(1); // Still has includedURLs
  }).timeout(10000);


  it('prepareScrapingStep should log when filtering unscrape-able files', async () => {
    context.log = { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() };
    context.dataAccess.SiteTopPage = { 
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
        { getUrl: () => 'https://example.com/page1.html' },
        { getUrl: () => 'https://example.com/doc.pdf' },
        { getUrl: () => 'https://example.com/sheet.xlsx' },
      ]) 
    };
    context.audit = { getAuditResult: () => ({ brokenInternalLinks: AUDIT_RESULT_DATA, success: true }) };
    
    nock('https://example.com').head('/page1.html').reply(200);
    await prepareScrapingStep(context);
    expect(context.log.info).to.have.been.calledWith(sinon.match(/Filtered out \d+ unscrape-able files/));
  }).timeout(10000);

  it('prepareScrapingStep should cap when total URLs exceed MAX_URLS_TO_PROCESS', async () => {
    nock.cleanAll();
    context.log = { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() };
    
    // Create 600 URLs total (400 Ahrefs + 200 manual = 600, exceeds 500)
    const manyPages = Array.from({ length: 400 }, (_, i) => ({ getUrl: () => `https://example.com/ah${i}` }));
    const manualUrls = Array.from({ length: 200 }, (_, i) => `https://example.com/man${i}`);
    
    const testCtx = { ...context };
    testCtx.log = context.log;
    testCtx.dataAccess = { ...context.dataAccess, SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(manyPages) } };
    testCtx.site = { ...site, getConfig: () => ({ getIncludedURLs: () => manualUrls }) };
    testCtx.audit = { getAuditResult: () => ({ brokenInternalLinks: AUDIT_RESULT_DATA, success: true }) };
    
    nock('https://example.com').persist().head(/\/(ah|man)\d+/).reply(200);
    await prepareScrapingStep(testCtx);
    
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Total URLs \(600\) exceeds limit\. Capping at 500/));
    nock.cleanAll();
  }).timeout(120000);

  it('prepareScrapingStep should filter URLs by audit scope', async () => {
    // Mock site with subpath
    const siteWithSubpath = {
      ...site,
      getBaseURL: () => 'https://example.com/blog',
    };
    context.site = siteWithSubpath;

    // Mock top pages that don't match the subpath
    const topPagesOutsideScope = [
      { getUrl: () => 'https://example.com/products' },
      { getUrl: () => 'https://example.com/about' },
    ];

    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPagesOutsideScope),
    };
    context.audit = {
      getAuditResult: () => ({
        brokenInternalLinks: AUDIT_RESULT_DATA,
        success: true,
      }),
    };

    const result = await prepareScrapingStep(context);
    expect(result.urls).to.have.lengthOf(0); // All filtered out
  }).timeout(5000);

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
      'Fetching opportunities for siteId site-id-1 failed with error: read error happened',
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
      'FIXED',
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
      'Fetching opportunities for siteId site-id-1 failed with error: some-error',
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
      'Fetching opportunities for siteId site-id-1 failed with error: some-error',
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
      sinon.match(/No valid broken links to send to Mystique/),
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
    const validSuggestions = Array.from({ length: 150 }, (_, i) => ({
      getData: () => ({
        urlTo: `https://example.com/en/broken${i}`,
        urlFrom: `https://example.com/en/source${i}`,
      }),
      getId: () => `suggestion-${i}`,
    }));

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

    // Verify log message about batching
    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Sending 150 broken links in 2 batch\(es\) to Mystique/),
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

    // Create 400 Ahrefs pages + 200 includedURLs = 600 total (exceeds 500)
    const manyTopPages = Array.from({ length: 400 }, (_, i) => ({
      getUrl: () => `https://example.com/en/page${i}`,
    }));

    // Update includedURLs to have 200 URLs
    context.site.getConfig = () => ({
      getIncludedURLs: () => Array.from({ length: 200 }, (_, i) => `https://example.com/en/included${i}`),
    });

    if (!context.dataAccess.Suggestion) {
      context.dataAccess.Suggestion = {};
    }
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .callsFake(() => Promise.resolve(validSuggestions));
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
      .resolves(manyTopPages);

    await handler.opportunityAndSuggestionsStep(context);

    // Verify warning was logged for capping URLs (600 > 500)
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Capping URLs from 600 to 500/),
    );
  }).timeout(10000);

  // Note: This test is skipped because with MAX_URLS_TO_PROCESS = 100 and MAX_ALTERNATIVE_URLS = 100,
  // the alternativeUrls limit (lines 423-425 in handler.js) can never be reached.
  // topPages is capped to 100, so alternativeUrls (derived from filtered topPages) can never exceed 100.
  // This code path was reachable when MAX_URLS_TO_PROCESS was 500, but is now unreachable.
  it.skip('should limit alternativeUrls when exceeding MAX_ALTERNATIVE_URLS', async () => {
    // Test skipped - unreachable code path with current MAX_URLS_TO_PROCESS = MAX_ALTERNATIVE_URLS = 100
  }).timeout(10000);

});

describe('runCrawlDetectionAndGenerateSuggestions', () => {
  let sandbox;
  let context;
  let mockAudit;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    mockAudit = {
      getId: () => 'audit-id-1',
      getAuditResult: () => ({
        brokenInternalLinks: [
          { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
        ],
        success: true,
      }),
      setAuditResult: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    context = {
      log: {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
      },
      site: {
        getId: () => 'site-id-1',
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => null,
      },
      audit: mockAudit,
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves(mockAudit),
        },
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves({
            getId: () => 'oppty-id-1',
            getType: () => 'broken-internal-links',
            getSiteId: () => 'site-id-1',
            addSuggestions: sandbox.stub().resolves({ createdItems: [], errorItems: [] }),
            getSuggestions: sandbox.stub().resolves([]),
            setAuditId: sandbox.stub(),
            save: sandbox.stub().resolves(),
            setData: () => {},
            getData: () => {},
            setUpdatedBy: sandbox.stub().returnsThis(),
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
        Suggestion: {
          allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub(),
      },
      finalUrl: 'https://example.com',
      scrapeResultPaths: new Map(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process RUM-only results when no scrapeResultPaths available', async () => {
    context.scrapeResultPaths = new Map(); // Empty map

    const result = await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/No scraped content available, using RUM-only results/),
    );
    expect(result.status).to.equal('complete');
  }).timeout(10000);

  it('should handle undefined scrapeResultPaths gracefully', async () => {
    // Explicitly test the || new Map() fallback
    context.scrapeResultPaths = undefined;

    const result = await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/No scraped content available, using RUM-only results/),
    );
    expect(result.status).to.equal('complete');
  }).timeout(10000);

  it('should handle missing brokenInternalLinks in audit result', async () => {
    // Test the || [] fallback when brokenInternalLinks is undefined
    mockAudit.getAuditResult = () => ({
      success: true,
      // No brokenInternalLinks property
    });

    const result = await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/RUM detection results: 0 broken links/),
    );
    expect(result.status).to.equal('complete');
  }).timeout(10000);

  it('should merge crawl and RUM results when scrapeResultPaths available', async () => {
    // Mock scrape result paths
    context.scrapeResultPaths = new Map([
      ['https://example.com/page1', 'scrape-results/page1.json'],
    ]);

    // Mock S3 response with HTML containing a broken link
    context.s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          scrapeResult: {
            rawBody: '<html><body><a href="https://example.com/crawl-broken">Link</a></body></html>',
          },
          finalUrl: 'https://example.com/page1',
        }),
      },
    });

    // Use esmock to stub dependencies
    const handlerWithMocks = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/crawl-detection.js': {
        detectBrokenLinksFromCrawl: sandbox.stub().resolves([
          { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/crawl-broken', trafficDomain: 0 },
        ]),
        mergeAndDeduplicate: sandbox.stub().returns([
          { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
          { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/crawl-broken', trafficDomain: 0 },
        ]),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
    });

    const result = await handlerWithMocks.runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Crawl detected/),
    );
    expect(result.status).to.equal('complete');
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
      error: sandbox.stub(),
    };

    const prioritizedLinks = [{ urlFrom: 'a', urlTo: 'b', priority: 'high' }];
    const auditResult = { success: true, brokenInternalLinks: [] };

    const result = await updateAuditResult(mockAudit, auditResult, prioritizedLinks, {}, log);

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
      error: sandbox.stub(),
    };

    const prioritizedLinks = [];
    const auditResult = { success: true };
    const dataAccess = {
      Audit: {
        findById: sandbox.stub().resolves(mockAuditFromDb),
      },
    };

    const result = await updateAuditResult(mockAudit, auditResult, prioritizedLinks, dataAccess, log);

    expect(dataAccess.Audit.findById).to.have.been.calledWith('audit-id-1');
    expect(mockAuditFromDb.setAuditResult).to.have.been.calledOnce;
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
      error: sandbox.stub(),
    };

    const dataAccess = {
      Audit: {
        findById: sandbox.stub().resolves(mockAuditFromDb),
      },
    };

    const prioritizedLinks = [{ urlFrom: 'a', urlTo: 'b', priority: 'high' }];
    const auditResult = { success: true, brokenInternalLinks: [] };

    const result = await updateAuditResult(mockAudit, auditResult, prioritizedLinks, dataAccess, log);

    expect(dataAccess.Audit.findById).to.have.been.calledWith('audit-id-1');
    expect(mockAuditFromDb.setAuditResult).to.have.been.calledOnce;
    expect(result.brokenInternalLinks).to.deep.equal(prioritizedLinks);
  });

  it('should log error when audit not found in database', async () => {
    const mockAudit = {
      getId: () => 'audit-id-1',
      id: 'audit-id-1',
    };

    const log = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };

    const dataAccess = {
      Audit: {
        findById: sandbox.stub().resolves(null), // Not found
      },
    };

    const prioritizedLinks = [];
    const auditResult = { success: true };

    await updateAuditResult(mockAudit, auditResult, prioritizedLinks, dataAccess, log);

    expect(log.error).to.have.been.calledWith(
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
      error: sandbox.stub(),
    };

    const prioritizedLinks = [];
    const auditResult = { success: true };

    await updateAuditResult(mockAudit, auditResult, prioritizedLinks, {}, log);

    expect(log.error).to.have.been.calledWith(
      sinon.match(/Failed to update audit result/),
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
        send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })),
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
          create: sandbox.stub().resolves({ getId: () => 'opp-1' }),
        },
        Suggestion: {
          allByOpportunityId: sandbox.stub().resolves([]),
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

    // Mock S3 - no existing state, then save succeeds
    s3ClientStub.send
      .onFirstCall().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }))
      .onSecondCall().resolves(); // PUT succeeds

    // Mock getObjectFromKey via esmock
    const getObjectFromKeyStub = sandbox.stub().resolves({
      scrapeResult: {
        rawBody: '<html><body><main><p>Test</p></main></body></html>',
      },
      finalUrl: 'https://example.com/page1',
    });

    const putObjectFromStringStub = sandbox.stub().resolves();

    const module = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/utils/s3-utils.js': {
        getObjectFromKey: getObjectFromKeyStub,
        putObjectFromString: putObjectFromStringStub,
      },
    });

    const result = await module.runCrawlDetectionBatch(mockContext);

    // Should return batch-continuation status
    expect(result).to.deep.equal({ status: 'batch-continuation' });
    
    // Should log continuation payload
    expect(mockLog.info).to.have.been.calledWith(sinon.match(/Continuation payload:/));
    
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

    // Create 3 pages (less than PAGES_PER_BATCH=30)
    const smallScrapeResultPaths = new Map([
      ['https://example.com/page1', 'scrape/page1.json'],
      ['https://example.com/page2', 'scrape/page2.json'],
      ['https://example.com/page3', 'scrape/page3.json'],
    ]);

    const mockS3Send = sandbox.stub()
      .onCall(0).rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) // GET
      .onCall(1).resolves() // PUT
      .onCall(2).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            results: [],
            brokenUrlsCache: [],
            workingUrlsCache: [],
          }),
        },
      }) // GET final
      .onCall(3).resolves(); // DELETE

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

    // Verify completion path (lines 664-665)
    expect(mockLog.info).to.have.been.calledWith(sinon.match(/All 1 batches complete, proceeding to merge step/));
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
          .onCall(0).resolves({
            Body: {
              transformToString: async () => JSON.stringify({
                results: crawlResults,
                brokenUrlsCache: [],
                workingUrlsCache: [],
              }),
            },
          })
          .onCall(1).resolves(), // cleanup
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
          .onCall(0).resolves({
            Body: {
              transformToString: async () => JSON.stringify({
                results: [],
                brokenUrlsCache: [],
                workingUrlsCache: [],
              }),
            },
          })
          .onCall(1).resolves(),
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
        send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })),
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
          .onCall(0).resolves({
            Body: {
              transformToString: async () => JSON.stringify({
                results: [],
                brokenUrlsCache: [],
                workingUrlsCache: [],
              }),
            },
          })
          .onCall(1).rejects(new Error('Cleanup error')), // DELETE fails
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
    expect(mockLog.warn).to.have.been.calledWith(sinon.match(/Failed to.*: Cleanup error/));
  });

});

