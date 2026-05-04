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
import { buildBrandAliasRows, syncBrandAliases } from '../../../src/llmo-config-db-sync/sync-brand-aliases.js';

use(chaiAsPromised);
use(sinonChai);

const BRAND_ID = 'brand-uuid-1';

// All from() calls return the same unified builder so call ordering doesn't matter
function makeClient({ fetchData = [], fetchError = null, upsertError = null, deleteError = null } = {}) {
  const inStub = sinon.stub().resolves({ error: deleteError });
  const deleteEqStub = sinon.stub().callsFake(() => ({ in: inStub }));
  const deleteStub = sinon.stub().callsFake(() => ({ eq: deleteEqStub }));
  const fetchEqStub = sinon.stub().resolves({ data: fetchData, error: fetchError });
  const selectStub = sinon.stub().callsFake(() => ({ eq: fetchEqStub }));
  const upsertStub = sinon.stub().resolves({ error: upsertError });

  const tableBuilder = { select: selectStub, delete: deleteStub, upsert: upsertStub };
  return { from: sinon.stub().returns(tableBuilder), inStub, deleteStub, upsertStub };
}

describe('llmo-config-db-sync/sync-brand-aliases', () => {
  let log;

  beforeEach(() => {
    log = { info: sinon.stub(), warn: sinon.stub() };
  });

  describe('buildBrandAliasRows', () => {
    it('flattens aliases array into rows', () => {
      const config = {
        brands: {
          aliases: [
            { aliases: ['Adobe', 'Adobe Inc'], region: 'us', updatedBy: 'user@test.com' },
            { aliases: ['ADBE'], region: ['us', 'de'] },
          ],
        },
      };
      const rows = buildBrandAliasRows(config, BRAND_ID);
      expect(rows).to.have.length(3);
      expect(rows[0]).to.deep.include({ brand_id: BRAND_ID, alias: 'Adobe', regions: ['US'] });
      expect(rows[1]).to.deep.include({ brand_id: BRAND_ID, alias: 'Adobe Inc', regions: ['US'] });
      expect(rows[2].regions).to.deep.include.members(['US', 'DE']);
    });

    it('handles missing region (empty regions array)', () => {
      const config = { brands: { aliases: [{ aliases: ['Adobe'] }] } };
      const rows = buildBrandAliasRows(config, BRAND_ID);
      expect(rows[0].regions).to.deep.equal([]);
    });

    it('returns empty array for empty aliases', () => {
      expect(buildBrandAliasRows({ brands: { aliases: [] } }, BRAND_ID)).to.deep.equal([]);
      expect(buildBrandAliasRows({}, BRAND_ID)).to.deep.equal([]);
    });

    it('handles entry with no aliases field', () => {
      const config = { brands: { aliases: [{ region: 'us' }] } };
      const rows = buildBrandAliasRows(config, BRAND_ID);
      expect(rows).to.deep.equal([]);
    });
  });

  describe('syncBrandAliases', () => {
    it('inserts new aliases', async () => {
      const config = { brands: { aliases: [{ aliases: ['Adobe'], region: 'us' }] } };
      const { from, upsertStub } = makeClient({ fetchData: [] });
      const stats = await syncBrandAliases({ from }, config, BRAND_ID, log);
      expect(stats.inserted).to.equal(1);
      expect(stats.deleted).to.equal(0);
      expect(upsertStub).to.have.been.called;
    });

    it('deletes removed aliases', async () => {
      const config = { brands: { aliases: [] } };
      const { from, inStub } = makeClient({ fetchData: [{ alias: 'OldAlias', regions: ['US'] }] });
      const stats = await syncBrandAliases({ from }, config, BRAND_ID, log);
      expect(stats.deleted).to.equal(1);
      expect(inStub).to.have.been.calledWith('alias', ['OldAlias']);
    });

    it('updates changed aliases (upserts with diff)', async () => {
      const config = { brands: { aliases: [{ aliases: ['Adobe'], region: 'de' }] } };
      const { from, upsertStub } = makeClient({ fetchData: [{ alias: 'Adobe', regions: ['US'] }] });
      const stats = await syncBrandAliases({ from }, config, BRAND_ID, log);
      expect(stats.updated).to.equal(1);
      expect(upsertStub).to.have.been.called;
    });

    it('skips DB writes when nothing changed', async () => {
      const config = { brands: { aliases: [{ aliases: ['Adobe'], region: 'us' }] } };
      const { from, upsertStub, deleteStub } = makeClient({ fetchData: [{ alias: 'Adobe', regions: ['US'] }] });
      const stats = await syncBrandAliases({ from }, config, BRAND_ID, log);
      expect(stats.unchanged).to.equal(1);
      expect(upsertStub).to.not.have.been.called;
      expect(deleteStub).to.not.have.been.called;
    });

    it('skips deletes and upserts in dry-run mode', async () => {
      const config = { brands: { aliases: [] } };
      const { from, inStub, upsertStub } = makeClient({ fetchData: [{ alias: 'OldAlias', regions: [] }] });
      await syncBrandAliases({ from }, config, BRAND_ID, log, true);
      expect(inStub).to.not.have.been.called;
      expect(upsertStub).to.not.have.been.called;
    });

    it('handles null existingData from fetch', async () => {
      const config = { brands: { aliases: [{ aliases: ['Adobe'], region: 'us' }] } };
      const { from, upsertStub } = makeClient({ fetchData: null });
      const stats = await syncBrandAliases({ from }, config, BRAND_ID, log);
      expect(stats.inserted).to.equal(1);
      expect(upsertStub).to.have.been.called;
    });

    it('throws on fetch error', async () => {
      const { from } = makeClient({ fetchError: { message: 'fetch fail' } });
      await expect(syncBrandAliases({ from }, {}, BRAND_ID, log))
        .to.be.rejectedWith('Failed to fetch brand_aliases: fetch fail');
    });

    it('throws on delete error', async () => {
      const config = { brands: { aliases: [] } };
      const { from } = makeClient({
        fetchData: [{ alias: 'OldAlias', regions: [] }],
        deleteError: { message: 'del fail' },
      });
      await expect(syncBrandAliases({ from }, config, BRAND_ID, log))
        .to.be.rejectedWith('Failed to delete brand_aliases: del fail');
    });

    it('throws on upsert error', async () => {
      const config = { brands: { aliases: [{ aliases: ['NewAlias'], region: 'us' }] } };
      const { from } = makeClient({ fetchData: [], upsertError: { message: 'ups fail' } });
      await expect(syncBrandAliases({ from }, config, BRAND_ID, log))
        .to.be.rejectedWith('Failed to upsert brand_aliases: ups fail');
    });
  });
});
