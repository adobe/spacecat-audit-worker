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
import { isOrgRow, readOrgFeatureFlag } from '../../src/utils/feature-flags-utils.js';

use(sinonChai);

describe('feature-flags-utils', () => {
  const sandbox = sinon.createSandbox();
  let log;

  beforeEach(() => {
    log = { warn: sandbox.stub() };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isOrgRow', () => {
    it('is true for a row with brand_id explicitly null', () => {
      expect(isOrgRow({ brand_id: null })).to.equal(true);
    });

    it('is true for a pre-migration row with no brand_id at all', () => {
      expect(isOrgRow({})).to.equal(true);
    });

    it('is false for a row carrying a brand-scoped override', () => {
      expect(isOrgRow({ brand_id: 'brand-a' })).to.equal(false);
    });
  });

  describe('readOrgFeatureFlag', () => {
    function stubPostgrestClient({ data = null, error = null, rejectsWith = null } = {}) {
      const query = {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        then: (resolve, reject) => (
          rejectsWith ? reject(rejectsWith) : resolve({ data, error })
        ),
      };
      const from = sandbox.stub().returns(query);
      return { client: { from }, query, from };
    }

    it('returns false without querying when organizationId is missing', async () => {
      const { client, from } = stubPostgrestClient({ data: [{ flag_value: true }] });

      const result = await readOrgFeatureFlag(client, {
        product: 'LLMO', flagName: 'serenity', log,
      });

      expect(result).to.equal(false);
      expect(from).to.not.have.been.called;
    });

    it('returns null and warns when the PostgREST client is missing', async () => {
      const result = await readOrgFeatureFlag(undefined, {
        organizationId: 'org-123', product: 'LLMO', flagName: 'serenity', log,
      });

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(/cannot check serenity flag/);
    });

    it('queries by organization_id/product/flag_name with a wildcard projection', async () => {
      const { client, from, query } = stubPostgrestClient({
        data: [{ flag_value: true, brand_id: null }],
      });

      const result = await readOrgFeatureFlag(client, {
        organizationId: 'org-123', product: 'LLMO', flagName: 'serenity', log,
      });

      expect(result).to.equal(true);
      expect(from).to.have.been.calledWith('feature_flags');
      expect(query.select).to.have.been.calledWith('*');
      expect(query.eq).to.have.been.calledWith('organization_id', 'org-123');
      expect(query.eq).to.have.been.calledWith('product', 'LLMO');
      expect(query.eq).to.have.been.calledWith('flag_name', 'serenity');
    });

    it('resolves the organization row and ignores a brand-scoped override', async () => {
      const { client } = stubPostgrestClient({
        data: [
          { flag_value: true, brand_id: 'brand-a' },
          { flag_value: false, brand_id: null },
        ],
      });

      const result = await readOrgFeatureFlag(client, {
        organizationId: 'org-123', product: 'LLMO', flagName: 'serenity', log,
      });

      expect(result).to.equal(false);
    });

    it('returns false when no row matches', async () => {
      const { client } = stubPostgrestClient({ data: [] });

      const result = await readOrgFeatureFlag(client, {
        organizationId: 'org-123', product: 'LLMO', flagName: 'serenity', log,
      });

      expect(result).to.equal(false);
    });

    it('returns null and warns when the query returns an error', async () => {
      const { client } = stubPostgrestClient({ error: { message: 'db unavailable' } });

      const result = await readOrgFeatureFlag(client, {
        organizationId: 'org-123', product: 'LLMO', flagName: 'serenity', log,
      });

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        /Failed to read serenity flag for org org-123: db unavailable/,
      );
    });

    it('returns null and warns when the query throws', async () => {
      const { client } = stubPostgrestClient({ rejectsWith: new Error('connection reset') });

      const result = await readOrgFeatureFlag(client, {
        organizationId: 'org-123', product: 'LLMO', flagName: 'serenity', log,
      });

      expect(result).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        /Error checking serenity flag for org org-123: connection reset/,
      );
    });
  });
});
