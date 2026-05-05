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
  applyScopeToOpportunity,
  BRAND_RESOLUTION_TIMEOUT_MS,
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

  /**
   * Build a single PostgREST query chain mock that resolves (or rejects) on the
   * third `.eq()` call (matching the new 3-eq query pattern: org, status, site_id).
   */
  function makeChain(resolveData, throwWith, postgrestError = null) {
    const chain = {
      select: sandbox.stub().returnsThis(),
      eq: sandbox.stub().returnsThis(),
      order: sandbox.stub().returnsThis(),
    };
    if (throwWith) {
      chain.limit = sandbox.stub().rejects(throwWith);
    } else {
      chain.limit = sandbox.stub().resolves({ data: resolveData, error: postgrestError });
    }
    return chain;
  }

  /**
   * Build a full Lambda context with a PostgREST client mock that supports the
   * two-query structure: directChain for Q1 (site_id match), joinChain for Q2
   * (brand_sites join fallback).
   *
   * @param {object} opts
   * @param {Array}  [opts.directBrands=[]] - rows returned by Q1 (direct site_id match)
   * @param {Array}  [opts.joinBrands=[]]   - rows returned by Q2 (brand_sites join)
   * @param {Error}  [opts.throws=null]     - if set, Q1 rejects with this error (Q2 never runs)
   */
  function buildContext({ directBrands = [], joinBrands = [], throws = null } = {}) {
    const directChain = makeChain(throws ? null : directBrands, throws);
    const joinChain = makeChain(joinBrands, null);
    return {
      log,
      dataAccess: {
        services: {
          postgrestClient: {
            from: sandbox.stub()
              .onFirstCall()
              .returns(directChain)
              .onSecondCall()
              .returns(joinChain),
          },
        },
      },
    };
  }

  /** Return the last structured outcome log call across all log levels. */
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
      // No log available; just verify the call doesn't throw and returns null.
    });

    it('returns null and logs missing_input at debug when orgId is missing', async () => {
      const ctx = buildContext({ directBrands: [] });
      const result = await findActiveBrandForSite(ctx, { siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call).to.exist;
      expect(call.proxy).to.equal(log.debug);
      expect(call.args[1]).to.include({ result: 'missing_input', siteId });
    });

    it('returns null and logs missing_input when params is omitted entirely', async () => {
      const ctx = buildContext({ directBrands: [] });
      const result = await findActiveBrandForSite(ctx);

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.args[1]).to.include({ result: 'missing_input' });
    });

    it('returns null and logs no_client at warn when postgrestClient is unavailable', async () => {
      const ctx = { log, dataAccess: { services: {} } };

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.warn);
      expect(call.args[1]).to.include({ result: 'no_client', orgId, siteId });
    });

    it('resolves brand via direct baseSiteId match and logs success at info', async () => {
      const ctx = buildContext({ directBrands: [{ id: 'brand-1' }] });

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.deep.equal({ brandId: 'brand-1' });
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.info);
      expect(call.args[1]).to.include({
        result: 'success', orgId, siteId, brandId: 'brand-1', via: 'baseSiteId',
      });
      expect(call.args[1].durationMs).to.be.a('number');
    });

    it('falls back to brand_sites join match when no direct baseSiteId match exists', async () => {
      const ctx = buildContext({ directBrands: [], joinBrands: [{ id: 'brand-2' }] });

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.deep.equal({ brandId: 'brand-2' });
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.info);
      expect(call.args[1]).to.include({ result: 'success', via: 'brand_sites' });
    });

    it('returns null and logs no_match at info when no brand matches either query', async () => {
      const ctx = buildContext();

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.info);
      expect(call.args[1]).to.include({ result: 'no_match' });
    });

    it('handles undefined data array from Q1 gracefully and falls through to Q2', async () => {
      const ctx = buildContext({ directBrands: undefined, joinBrands: [] });

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
    });

    it('returns null and logs error at warn with errorName (not errorMessage) when query throws', async () => {
      const err = new Error('boom');
      err.name = 'PostgrestError';
      const ctx = buildContext({ throws: err });

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.warn);
      expect(call.args[1]).to.include({ result: 'error', errorName: 'PostgrestError' });
      // errorMessage must NOT appear in the warn payload (may contain DB internals)
      expect(call.args[1]).to.not.have.property('errorMessage');
      // but error detail (message + stack) must appear at debug level
      expect(log.debug).to.have.been.calledWithMatch(/\[brand-resolver\] error detail/);
      const debugCall = log.debug.getCalls().find((c) => /error detail/.test(c.args[0]));
      expect(debugCall.args[1]).to.have.property('errorMessage', 'boom');
    });

    it('returns null and logs timeout at warn when query exceeds BRAND_RESOLUTION_TIMEOUT_MS', async () => {
      const clock = sandbox.useFakeTimers();
      const neverChain = {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        order: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returns(new Promise(() => {})),
      };
      // limit() returns a promise that never settles

      const ctx = {
        log,
        dataAccess: {
          services: {
            postgrestClient: { from: sandbox.stub().returns(neverChain) },
          },
        },
      };

      const resultP = findActiveBrandForSite(ctx, { orgId, siteId });
      await clock.tickAsync(BRAND_RESOLUTION_TIMEOUT_MS + 1);
      const result = await resultP;

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.warn);
      expect(call.args[1]).to.include({ result: 'timeout', orgId, siteId });
    });

    it('returns null and logs error at warn when Q2 returns a PostgREST error response', async () => {
      const postgrestErr = { message: 'permission denied', code: '42501' };
      const okChain = {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        order: sandbox.stub().returnsThis(),
        limit: sandbox.stub().resolves({ data: [], error: null }),
      };
      const errorChain = {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        order: sandbox.stub().returnsThis(),
        limit: sandbox.stub().resolves({ data: null, error: postgrestErr }),
      };
      const ctx = {
        log,
        dataAccess: {
          services: {
            postgrestClient: {
              from: sandbox.stub()
                .onFirstCall()
                .returns(okChain)
                .onSecondCall()
                .returns(errorChain),
            },
          },
        },
      };

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.warn);
      expect(call.args[1]).to.include({ result: 'error', errorName: 'PostgrestError' });
      expect(call.args[1]).to.not.have.property('errorMessage');
    });

    it('returns null and logs error at warn when Q1 returns a PostgREST error response', async () => {
      const postgrestErr = { message: 'RLS policy violation', code: '42501' };
      const errorChain = {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        order: sandbox.stub().returnsThis(),
        limit: sandbox.stub().resolves({ data: null, error: postgrestErr }),
      };
      const ctx = {
        log,
        dataAccess: { services: { postgrestClient: { from: sandbox.stub().returns(errorChain) } } },
      };

      const result = await findActiveBrandForSite(ctx, { orgId, siteId });

      expect(result).to.be.null;
      const call = lastOutcome();
      expect(call.proxy).to.equal(log.warn);
      expect(call.args[1]).to.include({ result: 'error', errorName: 'PostgrestError' });
      expect(call.args[1]).to.not.have.property('errorMessage');
    });

    it('does not throw when log is missing across all outcomes', async () => {
      // success via direct match
      const okCtx = buildContext({ directBrands: [{ id: 'brand-z' }] });
      delete okCtx.log;
      expect(await findActiveBrandForSite(okCtx, { orgId, siteId }))
        .to.deep.equal({ brandId: 'brand-z' });

      // success via brand_sites join
      const joinCtx = buildContext({ joinBrands: [{ id: 'brand-j' }] });
      delete joinCtx.log;
      expect(await findActiveBrandForSite(joinCtx, { orgId, siteId }))
        .to.deep.equal({ brandId: 'brand-j' });

      // error path
      const errCtx = buildContext({ throws: new Error('silent') });
      delete errCtx.log;
      expect(await findActiveBrandForSite(errCtx, { orgId, siteId })).to.be.null;

      // missing_input path
      const missCtx = buildContext({ directBrands: [] });
      delete missCtx.log;
      expect(await findActiveBrandForSite(missCtx, { siteId })).to.be.null;

      // no_client path
      expect(
        await findActiveBrandForSite({ dataAccess: { services: {} } }, { orgId, siteId }),
      ).to.be.null;

      // no_match path
      const noMatchCtx = buildContext();
      delete noMatchCtx.log;
      expect(await findActiveBrandForSite(noMatchCtx, { orgId, siteId })).to.be.null;
    });
  });

  describe('resolveBrandForSite', () => {
    it('delegates to findActiveBrandForSite using site getters', async () => {
      const ctx = buildContext({ directBrands: [{ id: 'brand-1' }] });

      const result = await resolveBrandForSite(ctx, site);

      expect(result).to.deep.equal({ brandId: 'brand-1' });
      expect(site.getId).to.have.been.called;
      expect(site.getOrganizationId).to.have.been.called;
    });

    it('returns null when site is missing (no getters)', async () => {
      const result = await resolveBrandForSite(buildContext({ directBrands: [] }), undefined);
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

    it('returns the message unchanged when brand has no brandId', () => {
      const message = { type: 't', siteId: 'orig' };
      const out = applyBrandScope(message, { someOtherField: 'x' });
      expect(out).to.equal(message);
    });

    it('adds scope fields, does NOT mutate siteId, and does not mutate the original message', () => {
      const message = { type: 't', siteId: 'orig-site', data: { foo: 1 } };
      const out = applyBrandScope(message, { brandId: 'b-1' });

      expect(out).to.not.equal(message);
      expect(out).to.deep.equal({
        type: 't',
        siteId: 'orig-site',
        data: { foo: 1 },
        scopeType: 'brand',
        brandId: 'b-1',
      });
      // original message untouched
      expect(message).to.deep.equal({ type: 't', siteId: 'orig-site', data: { foo: 1 } });
    });

    it('sets scopeType to the exact string "brand"', () => {
      const out = applyBrandScope({ type: 't', siteId: 's' }, { brandId: 'b-2' });
      expect(out.scopeType).to.equal('brand');
      expect(out.brandId).to.equal('b-2');
    });
  });

  describe('applyScopeToOpportunity', () => {
    let mockOpportunity;

    beforeEach(() => {
      mockOpportunity = {
        setScopeType: sandbox.stub(),
        setScopeId: sandbox.stub(),
      };
    });

    it("sets scopeType='brand' and scopeId when brand is resolved", () => {
      applyScopeToOpportunity(mockOpportunity, { brandId: 'brand-abc' }, log, '[Test]');

      expect(mockOpportunity.setScopeType).to.have.been.calledWith('brand');
      expect(mockOpportunity.setScopeId).to.have.been.calledWith('brand-abc');
    });

    it('sets scopeType=null and scopeId=null when brand is null (ghost scope cleanup)', () => {
      applyScopeToOpportunity(mockOpportunity, null, log, '[Test]');

      expect(mockOpportunity.setScopeType).to.have.been.calledWith(null);
      expect(mockOpportunity.setScopeId).to.have.been.calledWith(null);
    });

    it('does not throw when setScopeType throws; emits warn log', () => {
      mockOpportunity.setScopeType.throws(new Error('validation error'));

      expect(() => applyScopeToOpportunity(mockOpportunity, { brandId: 'b' }, log, '[Test]')).to.not.throw();
      expect(log.warn).to.have.been.calledWithMatch(/Failed to set brand scope/);
    });

    it('uses empty logPrefix when not provided', () => {
      mockOpportunity.setScopeType.throws(new Error('oops'));

      expect(() => applyScopeToOpportunity(mockOpportunity, { brandId: 'b' }, log)).to.not.throw();
      expect(log.warn).to.have.been.calledWithMatch(/Failed to set brand scope/);
    });
  });
});
