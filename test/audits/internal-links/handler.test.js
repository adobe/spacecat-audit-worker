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
} from '../../../src/internal-links/handler.js';
import {
  internalLinksData,
  expectedOpportunity,
  expectedSuggestions,
} from '../../fixtures/internal-links-data.js';
import { MockContextBuilder } from '../../shared.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;
const topPages = [{ getUrl: () => 'https://example.com/page1' }, { getUrl: () => 'https://example.com/page2' }];
const AUDIT_RESULT_DATA = [
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
        brokenInternalLinks: AUDIT_RESULT_DATA,
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

  it('broken-internal-links audit filters out links that are out of audit scope', async () => {
    // Mock RUM data with links both in and out of scope
    const mixedScopeLinks = [
      {
        url_from: 'https://example.com/page1',
        url_to: 'https://example.com/broken1', // In scope
        traffic_domain: 1000,
      },
      {
        url_from: 'https://example.com/other/page2',
        url_to: 'https://example.com/broken2', // Out of scope (from)
        traffic_domain: 2000,
      },
      {
        url_from: 'https://example.com/page3',
        url_to: 'https://example.com/other/broken3', // Out of scope (to)
        traffic_domain: 1500,
      },
    ];

    context.rumApiClient.query.resolves(mixedScopeLinks);

    // Mock isLinkInaccessible to return true for all
    nock('https://example.com')
      .get('/broken1')
      .reply(404);
    nock('https://example.com')
      .get('/broken2')
      .reply(404);
    nock('https://example.com')
      .get('/other/broken3')
      .reply(404);

    const result = await internalLinksAuditRunner(
      'www.example.com',
      context,
      site,
    );

    // Only the in-scope link should be included
    expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenInternalLinks[0]).to.deep.equal({
      urlFrom: 'https://example.com/page1',
      urlTo: 'https://example.com/broken1',
      trafficDomain: 1000,
    });

    // Check that the debug log was called for filtered links
    expect(context.log.debug).to.have.been.calledWith(
      sinon.match(/Filtered out.*out of scope/),
    );

    // Check that the info log was called for out-of-scope count
    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Filtered out 2 links out of audit scope/),
    );
  }).timeout(5000);

  it('runAuditAndImportTopPagesStep should run audit and import top pages', async () => {
    const result = await runAuditAndImportTopPagesStep(context);
    expect(result).to.deep.equal({
      type: 'top-pages',
      siteId: site.getId(),
      auditResult: {
        brokenInternalLinks: AUDIT_RESULT_DATA,
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

    const result = await prepareScrapingStep(context);
    expect(result).to.deep.equal({
      siteId: site.getId(),
      type: 'broken-internal-links',
      urls: topPages.map((page) => ({ url: page.getUrl() })),
    });
  }).timeout(5000);

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

  it('prepareScrapingStep should throw error when no top pages found in database', async () => {
    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]), // Empty array
    };
    context.audit = {
      getAuditResult: () => ({
        brokenInternalLinks: AUDIT_RESULT_DATA,
        success: true,
      }),
    };

    await expect(prepareScrapingStep(context))
      .to.be.rejectedWith(`No top pages found in database for site ${site.getId()}. Ahrefs import required.`);
  }).timeout(5000);

  it('prepareScrapingStep should throw error when all top pages filtered out by audit scope', async () => {
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

    await expect(prepareScrapingStep(context))
      .to.be.rejectedWith(`All 2 top pages filtered out by audit scope. BaseURL: https://example.com/blog requires subpath match but no pages match scope.`);
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
      sinon.match('Message sent to Mystique:'),
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
      sinon.match(/Filtered out 5 unscrape-able file URLs \(PDFs, Office docs, etc\.\) from alternative URLs before sending to Mystique/),
    );

    // Verify SQS was called with only scrapeable URLs
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    const messageArg = context.sqs.sendMessage.getCall(0).args[1];
    expect(messageArg.data.alternativeUrls).to.have.lengthOf(1);
    expect(messageArg.data.alternativeUrls[0]).to.equal('https://example.com/page1');
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
});

