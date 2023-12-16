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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';

import audit from '../../src/lhs/handler.js';

const { expect } = chai;
chai.use(sinonChai);
chai.use(chaiAsPromised);

describe('LHS Audit', () => {
  let context;
  let auditQueueMessage;
  let mockDataAccess;
  let mockLog;

  const sandbox = sinon.createSandbox();

  const siteData = {
    id: 'site1',
    baseURL: 'https://adobe.com',
    imsOrgId: 'org123',
  };

  const site = createSite(siteData);

  const psiResult = {
    lighthouseResult: {
      finalUrl: 'https://adobe.com/',
      categories: {
        performance: {
          score: 0.5,
        },
        accessibility: {
          score: 0.5,
        },
        'best-practices': {
          score: 0.5,
        },
        seo: {
          score: 0.5,
        },
      },
    },
  };

  beforeEach(() => {
    mockDataAccess = {
      getSiteByBaseURL: sinon.stub().resolves(site),
      getSiteByID: sinon.stub().resolves(site),
      getLatestAuditForSite: sinon.stub().resolves(null),
      addAudit: sinon.stub(),
    };

    mockLog = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };

    auditQueueMessage = {
      type: 'lhs-mobile',
      url: 'site1',
      auditContext: {
        finalUrl: 'adobe.com',
      },
    };
    context = {
      log: mockLog,
      runtime: {
        region: 'us-east-1',
      },
      env: {
        AUDIT_RESULTS_QUEUE_URL: 'some-queue-url',
        PAGESPEED_API_BASE_URL: 'https://psi-audit-service.com',
        GITHUB_CLIENT_ID: 'some-github-id',
        GITHUB_CLIENT_SECRET: 'some-github-secret',
      },
      invocation: {
        event: {
          Records: [{
            body: JSON.stringify(auditQueueMessage),
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

  it('should successfully perform an audit for mobile strategy', async () => {
    nock('https://adobe.com').get('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile')
      .reply(200, psiResult);

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
  });

  it('logs and saves error on lighthouse error', async () => {
    const errorPSIResult = {
      ...psiResult,
    };
    errorPSIResult.lighthouseResult.runtimeError = { code: 'error-code', message: 'error-message' };

    nock('https://adobe.com').get('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile')
      .reply(200, errorPSIResult);

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(204);
    expect(mockLog.error).to.have.been.calledWith('Audit error for site https://adobe.com with id site1: error-message');
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
    expect(mockDataAccess.addAudit.firstCall.firstArg.auditResult.runtimeError).to.be.an('object');
  });

  it('should successfully perform an audit for mobile strategy with valid URL', async () => {
    nock('https://adobe.com').get('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile')
      .reply(200, psiResult);

    auditQueueMessage.url = 'https://adobe.com';

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
  });

  it('successfully performs an audit for desktop strategy', async () => {
    nock('https://adobe.com').get('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=desktop')
      .reply(200, psiResult);

    auditQueueMessage.type = 'lhs-desktop';
    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
  });

  it('should successfully perform an audit with latest audit', async () => {
    mockDataAccess.getLatestAuditForSite.resolves({
      getAuditedAt: () => '2021-01-01T00:00:00.000Z',
      getAuditResult: () => ({}),
    });

    nock('https://adobe.com').get('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile')
      .reply(200, psiResult);

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
  });

  it('throws error for an audit of unknown type', async () => {
    auditQueueMessage.type = 'unknown-type';

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(500);
    expect(mockLog.error).to.have.been.calledOnce;
    expect(mockLog.error).to.have.been.calledWith('LHS Audit Error: Unexpected error occurred: Unsupported type. Supported types are lhs-mobile and lhs-desktop.');
  });

  it('throws error when psi api fetch fails', async () => {
    nock('https://adobe.com').get('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile')
      .reply(405, 'Method Not Allowed');

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(500);
    expect(mockLog.error).to.have.been.calledTwice;
    expect(mockLog.error).to.have.been.calledWith('Error happened during PSI check: Error: HTTP error! Status: 405');
    expect(mockLog.error).to.have.been.calledWith('LHS Audit Error: Unexpected error occurred: HTTP error! Status: 405');
  });

  it('returns a 404 when site does not exist', async () => {
    mockDataAccess.getSiteByID.resolves(null);

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(404);
  });

  it('returns a 200 when site audits are disabled', async () => {
    const siteWithDisabledAudits = createSite({
      ...siteData,
      auditConfig: { auditsDisabled: true },
    });

    mockDataAccess.getSiteByID.resolves(siteWithDisabledAudits);

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledTwice;
    expect(mockLog.info).to.have.been.calledWith('Audits disabled for site site1');
  });

  it('returns a 200 when audits for type are disabled', async () => {
    const siteWithDisabledAudits = createSite({
      ...siteData,
      auditConfig: { auditsDisabled: false, auditTypeConfigs: { 'lhs-mobile': { disabled: true } } },
    });

    mockDataAccess.getSiteByID.resolves(siteWithDisabledAudits);

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledTwice;
    expect(mockLog.info).to.have.been.calledWith('Audit type lhs-mobile disabled for site site1');
  });

  it('throws error when data access fails', async () => {
    mockDataAccess.getSiteByID.rejects(new Error('Data Error'));

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(500);
    expect(mockLog.error).to.have.been.calledOnce;
    expect(mockLog.error).to.have.been.calledWith('LHS Audit Error: Unexpected error occurred: Error getting site site1: Data Error');
  });

  it('throws error when context is incomplete', async () => {
    delete context.dataAccess;
    delete context.sqs;
    context.env = {};

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(500);
    expect(mockLog.error).to.have.been.calledOnce;
    expect(mockLog.error).to.have.been.calledWith('LHS Audit Error: Invalid configuration: Invalid dataAccess object, Invalid psiApiBaseUrl, Invalid queueUrl, Invalid sqs object');
  });

  it('performs audit even when sqs message send fails', async () => {
    nock('https://adobe.com').get('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile')
      .reply(200, psiResult);

    context.sqs.sendMessage.rejects(new Error('SQS Error'));

    await audit(auditQueueMessage, context);

    expect(mockLog.error).to.have.been.calledWith(
      'Error while sending audit result to queue',
      sinon.match.instanceOf(Error),
    );

    expect(mockLog.error).to.have.been.calledWith(
      'LHS Audit Error: Unexpected error occurred: Failed to send message to SQS: SQS Error',
      sinon.match.instanceOf(Error),
    );
  });
});
