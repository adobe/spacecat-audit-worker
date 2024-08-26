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
import nock from 'nock';
import { opportunitiesHandler } from '../../src/opportunities/opportunities.js';
import { MockContextBuilder } from '../shared.js';
import opportunitiesData from '../fixtures/opportunitiesdata.json' assert { type: 'json' };

use(sinonChai);

describe('Opportunities Tests', () => {
  const url = 'https://abc.com';
  let context;
  let processEnvCopy;
  let messageBodyJson;
  let sandbox;
  before('setup', function () {
    sandbox = sinon.createSandbox();
    const mockDate = '2023-11-27T12:30:01.124Z';
    this.clock = sandbox.useFakeTimers({
      now: new Date(mockDate).getTime(),
    });
  });

  beforeEach('setup', () => {
    messageBodyJson = {
      type: '404',
      url: 'https://abc.com',
      auditContext: {
        finalUrl: 'abc.com',
      },
    };
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AUDIT_RESULTS_QUEUE_URL: 'queueUrl',
          AWS_REGION: 'us-east-1',
          AWS_ACCESS_KEY_ID: 'some-key-id',
          AWS_SECRET_ACCESS_KEY: 'some-secret-key',
          AWS_SESSION_TOKEN: 'some-secret-token',
        },
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      })
      .build(messageBodyJson);
    processEnvCopy = { ...process.env };
    process.env = {
      ...process.env,
      ...context.env,
    };
  });
  after('clean', function () {
    this.clock.uninstall();
  });

  afterEach(() => {
    process.env = processEnvCopy;
    nock.cleanAll();
    sinon.restore();
  });

  it('fetch bundles for base url > process > send opportunities', async () => {
    nock('https://secretsmanager.us-east-1.amazonaws.com/')
      .post('/', (body) => body.SecretId === '/helix-deploy/spacecat-services/customer-secrets/abc_com/ci')
      .reply(200, {
        SecretString: JSON.stringify({
          RUM_DOMAIN_KEY: 'abc_dummy_key',
        }),
      });
    nock('https://abc.com')
      .get('/')
      .reply(200);
    context.rumApiClient = {
      queryMulti: sinon.stub().resolves(opportunitiesData),
    };
    const site = {
      getBaseURL: () => 'https://abc.com',
    };
    const auditData = await opportunitiesHandler(url, context, site);

    expect(context.rumApiClient.queryMulti).calledWith(
      ['rageclick'],
      {
        domain: 'https://abc.com',
        domainkey: 'abc_dummy_key',
        interval: 30,
        granularity: 'hourly',
      },
    );
    expect(
      auditData.auditResult.experimentationOpportunities,
    ).to.deep.equal(opportunitiesData.rageclick);
  });
});
