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
import { main } from '../../src/index.js';
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
  let messageBodyJson;

  beforeEach('setup', () => {
    messageBodyJson = {
      type: 'experimentation',
      url: 'https://bamboohr.com',
      auditContext: {
        finalUrl: 'bamboohr.com',
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

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('fetch experiment data for base url > process > send results', async () => {
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

    const resp = await main(request, context);

    const expectedMessage = {
      ...messageBodyJson,
      auditResult: expectedAuditResult,
    };

    expect(resp.status).to.equal(204);
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
  });

  it('fetch experiments for base url for base url > process > reject', async () => {
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
