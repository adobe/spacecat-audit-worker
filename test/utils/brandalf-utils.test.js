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

describe('brandalf-utils', () => {
  let sandbox;
  let isBrandalfEnabled;
  let resolveOrganizationIdForSite;
  let log;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    const mod = await esmock('../../src/utils/brandalf-utils.js', {});

    isBrandalfEnabled = mod.isBrandalfEnabled;
    resolveOrganizationIdForSite = mod.resolveOrganizationIdForSite;
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Builds a chainable PostgREST client stub whose terminal `maybeSingle()`
   * resolves to `{ data, error }`.
   */
  function stubPostgrestClient({ data = null, error = null } = {}) {
    const query = {
      select: sandbox.stub().returnsThis(),
      eq: sandbox.stub().returnsThis(),
      maybeSingle: sandbox.stub().resolves({ data, error }),
    };
    const from = sandbox.stub().returns(query);
    return { client: { from }, query, from };
  }

  describe('isBrandalfEnabled', () => {
    it('returns true when the brandalf flag is enabled', async () => {
      const { client, from, query } = stubPostgrestClient({ data: { flag_value: true } });

      const result = await isBrandalfEnabled('org-123', client, log);

      expect(result).to.equal(true);
      expect(from).to.have.been.calledWith('feature_flags');
      expect(query.select).to.have.been.calledWith('flag_value');
      expect(query.eq).to.have.been.calledWith('organization_id', 'org-123');
      expect(query.eq).to.have.been.calledWith('product', 'LLMO');
      expect(query.eq).to.have.been.calledWith('flag_name', 'brandalf');
    });

    it('returns false without querying when organizationId is missing', async () => {
      const { client, from } = stubPostgrestClient({ data: { flag_value: true } });

      const result = await isBrandalfEnabled(null, client, log);

      expect(result).to.equal(false);
      expect(from).to.not.have.been.called;
      expect(log.warn).to.not.have.been.called;
    });

    it('returns null when the PostgREST client is missing', async () => {
      const result = await isBrandalfEnabled('org-123', undefined, log);

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(/cannot check brandalf flag/);
    });

    it('returns null when the PostgREST client has no query builder', async () => {
      const result = await isBrandalfEnabled('org-123', {}, log);

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(/cannot check brandalf flag/);
    });

    it('returns false when no flag row exists', async () => {
      const { client } = stubPostgrestClient({ data: null });

      const result = await isBrandalfEnabled('org-123', client, log);

      expect(result).to.equal(false);
    });

    it('returns false when the flag row is explicitly disabled', async () => {
      const { client } = stubPostgrestClient({ data: { flag_value: false } });

      const result = await isBrandalfEnabled('org-123', client, log);

      expect(result).to.equal(false);
    });

    it('returns null and warns when the query returns an error', async () => {
      const { client } = stubPostgrestClient({ error: { message: 'db unavailable' } });

      const result = await isBrandalfEnabled('org-123', client, log);

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        /Failed to read brandalf flag for org org-123: db unavailable/,
      );
    });

    it('returns null and warns when the query throws', async () => {
      const query = {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        maybeSingle: sandbox.stub().rejects(new Error('connection reset')),
      };
      const client = { from: sandbox.stub().returns(query) };

      const result = await isBrandalfEnabled('org-123', client, log);

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        /Error checking brandalf flag for org org-123: connection reset/,
      );
    });
  });

  describe('resolveOrganizationIdForSite', () => {
    function resolve(overrides = {}) {
      return resolveOrganizationIdForSite({ log, ...overrides });
    }

    function siteWithOrg(orgId) {
      return { getOrganizationId: sandbox.stub().returns(orgId) };
    }

    function dataAccessWithFindById(findByIdStub) {
      return { Site: { findById: findByIdStub } };
    }

    it('prefers organization ID from the provided site object', async () => {
      const result = await resolve({
        site: siteWithOrg('org-from-site'),
        siteId: 'site-123',
        dataAccess: dataAccessWithFindById(sandbox.stub().rejects(new Error('should not be called'))),
        fallbackOrganizationId: 'fallback-org',
      });

      expect(result).to.equal('org-from-site');
    });

    it('falls back to explicit organizationId when site has none', async () => {
      const result = await resolve({
        site: siteWithOrg(null),
        fallbackOrganizationId: 'fallback-org',
      });

      expect(result).to.equal('fallback-org');
    });

    it('loads the site from dataAccess when only siteId is available', async () => {
      const result = await resolve({
        siteId: 'site-123',
        dataAccess: dataAccessWithFindById(
          sandbox.stub().resolves(siteWithOrg('org-from-lookup')),
        ),
      });

      expect(result).to.equal('org-from-lookup');
    });

    it('returns null when there is no siteId to look up', async () => {
      const findById = sandbox.stub();
      const result = await resolve({ dataAccess: dataAccessWithFindById(findById) });

      expect(result).to.equal(null);
      expect(findById).to.not.have.been.called;
    });

    it('returns null when the Site lookup helper is unavailable', async () => {
      const result = await resolve({
        siteId: 'site-123',
        dataAccess: { Site: {} },
      });

      expect(result).to.equal(null);
    });

    it('returns null when the looked-up site has no organization ID', async () => {
      const result = await resolve({
        siteId: 'site-123',
        dataAccess: dataAccessWithFindById(sandbox.stub().resolves(siteWithOrg(null))),
      });

      expect(result).to.equal(null);
    });

    it('returns null and warns when Site.findById throws', async () => {
      const result = await resolve({
        siteId: 'site-123',
        dataAccess: dataAccessWithFindById(sandbox.stub().rejects(new Error('lookup failed'))),
      });

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        /Failed to resolve organization for site site-123: lookup failed/,
      );
    });
  });
});