describe('submitForScraping', () => {
  let context;
  let submitForScraping;

  beforeEach(async () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        site: {
          getId: () => 'site-id-1',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getIncludedURLs: () => [],
          }),
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
          },
        },
      })
      .build();

    const module = await import('../../../src/internal-links/handler.js');
    submitForScraping = module.submitForScraping;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should merge Ahrefs top pages and includedURLs', async () => {
    const topPages = [
      { getUrl: () => 'https://example.com/page1' },
      { getUrl: () => 'https://example.com/page2' },
    ];

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);
    context.site.getConfig = () => ({
      getIncludedURLs: () => ['https://example.com/page3', 'https://example.com/page4'],
    });

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(4);
    expect(result.siteId).to.equal('site-id-1');
    expect(result.type).to.equal('broken-internal-links');
    expect(result.allowCache).to.be.false;
    expect(result.maxScrapeAge).to.equal(0);
  });

  it('should deduplicate URLs from Ahrefs and includedURLs', async () => {
    const topPages = [
      { getUrl: () => 'https://example.com/page1' },
      { getUrl: () => 'https://example.com/page2' },
    ];

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);
    context.site.getConfig = () => ({
      getIncludedURLs: () => ['https://example.com/page1', 'https://example.com/page3'],
    });

    const result = await submitForScraping(context);

    // Should have 3 unique URLs (page1 deduplicated)
    expect(result.urls).to.have.lengthOf(3);
    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/1 duplicates removed/),
    );
  });

  it('should filter out unscrape-able files (PDFs, Office docs)', async () => {
    const topPages = [
      { getUrl: () => 'https://example.com/page1' },
      { getUrl: () => 'https://example.com/document.pdf' },
      { getUrl: () => 'https://example.com/spreadsheet.xlsx' },
    ];

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);
    context.site.getConfig = () => ({
      getIncludedURLs: () => ['https://example.com/presentation.pptx'],
    });

    const result = await submitForScraping(context);

    // Should only have page1 (3 files filtered out)
    expect(result.urls).to.have.lengthOf(1);
    expect(result.urls[0].url).to.equal('https://example.com/page1');
    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Filtered out 3 unscrape-able files/),
    );
  });

  it('should throw error when no URLs found (no Ahrefs and no includedURLs)', async () => {
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);
    context.site.getConfig = () => ({
      getIncludedURLs: () => [],
    });

    await expect(submitForScraping(context))
      .to.be.rejectedWith(/No URLs found for site/);

    expect(context.log.error).to.have.been.calledWith(
      sinon.match(/No URLs found for site/),
    );
  });

  it('should handle only Ahrefs top pages (no includedURLs)', async () => {
    const topPages = [
      { getUrl: () => 'https://example.com/page1' },
      { getUrl: () => 'https://example.com/page2' },
    ];

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);
    context.site.getConfig = () => ({
      getIncludedURLs: () => [],
    });

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(2);
    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Found 0 manual includedURLs from siteConfig/),
    );
  });

  it('should handle only includedURLs (no Ahrefs top pages)', async () => {
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);
    context.site.getConfig = () => ({
      getIncludedURLs: () => ['https://example.com/page1', 'https://example.com/page2'],
    });

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(2);
    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Found 0 Ahrefs top pages/),
    );
  });

  it('should handle getConfig returning null or undefined', async () => {
    const topPages = [
      { getUrl: () => 'https://example.com/page1' },
    ];

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);
    context.site.getConfig = () => null;

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(1);
  });
});

