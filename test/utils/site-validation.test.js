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

import { expect } from 'chai';
import sinon from 'sinon';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { checkSiteRequiresValidation } from '../../src/utils/site-validation.js';

describe('utils/site-validation', () => {
  let sandbox;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    context = {
      log: {
        warn: sandbox.spy(),
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns false when site is null/undefined', async () => {
    const resultNull = await Promise.resolve(checkSiteRequiresValidation(null, context));
    const resultUndef = await Promise.resolve(checkSiteRequiresValidation(undefined, context));
    expect(resultNull).to.equal(false);
    expect(resultUndef).to.equal(false);
  });

  it('returns site.requiresValidation when explicitly set to true', async () => {
    const site = { getId: sandbox.stub().returns('site-1'), requiresValidation: true };
    const stub = sandbox.stub(TierClient, 'createForSite');

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(true);
    expect(stub).to.not.have.been.called;
  });

  it('returns site.requiresValidation when explicitly set to false', async () => {
    const site = { getId: sandbox.stub().returns('site-1'), requiresValidation: false };
    const stub = sandbox.stub(TierClient, 'createForSite');

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(false);
    expect(stub).to.not.have.been.called;
  });

  it('returns true when entitlement exists (PAID or FREE_TRIAL)', async () => {
    const site = { getId: sandbox.stub().returns('site-2') };
    sandbox.stub(TierClient, 'createForSite').resolves({
      checkValidEntitlement: sandbox.stub().resolves({ entitlement: 'PAID' }),
    });

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(true);
  });

  it('returns false and logs warn when entitlement check throws', async () => {
    const site = { getId: sandbox.stub().returns('site-err') };
    sandbox.stub(TierClient, 'createForSite').rejects(new Error('boom'));

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(false);
    expect(context.log.warn).to.have.been.called;
  });

  // Removed legacy fallback tests since validation is entitlement-driven only

  it('returns false when no entitlement and site is not included', async () => {
    const site = { getId: sandbox.stub().returns('some-other-id') };
    sandbox.stub(TierClient, 'createForSite').resolves({
      checkValidEntitlement: sandbox.stub().resolves({ entitlement: undefined }),
    });

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(false);
  });
});
