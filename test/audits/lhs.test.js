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

describe('audit', () => {
  let context;
  let auditQueueMessage;
  let mockDataAccess;
  let mockLog;

  const sandbox = sinon.createSandbox();

  const site = createSite({
    baseURL: 'https://adobe.com',
    imsOrgId: 'org123',
  });

  const psiResult = {
    lighthouseResult: {
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
      addAudit: sinon.stub(),
    };

    mockLog = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };

    auditQueueMessage = {
      type: 'lhs-mobile',
      url: 'adobe.com',
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
    nock('https://psi-audit-service.com', { encodedQueryParams: true })
      .get('/?url=https://adobe.com&strategy=mobile')
      .reply(200, psiResult);

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
  });

  it('should successfully perform an audit for mobile strategy with valid URL', async () => {
    nock('https://psi-audit-service.com', { encodedQueryParams: true })
      .get('/?url=https://adobe.com&strategy=mobile')
      .reply(200, psiResult);

    auditQueueMessage.url = 'https://adobe.com';

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
  });

  it('successfully performs an audit for desktop strategy', async () => {
    nock('https://psi-audit-service.com', { encodedQueryParams: true })
      .get('/?url=https://adobe.com&strategy=desktop')
      .reply(200, psiResult);

    auditQueueMessage.type = 'lhs-desktop';
    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
  });

  it('throws error for an audit of unknown type', async () => {
    auditQueueMessage.type = 'unknown-type';

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(500);
    expect(response.statusText).to.equal('LHS Audit Error: Unexpected error occurred: Unsupported type. Supported types are lhs-mobile and lhs-desktop.');
  });

  it('throws error when psi api fetch fails', async () => {
    nock('https://psi-audit-service.com', { encodedQueryParams: true })
      .get('/?url=https://adobe.com&strategy=mobile')
      .reply(405, 'Method Not Allowed');

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(500);
    expect(response.statusText).to.equal('LHS Audit Error: Unexpected error occurred: Expected a 200 status from PSI API');
  });

  it('throws error when site does not exist', async () => {
    mockDataAccess.getSiteByBaseURL.resolves(null);

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(500);
    expect(response.statusText).to.equal('LHS Audit Error: Unexpected error occurred: Site not found');
  });

  it('throws error when data access fails', async () => {
    mockDataAccess.getSiteByBaseURL.rejects(new Error('Data Error'));

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(500);
    expect(response.statusText).to.equal('LHS Audit Error: Unexpected error occurred: Error getting site with baseURL adobe.com');
  });

  it('throws error when context is incomplete', async () => {
    delete context.dataAccess;

    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(500);
    expect(response.statusText).to.equal('LHS Audit Error: Invalid configuration');
  });

  it('performs audit even when sqs message send fails', async () => {
    nock('https://psi-audit-service.com', { encodedQueryParams: true })
      .get('/?url=https://adobe.com&strategy=mobile')
      .reply(200, psiResult);

    context.sqs.sendMessage.rejects(new Error('SQS Error'));

    await audit(auditQueueMessage, context);

    expect(mockLog.error).to.have.been.calledOnceWith('Error while sending audit result to queue', sinon.match.instanceOf(Error));
  });
});
