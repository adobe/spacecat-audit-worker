/*
 * Copyright 2024 Adobe. All rights reserved.
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
import esmock from 'esmock';

import { internalLinksAuditRunner } from '../../../src/internal-links/handler.js';
import {
  internalLinksData,
  expectedOpportunity,
  expectedSuggestions,
} from '../../fixtures/internal-links-data.js';
import { MockContextBuilder } from '../../shared.js';

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
};

describe('Broken internal links audit', () => {
  const context = new MockContextBuilder()
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
    })
    .build();

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
        auditContext: {
          interval: 30,
        },
      },
      fullAuditRef: auditUrl,
    });
  }).timeout(5000);
});

describe('broken-internal-links audit to opportunity conversion', () => {
  let addSuggestionsResponse;
  let opportunity;
  let auditData;

  let context;
  let handler;

  beforeEach(async () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        finalUrl: 'www.example.com',
      })
      .build();
    context.log = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };

    context.dataAccess.Configuration = {
      findLatest: () => ({
        isHandlerEnabledForSite: () => true,
      }),
    };

    context.dataAccess.Opportunity = {
      allBySiteIdAndStatus: sandbox.stub(),
      create: sandbox.stub(),
    };

    context.site = site;

    addSuggestionsResponse = {
      createdItems: [],
      errorItems: [],
    };

    opportunity = {
      getType: () => 'broken-internal-links',
      getId: () => 'oppty-id-1',
      getSiteId: () => 'site-id-1',
      addSuggestions: sandbox.stub().resolves(addSuggestionsResponse),
      getSuggestions: sandbox.stub().resolves([]),
      setAuditId: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    auditData = {
      siteId: 'site-id-1',
      id: 'audit-id-1',
      isLive: true,
      auditedAt: new Date().toISOString(),
      auditType: 'broken-internal-links',
      auditResult: {
        brokenInternalLinks: AUDIT_RESULT_DATA,
        auditContext: {
          interval: 30,
        },
      },
      fullAuditRef: auditUrl,
    };
    handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => ({
          ...auditData,
          auditResult: {
            brokenInternalLinks: AUDIT_RESULT_DATA_WITH_SUGGESTIONS,
          },
        }),
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('creates a new opportunity object with mocked suggestions', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);
    context.site.getLatestAuditByAuditType = () => auditData;

    const result = await handler.opportunityAndSuggestionsStep(context);

    expect(result.status).to.equal('complete');
    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
    expect(opportunity.addSuggestions).to.have.been.calledOnce;
    const suggestionsArg = opportunity.addSuggestions.getCall(0).args[0];
    expect(suggestionsArg).to.be.an('array').with.lengthOf(3);
    expect(suggestionsArg[0].data.urlTo).to.equal(
      'https://www.petplace.com/a01',
    );
    expect(suggestionsArg[0].data.urlsSuggested).to.deep.equal([
      'https://petplace.com/suggestion1',
      'https://petplace.com/suggestion12',
    ]);
    expect(suggestionsArg[0].data.aiRationale).to.equal('Some Rationale');
  }).timeout(5000);

  it('creating a new opportunity object fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.rejects(
      new Error('big error happened'),
    );

    await expect(
      handler.opportunityAndSuggestionsStep(context),
    ).to.be.rejectedWith('big error happened');

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(
      expectedOpportunity,
    );
    expect(context.log.error).to.have.been.calledOnceWith(
      'Failed to create new opportunity for siteId site-id-1 and auditId audit-id-1: big error happened',
    );

    // make sure that no new suggestions are added
    expect(opportunity.addSuggestions).to.have.been.to.not.have.been.called;
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

  it('updates the existing opportunity object', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    const existingSuggestions = expectedSuggestions.map((suggestion) => ({
      ...suggestion,
      opportunityId: opportunity.getId(),
      remove: sinon.stub(),
      save: sinon.stub(),
      getData: () => suggestion.data,
      setData: sinon.stub(),
      getStatus: sinon.stub().returns('NEW'),
    }));
    opportunity.getSuggestions.resolves(existingSuggestions);

    await handler.opportunityAndSuggestionsStep(context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(opportunity.setAuditId).to.have.been.calledOnceWith('audit-id-1');
    expect(opportunity.save).to.have.been.calledOnce;

    expect(
      context.dataAccess.Suggestion.bulkUpdateStatus,
    ).to.have.been.calledOnceWith([existingSuggestions[1]], 'OUTDATED');

    // make sure that 1 existing suggestion is updated
    expect(existingSuggestions[0].setData).to.have.been.calledOnce;
    expect(existingSuggestions[0].save).to.have.been.calledOnce;

    // make sure that 3 new suggestions are created
    expect(opportunity.addSuggestions).to.have.been.calledOnce;
    const suggestionsArg = opportunity.addSuggestions.getCall(0).args[0];
    expect(suggestionsArg).to.be.an('array').with.lengthOf(1);
  }).timeout(5000);

  // it('should run audit and send urls for scraping step', async () => {
  //   const { brokenBacklinks } = auditDataMock.auditResult;
  //   const expectedBrokenBacklinks = auditDataMock.auditResult.brokenBacklinks.filter(
  //     (a) => a.url_to !== excludedUrl,
  //   );
  //   context.site = siteWithExcludedUrls;
  //   ahrefsMock(siteWithExcludedUrls.getBaseURL(), { backlinks: brokenBacklinks });

  //   const result = await runAuditAndImportTopPages(context);
  //   expect(result).to.deep.equal({
  //     type: 'top-pages',
  //     siteId: siteWithExcludedUrls.getId(),
  //     auditResult: {
  //       brokenBacklinks: expectedBrokenBacklinks,
  //       finalUrl: auditUrl,
  //     },
  //     fullAuditRef: auditDataMock.fullAuditRef,
  //   });
  // });
});
