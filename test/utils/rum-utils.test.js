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

import nock from 'nock';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getRUMDomainkey } from '../../src/support/utils.js';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('rum utils', () => {
  let context;
  let processEnvCopy;
  beforeEach('setup', () => {
    context = {
      env: {
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'some-key-id',
        AWS_SECRET_ACCESS_KEY: 'some-secret-key',
        AWS_SESSION_TOKEN: 'some-secret-token',
      },
      runtime: { name: 'aws-lambda' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
    };
    processEnvCopy = { ...process.env };
    process.env = {
      ...process.env,
      ...context.env,
    };
  });

  afterEach('clean up', () => {
    process.env = processEnvCopy;
    nock.cleanAll();
  });

  it('throws error when domain key does not exist', async () => {
    const scope = nock('https://secretsmanager.us-east-1.amazonaws.com/')
      .post('/', (body) => body.SecretId === '/helix-deploy/spacecat-services/customer-secrets/some_domain_com/ci')
      .reply(200, { SecretString: JSON.stringify({ }) });

    await expect(getRUMDomainkey('https://some-domain.com', context, { expiration: 0 })).to.be.rejectedWith('No domainkey found for https://some-domain.com');
    scope.done();
  });
});
