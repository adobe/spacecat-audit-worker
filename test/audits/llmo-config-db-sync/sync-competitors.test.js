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
import { buildCompetitorRows, syncCompetitors } from '../../../src/llmo-config-db-sync/sync-competitors.js';

use(chaiAsPromised);
use(sinonChai);

const BRAND_ID = 'brand-uuid-1';
const CAT_ID = 'f45efb75-eb06-4d99-9d1b-33ae52e783b5';

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

const sampleCompetitor = {
  category: CAT_ID,
  region: 'us',
  name: 'Affinity Photo',
  aliases: ['Affinity Photo'],
  urls: ['https://www.affinity.studio/'],
  updatedBy: 'user@test.com',
};

describe('llmo-config-db-sync/sync-competitors', () => {
  let log;

  beforeEach(() => {
    log = { info: sinon.stub(), warn: sinon.stub() };
  });

  describe('buildCompetitorRows', () => {
    it('maps config competitors to DB rows', () => {
      const config = { competitors: { competitors: [sampleCompetitor] } };
      const rows = buildCompetitorRows(config, BRAND_ID, log);
      expect(rows).to.have.length(1);
      expect(rows[0]).to.deep.include({
        brand_id: BRAND_ID,
        name: 'Affinity Photo',
        aliases: ['Affinity Photo'],
        regions: ['US'],
        url: 'https://www.affinity.studio/',
      });
    });

    it('logs warning for competitors with multiple URLs', () => {
      const config = {
        competitors: {
          competitors: [{ ...sampleCompetitor, urls: ['https://a.com', 'https://b.com'] }],
        },
      };
      buildCompetitorRows(config, BRAND_ID, log);
      expect(log.warn).to.have.been.calledWithMatch(/only the first will be persisted/);
    });

    it('handles array regions', () => {
      const config = {
        competitors: { competitors: [{ ...sampleCompetitor, region: ['us', 'de'] }] },
      };
      const rows = buildCompetitorRows(config, BRAND_ID, log);
      expect(rows[0].regions).to.deep.equal(['US', 'DE']);
    });

    it('handles missing urls and aliases', () => {
      const config = {
        competitors: { competitors: [{ ...sampleCompetitor, urls: undefined, aliases: undefined }] },
      };
      const rows = buildCompetitorRows(config, BRAND_ID, log);
      expect(rows[0].url).to.be.null;
      expect(rows[0].aliases).to.deep.equal([]);
    });

    it('defaults created_by and updated_by to null when updatedBy not set', () => {
      const { updatedBy, ...noUpdatedBy } = sampleCompetitor;
      const config = { competitors: { competitors: [noUpdatedBy] } };
      const rows = buildCompetitorRows(config, BRAND_ID, log);
      expect(rows[0].created_by).to.be.null;
      expect(rows[0].updated_by).to.be.null;
    });

    it('returns empty array for empty config', () => {
      expect(buildCompetitorRows({}, BRAND_ID, log)).to.deep.equal([]);
      expect(buildCompetitorRows({ competitors: { competitors: [] } }, BRAND_ID, log)).to.deep.equal([]);
    });
  });

  describe('syncCompetitors', () => {
    const config = { competitors: { competitors: [sampleCompetitor] } };

    it('inserts new competitors', async () => {
      const { from, upsertStub } = makeClient({ fetchData: [] });
      const stats = await syncCompetitors({ from }, config, BRAND_ID, log);
      expect(stats.inserted).to.equal(1);
      expect(stats.deleted).to.equal(0);
      expect(upsertStub).to.have.been.called;
    });

    it('deletes removed competitors', async () => {
      const { from, inStub } = makeClient({
        fetchData: [{ name: 'OldCompetitor', aliases: [], regions: [], url: null }],
      });
      await syncCompetitors({ from }, { competitors: { competitors: [] } }, BRAND_ID, log);
      expect(inStub).to.have.been.calledWith('name', ['OldCompetitor']);
    });

    it('updates changed competitors', async () => {
      const { from, upsertStub } = makeClient({
        fetchData: [{ name: 'Affinity Photo', aliases: [], regions: ['US'], url: 'https://old.com' }],
      });
      const stats = await syncCompetitors({ from }, config, BRAND_ID, log);
      expect(stats.updated).to.equal(1);
      expect(upsertStub).to.have.been.called;
    });

    it('skips DB writes when nothing changed', async () => {
      const { from, upsertStub, deleteStub } = makeClient({
        fetchData: [{
          name: 'Affinity Photo',
          aliases: ['Affinity Photo'],
          regions: ['US'],
          url: 'https://www.affinity.studio/',
        }],
      });
      const stats = await syncCompetitors({ from }, config, BRAND_ID, log);
      expect(stats.unchanged).to.equal(1);
      expect(upsertStub).to.not.have.been.called;
      expect(deleteStub).to.not.have.been.called;
    });

    it('skips deletes and upserts in dry-run mode', async () => {
      const { from, inStub, upsertStub } = makeClient({
        fetchData: [{ name: 'OldComp', aliases: [], regions: [], url: null }],
      });
      await syncCompetitors({ from }, { competitors: { competitors: [] } }, BRAND_ID, log, true);
      expect(inStub).to.not.have.been.called;
      expect(upsertStub).to.not.have.been.called;
    });

    it('handles null existingData from fetch', async () => {
      const { from, upsertStub } = makeClient({ fetchData: null });
      const stats = await syncCompetitors({ from }, config, BRAND_ID, log);
      expect(stats.inserted).to.equal(1);
      expect(upsertStub).to.have.been.called;
    });

    it('throws on fetch error', async () => {
      const { from } = makeClient({ fetchError: { message: 'fetch fail' } });
      await expect(syncCompetitors({ from }, config, BRAND_ID, log))
        .to.be.rejectedWith('Failed to fetch competitors: fetch fail');
    });

    it('throws on delete error', async () => {
      const { from } = makeClient({
        fetchData: [{ name: 'OldComp', aliases: [], regions: [], url: null }],
        deleteError: { message: 'del fail' },
      });
      await expect(syncCompetitors({ from }, { competitors: { competitors: [] } }, BRAND_ID, log))
        .to.be.rejectedWith('Failed to delete competitors: del fail');
    });

    it('throws on upsert error', async () => {
      const { from } = makeClient({ fetchData: [], upsertError: { message: 'ups fail' } });
      await expect(syncCompetitors({ from }, config, BRAND_ID, log))
        .to.be.rejectedWith('Failed to upsert competitors: ups fail');
    });
  });
});
