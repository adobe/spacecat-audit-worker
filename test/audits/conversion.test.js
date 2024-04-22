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
import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import { conversionAuditRunner } from '../../src/conversion/handler.js';
import { rumDashboardData, rumSourcesData, expectedConversionData } from '../fixtures/conversion-data.js';

chai.use(sinonChai);
const { expect } = chai;

const DOMAIN_REQUEST_DEFAULT_PARAMS = {
  interval: 7,
  offset: 0,
  limit: 101,
};
describe('Conversion Audit', () => {
  let context;
  let mockLog;

  beforeEach('setup', () => {
    mockLog = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };
    context = {
      log: mockLog,
      env: {
        RUM_DOMAIN_KEY: 'domainkey',
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('fetch conversion data for base url > process > send results', async () => {
    nock('https://www.spacecat.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-dashboard')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        url: 'www.spacecat.com',
      })
      .reply(200, rumDashboardData);

    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-sources')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        aggregate: false,
        checkpoint: 'convert',
        url: 'www.spacecat.com',
      })
      .reply(200, rumSourcesData);

    const auditData = await conversionAuditRunner('https://www.spacecat.com', context);
    expect(auditData).to.deep.equal(expectedConversionData);
  });

  it('rum-dashboard and rum-sources api is called with correct arguments', async () => {
    nock('https://www.spacecat.com')
      .get('/')
      .reply(200);
    context.rumApiClient = {
      getConversionData: sinon.stub().resolves(rumSourcesData.results.data),
      getRUMDashboard: sinon.stub().resolves(rumDashboardData.results.data),
    };
    const auditData = await conversionAuditRunner('https://www.spacecat.com', context);
    expect(context.rumApiClient.getConversionData).calledWith({ url: 'www.spacecat.com' });
    expect(context.rumApiClient.getRUMDashboard).calledWith({ url: 'www.spacecat.com' });
    expect(auditData).to.deep.equal(expectedConversionData);
  });
});