describe('runCrawlDetectionAndGenerateSuggestions', () => {
  let context;
  let runCrawlDetectionAndGenerateSuggestions;
  let detectBrokenLinksFromCrawlStub;
  let mergeAndDeduplicateStub;
  let calculatePriorityStub;
  let opportunityAndSuggestionsStepStub;

  beforeEach(async () => {
    detectBrokenLinksFromCrawlStub = sandbox.stub();
    mergeAndDeduplicateStub = sandbox.stub();
    calculatePriorityStub = sandbox.stub();
    opportunityAndSuggestionsStepStub = sandbox.stub();

    const module = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/crawl-detection.js': {
        detectBrokenLinksFromCrawl: detectBrokenLinksFromCrawlStub,
        mergeAndDeduplicate: mergeAndDeduplicateStub,
      },
      '../../../src/internal-links/helpers.js': {
        calculatePriority: calculatePriorityStub,
        isLinkInaccessible: sandbox.stub(),
        calculateKpiDeltasForAudit: sandbox.stub(),
      },
    });

    runCrawlDetectionAndGenerateSuggestions = module.runCrawlDetectionAndGenerateSuggestions;
    opportunityAndSuggestionsStepStub = sandbox.stub(module, 'opportunityAndSuggestionsStep');

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        site: {
          getId: () => 'site-id-1',
          getBaseURL: () => 'https://example.com',
        },
        audit: {
          getAuditResult: () => ({
            brokenInternalLinks: [
              { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
            ],
          }),
          setAuditResult: sandbox.stub(),
        },
        scrapeResultPaths: new Map([
          ['https://example.com/page1', 's3-key-1'],
        ]),
        dataAccess: {
          Configuration: {
            findLatest: () => ({
              isHandlerEnabledForSite: sandbox.stub().returns(true),
            }),
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should use RUM-only results when feature toggle is OFF', async () => {
    context.dataAccess.Configuration.findLatest = () => ({
      isHandlerEnabledForSite: sandbox.stub().returns(false),
    });

    const rumLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
    ];

    calculatePriorityStub.returns([
      { ...rumLinks[0], priority: 'high' },
    ]);

    opportunityAndSuggestionsStepStub.resolves({ status: 'complete' });

    const result = await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Feature toggle OFF: Crawl detection is disabled/),
    );
    expect(detectBrokenLinksFromCrawlStub).to.not.have.been.called;
    expect(calculatePriorityStub).to.have.been.calledWith(rumLinks);
    expect(result.status).to.equal('complete');
  });

  it('should run crawl detection and merge with RUM when feature toggle is ON', async () => {
    const rumLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
    ];

    const crawlLinks = [
      { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2', trafficDomain: 0 },
    ];

    const mergedLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
      { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2', trafficDomain: 0 },
    ];

    detectBrokenLinksFromCrawlStub.resolves(crawlLinks);
    mergeAndDeduplicateStub.returns(mergedLinks);
    calculatePriorityStub.returns(mergedLinks.map((link, idx) => ({
      ...link,
      priority: idx === 0 ? 'high' : 'low',
    })));
    opportunityAndSuggestionsStepStub.resolves({ status: 'complete' });

    const result = await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Feature toggle ON: Crawl detection is enabled/),
    );
    expect(detectBrokenLinksFromCrawlStub).to.have.been.calledOnce;
    expect(mergeAndDeduplicateStub).to.have.been.calledWith(crawlLinks, rumLinks, context.log);
    expect(calculatePriorityStub).to.have.been.calledWith(mergedLinks);
    expect(context.audit.setAuditResult).to.have.been.called;
    expect(result.status).to.equal('complete');
  });

  it('should fall back to RUM-only when no scraped content available', async () => {
    context.scrapeResultPaths = new Map(); // Empty map

    const rumLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
    ];

    calculatePriorityStub.returns([
      { ...rumLinks[0], priority: 'high' },
    ]);
    opportunityAndSuggestionsStepStub.resolves({ status: 'complete' });

    const result = await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/No scraped content available, falling back to RUM-only/),
    );
    expect(detectBrokenLinksFromCrawlStub).to.not.have.been.called;
    expect(calculatePriorityStub).to.have.been.calledWith(rumLinks);
    expect(result.status).to.equal('complete');
  });

  it('should calculate and log priority distribution', async () => {
    const rumLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 1000 },
      { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2', trafficDomain: 500 },
    ];

    const crawlLinks = [
      { urlFrom: 'https://example.com/page3', urlTo: 'https://example.com/broken3', trafficDomain: 0 },
    ];

    const mergedLinks = [...rumLinks, ...crawlLinks];

    detectBrokenLinksFromCrawlStub.resolves(crawlLinks);
    mergeAndDeduplicateStub.returns(mergedLinks);
    calculatePriorityStub.returns([
      { ...rumLinks[0], priority: 'high' },
      { ...rumLinks[1], priority: 'medium' },
      { ...crawlLinks[0], priority: 'low' },
    ]);
    opportunityAndSuggestionsStepStub.resolves({ status: 'complete' });

    await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Priority distribution: 1 high, 1 medium, 1 low/),
    );
  });

  it('should log merge statistics (crawl-only, RUM-only, overlap)', async () => {
    const rumLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
    ];

    const crawlLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 },
      { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2', trafficDomain: 0 },
    ];

    const mergedLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
      { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2', trafficDomain: 0 },
    ];

    detectBrokenLinksFromCrawlStub.resolves(crawlLinks);
    mergeAndDeduplicateStub.returns(mergedLinks);
    calculatePriorityStub.returns(mergedLinks);
    opportunityAndSuggestionsStepStub.resolves({ status: 'complete' });

    await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/Merge results: 2 total \(1 crawl-only, 0 RUM-only, 1 overlap\)/),
    );
  });

  it('should handle empty RUM links', async () => {
    context.audit.getAuditResult = () => ({
      brokenInternalLinks: [],
    });

    const crawlLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 },
    ];

    detectBrokenLinksFromCrawlStub.resolves(crawlLinks);
    mergeAndDeduplicateStub.returns(crawlLinks);
    calculatePriorityStub.returns(crawlLinks);
    opportunityAndSuggestionsStepStub.resolves({ status: 'complete' });

    await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/RUM detection results: 0 broken links/),
    );
    expect(mergeAndDeduplicateStub).to.have.been.calledWith(crawlLinks, [], context.log);
  });

  it('should update audit result with prioritized links', async () => {
    const rumLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
    ];

    const prioritizedLinks = [
      { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100, priority: 'high' },
    ];

    context.dataAccess.Configuration.findLatest = () => ({
      isHandlerEnabledForSite: sandbox.stub().returns(false),
    });

    calculatePriorityStub.returns(prioritizedLinks);
    opportunityAndSuggestionsStepStub.resolves({ status: 'complete' });

    await runCrawlDetectionAndGenerateSuggestions(context);

    expect(context.audit.setAuditResult).to.have.been.calledWith(
      sinon.match({
        brokenInternalLinks: prioritizedLinks,
      }),
    );
  });
});
