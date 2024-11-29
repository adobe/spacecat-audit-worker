/*
 * Copyright 2023 Adobe. All rights reserved.
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
import { CWVRunner, convertToOppty } from '../../src/cwv/handler.js';
import expectedOppty from '../fixtures/cwv/oppty.json' assert { type: 'json' };
import suggestions from '../fixtures/cwv/suggestions.json' assert { type: 'json' };
import rumData from '../fixtures/cwv/cwv.json' assert { type: 'json' };

use(sinonChai);

const sandbox = sinon.createSandbox();

const baseURL = 'https://spacecat.com';
const auditUrl = 'www.spacecat.com';
const DOMAIN_REQUEST_DEFAULT_PARAMS = {
  domain: auditUrl,
  domainkey: '42',
  interval: 7,
  granularity: 'hourly',
};
const AUDIT_TYPE = 'cwv';

describe('CWVRunner Tests', () => {
  const groupedURLs = [{ test: 'test' }];
  const siteConfig = {
    getGroupedURLs: sandbox.stub().returns(groupedURLs),
  };
  const site = {
    getBaseURL: sandbox.stub().returns(baseURL),
    getConfig: () => siteConfig,
  };

  const context = {
    runtime: { name: 'aws-lambda', region: 'us-east-1' },
    func: { package: 'spacecat-services', version: 'ci', name: 'test' },
    rumApiClient: {
      query: sandbox.stub().resolves(rumData),
    },
    dataAccess: {},
  };

  beforeEach('setup', () => {
    nock('https://secretsmanager.us-east-1.amazonaws.com/')
      .post('/', (body) => body.SecretId === '/helix-deploy/spacecat-services/customer-secrets/spacecat_com/ci')
      .reply(200, {
        SecretString: JSON.stringify({
          RUM_DOMAIN_KEY: '42',
        }),
      });
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('cwv audit runs rum api client cwv query', async () => {
    const result = await CWVRunner(auditUrl, context, site);

    expect(siteConfig.getGroupedURLs.calledWith(AUDIT_TYPE)).to.be.true;
    expect(
      context.rumApiClient.query.calledWith(
        AUDIT_TYPE,
        {
          ...DOMAIN_REQUEST_DEFAULT_PARAMS,
          groupedURLs,
        },
      ),
    ).to.be.true;

    expect(result).to.deep.equal({
      auditResult: {
        cwv: rumData.filter((data) => data.pageviews >= 7000),
        auditContext: {
          interval: 7,
        },
      },
      fullAuditRef: auditUrl,
    });
  });

  describe('CWV audit to oppty conversion', () => {
    let addSuggestionsResponse;
    let oppty;
    let auditData;

    beforeEach(() => {
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub(),
        create: sandbox.stub(),
      };

      addSuggestionsResponse = {
        createdItems: [],
        errorItems: [],
      };

      oppty = {
        getType: () => AUDIT_TYPE,
        getId: () => 'oppty-id',
        getSiteId: () => 'site-id',
        addSuggestions: sandbox.stub().resolves(addSuggestionsResponse),
        getSuggestions: sandbox.stub().resolves([]),
        setAuditId: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      auditData = {
        siteId: 'site-id',
        id: 'audit-id',
        isLive: true,
        auditedAt: new Date().toISOString(),
        auditType: AUDIT_TYPE,
        auditResult: {
          cwv: rumData.filter((data) => data.pageviews >= 7000),
          auditContext: {
            interval: 7,
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
      context.dataAccess.Opportunity.create.resolves(oppty);

      await convertToOppty(auditUrl, auditData, context);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);

      // make sure that newly oppty has all 4 new suggestions
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(4);
    });

    it('updates the existing opportunity object', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([oppty]);
      const existingSuggestions = suggestions.map((suggestion) => ({
        ...suggestion,
        opportunityId: oppty.getId(),
        remove: sinon.stub(),
        save: sinon.stub(),
        setData: sinon.stub(),
      }));
      oppty.getSuggestions.resolves(existingSuggestions);

      await convertToOppty(auditUrl, auditData, context);

      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(oppty.setAuditId).to.have.been.calledOnceWith('audit-id');
      expect(oppty.save).to.have.been.calledOnce;

      // make sure that 1 old suggestion is removed
      expect(existingSuggestions[0].remove).to.have.been.calledOnce;

      // make sure that 1 existing suggestion is updated
      expect(existingSuggestions[1].save).to.have.been.calledOnce;

      // make sure that 3 new suggestions are created
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(3);
    });
  });
});
