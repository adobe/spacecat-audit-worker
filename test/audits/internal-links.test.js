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
import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';
import { internalLinksAuditRunner, convertToOpportunity } from '../../src/internal-links/handler.js';
import { internalLinksData, expectedOpportunity, expectedSuggestions } from '../fixtures/internal-links-data.js';
import { MockContextBuilder } from '../shared.js';
// rum data = internalLinksData
// import expectedOppty from '../fixtures/internal-links-data.js' assert { type: 'json' };
// import suggestions from '../fixtures/internal-links/suggestions.json' assert { type: 'json' };
// import rumData from '../fixtures/cwv/cwv.json' assert { type: 'json' };

const AUDIT_RESULT_DATA = [
  {
    url_to: 'https://www.example.com/article/dogs/breeds/choosing-an-irish-setter',
    url_from: 'https://www.example.com/article/dogs/just-for-fun/dogs-good-for-men-13-manly-masculine-dog-breeds',
    traffic_domain: 100,
  },
  {
    url_to: 'https://www.example.com/article/dogs/breeds/choosing-a-miniature-poodle',
    url_from: 'https://www.example.com/article/dogs/pet-care/when-is-a-dog-considered-senior',
    traffic_domain: 100,
  },
];

use(sinonChai);

const sandbox = sinon.createSandbox();

const baseURL = 'https://example.com';
const auditUrl = 'www.example.com';

describe('Broken internal links audit', () => {
  const site = createSite({ baseURL });

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
    expect(context.rumApiClient.query).calledWith('404', {
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
  });
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

    await convertToOpportunity(auditUrl, auditData, context);

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOpportunity);

    // make sure that newly oppty has 2 new suggestions
    expect(opportunity.addSuggestions).to.have.been.calledOnce;
    const suggestionsArg = opportunity.addSuggestions.getCall(0).args[0];
    expect(suggestionsArg).to.be.an('array').with.lengthOf(2);
  });

  it('creating a new opportunity object fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.rejects(new Error('big error happened'));

    await expect(convertToOpportunity(auditUrl, auditData, context)).to.be.rejectedWith('big error happened');

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOpportunity);
    expect(context.log.error).to.have.been.calledOnceWith('Failed to create new opportunity for siteId site-id-1 and auditId audit-id-1: big error happened');

    // make sure that no new suggestions are added
    expect(opportunity.addSuggestions).to.have.been.to.not.have.been.called;
  });

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

    await convertToOpportunity(auditUrl, auditData, context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(opportunity.setAuditId).to.have.been.calledOnceWith('audit-id-1');
    expect(opportunity.save).to.have.been.calledOnce;

    // make sure that 1 old suggestion is removed
    expect(existingSuggestions[0].remove).to.have.been.calledOnce;

    // make sure that 1 existing suggestion is updated
    expect(existingSuggestions[1].setData).to.have.been.calledOnce();
    expect(existingSuggestions[1].save).to.have.been.calledOnce;

    // make sure that 3 new suggestions are created
    expect(opportunity.addSuggestions).to.have.been.calledOnce;
    const suggestionsArg = opportunity.addSuggestions.getCall(0).args[0];
    expect(suggestionsArg).to.be.an('array').with.lengthOf(3);
  });
});
