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
import * as siteValidation from '../../src/utils/site-validation.js';
import { main } from '../../src/index.js';
import { SITES_REQUIRING_VALIDATION } from '../../src/common/constants.js';

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

  it('sets context.site and requiresValidation=false when entitlement exists', async () => {
    sandbox.stub(siteValidation, 'checkSiteRequiresValidation').resolves(false);

    const resp = await main(new Request('https://space.cat'), context);

    expect(resp.status).to.equal(200);
    expect(context.site).to.exist;
    expect(context.site.requiresValidation).to.equal(false);
  });

  it('sets requiresValidation=true when entitlement check fails and site is in legacy list', async () => {
    const mustValidateId = SITES_REQUIRING_VALIDATION[0];
    context.dataAccess.Site.findById.resolves({ getId: sandbox.stub().returns(mustValidateId) });
    sandbox.stub(siteValidation, 'checkSiteRequiresValidation').resolves(true);

    const resp = await main(new Request('https://space.cat'), context);

    expect(resp.status).to.equal(200);
    expect(context.site).to.exist;
    expect(context.site.requiresValidation).to.equal(true);
  });
});
