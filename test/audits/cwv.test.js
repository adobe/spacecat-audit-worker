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
import sinonChai from 'sinon-chai';
import { Request } from '@adobe/fetch';
import nock from 'nock';
import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';
import { main } from '../../src/index.js';
import { getRUMUrl } from '../../src/support/utils.js';
import { expectedAuditResult, rumData } from '../fixtures/rum-data.js';

chai.use(sinonChai);
const { expect } = chai;

const sandbox = sinon.createSandbox();
const DOMAIN_REQUEST_DEFAULT_PARAMS = {
  interval: 7,
  offset: 0,
  limit: 101,
};

const mockDate = '2023-11-27T12:30:01.124Z';
describe('Index Tests', () => {
  const request = new Request('https://space.cat');
  let mockDataAccess;
  let context;
  let messageBodyJson;
  let site;

  before('init', function () {
    this.clock = sandbox.useFakeTimers({
      now: new Date(mockDate).getTime(),
    });
  });

  beforeEach('setup', () => {
    site = createSite({
      baseURL: 'https://adobe.com',
    });

    mockDataAccess = {
      getSiteByID: sinon.stub(),
      addAudit: sinon.stub(),
    };
    mockDataAccess.getSiteByID = sinon.stub().withArgs('site-id').resolves(site);

    messageBodyJson = {
      type: 'cwv',
      url: 'site-id',
      auditContext: {
        finalUrl: 'adobe.com',
      },
    };
    context = {
      log: console,
      runtime: {
        region: 'us-east-1',
      },
      dataAccess: mockDataAccess,
      env: {
        AUDIT_RESULTS_QUEUE_URL: 'queueUrl',
        RUM_DOMAIN_KEY: 'domainkey',
      },
      invocation: {
        event: {
          Records: [{
            body: JSON.stringify(messageBodyJson),
          }],
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });

  after(function () {
    this.clock.uninstall();
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('fetch cwv for base url > process > send results', async () => {
    nock('https://adobe.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-dashboard')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        url: 'adobe.com',
      })
      .reply(200, rumData);

    const resp = await main(request, context);

    const expectedMessage = {
      ...messageBodyJson,
      url: site.getBaseURL(),
      auditResult: expectedAuditResult,
    };

    expect(resp.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
    expect(mockDataAccess.addAudit).to.have.been.calledWith({
      siteId: site.getId(),
      isLive: false,
      auditedAt: mockDate,
      auditType: 'cwv',
      fullAuditRef: 'https://helix-pages.anywhere.run/helix-services/run-query@v3/rum-dashboard?domainkey=domainkey&interval=7&offset=0&limit=101&url=adobe.com',
      auditResult: expectedAuditResult,
    });
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
  });

  it('fetch cwv for base url for base url > process > reject', async () => {
    nock('https://adobe.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-dashboard')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        checkpoint: 404,
        url: 'adobe.com',
      })
      .replyWithError('Bad request');

    const resp = await main(request, context);

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
});
