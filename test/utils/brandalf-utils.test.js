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

const DEFAULT_ENV = Object.freeze({
  SPACECAT_API_BASE_URL: 'https://spacecat.example.com',
  SPACECAT_API_KEY: 'test-key',
});

describe('brandalf-utils', () => {
  let sandbox;
  let mockFetch;
  let isBrandalfEnabled;
  let resolveOrganizationIdForSite;
  let log;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockFetch = sandbox.stub();
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    const mod = await esmock('../../src/utils/brandalf-utils.js', {
      '@adobe/spacecat-shared-utils': { tracingFetch: mockFetch },
    });

    isBrandalfEnabled = mod.isBrandalfEnabled;
    resolveOrganizationIdForSite = mod.resolveOrganizationIdForSite;
  });

  afterEach(() => {
    sandbox.restore();
  });

  function stubFeatureFlagsResponse(flags) {
    mockFetch.resolves({
      ok: true,
      json: async () => flags,
    });
  }

  describe('isBrandalfEnabled', () => {
    it('returns true when the brandalf flag is enabled', async () => {
      stubFeatureFlagsResponse([{ flagName: 'brandalf', flagValue: true }]);

      const result = await isBrandalfEnabled('org-123', DEFAULT_ENV, log);

      expect(result).to.equal(true);
      expect(mockFetch).to.have.been.calledWith(
        'https://spacecat.example.com/organizations/org-123/feature-flags?product=LLMO',
        sinon.match.hasNested('headers.x-api-key', 'test-key'),
      );
    });

    it('returns false without calling the API when organizationId is missing', async () => {
      const result = await isBrandalfEnabled(null, DEFAULT_ENV, log);

      expect(result).to.equal(false);
      expect(mockFetch).to.not.have.been.called;
      expect(log.warn).to.not.have.been.called;
    });

    it('returns null when API env is missing', async () => {
      const result = await isBrandalfEnabled('org-123', {}, log);

      expect(result).to.equal(null);
      expect(mockFetch).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(/cannot check brandalf flag/);
    });

    it('returns null when env is omitted entirely', async () => {
      const result = await isBrandalfEnabled('org-123', undefined, log);

      expect(result).to.equal(null);
      expect(mockFetch).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(/cannot check brandalf flag/);
    });

    it('encodes the org ID and returns false when brandalf is not enabled', async () => {
      stubFeatureFlagsResponse([
        { flagName: 'brandalf', flagValue: false },
        { flagName: 'different-flag', flagValue: true },
      ]);

      const result = await isBrandalfEnabled('org/with spaces', DEFAULT_ENV, log);

      expect(result).to.equal(false);
      expect(mockFetch).to.have.been.calledWith(
        'https://spacecat.example.com/organizations/org%2Fwith%20spaces/feature-flags?product=LLMO',
        sinon.match.hasNested('headers.x-api-key', 'test-key'),
      );
    });

    it('returns null when the feature-flags endpoint responds with a non-ok status', async () => {
      mockFetch.resolves({ ok: false, status: 503 });

      const result = await isBrandalfEnabled('org-123', DEFAULT_ENV, log);

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        /Failed to fetch feature flags for org org-123: 503/,
      );
    });

    it('returns null when the API payload is not an array', async () => {
      stubFeatureFlagsResponse({ flagName: 'brandalf', flagValue: true });

      expect(await isBrandalfEnabled('org-123', DEFAULT_ENV, log)).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(/Unexpected feature flags payload/);
    });

    it('returns null and warns when the feature-flag request throws', async () => {
      mockFetch.rejects(new Error('network down'));

      const result = await isBrandalfEnabled('org-123', DEFAULT_ENV, log);

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        /Error checking brandalf flag for org org-123: network down/,
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
