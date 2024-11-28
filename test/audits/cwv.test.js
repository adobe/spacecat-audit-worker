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
import { CWVRunner } from '../../src/cwv/handler.js';
import { rumData } from '../fixtures/rum-data.js';

use(sinonChai);

const sandbox = sinon.createSandbox();

const baseURL = 'https://spacecat.com';
const auditUrl = 'www.spacecat.com';
const DOMAIN_REQUEST_DEFAULT_PARAMS = {
  domain: auditUrl,
  domainkey: '42',
  interval: 7,
  granularity: 'hourly',
};
const HANDLER_NAME = 'cwv';

describe('CWVRunner Tests', () => {
  const groupedURLs = [{ test: 'test' }];
  const siteConfig = {
    getGroupedURLs: sandbox.stub().returns(groupedURLs),
  };
  const site = {
    getBaseURL: sandbox.stub().returns(baseURL),
    getConfig: () => siteConfig,
  };

  const context = {
    runtime: { name: 'aws-lambda', region: 'us-east-1' },
    func: { package: 'spacecat-services', version: 'ci', name: 'test' },
    rumApiClient: {
      query: sandbox.stub().resolves(rumData),
    },
  };

  beforeEach('setup', () => {
    nock('https://secretsmanager.us-east-1.amazonaws.com/')
      .post('/', (body) => body.SecretId === '/helix-deploy/spacecat-services/customer-secrets/spacecat_com/ci')
      .reply(200, {
        SecretString: JSON.stringify({
          RUM_DOMAIN_KEY: '42',
        }),
      });
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('cwv audit runs rum api client cwv query', async () => {
    const result = await CWVRunner('www.spacecat.com', context, site);

    expect(siteConfig.getGroupedURLs.calledWith(HANDLER_NAME)).to.be.true;
    expect(
      context.rumApiClient.query.calledWith(
        HANDLER_NAME,
        {
          ...DOMAIN_REQUEST_DEFAULT_PARAMS,
          groupedURLs,
        },
      ),
    ).to.be.true;

    expect(result).to.deep.equal({
      auditResult: {
        cwv: rumData.filter((data) => data.pageviews >= 7000),
        auditContext: {
          interval: 7,
        },
      },
      fullAuditRef: auditUrl,
    });
  });
});
