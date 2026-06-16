/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('dataAccess middleware', () => {
  let mockFn;
  let request;
  let innerMiddleware;
  let dataAccessV3;
  let dataAccess;

  beforeEach(async () => {
    mockFn = sinon.stub().resolves('handler-result');
    request = { some: 'request' };
    // dataAccessV3(fn) returns a middleware (request, context) => ...
    innerMiddleware = sinon.stub().resolves('v3-result');
    dataAccessV3 = sinon.stub().returns(innerMiddleware);

    dataAccess = await esmock('../../src/support/data-access.js', {
      '@adobe/spacecat-shared-data-access': { default: dataAccessV3 },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('throws when POSTGREST_URL is not configured', async () => {
    const context = { env: {} };
    await expect(dataAccess(mockFn)(request, context))
      .to.be.rejectedWith('POSTGREST_URL is not configured');
    expect(dataAccessV3).to.not.have.been.called;
    expect(mockFn).to.not.have.been.called;
  });

  it('throws when context has no env at all', async () => {
    const context = {};
    await expect(dataAccess(mockFn)(request, context))
      .to.be.rejectedWith('POSTGREST_URL is not configured');
    expect(dataAccessV3).to.not.have.been.called;
  });

  it('delegates to the V3 data-access when POSTGREST_URL is present', async () => {
    const context = { env: { POSTGREST_URL: 'https://data-svc.example.com' } };
    const result = await dataAccess(mockFn)(request, context);

    expect(result).to.equal('v3-result');
    expect(dataAccessV3).to.have.been.calledOnceWithExactly(mockFn);
    expect(innerMiddleware).to.have.been.calledOnceWithExactly(request, context);
  });
});
