/*
 * Copyright 2025 Adobe. All rights reserved.
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

use(sinonChai);

describe('Rum Traffic Tests', () => {
  let sandbox;
  let rumTrafficHandler;
  let storeMetricsStub;
  let queryStub;
  let context;

  const baseURL = 'https://spacecat.com';
  const auditUrl = 'www.spacecat.com';
  const siteId = '12345';
  const domainkey = 'test-domain-key';

  const mockRumData = [
    {
      url: 'https://www.spacecat.com/page1',
      total: 1000,
      paid: 200,
      earned: 300,
      owned: 500,
    },
    {
      url: 'https://www.spacecat.com/page2',
      total: 2000,
      paid: 400,
      earned: 600,
      owned: 1000,
    },
  ];

  const expectedTrafficData = {
    'https://www.spacecat.com/page1': {
      total: 1000,
      paid: 200,
      earned: 300,
      owned: 500,
    },
    'https://www.spacecat.com/page2': {
      total: 2000,
      paid: 400,
      earned: 600,
      owned: 1000,
    },
  };

  const site = {
    getBaseURL: () => baseURL,
    getId: () => siteId,
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // Mock the storeMetrics function
    storeMetricsStub = sandbox.stub().resolves(`metrics/${siteId}/rum/rum-traffic.json`);
    // Mock RUM API client query
    queryStub = sandbox.stub().resolves(mockRumData);
    // Setup common context
    context = {
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
      rumApiClient: {
        query: queryStub,
      },
      s3Client: {
        send: sandbox.stub().resolves({}),
      },
      env: {
        S3_IMPORTER_BUCKET_NAME: 'test-bucket',
      },
    };
    nock('https://secretsmanager.us-east-1.amazonaws.com/')
      .post('/', (body) => body.SecretId === '/helix-deploy/spacecat-services/customer-secrets/spacecat_com/ci')
      .reply(200, {
        SecretString: JSON.stringify({
          RUM_DOMAIN_KEY: domainkey,
        }),
      });

    // Import and mock the handler function
    const module = await esmock('../../src/rum-traffic/rum-traffic.js', {
      '@adobe/spacecat-shared-utils': {
        storeMetrics: storeMetricsStub,
      },
    });
    rumTrafficHandler = module.handler;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('rum-traffic audit runs RUM API client traffic-acquisition query', async () => {
    // Run the handler
    const result = await rumTrafficHandler(auditUrl, context, site);

    // Verify RUM API client query was called with correct parameters
    expect(queryStub).to.have.been.calledWith('traffic-acquisition', {
      domain: auditUrl,
      domainkey,
      interval: 30,
      granularity: 'daily',
    });

    // Verify the result structure
    expect(result).to.deep.equal({
      auditResult: {
        trafficData: expectedTrafficData,
      },
      fullAuditRef: auditUrl,
    });
  });

  it('rum-traffic audit calls the storeMetrics', async () => {
    await rumTrafficHandler(auditUrl, context, site);
    expect(storeMetricsStub).to.have.been.calledOnce;
  });
});
