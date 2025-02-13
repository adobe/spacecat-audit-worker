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
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { CWVRunner, opportunityAndSuggestions } from '../../src/cwv/handler.js';
import expectedOppty from '../fixtures/cwv/oppty.json' with { type: 'json' };
import suggestions from '../fixtures/cwv/suggestions.json' with { type: 'json' };
import rumData from '../fixtures/cwv/cwv.json' with { type: 'json' };

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

const auditType = Audit.AUDIT_TYPES.CWV;
const baseURL = 'https://spacecat.com';
const auditUrl = 'www.spacecat.com';
const DOMAIN_REQUEST_DEFAULT_PARAMS = {
  domain: auditUrl,
  interval: 7,
  granularity: 'hourly',
};

describe('CWVRunner Tests', () => {
  const groupedURLs = [{ name: 'test', pattern: 'test/*' }];
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
    env: {},
  };

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('cwv audit runs rum api client cwv query', async () => {
    const result = await CWVRunner(auditUrl, context, site);

    expect(siteConfig.getGroupedURLs.calledWith(auditType)).to.be.true;
    expect(
      context.rumApiClient.query.calledWith(
        auditType,
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
    const opptyData = { 0: 'existed-data' };
    let auditData;

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

      oppty = {
        getType: () => auditType,
        getId: () => 'oppty-id',
        getSiteId: () => 'site-id',
        addSuggestions: sandbox.stub().resolves(addSuggestionsResponse),
        getSuggestions: sandbox.stub().resolves([]),
        setAuditId: sandbox.stub(),
        getData: sandbox.stub().returns(opptyData),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      auditData = {
        siteId: 'site-id',
        id: 'audit-id',
        isLive: true,
        auditedAt: new Date().toISOString(),
        auditType,
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

      await opportunityAndSuggestions(auditUrl, auditData, context, site);

      expect(siteConfig.getGroupedURLs).to.have.been.calledWith(auditType);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);

      // make sure that newly oppty has all 4 new suggestions
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(4);
    });

    it('creating a new opportunity object fails', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.rejects(new Error('big error happened'));

      await expect(opportunityAndSuggestions(auditUrl, auditData, context, site)).to.be.rejectedWith('big error happened');
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);
      expect(context.log.error).to.have.been.calledOnceWith('Failed to create new opportunity for siteId site-id and auditId audit-id: big error happened');

      // make sure that no new suggestions are added
      expect(oppty.addSuggestions).to.have.been.to.not.have.been.called;
    });

    it('updates the existing opportunity object', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([oppty]);
      const existingSuggestions = suggestions.map((suggestion) => ({
        ...suggestion,
        opportunityId: oppty.getId(),
        remove: sinon.stub(),
        save: sinon.stub(),
        getData: () => (suggestion.data),
        setData: sinon.stub(),
      }));
      oppty.getSuggestions.resolves(existingSuggestions);

      await opportunityAndSuggestions(auditUrl, auditData, context, site);

      expect(siteConfig.getGroupedURLs).to.have.been.calledWith(auditType);

      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(oppty.setAuditId).to.have.been.calledOnceWith('audit-id');
      expect(oppty.setData).to.have.been.calledOnceWith({ ...opptyData, ...expectedOppty.data });
      expect(oppty.save).to.have.been.calledOnce;

      // make sure that 1 old suggestion is removed
      expect(existingSuggestions[0].remove).to.have.been.calledOnce;

      // make sure that 1 existing suggestion is updated
      expect(existingSuggestions[1].setData).to.have.been.calledOnce;
      expect(existingSuggestions[1].setData.firstCall.args[0]).to.deep.equal(suggestions[1].data);
      expect(existingSuggestions[1].save).to.have.been.calledOnce;

      // make sure that 3 new suggestions are created
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(3);
    });
  });
});
