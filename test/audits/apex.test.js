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

import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';
import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import apexAudit, { hasNonWWWSubdomain, toggleWWW } from '../../src/apex/handler.js';

chai.use(sinonChai);
const { expect } = chai;

const sandbox = sinon.createSandbox();

describe('Apex audit', () => {
  let context;
  let messageBodyJson;
  let mockDataAccess;
  let mockLog;

  const siteData = {
    id: 'site1',
    baseURL: 'https://some-domain.com',
    imsOrgId: 'org123',
  };

  const siteWithApexDomain = createSite(siteData);
  const siteWithSubdomain = createSite({
    ...siteData,
    baseURL: 'https://subdomain.some-domain.com',
  });

  beforeEach('setup', () => {
    mockDataAccess = {
      getSiteByID: sinon.stub().resolves(siteWithApexDomain),
    };

    mockLog = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };

    messageBodyJson = {
      type: 'apex',
      url: 'site-id',
      auditContext: {},
    };

    context = {
      log: mockLog,
      runtime: {
        region: 'us-east-1',
      },
      env: {
        AUDIT_RESULTS_QUEUE_URL: 'some-queue-url',
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
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('apex audit returns 404 when site not found', async () => {
    mockDataAccess.getSiteByID = sinon.stub().resolves(null);

    const resp = await apexAudit(messageBodyJson, context);
    expect(resp.status).to.equal(404);
    expect(context.sqs.sendMessage).to.have.callCount(0);
  });

  it('apex audit returns 500 when audit fails', async () => {
    context.sqs = sinon.stub().rejects('wololo');

    nock('https://some-domain.com')
      .get('/')
      .reply(200);

    nock('https://www.some-domain.com')
      .get('/')
      .reply(200);

    const resp = await apexAudit(messageBodyJson, context);
    expect(resp.status).to.equal(500);
  });

  it('apex audit does not run when baseUrl is not apex', async () => {
    mockDataAccess.getSiteByID = sinon.stub().resolves(siteWithSubdomain);

    const resp = await apexAudit(messageBodyJson, context);
    expect(resp.status).to.equal(204);
    expect(context.sqs.sendMessage).to.have.callCount(0);
  });

  it('apex audit unsuccessful when baseurl doesnt resolve', async () => {
    const expectedMessage = {
      type: 'apex',
      url: 'some-domain.com',
      auditContext: {},
      auditResult: [
        {
          url: 'https://some-domain.com',
          success: false,
        },
        {
          url: 'https://www.some-domain.com',
          success: true,
          status: 200,
        },
      ],
    };

    nock('https://some-domain.com')
      .get('/')
      .replyWithError({ code: 'ECONNREFUSED', syscall: 'connect' });

    nock('https://www.some-domain.com')
      .get('/')
      .reply(200);

    const resp = await apexAudit(messageBodyJson, context);
    expect(resp.status).to.equal(204);
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
  });

  it('apex audit successful when baseurl resolves', async () => {
    const expectedMessage = {
      type: 'apex',
      url: 'some-domain.com',
      auditContext: {},
      auditResult: [
        {
          url: 'https://some-domain.com',
          success: true,
          status: 200,
        },
        {
          url: 'https://www.some-domain.com',
          success: true,
          status: 200,
        },
      ],
    };

    nock('https://some-domain.com')
      .get('/')
      .reply(200);

    nock('https://www.some-domain.com')
      .get('/')
      .reply(200);

    const resp = await apexAudit(messageBodyJson, context);
    expect(resp.status).to.equal(204);
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
  });

  describe('apex domain validation', () => {
    it('urls with subdomains', () => {
      expect(hasNonWWWSubdomain('https://subdomain.domain.com')).to.equal(true);
      expect(hasNonWWWSubdomain('https://sub.domain.museum')).to.equal(true);
      expect(hasNonWWWSubdomain('https://sub.domain.com/path?query=123')).to.equal(true);
      expect(hasNonWWWSubdomain('https://sub.domain.com/')).to.equal(true);
      expect(hasNonWWWSubdomain('https://sub.domain.com:3000')).to.equal(true);
    });

    it('urls with apex domains', () => {
      expect(hasNonWWWSubdomain('https://www.example.com/path/')).to.equal(false);
      expect(hasNonWWWSubdomain('https://www.site.com')).to.equal(false);
      expect(hasNonWWWSubdomain('https://domain.com')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.co.uk')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.com.tr')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.com/somepath')).to.equal(false);
      expect(hasNonWWWSubdomain('https://domain.com/path?query=123')).to.equal(false);
      expect(hasNonWWWSubdomain('https://domain.com/')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.com/path/')).to.equal(false);
      expect(hasNonWWWSubdomain('https://domain.com:8000')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.site')).to.equal(false);
      expect(hasNonWWWSubdomain('invalid-url^&*')).to.equal(false);
    });

    it('throws error when parse fails', () => {
      expect(() => hasNonWWWSubdomain('https://example,site')).to.throw('Cannot parse baseURL: https://example,site');
    });

    it('toggleWWW', () => {
      expect(toggleWWW('https://www.example.com/path/')).to.equal('https://example.com/path/');
      expect(toggleWWW('https://example.com/path/')).to.equal('https://www.example.com/path/');
      expect(toggleWWW('https://subdomain.example.com/path/')).to.equal('https://subdomain.example.com/path/');
    });
  });
});
