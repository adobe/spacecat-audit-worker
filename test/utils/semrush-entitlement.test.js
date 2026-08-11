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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

const ORG_ID = 'e07a0aae-b794-41f6-9622-a602203c5a3e';
const BRAND_ID = 'cb84e91a-f7e9-488b-8220-e0d031941cd7';

describe('semrush-entitlement', () => {
  let sandbox;
  let log;
  let resolveSemrushEntitlement;
  let SEMRUSH_ENTITLEMENT_TIMEOUT_MS;
  let SEMRUSH_NOT_ENTITLED_REASON;
  let SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON;
  let SEMRUSH_ENTITLEMENT_SKIP_REASONS;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };

    const mod = await esmock('../../src/utils/semrush-entitlement.js', {});
    resolveSemrushEntitlement = mod.resolveSemrushEntitlement;
    ({
      SEMRUSH_ENTITLEMENT_TIMEOUT_MS,
      SEMRUSH_NOT_ENTITLED_REASON,
      SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON,
      SEMRUSH_ENTITLEMENT_SKIP_REASONS,
    } = mod);
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Builds a `feature_flags` PostgREST client stub — the only table
   * `resolveSemrushEntitlement` still queries directly (no shared-package helper
   * exists for reading a flag; the workspace half goes through the Organization/Brand
   * models instead — see `makeDataAccess`). The query builder is awaited directly
   * (no terminal method), matching the real wildcard-select query in
   * `isSerenityEnabledForOrg` / `isBrandalfEnabled` — `data` is an array of rows, not
   * a single object, since more than one row (an org row plus a brand-scoped
   * override) can match the same organization_id/product/flag_name.
   */
  function makeFlagClient({
    data = null, error = null, pending = false, rejectsWith = null,
  } = {}) {
    const flagQuery = {
      select: sandbox.stub().returnsThis(),
      eq: sandbox.stub().returnsThis(),
      then: pending
        ? () => { /* never settles */ }
        : (resolve, reject) => (rejectsWith ? reject(rejectsWith) : resolve({ data, error })),
    };
    const from = sandbox.stub().callsFake((table) => {
      if (table === 'feature_flags') {
        return flagQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });
    return { client: { from }, from, flagQuery };
  }

  /**
   * Builds `dataAccess.Organization`/`dataAccess.Brand` stubs whose `findById`
   * resolves to an entity exposing the Semrush workspace getters, or `null` (no
   * row), or is overridden entirely (e.g. to reject, or to hang for the timeout
   * test).
   */
  function makeDataAccess({
    orgWorkspaceId, brandSubWorkspaceId, orgFindById, brandFindById,
  } = {}) {
    const org = orgWorkspaceId === undefined
      ? null
      : { getSemrushWorkspaceId: sandbox.stub().returns(orgWorkspaceId) };
    const brand = brandSubWorkspaceId === undefined
      ? null
      : { getSemrushSubWorkspaceId: sandbox.stub().returns(brandSubWorkspaceId) };

    return {
      Organization: { findById: orgFindById || sandbox.stub().resolves(org) },
      Brand: { findById: brandFindById || sandbox.stub().resolves(brand) },
    };
  }

  function contextWith(postgrestClient, dataAccessOverrides = {}) {
    return {
      log,
      dataAccess: { services: { postgrestClient }, ...dataAccessOverrides },
    };
  }

  const run = (
    { flag, dataAccessOverrides } = {},
    orgId = ORG_ID,
    brandId = BRAND_ID,
  ) => {
    const { client } = makeFlagClient(flag);
    return resolveSemrushEntitlement(
      contextWith(client, dataAccessOverrides ?? makeDataAccess()),
      { orgId, brandId },
    );
  };

  // --- entitled (flag on + workspace resolvable) -----------------------------

  it('is entitled via a brand sub-workspace when the flag is on', async () => {
    const { client, from } = makeFlagClient({ data: [{ flag_value: true, brand_id: null }] });
    const dataAccessOverrides = makeDataAccess({ brandSubWorkspaceId: 'sub-ws-1' });

    const result = await resolveSemrushEntitlement(
      contextWith(client, dataAccessOverrides),
      { orgId: ORG_ID, brandId: BRAND_ID },
    );

    expect(result).to.deep.equal({
      entitled: true, resolved: true, reason: 'entitled', mode: 'subworkspace',
    });
    expect(from).to.have.been.calledWith('feature_flags');
    expect(dataAccessOverrides.Organization.findById).to.have.been.calledWith(ORG_ID);
    expect(dataAccessOverrides.Brand.findById).to.have.been.calledWith(BRAND_ID);
  });

  it('is entitled via the org flat workspace when the brand has no sub-workspace', async () => {
    const result = await run({
      flag: { data: [{ flag_value: true, brand_id: null }] },
      dataAccessOverrides: makeDataAccess({
        orgWorkspaceId: 'org-ws-1', brandSubWorkspaceId: null,
      }),
    });

    expect(result).to.deep.equal({
      entitled: true, resolved: true, reason: 'entitled', mode: 'flat',
    });
  });

  // --- confirmed not entitled --------------------------------------------------

  it('is not entitled (no-workspace) when the flag is on but no workspace resolves', async () => {
    const result = await run({
      flag: { data: [{ flag_value: true, brand_id: null }] },
      dataAccessOverrides: makeDataAccess({ orgWorkspaceId: null, brandSubWorkspaceId: null }),
    });

    expect(result).to.deep.equal({ entitled: false, resolved: true, reason: 'no-workspace' });
  });

  it('is not entitled (no-workspace) when Organization/Brand rows do not exist at all', async () => {
    const result = await run({
      flag: { data: [{ flag_value: true, brand_id: null }] },
      dataAccessOverrides: makeDataAccess(),
    });

    expect(result).to.deep.equal({ entitled: false, resolved: true, reason: 'no-workspace' });
  });

  it('is not entitled (flag-disabled) even when a workspace exists — flag wins', async () => {
    const result = await run({
      flag: { data: [{ flag_value: false, brand_id: null }] },
      dataAccessOverrides: makeDataAccess({
        orgWorkspaceId: 'org-ws-1', brandSubWorkspaceId: 'sub-ws-1',
      }),
    });

    expect(result).to.deep.equal({ entitled: false, resolved: true, reason: 'flag-disabled' });
  });

  it('is not entitled (flag-disabled) when no flag row exists at all', async () => {
    const result = await run({
      flag: { data: null },
      dataAccessOverrides: makeDataAccess({ brandSubWorkspaceId: 'sub-ws-1' }),
    });

    expect(result).to.deep.equal({ entitled: false, resolved: true, reason: 'flag-disabled' });
  });

  // --- missing input / missing client ----------------------------------------

  it('returns missing-input without querying when orgId is absent', async () => {
    const { client, from } = makeFlagClient({ data: [{ flag_value: true, brand_id: null }] });
    const dataAccessOverrides = makeDataAccess();

    const result = await resolveSemrushEntitlement(
      contextWith(client, dataAccessOverrides),
      { orgId: null, brandId: BRAND_ID },
    );

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'missing-input' });
    expect(from).to.not.have.been.called;
    expect(dataAccessOverrides.Organization.findById).to.not.have.been.called;
  });

  it('returns missing-input without querying when brandId is absent', async () => {
    const { client, from } = makeFlagClient({ data: [{ flag_value: true, brand_id: null }] });

    const result = await resolveSemrushEntitlement(
      contextWith(client, makeDataAccess()),
      { orgId: ORG_ID, brandId: null },
    );

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'missing-input' });
    expect(from).to.not.have.been.called;
  });

  it('returns missing-input when called without a context or params', async () => {
    const result = await resolveSemrushEntitlement();

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'missing-input' });
  });

  it('returns no-client and warns when the PostgREST client is missing', async () => {
    const result = await resolveSemrushEntitlement(
      { log, dataAccess: makeDataAccess() },
      { orgId: ORG_ID, brandId: BRAND_ID },
    );

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'no-client' });
    expect(log.warn).to.have.been.calledWithMatch(/PostgREST client or Organization\/Brand data-access not available/);
  });

  it('returns no-client when the client has no query builder', async () => {
    const result = await resolveSemrushEntitlement(
      { log, dataAccess: { services: { postgrestClient: {} }, ...makeDataAccess() } },
      { orgId: ORG_ID, brandId: BRAND_ID },
    );

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'no-client' });
  });

  it('returns no-client when the Organization/Brand collections are unavailable', async () => {
    const { client } = makeFlagClient({ data: [{ flag_value: true, brand_id: null }] });

    const result = await resolveSemrushEntitlement(
      { log, dataAccess: { services: { postgrestClient: client } } },
      { orgId: ORG_ID, brandId: BRAND_ID },
    );

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'no-client' });
  });

  // --- transient failures (resolved:false, fail closed) -----------------------

  it('fails closed (check-failed) when the flag query returns an error', async () => {
    const result = await run({
      flag: { error: { message: 'db unavailable' } },
      dataAccessOverrides: makeDataAccess({ brandSubWorkspaceId: 'sub-ws-1' }),
    });

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'check-failed' });
  });

  it('fails closed (check-failed) and warns when the flag query throws', async () => {
    const { client } = makeFlagClient({ rejectsWith: new Error('connection reset') });

    const result = await resolveSemrushEntitlement(
      contextWith(client, makeDataAccess({ brandSubWorkspaceId: 'sub-ws-1' })),
      { orgId: ORG_ID, brandId: BRAND_ID },
    );

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'check-failed' });
    expect(log.warn).to.have.been.calledWithMatch(/Error checking serenity flag/);
  });

  it("resolves the organization's own row, ignoring a brand-scoped override, when two rows match", async () => {
    const result = await run({
      flag: {
        data: [
          { flag_value: false, brand_id: 'some-other-brand' },
          { flag_value: true, brand_id: null },
        ],
      },
      dataAccessOverrides: makeDataAccess({ brandSubWorkspaceId: 'sub-ws-1' }),
    });

    expect(result).to.deep.equal({
      entitled: true, resolved: true, reason: 'entitled', mode: 'subworkspace',
    });
  });

  it('is not entitled (flag-disabled) when only a brand-scoped override row matches, no org row', async () => {
    const result = await run({
      flag: { data: [{ flag_value: true, brand_id: 'some-other-brand' }] },
      dataAccessOverrides: makeDataAccess({ brandSubWorkspaceId: 'sub-ws-1' }),
    });

    expect(result).to.deep.equal({ entitled: false, resolved: true, reason: 'flag-disabled' });
  });

  it('fails closed (check-failed) and warns when Brand.findById throws', async () => {
    const result = await run({
      flag: { data: [{ flag_value: true, brand_id: null }] },
      dataAccessOverrides: makeDataAccess({
        orgWorkspaceId: null,
        brandFindById: sandbox.stub().rejects(new Error('brand lookup failed')),
      }),
    });

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'check-failed' });
    expect(log.warn).to.have.been.calledWithMatch(/Semrush entitlement check failed/);
  });

  it('fails closed (check-failed) when Organization.findById throws', async () => {
    const result = await run({
      flag: { data: [{ flag_value: true, brand_id: null }] },
      dataAccessOverrides: makeDataAccess({
        brandSubWorkspaceId: null,
        orgFindById: sandbox.stub().rejects(new Error('org lookup failed')),
      }),
    });

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'check-failed' });
  });

  it('fails closed (check-failed) and warns on a timeout', async () => {
    const clock = sandbox.useFakeTimers();
    const { client } = makeFlagClient({ pending: true });
    const neverSettles = () => new Promise(() => {});

    const resultP = resolveSemrushEntitlement(
      contextWith(client, makeDataAccess({
        orgFindById: sandbox.stub().callsFake(neverSettles),
        brandFindById: sandbox.stub().callsFake(neverSettles),
      })),
      { orgId: ORG_ID, brandId: BRAND_ID },
    );
    await clock.tickAsync(SEMRUSH_ENTITLEMENT_TIMEOUT_MS + 1);
    const result = await resultP;

    expect(result).to.deep.equal({ entitled: false, resolved: false, reason: 'check-failed' });
    expect(log.warn).to.have.been.calledWithMatch(/Semrush entitlement check failed.*timed out/);
  });

  // --- shared reason-string constants (single source of truth for the loader and
  // the handler's hard-stop-exemption check) ---------------------------------

  describe('exported reason-string constants', () => {
    it('exposes the two skip-reason literals the loader sets on diagnostics.fallbackReason', () => {
      expect(SEMRUSH_NOT_ENTITLED_REASON).to.equal('not-entitled');
      expect(SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON).to.equal('entitlement-check-failed');
    });

    it('bundles both reasons into SEMRUSH_ENTITLEMENT_SKIP_REASONS, and nothing else', () => {
      expect(SEMRUSH_ENTITLEMENT_SKIP_REASONS).to.be.instanceOf(Set);
      expect(SEMRUSH_ENTITLEMENT_SKIP_REASONS.has(SEMRUSH_NOT_ENTITLED_REASON)).to.equal(true);
      expect(SEMRUSH_ENTITLEMENT_SKIP_REASONS.has(SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON))
        .to.equal(true);
      expect(SEMRUSH_ENTITLEMENT_SKIP_REASONS.size).to.equal(2);
      expect(SEMRUSH_ENTITLEMENT_SKIP_REASONS.has('semrush-failed')).to.equal(false);
      expect(SEMRUSH_ENTITLEMENT_SKIP_REASONS.has('ims-token-failed')).to.equal(false);
    });

    it('is frozen (cannot be mutated by a caller)', () => {
      expect(Object.isFrozen(SEMRUSH_ENTITLEMENT_SKIP_REASONS)).to.equal(true);
    });
  });
});
