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
import { ok } from '@adobe/spacecat-shared-http-utils';
import handler from '../../../src/paid-keyword-optimizer/guidance-handler.js';

use(sinonChai);

// TEMPORARY: Tests simplified while guidance handler is short-circuited for E2E testing.
// Original tests will be restored when the short-circuit is removed.
describe('Paid Keyword Optimizer Guidance Handler (short-circuited)', () => {
  let sandbox;
  let logStub;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    context = {
      log: logStub,
      dataAccess: {
        Audit: { findById: sandbox.stub() },
        Opportunity: { create: sandbox.stub() },
        Suggestion: { create: sandbox.stub() },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should short-circuit and return ok() without creating opportunities', async () => {
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: {
        url: 'https://example.com/page1',
        guidance: [{
          body: { url: 'https://example.com/page1' },
        }],
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(logStub.info).to.have.been.calledWithMatch(/Short-circuited/);
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(context.dataAccess.Suggestion.create).to.not.have.been.called;
  });

  it('should short-circuit even when guidance body url is missing (falls back to data.url)', async () => {
    const message = {
      auditId: 'auditId',
      siteId: 'site',
      data: {
        url: 'https://example.com/fallback',
        guidance: [{ body: {} }],
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
  });
});
