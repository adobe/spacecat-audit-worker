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
  resolvePromptId, collectPrompts, upsertInBatches, syncPrompts,
} from '../../../src/llmo-config-db-sync/sync-prompts.js';

use(chaiAsPromised);
use(sinonChai);

const ORG_ID = 'org-uuid-1';
const BRAND_ID = 'brand-uuid-1';
const TOPIC_ID = '1413d7bd-eed6-4ac2-a782-1a3070100f11';
const TOPIC_UUID = 'topic-internal-uuid';
const CAT_ID = '3c36acd9-528a-4f11-b50f-e43aad11e2db';
const CAT_UUID = 'cat-internal-uuid';
const PROMPT_UUID = 'prompt-uuid-1234-5678-90ab-cdef01234567';

function makeExistingPrompts(overrides = {}) {
  return new Map(Object.entries(overrides));
}

describe('llmo-config-db-sync/sync-prompts', () => {
  let log;

  beforeEach(() => {
    log = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
  });

  describe('resolvePromptId', () => {
    it('returns existing prompt_id when found', () => {
      const existing = makeExistingPrompts({
        [`How do I cancel?\0${TOPIC_UUID}`]: { prompt_id: PROMPT_UUID },
      });
      const p = { prompt: 'How do I cancel?' };
      expect(resolvePromptId(p, TOPIC_ID, TOPIC_UUID, existing)).to.equal(PROMPT_UUID);
    });

    it('generates deterministic UUID when not found', () => {
      const id = resolvePromptId({ prompt: 'New prompt' }, TOPIC_ID, null, new Map());
      expect(id).to.be.a('string').with.length(36);
    });

    it('returns null for empty prompt text', () => {
      expect(resolvePromptId({ prompt: '' }, TOPIC_ID, null, new Map())).to.be.null;
    });
  });

  describe('collectPrompts', () => {
    const categoryLookup = new Map([[CAT_ID, CAT_UUID]]);
    const topicLookup = new Map([[TOPIC_ID, TOPIC_UUID]]);
    const topicNameLookup = new Map([['Account Management', TOPIC_UUID]]);

    it('collects active prompts from topics', () => {
      const config = {
        topics: {
          [TOPIC_ID]: {
            name: 'Account Management',
            category: CAT_ID,
            prompts: [{ prompt: 'How do I cancel?', regions: ['us'], origin: 'human', source: 'config' }],
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.have.length(1);
      expect(rows[0]).to.include({ status: 'active', brand_id: BRAND_ID, topic_id: TOPIC_UUID });
      expect(rows[0].regions).to.deep.equal(['US']);
    });

    it('collects active prompts from aiTopics', () => {
      const config = {
        aiTopics: {
          [TOPIC_ID]: {
            category: CAT_ID,
            prompts: [{ prompt: 'AI prompt', regions: ['de'], origin: 'ai', source: 'config' }],
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.have.length(1);
      expect(rows[0].status).to.equal('active');
      expect(rows[0].origin).to.equal('ai');
    });

    it('collects deleted prompts', () => {
      const config = {
        deleted: {
          prompts: {
            'del-uuid-1': {
              prompt: 'Old prompt',
              regions: ['us'],
              origin: 'human',
              source: 'config',
              topic: 'Account Management',
              category: 'Creative Cloud',
              categoryId: CAT_ID,
            },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.have.length(1);
      expect(rows[0].status).to.equal('deleted');
    });

    it('warns and skips deleted prompt with missing topic', () => {
      const config = {
        deleted: {
          prompts: {
            'del-1': {
              prompt: 'Old', regions: ['us'], origin: 'human', source: 'config',
              // no topic field
            },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.have.length(0);
      expect(log.warn).to.have.been.calledWithMatch(/no topic field/);
    });

    it('collects deleted prompt with no categoryId and missing optional fields', () => {
      const config = {
        deleted: {
          prompts: {
            'del-1': {
              prompt: 'Old',
              topic: 'Account Management',
            },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.have.length(1);
      expect(rows[0].category_id).to.be.null;
      expect(rows[0].regions).to.deep.equal([]);
      expect(rows[0].origin).to.equal('human');
      expect(rows[0].source).to.equal('config');
    });

    it('falls back to null when deleted prompt categoryId not in lookup', () => {
      const config = {
        deleted: {
          prompts: {
            'del-1': {
              prompt: 'Old',
              topic: 'Account Management',
              categoryId: 'unknown-cat',
            },
          },
        },
      };
      const rows = collectPrompts(config, new Map(), topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows[0].category_id).to.be.null;
    });

    it('uses configPromptId as name fallback when deleted prompt text is empty', () => {
      const config = {
        deleted: {
          prompts: {
            'del-config-id': {
              prompt: '',
              topic: 'Account Management',
              categoryId: CAT_ID,
            },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows[0].name).to.equal('del-config-id');
    });

    it('reuses existing prompt_id for deleted prompt', () => {
      const existing = new Map([[`Old prompt\0${TOPIC_UUID}`, { prompt_id: 'existing-del-id' }]]);
      const config = {
        deleted: {
          prompts: {
            'del-new-uuid': {
              prompt: 'Old prompt',
              regions: ['us'],
              origin: 'human',
              source: 'config',
              topic: 'Account Management',
              category: 'Creative Cloud',
              categoryId: CAT_ID,
            },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, existing, log);
      expect(rows[0].prompt_id).to.equal('existing-del-id');
    });

    it('warns and skips deleted prompt with unresolvable topic', () => {
      const config = {
        deleted: {
          prompts: {
            'del-1': {
              prompt: 'Old', regions: ['us'], origin: 'human', source: 'config',
              topic: 'Unknown Topic',
              category: 'X', categoryId: CAT_ID,
            },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.have.length(0);
      expect(log.warn).to.have.been.calledWithMatch(/could not be resolved by name/);
    });

    it('collects ignored prompts with status=ignored', () => {
      const config = {
        ignored: {
          prompts: {
            'ign-uuid-1': { prompt: 'Ignored prompt', region: 'us', source: 'gsc', updatedBy: 'user@test.com' },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.have.length(1);
      expect(rows[0]).to.include({ status: 'ignored', topic_id: null, category_id: null });
      expect(rows[0].regions).to.deep.equal(['US']);
    });

    it('collects ignored prompts with no region and no source', () => {
      const config = {
        ignored: {
          prompts: {
            'ign-1': { prompt: 'Ignored no region' },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows[0].regions).to.deep.equal([]);
      expect(rows[0].source).to.equal('config');
    });

    it('uses configPromptId as name fallback when ignored prompt text is empty', () => {
      const config = {
        ignored: {
          prompts: {
            'ign-config-id': { prompt: '' },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows[0].name).to.equal('ign-config-id');
    });

    it('reuses existing prompt_id for ignored prompts', () => {
      const existing = makeExistingPrompts({
        'Ignored prompt\0': { prompt_id: 'existing-ignored-id' },
      });
      const config = {
        ignored: {
          prompts: {
            'new-uuid': { prompt: 'Ignored prompt', region: 'us', source: 'gsc' },
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, existing, log);
      expect(rows[0].prompt_id).to.equal('existing-ignored-id');
    });

    it('uses promptId as name fallback when prompt text is empty but existing entry found', () => {
      const existing = new Map([[`\0${TOPIC_UUID}`, { prompt_id: 'existing-uuid' }]]);
      const config = {
        topics: {
          [TOPIC_ID]: {
            category: CAT_ID,
            prompts: [{ prompt: '', regions: ['us'], origin: 'human', source: 'config' }],
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, existing, log);
      expect(rows[0].name).to.equal('existing-uuid');
    });

    it('handles topic not in lookup and topic without category', () => {
      const config = {
        topics: {
          'unknown-topic': {
            prompts: [{ prompt: 'Test?', regions: ['us'], origin: 'human', source: 'config' }],
          },
          [TOPIC_ID]: {
            prompts: [{ prompt: 'No cat?', regions: ['us'], origin: 'human', source: 'config' }],
          },
        },
      };
      const rows = collectPrompts(config, new Map(), topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows[0].topic_id).to.be.null;
      expect(rows[0].category_id).to.be.null;
    });

    it('handles prompts with missing optional fields', () => {
      const config = {
        topics: {
          [TOPIC_ID]: {
            category: CAT_ID,
            prompts: [{ prompt: 'Minimal?' }],
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.have.length(1);
      expect(rows[0].regions).to.deep.equal([]);
      expect(rows[0].origin).to.equal('human');
      expect(rows[0].source).to.equal('config');
    });

    it('handles topic with no prompts field', () => {
      const config = {
        topics: { [TOPIC_ID]: { category: CAT_ID } },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.deep.equal([]);
    });

    it('handles category not in lookup for active topic', () => {
      const config = {
        topics: {
          [TOPIC_ID]: {
            category: 'missing-cat',
            prompts: [{ prompt: 'Test?', regions: ['us'], origin: 'human', source: 'config' }],
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows[0].category_id).to.be.null;
    });

    it('logs error and skips prompts without text', () => {
      const config = {
        topics: {
          [TOPIC_ID]: {
            category: CAT_ID,
            prompts: [{ prompt: '', regions: ['us'], origin: 'human', source: 'config' }],
          },
        },
      };
      const rows = collectPrompts(config, categoryLookup, topicLookup, topicNameLookup, BRAND_ID, ORG_ID, new Map(), log);
      expect(rows).to.have.length(0);
      expect(log.error).to.have.been.calledWithMatch(/Skipping prompt without text/);
    });
  });

  describe('upsertInBatches', () => {
    it('upserts rows in a single batch', async () => {
      const upsertChain = { upsert: sinon.stub().resolves({ error: null }) };
      const client = { from: sinon.stub().returns(upsertChain) };
      const rows = [{ prompt_id: 'p1' }, { prompt_id: 'p2' }];

      const total = await upsertInBatches(client, 'prompts', rows, 'brand_id,prompt_id', log);
      expect(total).to.equal(2);
    });

    it('splits into multiple batches for large row sets', async () => {
      const upsertChain = { upsert: sinon.stub().resolves({ error: null }) };
      const client = { from: sinon.stub().returns(upsertChain) };
      const rows = Array.from({ length: 3001 }, (_, i) => ({ prompt_id: `p${i}` }));

      await upsertInBatches(client, 'prompts', rows, 'brand_id,prompt_id', log);
      expect(upsertChain.upsert.callCount).to.equal(2);
    });

    it('throws on batch error', async () => {
      const upsertChain = { upsert: sinon.stub().resolves({ error: { message: 'batch fail' } }) };
      const client = { from: sinon.stub().returns(upsertChain) };

      await expect(upsertInBatches(client, 'prompts', [{ prompt_id: 'p1' }], 'brand_id,prompt_id', log))
        .to.be.rejectedWith('Failed to upsert prompts batch 1: batch fail');
    });
  });

  describe('syncPrompts', () => {
    const categoryLookup = new Map([[CAT_ID, CAT_UUID]]);
    const topicLookup = new Map([[TOPIC_ID, TOPIC_UUID]]);
    const topicNameLookup = new Map([['Account Management', TOPIC_UUID]]);
    const s3Config = {
      topics: {
        [TOPIC_ID]: {
          category: CAT_ID,
          prompts: [{ prompt: 'Cancel subscription?', regions: ['us'], origin: 'human', source: 'config' }],
        },
      },
    };

    it('upserts new prompts', async () => {
      const upsertChain = { upsert: sinon.stub().resolves({ error: null }) };
      const client = { from: sinon.stub().returns(upsertChain) };

      const stats = await syncPrompts(
        client, s3Config, categoryLookup, topicLookup, topicNameLookup,
        BRAND_ID, ORG_ID, new Map(), log,
      );
      expect(stats.inserted).to.equal(1);
    });

    it('skips upsert when no diff', async () => {
      const promptKey = `Cancel subscription?\0${TOPIC_UUID}`;
      const existingPrompts = new Map([[promptKey, {
        prompt_id: PROMPT_UUID, brand_id: BRAND_ID, text: 'Cancel subscription?',
        topic_id: TOPIC_UUID, name: 'Cancel subscription?', regions: ['US'],
        category_id: CAT_UUID, status: 'active', origin: 'human', source: 'config',
      }]]);
      const client = { from: sinon.stub() };

      const stats = await syncPrompts(
        client, s3Config, categoryLookup, topicLookup, topicNameLookup,
        BRAND_ID, ORG_ID, existingPrompts, log,
      );
      expect(stats.unchanged).to.equal(1);
      expect(client.from).to.not.have.been.called;
    });

    it('skips DB writes in dry-run mode', async () => {
      const client = { from: sinon.stub() };
      await syncPrompts(
        client, s3Config, categoryLookup, topicLookup, topicNameLookup,
        BRAND_ID, ORG_ID, new Map(), log, true,
      );
      expect(client.from).to.not.have.been.called;
    });
  });
});
