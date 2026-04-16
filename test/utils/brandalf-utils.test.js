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
      '@adobe/spacecat-shared-utils': {
        tracingFetch: mockFetch,
      },
    });

    isBrandalfEnabled = mod.isBrandalfEnabled;
    resolveOrganizationIdForSite = mod.resolveOrganizationIdForSite;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isBrandalfEnabled', () => {
    it('returns true when the brandalf flag is enabled', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [{ flagName: 'brandalf', flagValue: true }],
      });

      const result = await isBrandalfEnabled('org-123', {
        SPACECAT_API_BASE_URL: 'https://spacecat.example.com',
        SPACECAT_API_KEY: 'test-key',
      }, log);

      expect(result).to.equal(true);
      expect(mockFetch).to.have.been.calledWith(
        'https://spacecat.example.com/organizations/org-123/feature-flags?product=LLMO',
        sinon.match.hasNested('headers.x-api-key', 'test-key'),
      );
    });

    it('returns false without calling the API when organizationId is missing', async () => {
      const result = await isBrandalfEnabled(null, {
        SPACECAT_API_BASE_URL: 'https://spacecat.example.com',
        SPACECAT_API_KEY: 'test-key',
      }, log);

      expect(result).to.equal(false);
      expect(mockFetch).to.not.have.been.called;
      expect(log.warn).to.not.have.been.called;
    });

    it('returns false when API env is missing', async () => {
      const result = await isBrandalfEnabled('org-123', {}, log);

      expect(result).to.equal(false);
      expect(mockFetch).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(/cannot check brandalf flag/);
    });

    it('returns false when env is omitted entirely', async () => {
      const result = await isBrandalfEnabled('org-123', undefined, log);

      expect(result).to.equal(false);
      expect(mockFetch).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(/cannot check brandalf flag/);
    });

    it('encodes the org ID and returns false when brandalf is not enabled', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [
          { flagName: 'brandalf', flagValue: false },
          { flagName: 'different-flag', flagValue: true },
        ],
      });

      const result = await isBrandalfEnabled('org/with spaces', {
        SPACECAT_API_BASE_URL: 'https://spacecat.example.com',
        SPACECAT_API_KEY: 'test-key',
      }, log);

      expect(result).to.equal(false);
      expect(mockFetch).to.have.been.calledWith(
        'https://spacecat.example.com/organizations/org%2Fwith%20spaces/feature-flags?product=LLMO',
        sinon.match.hasNested('headers.x-api-key', 'test-key'),
      );
    });

    it('returns false when the feature-flags endpoint responds with a non-ok status', async () => {
      mockFetch.resolves({
        ok: false,
        status: 503,
      });

      const result = await isBrandalfEnabled('org-123', {
        SPACECAT_API_BASE_URL: 'https://spacecat.example.com',
        SPACECAT_API_KEY: 'test-key',
      }, log);

      expect(result).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(
        /Failed to fetch feature flags for org org-123: 503/,
      );
    });

    it('returns false when the API payload is not an array', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => ({ flagName: 'brandalf', flagValue: true }),
      });

      const result = await isBrandalfEnabled('org-123', {
        SPACECAT_API_BASE_URL: 'https://spacecat.example.com',
        SPACECAT_API_KEY: 'test-key',
      }, log);

      expect(result).to.equal(false);
    });

    it('returns false and warns when the feature-flag request throws', async () => {
      mockFetch.rejects(new Error('network down'));

      const result = await isBrandalfEnabled('org-123', {
        SPACECAT_API_BASE_URL: 'https://spacecat.example.com',
        SPACECAT_API_KEY: 'test-key',
      }, log);

      expect(result).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(
        /Error checking brandalf flag for org org-123: network down/,
      );
    });
  });

  describe('resolveOrganizationIdForSite', () => {
    it('prefers organization ID from the provided site object', async () => {
      const site = {
        getOrganizationId: sandbox.stub().returns('org-from-site'),
      };

      const result = await resolveOrganizationIdForSite({
        site,
        siteId: 'site-123',
        dataAccess: {
          Site: {
            findById: sandbox.stub().rejects(new Error('should not be called')),
          },
        },
        fallbackOrganizationId: 'fallback-org',
        log,
      });

      expect(result).to.equal('org-from-site');
    });

    it('falls back to explicit organizationId when site has none', async () => {
      const result = await resolveOrganizationIdForSite({
        site: { getOrganizationId: sandbox.stub().returns(null) },
        fallbackOrganizationId: 'fallback-org',
        log,
      });

      expect(result).to.equal('fallback-org');
    });

    it('loads the site from dataAccess when only siteId is available', async () => {
      const result = await resolveOrganizationIdForSite({
        siteId: 'site-123',
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves({
              getOrganizationId: sandbox.stub().returns('org-from-lookup'),
            }),
          },
        },
        log,
      });

      expect(result).to.equal('org-from-lookup');
    });

    it('returns null when there is no siteId to look up', async () => {
      const findById = sandbox.stub();

      const result = await resolveOrganizationIdForSite({
        dataAccess: {
          Site: {
            findById,
          },
        },
        log,
      });

      expect(result).to.equal(null);
      expect(findById).to.not.have.been.called;
    });

    it('returns null when the Site lookup helper is unavailable', async () => {
      const result = await resolveOrganizationIdForSite({
        siteId: 'site-123',
        dataAccess: {
          Site: {},
        },
        log,
      });

      expect(result).to.equal(null);
    });

    it('returns null when the looked-up site has no organization ID', async () => {
      const result = await resolveOrganizationIdForSite({
        siteId: 'site-123',
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves({
              getOrganizationId: sandbox.stub().returns(null),
            }),
          },
        },
        log,
      });

      expect(result).to.equal(null);
    });

    it('returns null and warns when Site.findById throws', async () => {
      const result = await resolveOrganizationIdForSite({
        siteId: 'site-123',
        dataAccess: {
          Site: {
            findById: sandbox.stub().rejects(new Error('lookup failed')),
          },
        },
        log,
      });

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        /Failed to resolve organization for site site-123: lookup failed/,
      );
    });
  });
});
