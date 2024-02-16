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

import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';

import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Request } from '@adobe/fetch';
import nock from 'nock';
import auditExperiments from '../../src/experimentation/handler.js';
import { getRUMUrl } from '../../src/support/utils.js';
import { expectedAuditResult, rumData } from '../fixtures/experimentation-data.js';

chai.use(sinonChai);
const { expect } = chai;

const sandbox = sinon.createSandbox();
const DOMAIN_REQUEST_DEFAULT_PARAMS = {
  interval: 7,
  offset: 0,
  limit: 101,
};
describe('Index Tests', () => {
  const request = new Request('https://space.cat');
  let context;
  let mockLog;
  let message;
  let mockDataAccess;

  const siteData = {
    id: 'site-id-123',
    baseURL: 'https://bamboohr.com',
    isLive: true,
  };

  const site = createSite(siteData);

  beforeEach('setup', () => {
    mockDataAccess = {
      getSiteByID: sinon.stub(),
      addAudit: sinon.stub(),
    };
    message = {
      type: 'experimentation',
      url: 'bamboohr.com',
      auditContext: {
        finalUrl: 'www.bamboohr.com',
      },
    };
    mockLog = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };
    context = {
      log: mockLog,
      runtime: {
        region: 'us-east-1',
      },
      env: {
        AUDIT_RESULTS_QUEUE_URL: 'queueUrl',
        RUM_DOMAIN_KEY: 'domainkey',
      },
      invocation: {
        event: {
          Records: [{
            body: JSON.stringify(message),
          }],
        },
      },
      dataAccess: mockDataAccess,
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('fetch experiment data for base url > process > send results', async () => {
    mockDataAccess.getSiteByID = sinon.stub().withArgs('site-id-123').resolves(site);
    nock('https://bamboohr.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-experiments')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        url: 'bamboohr.com',
      })
      .reply(200, rumData);
    const resp = await auditExperiments(message, context);

    const expectedMessage = {
      ...message,
      url: 'https://bamboohr.com',
      auditResult: expectedAuditResult,
    };
    expect(resp.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
  });

  it('fetch experiments for base url > process > reject', async () => {
    mockDataAccess.getSiteByID = sinon.stub().withArgs('site-id-123').resolves(site);
    nock('https://bamboohr.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-experiments')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        url: 'bamboohr.com',
      })
      .replyWithError('Bad request');

    const resp = await auditExperiments(request, context);

    expect(resp.status).to.equal(500);
  });

  it('getRUMUrl do not add scheme to urls with a scheme already', async () => {
    nock('http://space.cat')
      .get('/')
      .reply(200);

    const finalUrl = await getRUMUrl('http://space.cat');
    expect(finalUrl).to.eql('space.cat');
  });

  it('getRUMUrl adds scheme to urls without a scheme', async () => {
    nock('https://space.cat')
      .get('/')
      .reply(200);

    const finalUrl = await getRUMUrl('space.cat');
    expect(finalUrl).to.eql('space.cat');
  });

  it('returns a 404 when site does not exist', async () => {
    mockDataAccess.getSiteByID.resolves(null);

    const response = await auditExperiments(message, context);

    expect(response.status).to.equal(404);
  });

  it('returns a 200 when site is not live', async () => {
    const siteWithDisabledAudits = createSite({
      ...siteData,
      isLive: false,
    });

    mockDataAccess.getSiteByID.resolves(siteWithDisabledAudits);

    const response = await auditExperiments(message, context);

    expect(response.status).to.equal(200);
    expect(context.log.info).to.have.been.calledWith('Site bamboohr.com is not live');
  });
});
