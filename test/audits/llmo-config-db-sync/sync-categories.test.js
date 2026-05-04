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
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { buildCategoryRows, syncCategories } from '../../../src/llmo-config-db-sync/sync-categories.js';

use(chaiAsPromised);
use(sinonChai);

const ORG_ID = 'org-uuid-1';
const CAT_ID = '3c36acd9-528a-4f11-b50f-e43aad11e2db';

const S3_CONFIG = {
  categories: {
    [CAT_ID]: { name: 'Creative Cloud', origin: 'human', updatedBy: 'user@test.com' },
  },
};

describe('llmo-config-db-sync/sync-categories', () => {
  let log;

  beforeEach(() => {
    log = { info: sinon.stub(), error: sinon.stub() };
  });

  describe('buildCategoryRows', () => {
    it('maps config categories to DB rows', () => {
      const rows = buildCategoryRows(S3_CONFIG, ORG_ID);
      expect(rows).to.have.length(1);
      expect(rows[0]).to.deep.include({
        organization_id: ORG_ID,
        category_id: CAT_ID,
        name: 'Creative Cloud',
        origin: 'human',
        status: 'active',
        updated_by: 'user@test.com',
      });
    });

    it('defaults origin to human when missing', () => {
      const rows = buildCategoryRows({ categories: { [CAT_ID]: { name: 'X' } } }, ORG_ID);
      expect(rows[0].origin).to.equal('human');
    });

    it('returns empty array for empty config', () => {
      expect(buildCategoryRows({}, ORG_ID)).to.deep.equal([]);
    });
  });

  describe('syncCategories', () => {
    it('upserts new categories and updates categoryLookup', async () => {
      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: [{ id: 'cat-uuid', category_id: CAT_ID }], error: null }),
      };
      const client = { from: sinon.stub().returns(upsertChain) };
      const categoryLookup = new Map();

      const stats = await syncCategories(client, S3_CONFIG, ORG_ID, new Map(), categoryLookup, log);
      expect(stats.inserted).to.equal(1);
      expect(categoryLookup.get(CAT_ID)).to.equal('cat-uuid');
    });

    it('handles null data returned from upsert', async () => {
      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: null }),
      };
      const client = { from: sinon.stub().returns(upsertChain) };
      const categoryLookup = new Map();

      await syncCategories(client, S3_CONFIG, ORG_ID, new Map(), categoryLookup, log);
      expect(categoryLookup.size).to.equal(0);
    });

    it('skips upsert when no diff (unchanged)', async () => {
      const existing = new Map([[CAT_ID, { category_id: CAT_ID, name: 'Creative Cloud', origin: 'human', status: 'active' }]]);
      const client = { from: sinon.stub() };

      const stats = await syncCategories(client, S3_CONFIG, ORG_ID, existing, new Map(), log);
      expect(stats.unchanged).to.equal(1);
      expect(client.from).to.not.have.been.called;
    });

    it('skips DB writes in dry-run mode', async () => {
      const client = { from: sinon.stub() };
      await syncCategories(client, S3_CONFIG, ORG_ID, new Map(), new Map(), log, true);
      expect(client.from).to.not.have.been.called;
    });

    it('throws on upsert error', async () => {
      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: { message: 'DB error' } }),
      };
      const client = { from: sinon.stub().returns(upsertChain) };

      await expect(syncCategories(client, S3_CONFIG, ORG_ID, new Map(), new Map(), log))
        .to.be.rejectedWith('Failed to upsert categories: DB error');
    });
  });
});
