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
import esmock from 'esmock';
import { MAX_OPPORTUNITIES, getRecommendations } from '../../src/experimentation-opportunities/experimentation-opportunities.js';
import { MockContextBuilder } from '../shared.js';
import opportunitiesData from '../fixtures/opportunitiesdata.json' with { type: 'json' };
import expectedOpportunitiesData from '../fixtures/expected-opportunities-data.json' with { type: 'json' };
import llmHandlerResponse from '../fixtures/statistics-lambda-llm-insights-response.json' with { type: 'json' };

use(sinonChai);

describe('Opportunities Tests', () => {
  const url = 'https://abc.com';
  const mockDate = '2023-11-27T12:30:01.124Z';

  let clock;
  let context;
  let processEnvCopy;
  let messageBodyJson;
  let sandbox;
  let lambdaSendStub;
  let experimentationOpportunities;
  let site;
  const llmHanderResult = JSON.parse(llmHandlerResponse.body).result;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(async () => {
    clock = sandbox.useFakeTimers({
      now: +new Date(mockDate),
      toFake: ['Date'],
    });
    messageBodyJson = {
      type: '404',
      url: 'https://abc.com',
      auditContext: {
        finalUrl: 'abc.com',
      },
    };
    site = {
      getBaseURL: () => 'https://abc.com',
      getId: () => '056f9dbe-e9e1-4d80-8bfb-c9785a873b6a',
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

    context.rumApiClient = {
      queryMulti: sinon.stub().resolves(opportunitiesData),
    };
    processEnvCopy = { ...process.env };
    process.env = {
      ...process.env,
      ...context.env,
    };

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

    // Stub the LambdaClient's send method
    lambdaSendStub = sinon.stub();

    // Mock LambdaClient constructor to return an object with the stubbed send method
    const LambdaClientMock = sinon.stub().returns({
      send: lambdaSendStub,
    });

    // Stub defaultProvider
    const defaultProviderStub = sinon.stub().returns(() => ({
      accessKeyId: 'mockAccessKeyId',
      secretAccessKey: 'mockSecretAccessKey',
    }));

    // Mock AWS SDK using esmock
    experimentationOpportunities = await esmock('../../src/experimentation-opportunities/experimentation-opportunities.js', {
      '@aws-sdk/client-lambda': { LambdaClient: LambdaClientMock },
      '@aws-sdk/credential-provider-node': { defaultProvider: defaultProviderStub },
    });

    const lambdaResponse = {
      Payload: new TextEncoder().encode(JSON.stringify(llmHandlerResponse)),
    };
    lambdaSendStub.resolves(lambdaResponse);
  });

  afterEach(() => {
    process.env = processEnvCopy;
    nock.cleanAll();
    clock.restore();
    sinon.restore();
  });

  it('fetch bundles for base url > process > send opportunities', async () => {
    const auditData = await experimentationOpportunities.handler(url, context, site);
    expect(context.rumApiClient.queryMulti).calledWith([
      'rageclick',
      'high-inorganic-high-bounce-rate',
      'high-organic-low-ctr',
    ], {
      domain: 'https://abc.com',
      domainkey: 'abc_dummy_key',
      interval: 7,
      granularity: 'hourly',
    });
    expect(
      auditData.auditResult.experimentationOpportunities,
    ).to.deep.equal(expectedOpportunitiesData);
  });

  it('should process configured maximum number of high-organic-low-ctr opportunities', async () => {
    // Mock multiple high-organic-low-ctr opportunities
    const manyOpportunities = Array(12).fill(null).map((_, index) => ({
      type: 'high-organic-low-ctr',
      page: `https://abc.com/page${index}/`,
      pageViews: 1000 * (index + 1),
      trackedPageKPIValue: 0.09,
      trackedKPISiteAverage: 0.23,
      metrics: [{
        type: 'traffic',
        value: {
          earned: 11000,
          owned: 13000,
          paid: 10030,
          total: 34030,
        },
        vendor: 'facebook',
      },
      {
        type: 'ctr',
        value: {
          page: 0.11,
        },
        vendor: 'facebook',
      },
      {
        type: 'traffic',
        value: {
          earned: 100,
          owned: 1300,
          paid: 100,
          total: 1500,
        },
        vendor: 'tiktok',
      },
      {
        type: 'ctr',
        value: {
          page: 0.23,
        },
        vendor: 'tiktok',
      }],
    }));
    context.rumApiClient = {
      queryMulti: sinon.stub().resolves(manyOpportunities),
    };
    const auditData = await experimentationOpportunities.handler(url, context, site);
    // Verify only top MAX_OPPORTUNITIES opportunities are processed
    const processedOpportunities = auditData.auditResult.experimentationOpportunities
      .filter((o) => o.type === 'high-organic-low-ctr' && o.recommendations);
    expect(processedOpportunities).to.have.lengthOf(MAX_OPPORTUNITIES);
  });

  it('should include required parameters in lambda payload for high-organic-low-ctr opportunities', async () => {
    await experimentationOpportunities.handler(url, context, site);
    expect(lambdaSendStub).to.have.been.calledOnce;
    const lambdaPayload = JSON.parse(lambdaSendStub.firstCall.args[0].input.Payload);
    expect(lambdaPayload).to.include.all.keys([
      'type',
      'payload',
    ]);
    expect(lambdaPayload.type).to.equal('llm-insights');
    expect(lambdaPayload).to.have.nested.property('payload.rumData.url');
    expect(lambdaPayload).to.have.nested.property('payload.rumData.promptPath');
  });

  it('should add recommendations from lambda to high-organic-low-ctr opportunities', async () => {
    const auditData = await experimentationOpportunities.handler(url, context, site);
    const opportunity = auditData.auditResult.experimentationOpportunities
      .find((o) => o.type === 'high-organic-low-ctr');
    expect(opportunity.recommendations).to.deep.equal(
      getRecommendations(llmHanderResult),
    );
  });

  it('should not add recommendations to high-organic-low-ctr opportunities when error occurs in lambda', async () => {
    // Mock the lambda call to throw an error
    lambdaSendStub.rejects(new Error('Lambda error'));
    const auditData = await experimentationOpportunities.handler(url, context, site);
    const opportunity = auditData.auditResult.experimentationOpportunities
      .find((o) => o.type === 'high-organic-low-ctr');
    expect(opportunity.recommendations).to.be.undefined;
  });

  it('should not add recommendations to high-organic-low-ctr opportunities when lambda returns empty body', async () => {
    const lambdaResponse = {
      Payload: new TextEncoder().encode(JSON.stringify({
        statusCode: 200,
        body: null,
      })),
    };
    lambdaSendStub.resolves(lambdaResponse);
    const auditData = await experimentationOpportunities.handler(url, context, site);
    const opportunity = auditData.auditResult.experimentationOpportunities
      .find((o) => o.type === 'high-organic-low-ctr');
    expect(opportunity.recommendations).to.be.undefined;
  });

  it('should return empty recommendations array when llm response is empty', async () => {
    const recommendations = getRecommendations();
    expect(recommendations).to.deep.equal([]);
  });
});
