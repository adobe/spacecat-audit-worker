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
  suggestionsInternalLinksHandler,
} from '../../../src/internal-links/suggestions-internal-links-handler.js';
import {
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
  getConfig: sinon.stub(),
  getDeliveryType: sinon.stub().returns('eds'),
};

describe('Broken internal links audit suggestions handler', () => {
  let addSuggestionsResponse;
  let opportunity;
  let auditData;

  let context;
  let handler;
  let message;
  let brokenInternalLinksChunk;

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
      findById: sandbox.stub(),
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

    brokenInternalLinksChunk = AUDIT_RESULT_DATA;

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

    message = {
      type: 'suggestions:internal-links',
      siteId: site.getId(),
      // auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        brokenInternalLinks: brokenInternalLinksChunk,
        size: brokenInternalLinksChunk.length,
        opportunityId: opportunity.getId(),
      },
    };

    handler = await esmock('../../../src/internal-links/suggestions-internal-links-handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => AUDIT_RESULT_DATA_WITH_SUGGESTIONS,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('Updates an existing opportunity object if one is found', async () => {
    context.dataAccess.Opportunity.findById.resolves(opportunity);
    // context.dataAccess.Opportunity.create.resolves(opportunity);
    context.site.getLatestAuditByAuditType = () => auditData;

    const result = await handler.suggestionsInternalLinksHandler(message, context);

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
  }).timeout(10000);

  //NA
  // it('creating a new opportunity object fails', async () => {
  //   context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
  //   context.dataAccess.Opportunity.create.rejects(
  //     new Error('big error happened'),
  //   );
  //   sandbox.stub(GoogleClient, 'createFrom').resolves({});

  //   await expect(
  //     handler.suggestionsInternalLinksHandler(message, context),
  //   ).to.be.rejectedWith('big error happened');

  //   expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(
  //     expectedOpportunity,
  //   );
  //   expect(context.log.error).to.have.been.calledOnceWith(
  //     'Failed to create new opportunity for siteId site-id-1 and auditId audit-id-1: big error happened',
  //   );

  //   // make sure that no new suggestions are added
  //   expect(opportunity.addSuggestions).to.have.been.to.not.have.been.called;
  // }).timeout(5000);

  it('fetching existing opportunity object fails', async () => {
    context.dataAccess.Opportunity.findById.rejects(
      new Error('read error happened'),
    );
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    handler = await esmock('../../../src/internal-links/suggestions-internal-links-handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
      },
    });

    await expect(
      handler.suggestionsInternalLinksHandler(message, context),
    ).to.be.rejectedWith('read error happened');
  }).timeout(5000);
 
  it('fetching existing opportunity object suceeds but no opportunity found', async () => {
    // context.dataAccess.Opportunity.findById.resolves(null);
    opportunity.getId = () => 'oppty-id-2';
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    handler = await esmock('../../../src/internal-links/suggestions-internal-links-handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => [],
      },
    });

    await expect(
      handler.suggestionsInternalLinksHandler(message, context),
    ).to.be.rejectedWith('Opportunity not found');
  }).timeout(5000);

  

  it('Updating an opportunity object suceeds even if suggestion generation error occurs', async () => {
    context.dataAccess.Opportunity.findById.resolves(opportunity);
    // context.dataAccess.Opportunity.create.resolves(opportunity);
    sandbox.stub(GoogleClient, 'createFrom').resolves({});

    context.site.getLatestAuditByAuditType = () => auditData;

    handler = await esmock('../../../src/internal-links/suggestions-internal-links-handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: () => { throw new Error('error'); },
      },
    });

    const result = await handler.suggestionsInternalLinksHandler(message, context);

    expect(opportunity.addSuggestions).to.have.been.calledOnce;
    const suggestionsArg = opportunity.addSuggestions.getCall(0).args[0];
    expect(suggestionsArg).to.be.an('array').with.lengthOf(3);
    expect(suggestionsArg[0].data.urlTo).to.equal(
      'https://www.petplace.com/a01',
    );
    expect(suggestionsArg[0].data.urlsSuggested).to.be.empty;
    expect(suggestionsArg[0].data.aiRationale).to.equal('');
  }).timeout(5000);

  // not applicable for suggestions handler
  // it('Existing opportunity and suggestions are updated if no broken internal links found', async () => {
  //   // Create mock suggestions
  //   const mockSuggestions = [{}];

  //   const existingOpportunity = {
  //     setStatus: sandbox.spy(sandbox.stub().resolves()),
  //     setAuditId: sandbox.stub(),
  //     save: sandbox.spy(sandbox.stub().resolves()),
  //     getType: () => 'broken-internal-links',
  //     getSuggestions: sandbox.stub().resolves(mockSuggestions),
  //     setUpdatedBy: sandbox.stub().returnsThis(),
  //   };

  //   context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);

  //   //return empty array of broken internal links
  //   auditData.auditResult.brokenInternalLinks = [];

  //   // Mock Suggestion.bulkUpdateStatus
  //   context.dataAccess.Suggestion = {
  //     bulkUpdateStatus: sandbox.spy(sandbox.stub().resolves()),
  //   };

  //   // Mock statuses
  //   sandbox.stub(Oppty, 'STATUSES').value({ RESOLVED: 'RESOLVED', NEW: 'NEW' });
  //   sandbox.stub(SuggestionDataAccess, 'STATUSES').value({ OUTDATED: 'OUTDATED', NEW: 'NEW' });
  //   sandbox.stub(GoogleClient, 'createFrom').resolves({});
  //   context.site.getLatestAuditByAuditType = () => auditData;

  //   handler = await esmock('../../../src/internal-links/suggestions-internal-links-handler.js', {
  //     '../../../src/internal-links/suggestions-generator.js': {
  //       generateSuggestionData: () => [],
  //     },
  //   });

  //   const result = await handler.suggestionsInternalLinksHandler(message, context);

  //   // Verify opportunity was updated
  //   expect(existingOpportunity.setStatus).to.have.been.calledOnceWith('RESOLVED');

  //   // Verify suggestions were retrieved
  //   expect(existingOpportunity.getSuggestions).to.have.been.calledOnce;

  //   // Verify suggestions statuses were updated
  //   expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
  //     mockSuggestions,
  //     'OUTDATED',
  //   );
  //   expect(existingOpportunity.save).to.have.been.calledOnce;

  //   expect(result.status).to.equal('complete');
  // }).timeout(5000);

  //already covered
  // it('allBySiteIdAndStatus method fails', async () => {
  //   context.dataAccess.Opportunity.findById.rejects(
  //     new Error('some-error'),
  //   );
  //   context.dataAccess.Opportunity.create.resolves(opportunity);
  //   try {
  //     await handler.suggestionsInternalLinksHandler(message, context);
  //   } catch (err) {
  //     expect(err.message).to.equal(
  //       'Failed to fetch opportunities for siteId site-id-1: some-error',
  //     );
  //   }

  //   expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
  //   expect(context.log.error).to.have.been.calledOnceWith(
  //     'Fetching opportunities for siteId site-id-1 failed with error: some-error',
  //   );

  //   // make sure that no new suggestions are added
  //   expect(opportunity.addSuggestions).to.have.been.to.not.have.been.called;
  // }).timeout(5000);

  it('updates the existing opportunity object with new suggestions', async () => {

    // auditData.auditResult.brokenInternalLinks = [];
    // context.site.getLatestAuditByAuditType = () => auditData;
  
    context.dataAccess.Opportunity.findById.resolves(opportunity);
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

    await handler.suggestionsInternalLinksHandler(message, context);

    // expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    // expect(opportunity.setAuditId).to.have.been.calledOnceWith('audit-id-1');
    // expect(opportunity.save).to.have.been.calledOnce;

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
});