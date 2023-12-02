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
import nock from 'nock';

import audit from '../../src/lhs/handler.js';

const { expect } = chai;
chai.use(sinonChai);

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

    nock('https://psi-audit-service.com', { encodedQueryParams: true })
      .get('/?url=https://adobe.com&strategy=mobile')
      .reply(200, psiResult);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should successfully perform an audit', async () => {
    const response = await audit(auditQueueMessage, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
  });
});
