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

describe('utils/feature-flags', () => {
  let sandbox;
  let mockFetch;
  let log;
  let env;
  let featureFlags;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockFetch = sandbox.stub();
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
    env = {
      SPACECAT_API_BASE_URL: 'https://spacecat.example.com',
      SPACECAT_API_KEY: 'test-api-key',
    };
    featureFlags = await esmock('../../src/utils/feature-flags.js', {
      '@adobe/spacecat-shared-utils': { tracingFetch: mockFetch },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isBrandalfEnabled', () => {
    it('returns true when brandalf flag is enabled', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [{ flagName: 'brandalf', flagValue: true }],
      });

      const result = await featureFlags.isBrandalfEnabled('org-123', env, log);

      expect(result).to.equal(true);
      expect(mockFetch).to.have.been.calledWith(
        'https://spacecat.example.com/organizations/org-123/feature-flags?product=LLMO',
        sinon.match({ headers: { 'x-api-key': 'test-api-key' } }),
      );
    });

    it('returns false when only brandalf_migration is enabled', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [{ flagName: 'brandalf_migration', flagValue: true }],
      });

      const result = await featureFlags.isBrandalfEnabled('org-123', env, log);

      expect(result).to.equal(false);
    });

    it('returns false when brandalf flag is set to false', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [{ flagName: 'brandalf', flagValue: false }],
      });

      const result = await featureFlags.isBrandalfEnabled('org-123', env, log);

      expect(result).to.equal(false);
    });

    it('encodes the organization id in the URL', async () => {
      mockFetch.resolves({ ok: true, json: async () => [] });

      await featureFlags.isBrandalfEnabled('org/with spaces&chars', env, log);

      expect(mockFetch).to.have.been.calledWith(
        sinon.match((url) => url.includes('org%2Fwith%20spaces%26chars')),
      );
    });
  });

  describe('isBrandalfOrMigrationEnabled', () => {
    it('returns true when only brandalf is enabled', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [{ flagName: 'brandalf', flagValue: true }],
      });

      const result = await featureFlags.isBrandalfOrMigrationEnabled('org-1', env, log);

      expect(result).to.equal(true);
    });

    it('returns true when only brandalf_migration is enabled', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [{ flagName: 'brandalf_migration', flagValue: true }],
      });

      const result = await featureFlags.isBrandalfOrMigrationEnabled('org-1', env, log);

      expect(result).to.equal(true);
    });

    it('returns true when both flags are enabled', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [
          { flagName: 'brandalf', flagValue: true },
          { flagName: 'brandalf_migration', flagValue: true },
        ],
      });

      const result = await featureFlags.isBrandalfOrMigrationEnabled('org-1', env, log);

      expect(result).to.equal(true);
    });

    it('returns false when neither flag is enabled', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [
          { flagName: 'other_flag', flagValue: true },
        ],
      });

      const result = await featureFlags.isBrandalfOrMigrationEnabled('org-1', env, log);

      expect(result).to.equal(false);
    });

    it('returns false when API base URL is not configured', async () => {
      const result = await featureFlags.isBrandalfOrMigrationEnabled(
        'org-1',
        { SPACECAT_API_KEY: 'test-key' },
        log,
      );

      expect(result).to.equal(false);
      expect(mockFetch).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured/),
      );
    });

    it('returns false when API key is not configured', async () => {
      const result = await featureFlags.isBrandalfOrMigrationEnabled(
        'org-1',
        { SPACECAT_API_BASE_URL: 'https://spacecat.example.com' },
        log,
      );

      expect(result).to.equal(false);
      expect(mockFetch).to.not.have.been.called;
    });

    it('returns false and warns when API responds with non-ok status', async () => {
      mockFetch.resolves({ ok: false, status: 503 });

      const result = await featureFlags.isBrandalfOrMigrationEnabled('org-1', env, log);

      expect(result).to.equal(false);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to fetch LLMO feature flags for org org-1: 503/),
      );
    });

    it('returns false and warns when fetch throws', async () => {
      mockFetch.rejects(new Error('ECONNREFUSED'));

      const result = await featureFlags.isBrandalfOrMigrationEnabled('org-1', env, log);

      expect(result).to.equal(false);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Error checking LLMO feature flags for org org-1: ECONNREFUSED/),
      );
    });

    it('returns false when API responds with malformed (non-array) body', async () => {
      mockFetch.resolves({ ok: true, json: async () => ({ unexpected: 'shape' }) });

      const result = await featureFlags.isBrandalfOrMigrationEnabled('org-1', env, log);

      expect(result).to.equal(false);
    });

    it('ignores entries with non-string flagName or non-true value', async () => {
      mockFetch.resolves({
        ok: true,
        json: async () => [
          null,
          undefined,
          { flagName: 42, flagValue: true },
          { flagName: 'brandalf', flagValue: 'true' },
          { flagName: 'brandalf_migration', flagValue: true },
        ],
      });

      const result = await featureFlags.isBrandalfOrMigrationEnabled('org-1', env, log);

      expect(result).to.equal(true);
    });
  });
});
