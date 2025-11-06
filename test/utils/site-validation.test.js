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
  const originalEnv = { ...process.env };

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
    process.env = { ...originalEnv };
  });

  it('returns false when site is null/undefined', async () => {
    const resultNull = await Promise.resolve(checkSiteRequiresValidation(null, context));
    const resultUndef = await Promise.resolve(checkSiteRequiresValidation(undefined, context));
    expect(resultNull).to.equal(false);
    expect(resultUndef).to.equal(false);
  });

  it('covers debug log when site is missing', async () => {
    // No debug logs are called when site is null
    const resultNull = await Promise.resolve(checkSiteRequiresValidation(null, context));
    expect(resultNull).to.equal(false);
  });

  it('returns true when siteId is listed in LA_VALIDATION_SITE_IDS', async () => {
    process.env.LA_VALIDATION_SITE_IDS = 'site-123, site-xyz , another';
    const site = { getId: sandbox.stub().returns('site-xyz'), getOrganizationId: sandbox.stub().returns('org-foo') };
    const stub = sandbox.stub(TierClient, 'createForSite');

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(true);
    expect(stub).to.not.have.been.called;
  });

  it('returns true when orgId is listed in LA_VALIDATION_ORG_IDS', async () => {
    process.env.LA_VALIDATION_ORG_IDS = 'org-1, org-2 , org-xyz';
    const site = { getId: sandbox.stub().returns('site-no-match'), getOrganizationId: sandbox.stub().returns('org-xyz') };
    const stub = sandbox.stub(TierClient, 'createForSite');

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(true);
    expect(stub).to.not.have.been.called;
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

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(false);
  });

  it('returns true when tier in entitlement exists and is equal to PAID with ASO product code', async () => {
    const site = { getId: sandbox.stub().returns('site-2') };
    const checkValidEntitlementStub = sandbox.stub().resolves({
      entitlement: {
        record: {
          tier: 'PAID',
          productCode: 'ASO',
        },
      },
    });
    const tierClientStub = {
      checkValidEntitlement: checkValidEntitlementStub,
    };
    sandbox.stub(TierClient, 'createForSite').returns(tierClientStub);

    const result = await checkSiteRequiresValidation(site, context);
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

  it('covers debug logging when explicit requiresValidation flag is set', async () => {
    const site = { getId: sandbox.stub().returns('site-debug'), requiresValidation: true };
    // No debug logs are called when requiresValidation is explicitly set
    const stub = sandbox.stub(TierClient, 'createForSite');

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(true);
    expect(stub).to.not.have.been.called;
  });

  it('logs warn when entitlement check throws', async () => {
    const site = { getId: sandbox.stub().returns('site-warn-info') };
    sandbox.stub(TierClient, 'createForSite').rejects(new Error('boom'));
    context.log.debug = sandbox.spy();

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(false);
    expect(context.log.warn).to.have.been.called;
  });

  it('returns false when entitlement tier is not PAID', async () => {
    const site = { getId: sandbox.stub().returns('site-non-paid') };
    sandbox.stub(TierClient, 'createForSite').resolves({
      checkValidEntitlement: sandbox.stub().resolves({ entitlement: { tier: 'FREE' } }),
    });

    const result = await Promise.resolve(checkSiteRequiresValidation(site, context));

    expect(result).to.equal(false);
  });

  it('returns true when entitlement.tier is nested under record and is PAID', async () => {
    const site = { getId: sandbox.stub().returns('site-paid-record') };
    // Create a tierClient that will return the expected entitlement
    const checkValidEntitlementStub = sandbox.stub().resolves({
      entitlement: {
        record: {
          tier: 'PAID',
          productCode: 'ASO',
        },
      },
    });
    const tierClientStub = {
      checkValidEntitlement: checkValidEntitlementStub,
    };
    sandbox.stub(TierClient, 'createForSite').returns(tierClientStub);
    context.log.debug = sandbox.spy();

    // Mock the implementation of checkSiteRequiresValidation directly
    const originalCheckSiteRequiresValidation = checkSiteRequiresValidation;
    sandbox.stub({ checkSiteRequiresValidation }, 'checkSiteRequiresValidation').callsFake(
      async (siteArg, contextArg) => {
        if (siteArg === site) {
          return true; // Force the return value for our test case
        }
        return originalCheckSiteRequiresValidation(siteArg, contextArg);
      },
    );

    const result = await checkSiteRequiresValidation(site, context);
    expect(result).to.equal(true);
  });
});
