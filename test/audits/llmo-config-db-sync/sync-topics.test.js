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
  buildTopicRows, ensureDeletedRefEntities, syncTopics,
} from '../../../src/llmo-config-db-sync/sync-topics.js';

use(chaiAsPromised);
use(sinonChai);

const ORG_ID = 'org-uuid-1';
const BRAND_ID = 'brand-uuid-test';
const TOPIC_ID = '1413d7bd-eed6-4ac2-a782-1a3070100f11';
const CAT_ID = '3c36acd9-528a-4f11-b50f-e43aad11e2db';

const S3_CONFIG = {
  topics: {
    [TOPIC_ID]: {
      name: 'Account Management',
      prompts: [],
      category: CAT_ID,
    },
  },
  aiTopics: {
    'ai-topic-1': { name: 'AI Topic', prompts: [], category: CAT_ID },
  },
};

describe('llmo-config-db-sync/sync-topics', () => {
  let log;

  beforeEach(() => {
    log = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
  });

  describe('buildTopicRows', () => {
    it('maps topics and aiTopics to rows', () => {
      const rows = buildTopicRows(S3_CONFIG, ORG_ID, BRAND_ID);
      expect(rows).to.have.length(2);
      const row = rows.find((r) => r.topic_id === TOPIC_ID);
      expect(row).to.include({ name: 'Account Management', status: 'active', brand_id: BRAND_ID });
    });

    it('handles missing topics/aiTopics gracefully', () => {
      expect(buildTopicRows({}, ORG_ID, BRAND_ID)).to.deep.equal([]);
      expect(buildTopicRows({ topics: null }, ORG_ID, BRAND_ID)).to.deep.equal([]);
    });
  });

  describe('ensureDeletedRefEntities', () => {
    it('does nothing when no deleted prompts', async () => {
      const client = { from: sinon.stub() };
      await ensureDeletedRefEntities(client, {}, ORG_ID, new Map(), new Map(), new Map(), log);
      expect(client.from).to.not.have.been.called;
    });

    it('upserts missing topic and category referenced by deleted prompts', async () => {
      const config = {
        deleted: {
          prompts: {
            'prompt-uuid-1': {
              prompt: 'Test prompt',
              regions: ['us'],
              origin: 'human',
              source: 'config',
              topic: 'Hardware Acceleration',
              category: 'Premiere Pro',
              categoryId: '89c28b7a-2915-4522-9151-bee140232cbb',
            },
          },
        },
      };

      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({
          data: [{ id: 'new-uuid', category_id: '89c28b7a-2915-4522-9151-bee140232cbb' }],
          error: null,
        }),
      };
      const topicUpsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({
          data: [{ id: 'topic-uuid', topic_id: 'generated-uuid', name: 'Hardware Acceleration' }],
          error: null,
        }),
      };
      const fromStub = sinon.stub()
        .onFirstCall().returns(upsertChain)
        .onSecondCall().returns(topicUpsertChain);
      const client = { from: fromStub };

      const categoryLookup = new Map();
      const topicLookup = new Map();
      const topicNameLookup = new Map();

      await ensureDeletedRefEntities(
        client, config, ORG_ID, BRAND_ID, categoryLookup, topicLookup, topicNameLookup, log,
      );

      expect(categoryLookup.size).to.equal(1);
      expect(topicNameLookup.has('Hardware Acceleration')).to.be.true;
    });

    it('uses categoryId as name fallback when category name is missing', async () => {
      const config = {
        deleted: {
          prompts: {
            'p-1': {
              prompt: 'X',
              topic: 'New Topic',
              categoryId: 'missing-cat-id',
            },
          },
        },
      };
      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: null }),
      };
      const topicUpsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: null }),
      };
      const fromStub = sinon.stub()
        .onFirstCall().returns(upsertChain)
        .onSecondCall().returns(topicUpsertChain);
      const client = { from: fromStub };

      const categoryLookup = new Map();
      await ensureDeletedRefEntities(client, config, ORG_ID, BRAND_ID, categoryLookup, new Map(), new Map(), log);
      const upsertedCat = upsertChain.upsert.args[0][0][0];
      expect(upsertedCat.name).to.equal('missing-cat-id');
    });

    it('handles null data returned from category and topic upserts', async () => {
      const config = {
        deleted: {
          prompts: {
            'p-1': {
              prompt: 'X',
              topic: 'New Topic',
              category: 'New Cat',
              categoryId: 'new-cat-id',
            },
          },
        },
      };
      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: null }),
      };
      const topicUpsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: null }),
      };
      const fromStub = sinon.stub()
        .onFirstCall().returns(upsertChain)
        .onSecondCall().returns(topicUpsertChain);
      const client = { from: fromStub };

      const categoryLookup = new Map();
      const topicLookup = new Map();
      const topicNameLookup = new Map();
      await ensureDeletedRefEntities(client, config, ORG_ID, BRAND_ID, categoryLookup, topicLookup, topicNameLookup, log);
      expect(categoryLookup.size).to.equal(0);
      expect(topicLookup.size).to.equal(0);
    });

    it('skips already-known topics and categories', async () => {
      const config = {
        deleted: {
          prompts: {
            'p-1': {
              prompt: 'X', regions: ['us'], origin: 'human', source: 'config',
              topic: 'Known Topic', category: 'Known Cat', categoryId: CAT_ID,
            },
          },
        },
      };
      const client = { from: sinon.stub() };
      const categoryLookup = new Map([[CAT_ID, 'cat-uuid']]);
      const topicNameLookup = new Map([['Known Topic', 'topic-uuid']]);

      await ensureDeletedRefEntities(client, config, ORG_ID, BRAND_ID, categoryLookup, new Map(), topicNameLookup, log);
      expect(client.from).to.not.have.been.called;
    });

    it('throws on category upsert error', async () => {
      const config = {
        deleted: {
          prompts: {
            'p-1': {
              prompt: 'X', regions: ['us'], origin: 'human', source: 'config',
              topic: 'T', category: 'C', categoryId: 'missing-cat',
            },
          },
        },
      };
      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: { message: 'fail' } }),
      };
      const client = { from: sinon.stub().returns(upsertChain) };

      await expect(ensureDeletedRefEntities(client, config, ORG_ID, BRAND_ID, new Map(), new Map(), new Map(), log))
        .to.be.rejectedWith('Failed to upsert deleted-ref categories');
    });

    it('throws on topic upsert error', async () => {
      const config = {
        deleted: {
          prompts: {
            'p-1': {
              prompt: 'X', regions: ['us'], origin: 'human', source: 'config',
              topic: 'Unknown Topic', category: 'C', categoryId: CAT_ID,
            },
          },
        },
      };
      // category is known, topic is unknown
      const categoryLookup = new Map([[CAT_ID, 'cat-uuid']]);
      const topicUpsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: { message: 'topic fail' } }),
      };
      const client = { from: sinon.stub().returns(topicUpsertChain) };

      await expect(ensureDeletedRefEntities(client, config, ORG_ID, BRAND_ID, categoryLookup, new Map(), new Map(), log))
        .to.be.rejectedWith('Failed to upsert deleted-ref topics');
    });

    it('skips DB writes in dry-run mode', async () => {
      const config = {
        deleted: {
          prompts: {
            'p-1': {
              prompt: 'X', regions: ['us'], origin: 'human', source: 'config',
              topic: 'Missing Topic', category: 'C', categoryId: 'missing-cat',
            },
          },
        },
      };
      const client = { from: sinon.stub() };
      await ensureDeletedRefEntities(client, config, ORG_ID, BRAND_ID, new Map(), new Map(), new Map(), log, true);
      expect(client.from).to.not.have.been.called;
    });
  });

  describe('syncTopics', () => {
    it('upserts new topics and updates lookups', async () => {
      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({
          data: [{ id: 'topic-uuid', topic_id: TOPIC_ID, name: 'Account Management' }],
          error: null,
        }),
      };
      const client = { from: sinon.stub().returns(upsertChain) };
      const topicLookup = new Map();
      const topicNameLookup = new Map();

      const stats = await syncTopics(client, S3_CONFIG, ORG_ID, BRAND_ID, new Map(), topicLookup, topicNameLookup, log);
      expect(stats.inserted).to.equal(2);
      expect(topicLookup.get(TOPIC_ID)).to.equal('topic-uuid');
      expect(topicNameLookup.get('Account Management')).to.equal('topic-uuid');
    });

    it('handles null topicData returned from upsert', async () => {
      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: null }),
      };
      const client = { from: sinon.stub().returns(upsertChain) };
      const topicLookup = new Map();
      const topicNameLookup = new Map();

      await syncTopics(client, S3_CONFIG, ORG_ID, BRAND_ID, new Map(), topicLookup, topicNameLookup, log);
      expect(topicLookup.size).to.equal(0);
    });

    it('skips upsert when all topics unchanged', async () => {
      const existingTopics = new Map([
        [TOPIC_ID, { topic_id: TOPIC_ID, name: 'Account Management', description: null, status: 'active' }],
        ['ai-topic-1', { topic_id: 'ai-topic-1', name: 'AI Topic', description: null, status: 'active' }],
      ]);
      const client = { from: sinon.stub() };
      const stats = await syncTopics(client, S3_CONFIG, ORG_ID, BRAND_ID, existingTopics, new Map(), new Map(), log);
      expect(stats.unchanged).to.equal(2);
      expect(client.from).to.not.have.been.called;
    });

    it('skips DB writes in dry-run mode', async () => {
      const client = { from: sinon.stub() };
      await syncTopics(client, S3_CONFIG, ORG_ID, BRAND_ID, new Map(), new Map(), new Map(), log, true);
      expect(client.from).to.not.have.been.called;
    });

    it('throws on upsert error', async () => {
      const upsertChain = {
        upsert: sinon.stub().returnsThis(),
        select: sinon.stub().resolves({ data: null, error: { message: 'fail' } }),
      };
      const client = { from: sinon.stub().returns(upsertChain) };

      await expect(syncTopics(client, S3_CONFIG, ORG_ID, BRAND_ID, new Map(), new Map(), new Map(), log))
        .to.be.rejectedWith('Failed to upsert topics');
    });
  });
});
