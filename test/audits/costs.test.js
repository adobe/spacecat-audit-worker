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
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { MockContextBuilder } from '../shared.js';
import { runner } from '../../src/costs/handler.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

const message = {
  type: 'costs',
  url: 'site-id',
};
const sandbox = sinon.createSandbox();

describe('Costs audit', () => {
  let context;

  beforeEach('setup', () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AHREFS_API_BASE_URL: 'https://ahrefs-example.com',
          AHREFS_API_KEY: 'ahrefs-token',
        },
      })
      .build(message);
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('costs audit returns ahrefs costs succesfully', async () => {
    const limitsUsageResponse = {
      limits_and_usage: {
        subscription: 'Enterprise, billed yearly',
        usage_reset_date: '2024-08-28T00:00:00Z',
        units_limit_workspace: 12000000,
        units_usage_workspace: 6618294,
        units_limit_api_key: 1000000,
        units_usage_api_key: 198771,
        api_key_expiration_date: '2025-01-04T17:44:07Z',
      },
    };

    nock('https://ahrefs-example.com')
      .get('/subscription-info/limits-and-usage')
      .reply(200, limitsUsageResponse);

    const result = await runner('https://spacecat.com', context);

    const expectedAuditResult = {
      ahrefs: {
        usedApiUnits: 198771,
        limitApiUnits: 1000000,
        fullAuditRef: 'https://ahrefs-example.com/subscription-info/limits-and-usage',
      },
    };

    expect(result).to.eql({
      auditResult: expectedAuditResult,
      fullAuditRef: 'https://ahrefs-example.com/subscription-info/limits-and-usage',
    });
  });

  it('costs audit returns error for ahrefs costs when call to ahrefs throws', async () => {
    nock('https://ahrefs-example.com')
      .get('/subscription-info/limits-and-usage')
      .reply(500);

    const result = await runner('https://spacecat.com', context);

    const expectedAuditResult = {
      ahrefs: {
        error: 'Ahrefs costs type audit failed with error: Ahrefs API request failed with status: 500',
      },
    };

    expect(result).to.eql({
      auditResult: expectedAuditResult,
      fullAuditRef: undefined,
    });
  });
});
