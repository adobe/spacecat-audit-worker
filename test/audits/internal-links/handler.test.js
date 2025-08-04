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
import nock from 'nock';
import esmock from 'esmock';
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { Opportunity as Oppty, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';

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

describe('Broken internal links audit ', () => {
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

    const result = await prepareScrapingStep(context);
    expect(result).to.deep.equal({
      siteId: site.getId(),
      type: 'broken-internal-links',
      urls: topPages.map((page) => ({ url: page.getUrl() })),
    });
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
      info: sandbox.stub(),
      error: sandbox.stub(),
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

    opportunity = {
      getType: () => 'broken-internal-links',
      getId: () => 'oppty-id-1',
      getSiteId: () => 'site-id-1',
      addSuggestions: sandbox.stub().resolves(addSuggestionsResponse),
      getSuggestions: sandbox.stub().resolves([]),
      setAuditId: sandbox.stub(),
      save: sandbox.stub().resolves(),
      setData: () => {},
      getData: () => {},
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
      },
    });
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .resolves(AUDIT_RESULT_DATA_WITH_SUGGESTIONS.map((data) => (
        { getData: () => data, getId: () => '1111', save: () => {} })));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('creates a new opportunity object if one is not found', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);
    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';

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
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);
    context.sqs.sendMessage.rejects(new Error('SQS error'));
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';

    await expect(
      handler.opportunityAndSuggestionsStep(context),
    ).to.be.rejectedWith('SQS error');

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(
      expectedOpportunity,
    );
  }).timeout(5000);

  it('creating a new opportunity object succeeds and sends SQS messages', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    context.site.getLatestAuditByAuditType = () => auditData;
    context.site.getDeliveryType = () => 'aem_edge';

    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(
      expectedOpportunity,
    );

    expect(result.status).to.equal('complete');

    // Verify SQS messages were sent
    expect(context.sqs.sendMessage).to.have.been.called;
    expect(context.log.info).to.have.been.calledWith(
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
    sandbox.stub(SuggestionDataAccess, 'STATUSES').value({ OUTDATED: 'OUTDATED', NEW: 'NEW' });
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
});
