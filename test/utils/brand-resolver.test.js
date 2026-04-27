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

import {
  applyBrandScope,
  findActiveBrandForSite,
  resolveBrandForSite,
} from '../../src/utils/brand-resolver.js';

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

  function lastOutcome() {
    const calls = [...log.info.getCalls(), ...log.warn.getCalls(), ...log.debug.getCalls()]
      .filter((c) => /\[brand-resolver\] outcome/.test(c.args[0] || ''));
    return calls[calls.length - 1];
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

  describe('findActiveBrandForSite', () => {
    it('returns null and emits missing_input outcome at debug when context is missing', async () => {
      const result = await findActiveBrandForSite(undefined, { orgId, siteId });
      expect(result).to.be.null;
      // No log available, so just verify the call doesn't throw and returns null.
    });

    it('returns null and logs missing_input at debug when orgId is missing', async () => {
      const ctx = buildContext({ brands: [] });
      const result = await findActiveBrandForSite(ctx, { siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call).to.exist;
      expect(call.proxy).to.equal(log.debug);
      expect(call.args[1]).to.include({ result: 'missing_input', siteId });
    });

    it('returns null and logs missing_input when params is omitted entirely', async () => {
      const ctx = buildContext({ brands: [] });
      const result = await findActiveBrandForSite(ctx);

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.args[1]).to.include({ result: 'missing_input' });
    });

    it('returns null and logs no_client when postgrestClient is unavailable', async () => {
      const ctx = { log, dataAccess: { services: {} } };

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.debug);
      expect(call.args[1]).to.include({ result: 'no_client', orgId, siteId });
    });

    it('resolves brand via baseSiteId match and logs success at info', async () => {
      const brands = [
        { id: 'brand-other', site_id: 'other-site', brand_sites: [] },
        { id: 'brand-1', site_id: siteId, brand_sites: [] },
      ];
      const ctx = buildContext({ brands });

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.deep.equal({ brandId: 'brand-1', via: 'baseSiteId' });
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.info);
      expect(call.args[1]).to.include({
        result: 'success', orgId, siteId, brandId: 'brand-1', via: 'baseSiteId',
      });
      expect(call.args[1].durationMs).to.be.a('number');
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

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.deep.equal({ brandId: 'brand-2', via: 'brand_sites' });
      const call = lastOutcome();
      expect(call.args[1]).to.include({ via: 'brand_sites' });
    });

    it('returns null and logs no_match at info when no brand matches', async () => {
      const brands = [
        { id: 'brand-x', site_id: 'other-site', brand_sites: [{ site_id: 'unrelated' }] },
      ];
      const ctx = buildContext({ brands });

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.info);
      expect(call.args[1]).to.include({ result: 'no_match' });
    });

    it('handles undefined brands array gracefully', async () => {
      const ctx = buildContext({ brands: undefined });

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
    });

    it('returns null and logs error at warn with errorName when query throws', async () => {
      const err = new Error('boom');
      err.name = 'PostgrestError';
      const ctx = buildContext({ throws: err });

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.warn);
      expect(call.args[1]).to.include({
        result: 'error', errorName: 'PostgrestError', errorMessage: 'boom',
      });
      expect(log.debug).to.have.been.calledWithMatch(/\[brand-resolver\] stack/);
    });

    it('does not throw when log is missing across all outcomes', async () => {
      // success path
      const brands = [{ id: 'brand-z', site_id: siteId, brand_sites: [] }];
      const okCtx = buildContext({ brands });
      delete okCtx.log;
      expect(await findActiveBrandForSite(okCtx, { orgId, siteId }))
        .to.deep.equal({ brandId: 'brand-z', via: 'baseSiteId' });

      // error path
      const errCtx = buildContext({ throws: new Error('silent') });
      delete errCtx.log;
      expect(await findActiveBrandForSite(errCtx, { orgId, siteId })).to.be.null;

      // missing_input path
      const missCtx = buildContext({ brands: [] });
      delete missCtx.log;
      expect(await findActiveBrandForSite(missCtx, { siteId })).to.be.null;

      // no_client path
      expect(
        await findActiveBrandForSite({ dataAccess: { services: {} } }, { orgId, siteId }),
      ).to.be.null;

      // no_match path
      const noMatchCtx = buildContext({ brands: [] });
      delete noMatchCtx.log;
      expect(await findActiveBrandForSite(noMatchCtx, { orgId, siteId })).to.be.null;
    });
  });

  describe('resolveBrandForSite', () => {
    it('delegates to findActiveBrandForSite using site getters', async () => {
      const brands = [{ id: 'brand-1', site_id: siteId, brand_sites: [] }];
      const ctx = buildContext({ brands });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.deep.equal({ brandId: 'brand-1', via: 'baseSiteId' });
      expect(site.getId).to.have.been.called;
      expect(site.getOrganizationId).to.have.been.called;
    });

    it('returns null when site is missing (no getters)', async () => {
      const result = await resolveBrandForSite(buildContext({ brands: [] }), undefined);
      expect(result).to.be.null;
    });

    it('returns null when site is missing on null context', async () => {
      const result = await resolveBrandForSite(undefined, undefined);
      expect(result).to.be.null;
    });
  });

  describe('applyBrandScope', () => {
    it('returns the message unchanged when brand is null', () => {
      const message = { type: 't', siteId: 'orig', data: { foo: 1 } };
      const out = applyBrandScope(message, null);
      expect(out).to.equal(message);
    });

    it('returns the message unchanged when brand is undefined', () => {
      const message = { type: 't', siteId: 'orig' };
      const out = applyBrandScope(message, undefined);
      expect(out).to.equal(message);
    });

    it('adds scope fields and does NOT mutate siteId when brand is provided', () => {
      const message = { type: 't', siteId: 'orig-site', data: { foo: 1 } };
      const out = applyBrandScope(message, { brandId: 'b-1' });

      expect(out).to.not.equal(message);
      expect(out).to.deep.equal({
        type: 't',
        siteId: 'orig-site',
        data: { foo: 1 },
        scopeType: 'brand',
        scopeId: 'b-1',
      });
      // original message untouched
      expect(message).to.deep.equal({ type: 't', siteId: 'orig-site', data: { foo: 1 } });
    });
  });
});
