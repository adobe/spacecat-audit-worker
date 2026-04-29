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
import { fetchPromptsBatched, fetchExistingState } from '../../../src/llmo-config-db-sync/fetch.js';

use(chaiAsPromised);
use(sinonChai);

const ORG_ID = 'org-uuid-1';
const BRAND_ID = 'brand-uuid-test';

// Topics fetch chains two .eq() calls; make the chain itself thenable.
function makeTopicChain(data, error = null) {
  const chain = {
    select: sinon.stub().returnsThis(),
    eq: sinon.stub().returnsThis(),
  };
  chain.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
  return chain;
}

function makeChain(resolveWith) {
  return {
    select: sinon.stub().returnsThis(),
    eq: sinon.stub().returnsThis(),
    range: sinon.stub().resolves(resolveWith),
  };
}

describe('llmo-config-db-sync/fetch', () => {
  let log;

  beforeEach(() => {
    log = { info: sinon.stub(), error: sinon.stub() };
  });

  describe('fetchPromptsBatched', () => {
    it('returns all rows from a single batch', async () => {
      const chain = makeChain({ data: [{ prompt_id: 'p1', text: 'hi', topic_id: null }], error: null });
      const client = { from: sinon.stub().returns(chain) };
      const rows = await fetchPromptsBatched(client, ORG_ID, log);
      expect(rows).to.have.length(1);
    });

    it('paginates across multiple batches', async () => {
      // First call returns FETCH_BATCH_SIZE rows (5000), second returns 1
      const bigBatch = Array.from({ length: 5000 }, (_, i) => ({ prompt_id: `p${i}`, text: `t${i}`, topic_id: null }));
      const chain = { select: sinon.stub().returnsThis(), eq: sinon.stub().returnsThis() };
      chain.range = sinon.stub()
        .onFirstCall().resolves({ data: bigBatch, error: null })
        .onSecondCall().resolves({ data: [{ prompt_id: 'p5000', text: 'last', topic_id: null }], error: null });
      const client = { from: sinon.stub().returns(chain) };
      const rows = await fetchPromptsBatched(client, ORG_ID, log);
      expect(rows).to.have.length(5001);
    });

    it('throws on fetch failure', async () => {
      const chain = makeChain({ data: null, error: { message: 'DB error' } });
      const client = { from: sinon.stub().returns(chain) };
      await expect(fetchPromptsBatched(client, ORG_ID, log))
        .to.be.rejectedWith('Failed to fetch prompts at offset 0: DB error');
    });

    it('handles null data with no error gracefully', async () => {
      const chain = makeChain({ data: null, error: null });
      const client = { from: sinon.stub().returns(chain) };
      const rows = await fetchPromptsBatched(client, ORG_ID, log);
      expect(rows).to.have.length(0);
    });
  });

  describe('fetchExistingState', () => {
    it('returns populated lookup maps', async () => {
      const catChain = {
        select: sinon.stub().returnsThis(),
        eq: sinon.stub().resolves({
          data: [{ id: 'cat-uuid', category_id: 'cat-1', name: 'Cat', origin: 'human', status: 'active' }],
          error: null,
        }),
      };
      const topicChain = makeTopicChain([
        { id: 'topic-uuid', topic_id: 'topic-1', name: 'Topic A', description: null, status: 'active' },
      ]);
      const promptChain = {
        select: sinon.stub().returnsThis(),
        eq: sinon.stub().returnsThis(),
        range: sinon.stub().resolves({
          data: [
            { prompt_id: 'pr-1', text: 'hello', topic_id: 'topic-uuid' },
            { prompt_id: 'pr-2', text: 'ignored', topic_id: null },
          ],
          error: null,
        }),
      };
      const fromStub = sinon.stub();
      fromStub.withArgs('categories').returns(catChain);
      fromStub.withArgs('topics').returns(topicChain);
      fromStub.withArgs('prompts').returns(promptChain);
      const client = { from: fromStub };

      const result = await fetchExistingState(client, ORG_ID, BRAND_ID, log);
      expect(result.categoryLookup.get('cat-1')).to.equal('cat-uuid');
      expect(result.topicLookup.get('topic-1')).to.equal('topic-uuid');
      expect(result.topicNameLookup.get('Topic A')).to.equal('topic-uuid');
      expect(result.existingCats.get('cat-1')).to.exist;
      expect(result.existingTopics.get('topic-1')).to.exist;
      expect(result.existingPrompts.size).to.equal(2);
      // Verify brand_id filter was applied to the topics chain
      expect(topicChain.eq).to.have.been.calledWith('brand_id', BRAND_ID);
    });

    it('throws on categories fetch error', async () => {
      const catChain = {
        select: sinon.stub().returnsThis(),
        eq: sinon.stub().resolves({ data: null, error: { message: 'cat fail' } }),
      };
      const topicChain = makeTopicChain([], null);
      const promptChain = {
        select: sinon.stub().returnsThis(),
        eq: sinon.stub().returnsThis(),
        range: sinon.stub().resolves({ data: [], error: null }),
      };
      const fromStub = sinon.stub();
      fromStub.withArgs('categories').returns(catChain);
      fromStub.withArgs('topics').returns(topicChain);
      fromStub.withArgs('prompts').returns(promptChain);
      const client = { from: fromStub };

      await expect(fetchExistingState(client, ORG_ID, BRAND_ID, log))
        .to.be.rejectedWith('Failed to fetch categories: cat fail');
    });

    it('throws on topics fetch error', async () => {
      const catChain = {
        select: sinon.stub().returnsThis(),
        eq: sinon.stub().resolves({ data: [], error: null }),
      };
      const topicChain = makeTopicChain(null, { message: 'topic fail' });
      const promptChain = {
        select: sinon.stub().returnsThis(),
        eq: sinon.stub().returnsThis(),
        range: sinon.stub().resolves({ data: [], error: null }),
      };
      const fromStub = sinon.stub();
      fromStub.withArgs('categories').returns(catChain);
      fromStub.withArgs('topics').returns(topicChain);
      fromStub.withArgs('prompts').returns(promptChain);
      const client = { from: fromStub };

      await expect(fetchExistingState(client, ORG_ID, BRAND_ID, log))
        .to.be.rejectedWith('Failed to fetch topics: topic fail');
    });

    it('handles null data from categories and topics queries', async () => {
      const catChain = {
        select: sinon.stub().returnsThis(),
        eq: sinon.stub().resolves({ data: null, error: null }),
      };
      const topicChain = makeTopicChain(null, null);
      const promptChain = {
        select: sinon.stub().returnsThis(),
        eq: sinon.stub().returnsThis(),
        range: sinon.stub().resolves({ data: [], error: null }),
      };
      const fromStub = sinon.stub();
      fromStub.withArgs('categories').returns(catChain);
      fromStub.withArgs('topics').returns(topicChain);
      fromStub.withArgs('prompts').returns(promptChain);
      const client = { from: fromStub };

      const result = await fetchExistingState(client, ORG_ID, BRAND_ID, log);
      expect(result.categoryLookup.size).to.equal(0);
      expect(result.topicLookup.size).to.equal(0);
      expect(result.existingPrompts.size).to.equal(0);
    });
  });
});
