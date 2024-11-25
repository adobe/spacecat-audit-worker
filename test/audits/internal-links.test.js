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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';
import { internalLinksAuditRunner } from '../../src/internal-links/handler.js';
import { internalLinksData } from '../fixtures/internal-links-data.js';
import { MockContextBuilder } from '../shared.js';

const AUDIT_RESULT_DATA = [
  {
    url_to: 'https://www.example.com/article/dogs/breeds/choosing-an-irish-setter',
    url_from: 'https://www.example.com/article/dogs/just-for-fun/dogs-good-for-men-13-manly-masculine-dog-breeds',
    traffic_domain: 100,
  },
  {
    url_to: 'https://www.example.com/article/dogs/breeds/choosing-a-miniature-poodle',
    url_from: 'https://www.example.com/article/dogs/pet-care/when-is-a-dog-considered-senior',
    traffic_domain: 100,
  },
];

use(sinonChai);

const sandbox = sinon.createSandbox();

const baseURL = 'https://example.com';
const auditUrl = 'www.example.com';

describe('Broken internal links audit', () => {
  const site = createSite({ baseURL });

  const context = new MockContextBuilder()
    .withSandbox(sandbox)
    .withOverrides({
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      rumApiClient: {
        query: sinon.stub().resolves(internalLinksData),
      },
    })
    .build();

  beforeEach('setup', () => {
    nock('https://secretsmanager.us-east-1.amazonaws.com/')
      .post('/', (body) => body.SecretId === '/helix-deploy/spacecat-services/customer-secrets/example_com/ci')
      .reply(200, {
        SecretString: JSON.stringify({
          RUM_DOMAIN_KEY: 'test-key',
        }),
      });
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('broken-internal-links audit runs rum api client 404 query', async () => {
    const result = await internalLinksAuditRunner(
      'www.example.com',
      context,
      site,
    );
    expect(context.rumApiClient.query).calledWith('404', {
      domain: 'www.example.com',
      domainkey: 'test-key',
      interval: 30,
      granularity: 'hourly',
    });
    expect(result).to.deep.equal({
      auditResult: {
        brokenInternalLinks: AUDIT_RESULT_DATA,
        fullAuditRef: auditUrl,
        finalUrl: auditUrl,
        auditContext: {
          interval: 30,
        },
      },
      fullAuditRef: auditUrl,
    });
  });
});
