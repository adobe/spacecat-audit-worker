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
import { Request } from '@adobe/fetch';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { main } from '../../src/index.js';

use(sinonChai);

describe('Index siteId handling and validation flag', () => {
  const sandbox = sinon.createSandbox();
  let context;
  let messageBodyJson;

  beforeEach(() => {
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x';
    messageBodyJson = {
      type: 'dummy',
      siteId: 'site-xyz',
    };
    context = {
      dataAccess: {
        Site: {
          findById: sandbox.stub().resolves({
            getId: sandbox.stub().returns('site-xyz'),
          }),
        },
      },
      log: {
        debug: sandbox.spy(),
        info: sandbox.spy(),
        warn: sandbox.spy(),
        error: sandbox.spy(),
      },
      runtime: { region: 'us-east-1' },
      invocation: {
        event: {
          Records: [{ body: JSON.stringify(messageBodyJson) }],
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('sets context.site and requiresValidation=true when entitlement exists', async () => {
    sandbox.stub(TierClient, 'createForSite').resolves({
      checkValidEntitlement: sandbox.stub().resolves({ entitlement: { tier: 'PAID' } }),
    });

    const resp = await main(new Request('https://space.cat'), context);

    expect(resp.status).to.equal(200);
    expect(context.site).to.exist;
    expect(context.site.requiresValidation).to.equal(true);
  });

  it('sets requiresValidation=false when entitlement is absent', async () => {
    sandbox.stub(TierClient, 'createForSite').resolves({
      checkValidEntitlement: sandbox.stub().resolves({ entitlement: null }),
    });

    const resp = await main(new Request('https://space.cat'), context);

    expect(resp.status).to.equal(200);
    expect(context.site).to.exist;
    expect(context.site.requiresValidation).to.equal(false);
  });

  // Removed legacy fallback test: validation is driven solely by entitlements

  it('logs a warning when site fetch fails (coverage for catch)', async () => {
    context.dataAccess.Site.findById.rejects(new Error('db down'));

    const resp = await main(new Request('https://space.cat'), context);

    expect(resp.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWithMatch('Failed to fetch site');
  });
});
