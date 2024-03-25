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

import chai from 'chai';
import sinon from 'sinon';
import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';
import sinonChai from 'sinon-chai';
import { Request } from '@adobe/fetch';
import nock from 'nock';
import { main } from '../../src/index.js';
import { getRUMUrl } from '../../src/support/utils.js';
import { expectedAuditResult, notFoundData } from '../fixtures/notfounddata.js';

chai.use(sinonChai);
const { expect } = chai;

describe('Index Tests', () => {
  const request = new Request('https://space.cat');
  let context;
  let messageBodyJson;
  let site;
  let sandbox;
  before('setup', function () {
    sandbox = sinon.createSandbox();
    const mockDate = '2023-11-27T12:30:01.124Z';
    this.clock = sandbox.useFakeTimers({
      now: new Date(mockDate).getTime(),
    });
  });

  beforeEach('setup', () => {
    const siteData = {
      id: 'site1',
      baseURL: 'https://abc.com',
    };

    site = createSite(siteData);
    const mockDataAccess = {
      getSiteByBaseURL: sinon.stub().resolves(site),
      getSiteByID: sinon.stub().resolves(site),
      addAudit: sinon.stub(),
    };
    messageBodyJson = {
      type: '404',
      url: 'https://abc.com',
      auditContext: {
        finalUrl: 'abc.com',
      },
    };
    context = {
      log: console,
      runtime: {
        region: 'us-east-1',
      },
      env: {
        AUDIT_RESULTS_QUEUE_URL: 'queueUrl',
      },
      invocation: {
        event: {
          Records: [{
            body: JSON.stringify(messageBodyJson),
          }],
        },
      },
      dataAccess: mockDataAccess,
      sqs: {
        sendMessage: sinon.stub().resolves(),
      },
    };
  });

  after('clean', function () {
    this.clock.uninstall();
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('fetch 404s for base url > process > send results', async () => {
    nock('https://abc.com')
      .get('/')
      .reply(200);
    context.rumApiClient = {
      get404Sources: sinon.stub().resolves(notFoundData.results.data),
      create404URL: () => 'abc.com',
    };
    const resp = await main(request, context);

    expect(resp.status).to.equal(204);
    expect(context.rumApiClient.get404Sources).calledWith({
      url: 'abc.com',
      interval: -1,
      startdate: '2023-11-20',
      enddate: '2023-11-27',
    });
    expect(context.dataAccess.addAudit).to.have.been.calledOnce;
    const expectedMessage = {
      ...messageBodyJson,
      auditResult: expectedAuditResult,
    };
    expect(resp.status).to.equal(204);
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
  });

  it('fetch 404s for base url > site data access exception > reject', async () => {
    const exceptionContext = { ...context };
    exceptionContext.dataAccess.getSiteByBaseURL = sinon.stub().rejects('Exception data accesss');

    const resp = await main(request, exceptionContext);

    expect(resp.status).to.equal(500);
  });

  it('fetch 404s for base url > process > notfound', async () => {
    nock('https://adobe.com')
      .get('/')
      .reply(200);
    const noSiteContext = { ...context };
    noSiteContext.dataAccess.getSiteByBaseURL = sinon.stub().resolves(null);

    const resp = await main(request, noSiteContext);

    expect(resp.status).to.equal(404);
  });

  it('fetch 404s for base url > process > reject', async () => {
    nock('https://adobe.com')
      .get('/')
      .reply(200);
    context.rumApiClient = { get404Sources: async () => Promise.reject(new Error('Error')) };
    const resp = await main(request, context);

    expect(resp.status).to.equal(500);
  });

  it('fetch 404s for base url > audit data model exception > reject', async () => {
    nock('https://adobe.com')
      .get('/')
      .reply(200);
    context.rumApiClient = {
      get404Sources: async () => Promise.resolve(notFoundData.results.data),
      create404URL: () => 'https://url.com',
    };
    const auditFailContext = { ...context };
    auditFailContext.dataAccess.addAudit = sinon.stub().rejects('Error adding audit');

    const resp = await main(request, auditFailContext);

    expect(resp.status).to.equal(500);
  });

  it('getRUMUrl do not add scheme to urls with a scheme already', async () => {
    nock('http://space.cat')
      .get('/')
      .reply(200);

    const finalUrl = await getRUMUrl('http://space.cat');
    expect(finalUrl).to.eql('space.cat');
  });
});
