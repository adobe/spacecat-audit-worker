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
import {
  buildTopicCategoryRows, buildTopicPromptRows,
  syncTopicCategories, syncTopicPrompts,
} from '../../../src/llmo-config-db-sync/sync-junctions.js';

use(chaiAsPromised);
use(sinonChai);

const ORG_ID = 'org-uuid-1';
const TOPIC_ID = 'topic-config-id';
const TOPIC_UUID = 'topic-internal-uuid';
const CAT_ID = 'cat-config-id';
const CAT_UUID = 'cat-internal-uuid';

describe('llmo-config-db-sync/sync-junctions', () => {
  let log;

  beforeEach(() => {
    log = { info: sinon.stub(), warn: sinon.stub() };
  });

  describe('buildTopicCategoryRows', () => {
    it('builds rows from topics and aiTopics', () => {
      const config = {
        topics: { [TOPIC_ID]: { category: CAT_ID, prompts: [] } },
        aiTopics: { 'ai-1': { category: CAT_ID, prompts: [] } },
      };
      const topicLookup = new Map([[TOPIC_ID, TOPIC_UUID], ['ai-1', 'ai-uuid']]);
      const categoryLookup = new Map([[CAT_ID, CAT_UUID]]);

      const rows = buildTopicCategoryRows(config, topicLookup, categoryLookup);
      expect(rows).to.have.length(2);
      expect(rows[0]).to.deep.equal({ topic_id: TOPIC_UUID, category_id: CAT_UUID });
    });

    it('deduplicates rows for the same (topic_id, category_id)', () => {
      const config = {
        topics: { [TOPIC_ID]: { category: CAT_ID, prompts: [] } },
        aiTopics: { [TOPIC_ID]: { category: CAT_ID, prompts: [] } },
      };
      const topicLookup = new Map([[TOPIC_ID, TOPIC_UUID]]);
      const categoryLookup = new Map([[CAT_ID, CAT_UUID]]);

      const rows = buildTopicCategoryRows(config, topicLookup, categoryLookup);
      expect(rows).to.have.length(1);
    });

    it('skips topics without a resolved category', () => {
      const config = { topics: { [TOPIC_ID]: { prompts: [] } } };
      const topicLookup = new Map([[TOPIC_ID, TOPIC_UUID]]);
      expect(buildTopicCategoryRows(config, topicLookup, new Map())).to.deep.equal([]);
    });

    it('skips topics not in lookup', () => {
      const config = { topics: { 'unknown-topic': { category: CAT_ID, prompts: [] } } };
      const categoryLookup = new Map([[CAT_ID, CAT_UUID]]);
      expect(buildTopicCategoryRows(config, new Map(), categoryLookup)).to.deep.equal([]);
    });

    it('handles missing aiTopics gracefully', () => {
      const config = { topics: { [TOPIC_ID]: { category: CAT_ID, prompts: [] } } };
      const topicLookup = new Map([[TOPIC_ID, TOPIC_UUID]]);
      const categoryLookup = new Map([[CAT_ID, CAT_UUID]]);

      const rows = buildTopicCategoryRows(config, topicLookup, categoryLookup);
      expect(rows).to.have.length(1);
    });
  });

  describe('buildTopicPromptRows', () => {
    it('maps prompts with topic_id to junction rows', () => {
      const prompts = [
        { id: 'pk-1', topic_id: TOPIC_UUID },
        { id: 'pk-2', topic_id: TOPIC_UUID },
        { id: 'pk-3', topic_id: null },
      ];
      const rows = buildTopicPromptRows(prompts);
      expect(rows).to.have.length(2);
      expect(rows[0]).to.deep.equal({ topic_id: TOPIC_UUID, prompt_id: 'pk-1' });
    });

    it('returns empty for empty input', () => {
      expect(buildTopicPromptRows([])).to.deep.equal([]);
    });
  });

  describe('syncTopicCategories', () => {
    const config = { topics: { [TOPIC_ID]: { category: CAT_ID, prompts: [] } } };
    const topicLookup = new Map([[TOPIC_ID, TOPIC_UUID]]);
    const categoryLookup = new Map([[CAT_ID, CAT_UUID]]);

    // delete chain uses .eq().eq() pattern
    function makeClient({ fetchData = [], fetchError = null, upsertError = null, deleteError = null } = {}) {
      const deleteEq2 = sinon.stub().resolves({ error: deleteError });
      const deleteEq1 = sinon.stub().callsFake(() => ({ eq: deleteEq2 }));
      const deleteStub = sinon.stub().callsFake(() => ({ eq: deleteEq1 }));
      const fetchInStub = sinon.stub().resolves({ data: fetchData, error: fetchError });
      const selectStub = sinon.stub().callsFake(() => ({ in: fetchInStub }));
      const upsertStub = sinon.stub().resolves({ error: upsertError });

      const tableBuilder = { select: selectStub, delete: deleteStub, upsert: upsertStub };
      return {
        from: sinon.stub().returns(tableBuilder), deleteStub, deleteEq1, deleteEq2, upsertStub,
      };
    }

    it('inserts new topic-category pairs', async () => {
      const { from, upsertStub } = makeClient({ fetchData: [] });
      const stats = await syncTopicCategories({ from }, config, topicLookup, categoryLookup, log);
      expect(stats.inserted).to.equal(1);
      expect(upsertStub).to.have.been.called;
    });

    it('skips when all pairs already exist', async () => {
      const { from, upsertStub, deleteStub } = makeClient({
        fetchData: [{ topic_id: TOPIC_UUID, category_id: CAT_UUID }],
      });
      const stats = await syncTopicCategories({ from }, config, topicLookup, categoryLookup, log);
      expect(stats.inserted).to.equal(0);
      expect(stats.deleted).to.equal(0);
      expect(upsertStub).to.not.have.been.called;
      expect(deleteStub).to.not.have.been.called;
    });

    it('deletes orphaned rows', async () => {
      const { from, deleteEq1, deleteEq2 } = makeClient({
        fetchData: [{ topic_id: TOPIC_UUID, category_id: 'old-cat-uuid' }],
      });
      const stats = await syncTopicCategories({ from }, config, topicLookup, categoryLookup, log);
      expect(stats.deleted).to.equal(1);
      expect(deleteEq1).to.have.been.calledWith('topic_id', TOPIC_UUID);
      expect(deleteEq2).to.have.been.calledWith('category_id', 'old-cat-uuid');
    });

    it('skips DB writes in dry-run mode', async () => {
      const { from, upsertStub, deleteStub } = makeClient({ fetchData: [] });
      await syncTopicCategories({ from }, config, topicLookup, categoryLookup, log, true);
      expect(upsertStub).to.not.have.been.called;
      expect(deleteStub).to.not.have.been.called;
    });

    it('handles null existingData from fetch', async () => {
      const { from, upsertStub } = makeClient({ fetchData: null });
      const stats = await syncTopicCategories({ from }, config, topicLookup, categoryLookup, log);
      expect(stats.inserted).to.equal(1);
      expect(upsertStub).to.have.been.called;
    });

    it('returns early when no topics in lookup', async () => {
      const { from } = makeClient();
      const stats = await syncTopicCategories({ from }, config, new Map(), categoryLookup, log);
      expect(stats).to.deep.equal({ inserted: 0, deleted: 0 });
      expect(from).to.not.have.been.called;
    });

    it('throws on fetch error', async () => {
      const { from } = makeClient({ fetchError: { message: 'fetch fail' } });
      await expect(syncTopicCategories({ from }, config, topicLookup, categoryLookup, log))
        .to.be.rejectedWith('Failed to fetch topic_categories');
    });

    it('throws on delete error', async () => {
      const { from } = makeClient({
        fetchData: [{ topic_id: TOPIC_UUID, category_id: 'old-cat' }],
        deleteError: { message: 'del fail' },
      });
      await expect(syncTopicCategories({ from }, config, topicLookup, categoryLookup, log))
        .to.be.rejectedWith('Failed to delete topic_categories row');
    });

    it('throws on upsert error', async () => {
      const { from } = makeClient({ fetchData: [], upsertError: { message: 'ups fail' } });
      await expect(syncTopicCategories({ from }, config, topicLookup, categoryLookup, log))
        .to.be.rejectedWith('Failed to upsert topic_categories');
    });
  });

  describe('syncTopicPrompts', () => {
    const PROMPT_PK = 'prompt-pk-1';
    const promptsWithIds = [{ id: PROMPT_PK, topic_id: TOPIC_UUID }];

    // delete chain uses .eq().in() pattern
    function makeClient({ fetchData = [], fetchError = null, upsertError = null, deleteError = null } = {}) {
      const deleteInStub = sinon.stub().resolves({ error: deleteError });
      const deleteEqStub = sinon.stub().callsFake(() => ({ in: deleteInStub }));
      const deleteStub = sinon.stub().callsFake(() => ({ eq: deleteEqStub }));
      const fetchEqStub = sinon.stub().resolves({ data: fetchData, error: fetchError });
      const selectStub = sinon.stub().callsFake(() => ({ eq: fetchEqStub }));
      const upsertStub = sinon.stub().resolves({ error: upsertError });

      const tableBuilder = { select: selectStub, delete: deleteStub, upsert: upsertStub };
      return {
        from: sinon.stub().returns(tableBuilder), deleteStub, deleteInStub, upsertStub,
      };
    }

    it('inserts new topic-prompt pairs', async () => {
      const { from, upsertStub } = makeClient({ fetchData: [] });
      const stats = await syncTopicPrompts({ from }, ORG_ID, promptsWithIds, log);
      expect(stats.inserted).to.equal(1);
      expect(upsertStub).to.have.been.called;
    });

    it('skips when all pairs already exist', async () => {
      const { from, upsertStub, deleteStub } = makeClient({
        fetchData: [{ topic_id: TOPIC_UUID, prompt_id: PROMPT_PK }],
      });
      const stats = await syncTopicPrompts({ from }, ORG_ID, promptsWithIds, log);
      expect(stats.inserted).to.equal(0);
      expect(stats.deleted).to.equal(0);
      expect(upsertStub).to.not.have.been.called;
      expect(deleteStub).to.not.have.been.called;
    });

    it('deletes orphaned rows grouped by topic', async () => {
      const { from, deleteInStub } = makeClient({
        fetchData: [
          { topic_id: TOPIC_UUID, prompt_id: 'old-pk-1' },
          { topic_id: TOPIC_UUID, prompt_id: 'old-pk-2' },
        ],
      });
      const stats = await syncTopicPrompts({ from }, ORG_ID, promptsWithIds, log);
      expect(stats.deleted).to.equal(2);
      expect(deleteInStub).to.have.been.calledWith('prompt_id', ['old-pk-1', 'old-pk-2']);
    });

    it('skips DB writes in dry-run mode', async () => {
      const { from, upsertStub, deleteStub } = makeClient({ fetchData: [] });
      await syncTopicPrompts({ from }, ORG_ID, promptsWithIds, log, true);
      expect(upsertStub).to.not.have.been.called;
      expect(deleteStub).to.not.have.been.called;
    });

    it('handles null existingData from fetch', async () => {
      const { from, upsertStub } = makeClient({ fetchData: null });
      const stats = await syncTopicPrompts({ from }, ORG_ID, promptsWithIds, log);
      expect(stats.inserted).to.equal(1);
      expect(upsertStub).to.have.been.called;
    });

    it('throws on fetch error', async () => {
      const { from } = makeClient({ fetchError: { message: 'fetch fail' } });
      await expect(syncTopicPrompts({ from }, ORG_ID, promptsWithIds, log))
        .to.be.rejectedWith('Failed to fetch topic_prompts');
    });

    it('throws on delete error', async () => {
      const { from } = makeClient({
        fetchData: [{ topic_id: TOPIC_UUID, prompt_id: 'old-pk' }],
        deleteError: { message: 'del fail' },
      });
      await expect(syncTopicPrompts({ from }, ORG_ID, promptsWithIds, log))
        .to.be.rejectedWith(`Failed to delete topic_prompts for topic ${TOPIC_UUID}`);
    });

    it('throws on upsert error', async () => {
      const { from } = makeClient({ fetchData: [], upsertError: { message: 'ups fail' } });
      await expect(syncTopicPrompts({ from }, ORG_ID, promptsWithIds, log))
        .to.be.rejectedWith('Failed to upsert topic_prompts');
    });
  });
});
