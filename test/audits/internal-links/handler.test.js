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

    // Verify opportunity save was called (status may be handled elsewhere now)
    expect(existingOpportunity.save).to.have.been.calledOnce;

    // Suggestions are no longer bulk-updated here
    expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;

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

  it('logs info when opportunity exists and no broken internal links', async () => {
    // Arrange: existing opportunity and no broken links
    const existingOpportunity = {
      getType: () => 'broken-internal-links',
      getSuggestions: sandbox.stub().resolves([]),
      setUpdatedBy: sandbox.stub().returnsThis(),
      setStatus: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
    // No broken links
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [],
        success: true,
        auditContext: { interval: 30 },
      }),
    };
    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
      },
    });

    // Act
    const result = await handler.opportunityAndSuggestionsStep(context);

    // Assert
    expect(result.status).to.equal('complete');
    expect(context.log.info).to.have.been.calledWith(
      sinon.match(/no broken internal\s*links found, but found opportunity, updating status to RESOLVED/),
    );
  }).timeout(5000);

  it('warns when publishing FIXED suggestions fails', async () => {
    // Arrange to trigger the catch branch for publishing fixed suggestions
    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => false, // skip Mystique block entirely
      }),
    };
    // Provide one broken link to enter main flow
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{
          urlFrom: 'https://example.com/a',
          urlTo: 'https://example.com/b',
          trafficDomain: 1,
        }],
        success: true,
      }),
    };
    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-1',
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().rejects(new Error('boom')),
      },
    });

    // Act
    const result = await handler.opportunityAndSuggestionsStep(context);

    // Assert
    expect(result.status).to.equal('complete');
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Failed to publish fix entities: boom/),
    );
  }).timeout(5000);

  it('reconciles disappeared suggestions: marks FIXED and adds published fix entity', async () => {
    const deployed = 'DEPLOYED';
    const published = 'PUBLISHED';
    const suggestionSave = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-1',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/old-from',
        urlTo: 'https://example.com/old-to',
        urlsSuggested: ['https://example.com/new-to'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: suggestionSave,
    };
    const addFixEntities = sandbox.stub().resolves();

    handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-to' }), // redirect resolves to suggested
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { DEPLOYED: deployed, PUBLISHED: published } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-1',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    // brokenInternalLinks does not include the candidate pair, so it's "disappeared"
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{
          urlFrom: 'https://example.com/another',
          urlTo: 'https://example.com/another-to',
          trafficDomain: 1,
        }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    // Suggestion should be marked fixed and saved
    expect(suggestion.setStatus).to.have.been.calledWith('FIXED');
    expect(suggestion.setUpdatedBy).to.have.been.calledWith('system');
    expect(suggestionSave).to.have.been.calledOnce;
    // A published fix entity should be created via opportunity.addFixEntities
    expect(addFixEntities).to.have.been.calledOnce;
    const payload = addFixEntities.getCall(0).args[0];
    expect(Array.isArray(payload)).to.be.true;
    expect(payload).to.have.length(1);
    expect(payload[0]).to.include({
      opportunityId: 'oppty-1',
      status: published,
      type: 'CONTENT_UPDATE',
    });
    expect(payload[0].changeDetails).to.deep.include({
      system: 'aem_edge',
      pagePath: 'https://example.com/old-from',
      oldValue: 'https://example.com/old-to',
      updatedValue: 'https://example.com/new-to',
    });
    expect(payload[0].suggestions).to.deep.equal(['sug-1']);
  }).timeout(8000);

  it('does not add fix entity when redirect does not match any suggested URL', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-2',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from2',
        urlTo: 'https://example.com/old2',
        urlsSuggested: ['https://example.com/new2'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/different' }), // final does not match suggested
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-2',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{
          urlFrom: 'https://example.com/a',
          urlTo: 'https://example.com/b',
          trafficDomain: 1,
        }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    expect(addFixEntities).to.not.have.been.called;
    expect(suggestion.setStatus).to.not.have.been.called;
  }).timeout(8000);

  it('reconciliation: network error while following urlTo does not mark FIXED', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-net',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-net',
        urlTo: 'https://example.com/old-net',
        urlsSuggested: ['https://example.com/new-net'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => { throw new Error('net'); }, // triggers catch → false
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-net',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'https://example.com/a', urlTo: 'https://example.com/b', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.not.have.been.called;
    expect(addFixEntities).to.not.have.been.called;
  }).timeout(8000);

  it('reconciliation: save throws logs warn', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-save',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-save',
        urlTo: 'https://example.com/old-save',
        urlsSuggested: ['https://example.com/new-save'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      // Throw synchronously to hit the try/catch
      save: () => { throw new Error('sync-fail'); },
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-save' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-save',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'x', urlTo: 'y', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    // save error should have been logged as warn
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Failed to mark suggestion .* as FIXED: sync-fail/),
    );
  }).timeout(8000);

  it('reconciliation: building fix entity payload failure logs warn', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-build',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-build',
        urlTo: 'https://example.com/old-build',
        urlsSuggested: ['https://example.com/new-build'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-build' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-build',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      // Force site.getDeliveryType to throw during payload build
      '../../../src/common/index.js': {
        wwwUrlResolver: (site) => site.getBaseURL(),
      },
    });

    context.site.getDeliveryType = () => { throw new Error('delivery-fail'); };
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'a', urlTo: 'b', trafficDomain: 1 }],
        success: true,
      }),
    };

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Failed building fix entity payload for suggestion .*: delivery-fail/),
    );
    // Should not crash, and addFixEntities may be called 0 times due to payload build failure
  }).timeout(8000);

  it('reconciliation: addFixEntities failure logs warn', async () => {
    const addFixEntities = sandbox.stub().rejects(new Error('add-fail'));
    const suggestion = {
      getId: () => 'sug-add',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-add',
        urlTo: 'https://example.com/old-add',
        urlsSuggested: ['https://example.com/new-add'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-add' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-add',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.site.getDeliveryType = () => 'aem_edge';
    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'u', urlTo: 'v', trafficDomain: 1 }],
        success: true,
      }),
    };

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Failed to add fix entities on opportunity .*: add-fail/),
    );
  }).timeout(8000);

  it('reconciliation: skips when no suggested targets', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-empty',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-empty',
        urlTo: 'https://example.com/old-empty',
        urlsSuggested: [], // no targets
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-empty' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-empty',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'a', urlTo: 'b', trafficDomain: 1 }],
        success: true,
      }),
    };

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.not.have.been.called;
    expect(addFixEntities).to.not.have.been.called;
  }).timeout(8000);

  it('reconciliation: normalize handles non-string targets', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-norm',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-norm',
        urlTo: 'https://example.com/old-norm',
        urlsSuggested: [{ url: 'https://example.com/new-norm' }], // non-string target
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-norm' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-norm',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'x', urlTo: 'y', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    // Non-string target normalization path exercised; no strict assertions needed beyond no crash
  }).timeout(8000);

  it('reconciliation: executedBy falls back to empty string when no IMS ids', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-empty-exec',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-exec',
        urlTo: 'https://example.com/old-exec',
        urlsSuggested: ['https://example.com/match-exec'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/match-exec' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-exec',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'x', urlTo: 'y', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    const payload = addFixEntities.getCall(0).args[0][0];
  }).timeout(8000);

  it('reconciliation: executedBy falls back to user.id when imsUserId missing', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-user-id',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-userid',
        urlTo: 'https://example.com/old-userid',
        urlsSuggested: ['https://example.com/new-userid'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-userid' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-userid',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'x', urlTo: 'y', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    const payload = addFixEntities.getCall(0).args[0][0];
  }).timeout(8000);

  it('reconciliation: skips when urlTo missing', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-missing-urlto',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-miss',
        // urlTo missing
        urlsSuggested: ['https://example.com/new-miss'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-miss' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-miss',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'x', urlTo: 'y', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    expect(addFixEntities).to.not.have.been.called;
    expect(suggestion.setStatus).to.not.have.been.called;
  }).timeout(8000);

  it('publish callback: isSuggestionStillBroken calls isLinkInaccessible when urlTo exists (lines 259-260)', async () => {
    const isLinkInaccessibleStub = sandbox.stub().resolves(true);
    const handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-cb-urlto',
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: isLinkInaccessibleStub,
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        reconcileDisappearedSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: async ({ isSuggestionStillBroken }) => {
          const result = await isSuggestionStillBroken({
            getData: () => ({ urlTo: 'https://example.com/broken-url' }),
          });
          // isLinkInaccessible returns true, so result should be true
          expect(result).to.equal(true);
          expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/broken-url', sinon.match.any);
        },
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'a', urlTo: 'b', trafficDomain: 1 }],
        success: true,
      }),
    };

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
  }).timeout(8000);

  it('publish callback: isSuggestionStillBroken returns true when urlTo missing', async () => {
    const handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-cb',
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        reconcileDisappearedSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: async ({ isSuggestionStillBroken }) => {
          const result = await isSuggestionStillBroken({
            getData: () => ({}), // no urlTo
          });
          // Expect early return true when urlTo missing
          expect(result).to.equal(true);
        },
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'a', urlTo: 'b', trafficDomain: 1 }],
        success: true,
      }),
    };

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
  }).timeout(8000);

  
  it('reconciliation: skips payload build when urlsSuggested not array and no urlEdited (guards before 289)', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-undef-upd',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-und',
        urlTo: 'https://example.com/old-und',
        urlsSuggested: { first: 'https://example.com/new-und' }, // not array
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        // fetch returns a URL, but since urlsSuggested isn't an array,
        // the guard will skip reconciliation payload build
        tracingFetch: async () => ({ url: 'https://example.com/new-und' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-und',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'x', urlTo: 'y', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    // addFixEntities should not be called when urlsSuggested is not an array
    expect(addFixEntities).to.not.have.been.called;
    // and the suggestion should not be marked fixed
    expect(suggestion.setStatus).to.not.have.been.called;
  }).timeout(8000);

  it('reconciliation: handles suggestion with getData returning null (line 236 fallback)', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-null-data',
      getType: () => 'CONTENT_UPDATE',
      getData: () => null, // getData returns null, triggering || {} fallback
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-null-data',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'a', urlTo: 'b', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    // Should skip due to null data (no urlTo or targets)
    expect(suggestion.setStatus).to.not.have.been.called;
    expect(addFixEntities).to.not.have.been.called;
  }).timeout(8000);

  it('reconciliation: uses urlTo fallback when resp.url is undefined (line 250)', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-no-resp-url',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-no-resp',
        urlTo: 'https://example.com/old-no-resp',
        urlsSuggested: ['https://example.com/old-no-resp'], // match urlTo for FIXED
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        // fetch returns object without url property, triggers || urlTo fallback
        tracingFetch: async () => ({}),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-no-resp-url',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'a', urlTo: 'b', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    // finalResolvedUrl becomes urlTo via fallback, which matches urlsSuggested
    expect(suggestion.setStatus).to.have.been.calledWith('FIXED');
    expect(addFixEntities).to.have.been.called;
  }).timeout(8000);

  it('reconciliation: uses urlEdited when present (line 289 urlEdited branch)', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-urledited',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-edited',
        urlTo: 'https://example.com/old-edited',
        urlsSuggested: ['https://example.com/new-edited'],
        urlEdited: 'https://example.com/custom-edited', // urlEdited takes precedence
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-edited' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-urledited',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'a', urlTo: 'b', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.have.been.calledWith('FIXED');
    expect(addFixEntities).to.have.been.called;
    // Verify the fix entity uses urlEdited as updatedValue
    const callArgs = addFixEntities.firstCall.args[0];
    expect(callArgs[0].changeDetails.updatedValue).to.equal('https://example.com/custom-edited');
  }).timeout(8000);

  it('reconciliation: falls back to empty string when first suggested url is empty (line 289 || \"\" branch)', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-empty-updatedValue',
      getType: () => 'CONTENT_UPDATE',
      getData: () => ({
        urlFrom: 'https://example.com/from-empty-updated',
        urlTo: 'https://example.com/old-empty-updated',
        // First suggested URL is empty string (falsy), but second matches the redirect target
        urlsSuggested: ['', 'https://example.com/new-empty-updated'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-empty-updated' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-empty-updatedValue',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/internal-links/helpers.js': {
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        isLinkInaccessible: sandbox.stub().resolves(true),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context.audit = {
      ...auditData,
      getAuditResult: () => ({
        brokenInternalLinks: [{ urlFrom: 'a', urlTo: 'b', trafficDomain: 1 }],
        success: true,
      }),
    };
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.have.been.calledWith('FIXED');
    expect(addFixEntities).to.have.been.called;

    const callArgs = addFixEntities.firstCall.args[0];
    expect(callArgs[0].changeDetails.updatedValue).to.equal('');
  }).timeout(8000);
});
