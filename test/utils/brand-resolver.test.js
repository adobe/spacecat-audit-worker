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

/* eslint-env mocha */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { resolveBrandForSite, withBrandScope } from '../../src/utils/brand-resolver.js';

use(sinonChai);

describe('brand-resolver', () => {
  let sandbox;
  let log;
  let site;

  const siteId = 'site-1';
  const orgId = 'org-1';

  function buildContext({ brands, throws } = {}) {
    const queryChain = {
      from: sandbox.stub().returnsThis(),
      select: sandbox.stub().returnsThis(),
      eq: sandbox.stub().returnsThis(),
    };
    const promise = throws
      ? Promise.reject(throws)
      : Promise.resolve({ data: brands });
    queryChain.eq.onSecondCall().returns(promise);
    return {
      log,
      dataAccess: {
        services: {
          postgrestClient: queryChain,
        },
      },
    };
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
    site = {
      getId: sandbox.stub().returns(siteId),
      getOrganizationId: sandbox.stub().returns(orgId),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('resolveBrandForSite', () => {
    it('returns null when context is missing', async () => {
      const result = await resolveBrandForSite(undefined, site);
      expect(result).to.be.null;
    });

    it('returns null when site is missing', async () => {
      const result = await resolveBrandForSite(buildContext({ brands: [] }), undefined);
      expect(result).to.be.null;
    });

    it('returns null and logs debug when orgId is missing', async () => {
      site.getOrganizationId.returns(null);
      const ctx = buildContext({ brands: [] });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.be.null;
      expect(log.debug).to.have.been.calledWithMatch(/missing orgId or siteId/);
    });

    it('returns null and logs debug when siteId is missing', async () => {
      site.getId.returns(null);
      const ctx = buildContext({ brands: [] });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.be.null;
      expect(log.debug).to.have.been.calledWithMatch(/missing orgId or siteId/);
    });

    it('returns null and logs debug when postgrestClient is unavailable', async () => {
      const ctx = { log, dataAccess: { services: {} } };

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.be.null;
      expect(log.debug).to.have.been.calledWithMatch(/postgrestClient unavailable/);
    });

    it('resolves brand via baseSiteId match', async () => {
      const brands = [
        { id: 'brand-other', site_id: 'other-site', brand_sites: [] },
        { id: 'brand-1', site_id: siteId, brand_sites: [] },
      ];
      const ctx = buildContext({ brands });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.deep.equal({ brandId: 'brand-1', brandSiteId: siteId });
      expect(log.info).to.have.been.calledWithMatch(/resolved brand brand-1.*via baseSiteId/);
    });

    it('falls back to brand_sites join match when baseSiteId does not match', async () => {
      const brands = [
        {
          id: 'brand-2',
          site_id: 'primary-site',
          brand_sites: [{ site_id: 'another' }, { site_id: siteId }],
        },
      ];
      const ctx = buildContext({ brands });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.deep.equal({ brandId: 'brand-2', brandSiteId: 'primary-site' });
      expect(log.info).to.have.been.calledWithMatch(/via brand_sites/);
    });

    it('uses siteId fallback when matched brand has no site_id column', async () => {
      const brands = [
        {
          id: 'brand-3',
          site_id: null,
          brand_sites: [{ site_id: siteId }],
        },
      ];
      const ctx = buildContext({ brands });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.deep.equal({ brandId: 'brand-3', brandSiteId: siteId });
    });

    it('returns null and logs debug when no brand matches', async () => {
      const brands = [
        { id: 'brand-x', site_id: 'other-site', brand_sites: [{ site_id: 'unrelated' }] },
      ];
      const ctx = buildContext({ brands });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.be.null;
      expect(log.debug).to.have.been.calledWithMatch(/no active brand found/);
    });

    it('handles undefined brands array gracefully', async () => {
      const ctx = buildContext({ brands: undefined });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.be.null;
    });

    it('returns null and logs warn when query throws', async () => {
      const ctx = buildContext({ throws: new Error('boom') });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.be.null;
      expect(log.warn).to.have.been.calledWithMatch(/failed to resolve brand.*boom/);
    });

    it('does not throw when log is missing on warn path', async () => {
      const ctx = buildContext({ throws: new Error('silent') });
      delete ctx.log;

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.be.null;
    });

    it('does not throw when log is missing on debug paths', async () => {
      const noOrgSite = {
        getId: sandbox.stub().returns(siteId),
        getOrganizationId: sandbox.stub().returns(null),
      };
      const ctx = buildContext({ brands: [] });
      delete ctx.log;

      const result = await resolveBrandForSite(ctx, noOrgSite);

      expect(result).to.be.null;
    });

    it('does not throw when log is missing on info path (success)', async () => {
      const brands = [{ id: 'brand-z', site_id: siteId, brand_sites: [] }];
      const ctx = buildContext({ brands });
      delete ctx.log;

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.deep.equal({ brandId: 'brand-z', brandSiteId: siteId });
    });
  });

  describe('withBrandScope', () => {
    it('returns the message unchanged when brand is null', () => {
      const message = { type: 't', siteId: 'orig', data: { foo: 1 } };
      const out = withBrandScope(message, null);
      expect(out).to.equal(message);
    });

    it('returns the message unchanged when brand is undefined', () => {
      const message = { type: 't', siteId: 'orig' };
      const out = withBrandScope(message, undefined);
      expect(out).to.equal(message);
    });

    it('merges scope fields and overrides siteId when brand is provided', () => {
      const message = { type: 't', siteId: 'old-site', data: { foo: 1 } };
      const out = withBrandScope(message, { brandId: 'b-1', brandSiteId: 'new-site' });

      expect(out).to.not.equal(message);
      expect(out).to.deep.equal({
        type: 't',
        siteId: 'new-site',
        data: { foo: 1 },
        scopeType: 'brand',
        scopeId: 'b-1',
      });
    });
  });
});
