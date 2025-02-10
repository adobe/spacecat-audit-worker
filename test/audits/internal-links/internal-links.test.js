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

import { internalLinksAuditRunner, opportunityAndSuggestions } from '../../../src/internal-links/handler.js';
import { internalLinksData, expectedOpportunity, expectedSuggestions } from '../../fixtures/internal-links-data.js';
import { MockContextBuilder } from '../../shared.js';

const AUDIT_RESULT_DATA = [
  {
    traffic_domain: 1800,
    url_to: 'https://www.petplace.com/a01',
    url_from: 'https://www.petplace.com/a02nf',
    priority: 'high',
  },
  {
    traffic_domain: 1200,
    url_to: 'https://www.petplace.com/ax02',
    url_from: 'https://www.petplace.com/ax02nf',
    priority: 'medium',
  },
  {
    traffic_domain: 200,
    url_to: 'https://www.petplace.com/a01',
    url_from: 'https://www.petplace.com/a01nf',
    priority: 'low',
  },
];

use(sinonChai);

const sandbox = sinon.createSandbox();

const baseURL = 'https://example.com';
const auditUrl = 'www.example.com';

describe('Broken internal links audit', () => {
  const site = { getBaseURL: () => baseURL };

  const context = new MockContextBuilder()
    .withSandbox(sandbox)
    .withOverrides({
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      rumApiClient: {
        query: sinon.stub().resolves(internalLinksData),
      },
    })
    .build();

  beforeEach('setup', () => {
    nock('https://secretsmanager.us-east-1.amazonaws.com/')
      .post('/', (body) => body.SecretId === '/helix-deploy/spacecat-services/customer-secrets/example_com/ci')
      .reply(200, {
        SecretString: JSON.stringify({
          RUM_DOMAIN_KEY: 'test-key',
        }),
      });
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
      domainkey: 'test-key',
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

  const context = new MockContextBuilder()
    .withSandbox(sandbox)
    .withOverrides({
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      rumApiClient: {
        query: sinon.stub().resolves(internalLinksData),
      },
    })
    .build();

  beforeEach(() => {
    context.log = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };

    context.dataAccess.Opportunity = {
      allBySiteIdAndStatus: sandbox.stub(),
      create: sandbox.stub(),
    };

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
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('creates a new opportunity object', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(opportunity);

    await opportunityAndSuggestions(auditUrl, auditData, context);

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOpportunity);

    // make sure that newly oppty has 3 new suggestions
    expect(opportunity.addSuggestions).to.have.been.calledOnce;
    const suggestionsArg = opportunity.addSuggestions.getCall(0).args[0];
    expect(suggestionsArg).to.be.an('array').with.lengthOf(3);
  }).timeout(5000);

  it('creating a new opportunity object fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.rejects(new Error('big error happened'));

    await expect(opportunityAndSuggestions(auditUrl, auditData, context)).to.be.rejectedWith('big error happened');

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOpportunity);
    expect(context.log.error).to.have.been.calledOnceWith('Failed to create new opportunity for siteId site-id-1 and auditId audit-id-1: big error happened');

    // make sure that no new suggestions are added
    expect(opportunity.addSuggestions).to.have.been.to.not.have.been.called;
  }).timeout(5000);

  it('allBySiteIdAndStatus method fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));
    context.dataAccess.Opportunity.create.resolves(opportunity);
    try {
      await opportunityAndSuggestions(auditUrl, auditData, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id-1: some-error');
    }

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledOnceWith('Fetching opportunities for siteId site-id-1 failed with error: some-error');

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
      getData: () => (suggestion.data),
      setData: sinon.stub(),
    }));
    opportunity.getSuggestions.resolves(existingSuggestions);

    await opportunityAndSuggestions(auditUrl, auditData, context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(opportunity.setAuditId).to.have.been.calledOnceWith('audit-id-1');
    expect(opportunity.save).to.have.been.calledOnce;

    // make sure that 1 old suggestion is removed
    expect(existingSuggestions[1].remove).to.have.been.calledOnce;

    // make sure that 1 existing suggestion is updated
    expect(existingSuggestions[0].setData).to.have.been.calledOnce;
    expect(existingSuggestions[0].save).to.have.been.calledOnce;

    // make sure that 3 new suggestions are created
    expect(opportunity.addSuggestions).to.have.been.calledOnce;
    const suggestionsArg = opportunity.addSuggestions.getCall(0).args[0];
    expect(suggestionsArg).to.be.an('array').with.lengthOf(1);
  }).timeout(5000);
});
