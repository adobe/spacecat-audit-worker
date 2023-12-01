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
/* eslint-disable no-unused-expressions */ // expect statements

import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Request } from '@adobe/fetch';
import nock from 'nock';
import { main } from '../../src/index.js';
import { DOMAIN_REQUEST_DEFAULT_PARAMS, getRUMUrl } from '../../src/support/utils.js';
import { notFoundData, expectedAuditResult } from '../notfounddata.js';

chai.use(sinonChai);
const { expect } = chai;

const sandbox = sinon.createSandbox();
describe('Index Tests', () => {
  const request = new Request('https://space.cat');
  let context;
  let messageBodyJson;

  beforeEach('setup', () => {
    messageBodyJson = {
      type: '404',
      url: 'adobe.com',
      auditContext: {
        finalUrl: 'adobe.com',
      },
    };
    context = {
      log: console,
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
            body: JSON.stringify(messageBodyJson),
          }],
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
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
        checkpoint: 404,
        url: 'adobe.com',
      })
      .reply(200, notFoundData);

    const resp = await main(request, context);

    const expectedMessage = {
      ...messageBodyJson,
      auditResult: expectedAuditResult,
    };

    expect(resp.status).to.equal(200);
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
  });

  it('getRUMUrl do not add scheme to urls with a scheme already', async () => {
    nock('http://space.cat')
      .get('/')
      .reply(200);

    const finalUrl = await getRUMUrl('http://space.cat');
    expect(finalUrl).to.eql('space.cat');
  });
});
