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
  submitForScraping,
  runCrawlDetectionAndGenerateSuggestions,
  updateAuditResult,
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

  it('should return empty array when RUM returns no broken links', async () => {
    context.rumApiClient.query.resolves([]);
    const result = await internalLinksAuditRunner(
      'www.example.com',
      context,
      site,
    );
    expect(result).to.deep.equal({
      auditResult: {
        brokenInternalLinks: [],
        fullAuditRef: auditUrl,
        finalUrl: 'www.example.com',
        auditContext: { interval: 30 },
        success: true,
      },
      fullAuditRef: auditUrl,
    });
    expect(context.log.info).to.have.been.calledWith(sinon.match(/No 404 internal links found in RUM data/));
  }).timeout(5000);

  it('should filter out links that are no longer broken', async () => {
    const mockLinksFromRUM = [
      { url_to: 'https://example.com/broken', url_from: 'https://example.com/page1', traffic_domain: 100 },
      { url_to: 'https://example.com/fixed', url_from: 'https://example.com/page2', traffic_domain: 50 },
    ];

    context.rumApiClient.query.resolves(mockLinksFromRUM);

    // Mock isLinkInaccessible to return true for first link, false for second
    const mockIsLinkInaccessible = async (url) => {
      if (url === 'https://example.com/broken') return true;
      if (url === 'https://example.com/fixed') return false;
      return false;
    };

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/helpers.js': {
        isLinkInaccessible: mockIsLinkInaccessible,
        calculatePriority: (links) => links,
        calculateKpiDeltasForAudit: () => {},
      },
    });

    const result = await handler.internalLinksAuditRunner('www.example.com', context, site);

    expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://example.com/broken');
    expect(context.log.debug).to.have.been.calledWith(sinon.match(/is now fixed/));
  }).timeout(5000);

  it('should filter out links that are out of audit scope and log them', async () => {
    const siteWithSubpath = {
      ...site,
      getBaseURL: () => 'https://example.com/blog',
    };

    const mockLinksFromRUM = [
      { url_to: 'https://example.com/blog/post1', url_from: 'https://example.com/blog/index', traffic_domain: 100 },
      { url_to: 'https://example.com/products/item', url_from: 'https://example.com/blog/index', traffic_domain: 50 },
    ];

    context.rumApiClient.query.resolves(mockLinksFromRUM);
    context.site = siteWithSubpath;

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/helpers.js': {
        isLinkInaccessible: async () => true,
        calculatePriority: (links) => links,
        calculateKpiDeltasForAudit: () => {},
      },
    });

    const result = await handler.internalLinksAuditRunner('www.example.com', context, siteWithSubpath);

    expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://example.com/blog/post1');
    expect(context.log.debug).to.have.been.calledWith(sinon.match(/Filtered out \(out of scope\)/));
    expect(context.log.info).to.have.been.calledWith(sinon.match(/Filtered out 1 links out of audit scope/));
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
      .to.be.rejectedWith(`No top pages found for site ${site.getId()}. Please configure includedURLs in siteConfig.`);
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

  it('prepareScrapingStep should use includedURLs and skip Ahrefs when configured', async () => {
    const includedURLs = ['https://example.com/page1', 'https://example.com/page2'];
    
    context.site.getConfig = () => ({
      getIncludedURLs: (type) => (type === 'broken-internal-links' ? includedURLs : []),
    });
    
    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
    };
    
    context.audit = {
      getAuditResult: () => ({
        brokenInternalLinks: AUDIT_RESULT_DATA,
        success: true,
      }),
    };

    const result = await prepareScrapingStep(context);
    
    // Verify Ahrefs was NOT called
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;
    
    // Verify log message about using includedURLs
    expect(context.log.info).to.have.been.calledWith(
      `[${AUDIT_TYPE}] [Site: ${site.getId()}] Using 2 includedURLs from siteConfig (Ahrefs skipped)`,
    );
    
    // Verify result contains includedURLs
    expect(result.urls).to.have.lengthOf(2);
    expect(result.urls[0].url).to.equal('https://example.com/page1');
    expect(result.urls[1].url).to.equal('https://example.com/page2');
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
    context.env = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
    };

    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };

    context.dataAccess.Opportunity = {
      allBySiteIdAndStatus: sandbox.stub().resolves([]),
      addSuggestions: sandbox.stub(),
      create: sandbox.stub().resolves({
        getId: () => 'opportunity-id',
        getSuggestions: sandbox.stub().resolves([]),
        addSuggestions: sandbox.stub().resolves({ createdItems: [], errorItems: [] }),
        setAuditId: sandbox.stub(),
        save: sandbox.stub().resolves(),
        setData: sandbox.stub(),
        getData: sandbox.stub(),
        setUpdatedBy: sandbox.stub().returnsThis(),
      }),
    };

    context.dataAccess.Audit = {
      findById: sandbox.stub().resolves({
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      }),
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

  describe('submitForScraping', () => {
    let originalFetch;

    beforeEach(() => {
      // Mock fetch for redirect resolution - default behavior is no redirect
      originalFetch = global.fetch;
      global.fetch = sandbox.stub().callsFake((url) => Promise.resolve({
        ok: true,
        url: url, // No redirect by default
      }));
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should use ONLY includedURLs when present (skip Ahrefs)', async () => {
      const mockTopPages = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/page2' },
      ];

      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(mockTopPages),
      };

      context.site.getConfig = sandbox.stub().returns({
        getIncludedURLs: sandbox.stub().returns(['https://example.com/page3', 'https://example.com/page1']), // page1 is duplicate
      });

      const result = await submitForScraping(context);

      // NEW BEHAVIOR: When includedURLs are configured, Ahrefs is SKIPPED
      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page3' },
          { url: 'https://example.com/page1' },
        ],
        siteId: 'site-id-1',
        type: 'broken-internal-links',
        allowCache: false,
        maxScrapeAge: 0,
      });

      // Verify Ahrefs was NOT called
      expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Found 2 manual includedURLs/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Using ONLY includedURLs/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/SKIPPING Ahrefs/));
    });

    it('should filter out unscrapeable URLs (PDFs, Office docs)', async () => {
      const mockTopPages = [
        { getUrl: () => 'https://example.com/page1.html' },
        { getUrl: () => 'https://example.com/doc.pdf' },
        { getUrl: () => 'https://example.com/file.xlsx' },
      ];

      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(mockTopPages),
      };

      context.site.getConfig = sandbox.stub().returns({
        getIncludedURLs: sandbox.stub().returns([]),
      });

      const result = await submitForScraping(context);

      expect(result.urls).to.deep.equal([
        { url: 'https://example.com/page1.html' },
      ]);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/Filtered out 2 unscrape-able files/));
    });

    it('should handle gracefully when no URLs are found (fallback to RUM-only)', async () => {
      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
      };

      context.site.getConfig = sandbox.stub().returns({
        getIncludedURLs: sandbox.stub().returns([]),
      });

      const result = await submitForScraping(context);

      expect(result).to.deep.equal({
        urls: [],
        siteId: 'site-id-1',
        type: 'broken-internal-links',
        allowCache: false,
        maxScrapeAge: 0,
      });

      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/No URLs found for site.*neither Ahrefs top pages nor includedURLs available/),
      );
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Audit will proceed with RUM-only detection/),
      );
    });

    it('should handle Ahrefs SSL error gracefully when no includedURLs exist', async () => {
      const sslError = new Error('SSL routines:final_renegotiate:unsafe legacy renegotiation disabled');

      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().rejects(sslError),
      };

      // No includedURLs configured - so Ahrefs will be attempted
      context.site.getConfig = sandbox.stub().returns({
        getIncludedURLs: sandbox.stub().returns([]),
      });

      const result = await submitForScraping(context);

      // When Ahrefs fails and no includedURLs exist, should return empty list
      expect(result).to.deep.equal({
        urls: [],
        siteId: 'site-id-1',
        type: 'broken-internal-links',
        allowCache: false,
        maxScrapeAge: 0,
      });

      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to fetch Ahrefs top pages.*SSL routines/),
      );
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/No URLs available for scraping/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Found 0 manual includedURLs from siteConfig/),
      );
    });

    it('should work with only manual includedURLs (Ahrefs skipped)', async () => {
      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
      };

      context.site.getConfig = sandbox.stub().returns({
        getIncludedURLs: sandbox.stub().returns(['https://example.com/manual1']),
      });

      const result = await submitForScraping(context);

      expect(result.urls).to.deep.equal([
        { url: 'https://example.com/manual1' },
      ]);

      // With new logic, Ahrefs is NOT called when includedURLs exist
      expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Found 1 manual includedURLs/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Using ONLY includedURLs/));
    });

    it('should handle site with no config or getIncludedURLs undefined', async () => {
      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
          { getUrl: () => 'https://example.com/page1' },
        ]),
      };

      // Test site with no getConfig method (returns undefined)
      context.site.getConfig = sandbox.stub().returns(undefined);

      const result = await submitForScraping(context);

      expect(result.urls).to.deep.equal([
        { url: 'https://example.com/page1' },
      ]);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/Found 0 manual includedURLs/));
    });

    it('should log ellipsis when more than 5 includedURLs', async () => {
      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
      };

      const manyUrls = Array.from({ length: 10 }, (_, i) => `https://example.com/url${i}`);
      context.site.getConfig = sandbox.stub().returns({
        getIncludedURLs: sandbox.stub().returns(manyUrls),
      });

      await submitForScraping(context);

      expect(context.log.debug).to.have.been.calledWith(sinon.match(/Manual includedURLs:.*\.\.\./));
    });

    it('should remove duplicate URLs before redirect resolution', async () => {
      const duplicateUrl = 'https://example.com/page1';

      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
      };

      // includedURLs contains internal duplicates
      context.site.getConfig = sandbox.stub().returns({
        getIncludedURLs: sandbox.stub().returns([
          duplicateUrl,
          'https://example.com/page2',
          duplicateUrl, // Duplicate
          'https://example.com/page3',
          duplicateUrl, // Another duplicate
        ]),
      });

      await submitForScraping(context);

      // Verify duplicate removal log (lines 260-261)
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Removed 2 duplicate URLs/));
    });

    it('should handle null site gracefully in includedURLs check', async () => {
      const originalContext = context.site;
      // Create a minimal site object that won't crash
      context.site = {
        getId: () => 'null-site-test',
        getBaseURL: () => 'https://example.com',
        getConfig: () => null // getConfig returns null to test optional chaining
      };

      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
      };

      await submitForScraping(context);

      // Should use empty array ([]) as includedURLs when getConfig returns null
      expect(context.log.info).to.have.been.calledWith(sinon.match(/No includedURLs configured/));

      context.site = originalContext; // Restore original site
    });

    it('should resolve redirects before submitting URLs for scraping', async () => {
      // Override the default fetch mock for this test
      global.fetch = sandbox.stub();
      // First URL redirects (from includedURLs)
      global.fetch.withArgs('https://example.com/redirect2').resolves({
        ok: true,
        url: 'https://example.com/final1',
      });
      // Second URL doesn't redirect
      global.fetch.withArgs('https://example.com/page2').resolves({
        ok: true,
        url: 'https://example.com/page2',
      });
      // Third URL has error (404 - not added to results)
      global.fetch.withArgs('https://example.com/error').resolves({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
      // Fourth URL throws network error (kept in results as fallback)
      global.fetch.withArgs('https://example.com/network-error').throws(new Error('Network timeout'));

      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
          { getUrl: () => 'https://example.com/redirect1' },
        ]),
      };

      context.site.getConfig = sandbox.stub().returns({
        getIncludedURLs: sandbox.stub().returns([
          'https://example.com/redirect2', // Will redirect to final1
          'https://example.com/page2',
          'https://example.com/error',
          'https://example.com/network-error'
        ]),
      });

      const result = await submitForScraping(context);

      // NEW BEHAVIOR: Ahrefs is SKIPPED when includedURLs exist, so redirect1 is not included
      expect(result.urls).to.deep.equal([
        { url: 'https://example.com/final1' }, // Redirect resolved from redirect2
        { url: 'https://example.com/page2' },  // No redirect
        { url: 'https://example.com/network-error' }, // Kept despite network error
        // error URL is NOT included (404 status)
      ]);

      // Verify Ahrefs was NOT called
      expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;

      expect(context.log.debug).to.have.been.calledWith(
        sinon.match(/Redirect resolved: https:\/\/example\.com\/redirect2 -> https:\/\/example\.com\/final1/),
      );
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/URL returned error status 404: https:\/\/example\.com\/error/),
      );
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to resolve redirects for https:\/\/example\.com\/network-error: Network timeout/),
      );
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Redirect resolution completed/));
      // With new logic: 4 includedURLs, but 1 has 404 error (not added to results) = 3 resolved, 2 errors
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Resolved 3 URLs, 2 errors/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Submitting 3 URLs for scraping/));
    });

    it('should remove duplicates after redirect resolution and log it', async () => {
      // Override the default fetch mock for this test
      global.fetch = sandbox.stub();
      // Multiple URLs redirect to the same final URL
      global.fetch.withArgs('https://example.com/redirect1').resolves({
        ok: true,
        url: 'https://example.com/final',
      });
      global.fetch.withArgs('https://example.com/redirect2').resolves({
        ok: true,
        url: 'https://example.com/final',  // Same as redirect1
      });
      global.fetch.withArgs('https://example.com/redirect3').resolves({
        ok: true,
        url: 'https://example.com/final',  // Same as redirect1 and redirect2
      });

      context.site.getConfig = sandbox.stub().returns({
        getIncludedURLs: sandbox.stub().returns([
          'https://example.com/redirect1',
          'https://example.com/redirect2',
          'https://example.com/redirect3',
        ]),
      });

      const result = await submitForScraping(context);

      // Only one URL should remain after deduplication
      expect(result.urls).to.deep.equal([
        { url: 'https://example.com/final' },
      ]);

      // Verify the duplicate removal log message
      expect(context.log.info).to.have.been.calledWith(
        `[${AUDIT_TYPE}] Removed 2 duplicates after redirect resolution`,
      );
    });
  });

  describe('runCrawlDetectionAndGenerateSuggestions', () => {
    let mockHandler;

    beforeEach(async () => {
      mockHandler = await esmock('../../../src/internal-links/handler.js', {
        '../../../src/internal-links/crawl-detection.js': {
          detectBrokenLinksFromCrawl: sandbox.stub().resolves([
            { urlTo: 'https://example.com/crawl1', urlFrom: 'https://example.com/page1', trafficDomain: 0 },
          ]),
          mergeAndDeduplicate: sandbox.stub().callsFake((crawl, rum) => [...crawl, ...rum]),
        },
        '../../../src/internal-links/helpers.js': {
          calculatePriority: sandbox.stub().callsFake((links) => links.map(l => ({ ...l, priority: 'high' }))),
          isLinkInaccessible: sandbox.stub().resolves(false),
          calculateKpiDeltasForAudit: sandbox.stub(),
        },
      });
    });

    it('should merge crawl + RUM results', async () => {
      const rumLinks = [
        { urlTo: 'https://example.com/rum1', urlFrom: 'https://example.com/page1', trafficDomain: 100 },
      ];

      context.audit = {
        getAuditResult: () => ({ brokenInternalLinks: rumLinks, success: true }),
        getId: () => 'test-audit-id',
      };

      // Mock database audit
      const mockDbAudit = {
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      // Mock the Audit import
      mockHandler.Audit = {
        findById: sandbox.stub().resolves(mockDbAudit),
        AUDIT_TYPES: {
          BROKEN_INTERNAL_LINKS: 'broken-internal-links',
        },
        AUDIT_STEP_DESTINATIONS: {
          IMPORT_WORKER: 'import-worker',
          SCRAPE_CLIENT: 'scrape-client',
        },
      };

      context.scrapeResultPaths = new Map([['https://example.com/page1', 's3-key-1']]);


      await mockHandler.runCrawlDetectionAndGenerateSuggestions(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/Using Ahrefs.*siteConfig crawl detection/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Starting crawl-based detection/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Merging RUM/));
    });

    it('should fall back to RUM-only when no scraped content is available', async () => {
      const rumLinks = [
        { urlTo: 'https://example.com/rum1', urlFrom: 'https://example.com/page1', trafficDomain: 100 },
      ];

      context.audit = {
        getAuditResult: () => ({ brokenInternalLinks: rumLinks, success: true }),
        getId: () => 'test-audit-id',
      };

      // Mock database audit
      const mockDbAudit = {
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      // Mock the Audit import
      mockHandler.Audit = {
        findById: sandbox.stub().resolves(mockDbAudit),
        AUDIT_TYPES: {
          BROKEN_INTERNAL_LINKS: 'broken-internal-links',
        },
        AUDIT_STEP_DESTINATIONS: {
          IMPORT_WORKER: 'import-worker',
          SCRAPE_CLIENT: 'scrape-client',
        },
      };

      context.scrapeResultPaths = new Map(); // Empty scrape results


      await mockHandler.runCrawlDetectionAndGenerateSuggestions(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/No scraped content available.*Falling back to RUM-only/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Note: Ensure the scraper completed successfully for job:/));
    });

    it('should handle undefined scrapeResultPaths and log scraper job ID', async () => {
      const rumLinks = [
        { urlTo: 'https://example.com/rum1', urlFrom: 'https://example.com/page1', trafficDomain: 100 },
      ];

      context.audit = {
        getAuditResult: () => ({ brokenInternalLinks: rumLinks, success: true }),
        getId: () => 'test-audit-id',
      };

      // Mock database audit
      const mockDbAudit = {
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      // Mock the Audit import
      mockHandler.Audit = {
        findById: sandbox.stub().resolves(mockDbAudit),
        AUDIT_TYPES: {
          BROKEN_INTERNAL_LINKS: 'broken-internal-links',
        },
        AUDIT_STEP_DESTINATIONS: {
          IMPORT_WORKER: 'import-worker',
          SCRAPE_CLIENT: 'scrape-client',
        },
      };

      // Set auditContext with scrapeJobId
      context.auditContext = { scrapeJobId: 'test-scrape-job-123' };

      // Don't set scrapeResultPaths at all to trigger the fallback on line 548
      // delete context.scrapeResultPaths; // This ensures it's undefined


      await mockHandler.runCrawlDetectionAndGenerateSuggestions(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/No scraped content available.*Falling back to RUM-only/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Ensure the scraper completed successfully for job: test-scrape-job-123/));
    });

    it('should log priority distribution after calculating priorities', async () => {
      const rumLinks = [
        { urlTo: 'https://example.com/rum1', urlFrom: 'https://example.com/page1', trafficDomain: 100 },
        { urlTo: 'https://example.com/rum2', urlFrom: 'https://example.com/page2', trafficDomain: 50 },
      ];

      context.audit = {
        getAuditResult: () => ({ brokenInternalLinks: rumLinks, success: true }),
        getId: () => 'test-audit-id',
      };

      // Mock database audit
      const mockDbAudit = {
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      // Mock the Audit import
      mockHandler.Audit = {
        findById: sandbox.stub().resolves(mockDbAudit),
        AUDIT_TYPES: {
          BROKEN_INTERNAL_LINKS: 'broken-internal-links',
        },
        AUDIT_STEP_DESTINATIONS: {
          IMPORT_WORKER: 'import-worker',
          SCRAPE_CLIENT: 'scrape-client',
        },
      };

      context.dataAccess.Configuration = {
        findLatest: () => ({
          isHandlerEnabledForSite: () => false,
        }),
      };

      context.scrapeResultPaths = new Map();


      await mockHandler.runCrawlDetectionAndGenerateSuggestions(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/Calculating priority for 2 broken links/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Priority distribution:/));
    });

    it('should handle auditResult with no brokenInternalLinks field', async () => {
      context.audit = {
        getAuditResult: () => ({}), // No brokenInternalLinks field
        getId: () => 'test-audit-id',
      };

      // Mock database audit
      const mockDbAudit = {
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      // Mock the Audit import
      mockHandler.Audit = {
        findById: sandbox.stub().resolves(mockDbAudit),
        AUDIT_TYPES: {
          BROKEN_INTERNAL_LINKS: 'broken-internal-links',
        },
        AUDIT_STEP_DESTINATIONS: {
          IMPORT_WORKER: 'import-worker',
          SCRAPE_CLIENT: 'scrape-client',
        },
      };

      context.dataAccess.Configuration = {
        findLatest: () => ({
          isHandlerEnabledForSite: () => false,
        }),
      };

      context.scrapeResultPaths = new Map();


      await mockHandler.runCrawlDetectionAndGenerateSuggestions(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/RUM detection results: 0 broken links/));
    });

    it('should handle links with undefined trafficDomain', async () => {
      const rumLinks = [
        { urlTo: 'https://example.com/rum1', urlFrom: 'https://example.com/page1' }, // No trafficDomain
      ];

      context.audit = {
        getAuditResult: () => ({ brokenInternalLinks: rumLinks, success: true }),
        getId: () => 'test-audit-id',
      };

      // Mock database audit
      const mockDbAudit = {
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      // Mock the Audit import
      mockHandler.Audit = {
        findById: sandbox.stub().resolves(mockDbAudit),
        AUDIT_TYPES: {
          BROKEN_INTERNAL_LINKS: 'broken-internal-links',
        },
        AUDIT_STEP_DESTINATIONS: {
          IMPORT_WORKER: 'import-worker',
          SCRAPE_CLIENT: 'scrape-client',
        },
      };

      context.dataAccess.Configuration = {
        findLatest: () => ({
          isHandlerEnabledForSite: () => false,
        }),
      };

      context.scrapeResultPaths = new Map();


      await mockHandler.runCrawlDetectionAndGenerateSuggestions(context);

      // Now logs at INFO level instead of DEBUG
      expect(context.log.info).to.have.been.calledWith(sinon.match(/RUM links total traffic: 0 views/));
    });

    it('should use Ahrefs when no includedURLs configured', async () => {
      const rumLinks = [
        { urlTo: 'https://example.com/rum1', urlFrom: 'https://example.com/page1', trafficDomain: 100 },
      ];

      context.audit = {
        getAuditResult: () => ({ brokenInternalLinks: rumLinks, success: true }),
        getId: () => 'test-audit-id',
        setAuditResult: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      // Configure site with NO includedURLs (triggers Ahrefs path on lines 448-451)
      context.site.getConfig = () => ({
        getIncludedURLs: () => [], // Empty array, no includedURLs
      });

      // Mock Ahrefs top pages
      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
          { getUrl: () => 'https://example.com/page1' },
          { getUrl: () => 'https://example.com/page2' },
        ]),
      };

      context.dataAccess.Opportunity = {
        create: sandbox.stub().resolves({
          getId: () => 'opp-123',
          getSuggestions: sandbox.stub().resolves([]),
          addSuggestions: sandbox.stub().resolves([]),
        }),
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
      };

      context.dataAccess.Suggestion = {
        create: sandbox.stub().resolves({ getId: () => 'sugg-123' }),
        allBySuggestionType: sandbox.stub().resolves([]),
        allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
      };

      // Disable Mystique to avoid complex opportunity flow
      context.dataAccess.Configuration = {
        findLatest: () => ({
          isHandlerEnabledForSite: () => false, // Disable Mystique
        }),
      };

      context.scrapeResultPaths = new Map();
      
      // Mock SQS even though Mystique is disabled
      context.sqsClient = {
        sendMessageToSQS: sandbox.stub().resolves(),
      };

      await mockHandler.runCrawlDetectionAndGenerateSuggestions(context);

      // Verify Ahrefs was called
      expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith('site-id-1', 'ahrefs', 'global');
      expect(context.log.info).to.have.been.calledWith(sinon.match(/No includedURLs configured, fetching Ahrefs top pages/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Found 2 top pages from Ahrefs/));
    });

    it('should filter out unscrape-able files from alternatives before sending to Mystique', async () => {
      const rumLinks = [
        { urlTo: 'https://example.com/broken', urlFrom: 'https://example.com/page1', trafficDomain: 100 },
      ];

      context.audit = {
        getAuditResult: () => ({ brokenInternalLinks: rumLinks, success: true }),
        getId: () => 'test-audit-id',
        setAuditResult: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      // Configure site with includedURLs that include PDFs
      context.site.getConfig = () => ({
        getIncludedURLs: () => [
          'https://example.com/page1',
          'https://example.com/document.pdf', // Unscrape-able
          'https://example.com/sheet.xlsx', // Unscrape-able
        ],
      });

      context.dataAccess.Opportunity = {
        create: sandbox.stub().resolves({
          getId: () => 'opp-123',
          getSuggestions: sandbox.stub().resolves([]),
          addSuggestions: sandbox.stub().resolves([]),
        }),
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
      };

      context.dataAccess.Suggestion = {
        create: sandbox.stub().resolves({ getId: () => 'sugg-123' }),
        allBySuggestionType: sandbox.stub().resolves([]),
        allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
      };

      // Enable Mystique to test the filtering logic
      context.dataAccess.Configuration = {
        findLatest: () => ({
          isHandlerEnabledForSite: () => true, // Enable Mystique
        }),
      };

      context.scrapeResultPaths = new Map();
      
      // Mock SQS to avoid actual message sending
      context.sqsClient = {
        sendMessageToSQS: sandbox.stub().resolves(),
      };

      await mockHandler.runCrawlDetectionAndGenerateSuggestions(context);

      // Verify unscrape-able files were filtered out (lines 515-516)
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Filtered out 2 unscrape-able file URLs \(PDFs, Office docs, etc\.\) from alternative URLs before sending to Mystique/));
    });


    // Unit tests for updateAuditResult function to achieve 100% coverage
    describe('updateAuditResult', () => {
      let originalFindById;

      beforeEach(() => {
        originalFindById = Audit.findById;
      });

      afterEach(() => {
        Audit.findById = originalFindById;
      });

      it('should successfully update audit result when audit has setAuditResult method', async () => {
        const mockAudit = {
          getId: () => 'test-audit-id',
          setAuditResult: sinon.stub(),
          save: sinon.stub().resolves(),
        };
        const mockAuditResult = { brokenInternalLinks: [] };
        const mockPrioritizedLinks = [{ urlTo: 'https://example.com/broken', priority: 'high' }];
        const mockDataAccess = { Audit: Audit };
        const mockLog = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

        await updateAuditResult(mockAudit, mockAuditResult, mockPrioritizedLinks, mockDataAccess, mockLog);

        // Direct update on audit object with explicit save
        expect(mockAudit.setAuditResult).to.have.been.calledWith({
          ...mockAuditResult,
          brokenInternalLinks: mockPrioritizedLinks,
        });
        expect(mockAudit.save).to.have.been.calledOnce;
        expect(mockLog.info).to.have.been.calledWith('[broken-internal-links] Updated audit result with 1 prioritized broken links');
      });

      it('should handle audit without setAuditResult method gracefully', async () => {
        const mockAudit = { getId: () => 'test-audit-id' }; // No setAuditResult method
        const mockAuditResult = { brokenInternalLinks: [] };
        const mockPrioritizedLinks = [{ urlTo: 'https://example.com/broken', priority: 'high' }];
        const mockDataAccess = { Audit: Audit };
        const mockLog = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

        await updateAuditResult(mockAudit, mockAuditResult, mockPrioritizedLinks, mockDataAccess, mockLog);

        expect(mockLog.warn).to.have.been.calledWith('[broken-internal-links] Audit object does not have setAuditResult method, cannot update');
      });

      it('should handle errors gracefully', async () => {
        const mockAudit = {
          getId: () => 'test-audit-id',
          setAuditResult: sinon.stub(),
          save: sinon.stub().rejects(new Error('Save failed')),
        };
        const mockAuditResult = { brokenInternalLinks: [] };
        const mockPrioritizedLinks = [{ urlTo: 'https://example.com/broken', priority: 'high' }];
        const mockDataAccess = { Audit: Audit };
        const mockLog = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

        await updateAuditResult(mockAudit, mockAuditResult, mockPrioritizedLinks, mockDataAccess, mockLog);

        expect(mockLog.error).to.have.been.calledWith('[broken-internal-links] Failed to update audit result: Save failed');
      });

    });


  });
});
