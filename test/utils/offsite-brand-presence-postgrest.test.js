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

import {
  BRAND_PRESENCE_DB_MODEL_BY_PROVIDER,
  EXECUTION_FETCH_BATCH_SIZE,
  MAX_EXECUTION_FETCH_PAGES,
  getBrandPresenceDbModels,
  getDateWindowForPreviousWeeks,
  loadBrandPresenceDataFromPostgrest,
  mapExecutionsToLegacyBrandPresenceRows,
} from '../../src/utils/offsite-brand-presence-postgrest.js';

use(sinonChai);

const SITE_ID = 'site-123';
const ORG_ID = 'org-123';
const DEFAULT_PREVIOUS_WEEKS = [{ week: 11, year: 2026 }, { week: 10, year: 2026 }];
const SINGLE_WEEK = [{ week: 11, year: 2026 }];

function createCapture() {
  return {
    eq: [], in: [], gte: [], lte: [], order: [], limit: [], or: [], select: [],
  };
}

function capturingStub(capture, key, returnValue) {
  return sinon.stub().callsFake((...args) => {
    capture[key].push(args.length === 1 ? args[0] : args);
    return returnValue;
  });
}

function createQueryChain(capture, responses) {
  const queue = [...responses];
  const chain = {};
  chain.select = capturingStub(capture, 'select', chain);
  chain.eq = capturingStub(capture, 'eq', chain);
  chain.in = capturingStub(capture, 'in', chain);
  chain.gte = capturingStub(capture, 'gte', chain);
  chain.lte = capturingStub(capture, 'lte', chain);
  chain.order = capturingStub(capture, 'order', chain);
  chain.limit = capturingStub(capture, 'limit', chain);
  chain.or = capturingStub(capture, 'or', chain);
  chain.then = (resolve) => resolve(queue.shift());
  return chain;
}

function makeExecution(overrides = {}) {
  return {
    id: 'exec-1',
    execution_date: '2026-03-12',
    region_code: 'US',
    topics: '',
    prompt: '',
    category_name: '',
    model: 'chatgpt-free',
    brand_presence_sources: [],
    ...overrides,
  };
}

function embeddedSource(url) {
  return { source_urls: { url } };
}

describe('offsite-brand-presence-postgrest', () => {
  let sandbox;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getBrandPresenceDbModels', () => {
    it('maps the supported providers to DB model names', () => {
      expect(BRAND_PRESENCE_DB_MODEL_BY_PROVIDER).to.deep.equal({
        'ai-mode': 'google-ai-mode',
        all: 'chatgpt-paid',
        chatgpt: 'chatgpt-free',
        copilot: 'copilot',
        gemini: 'gemini',
        'google-ai-overviews': 'google-ai-overview',
        perplexity: 'perplexity',
      });

      expect(getBrandPresenceDbModels()).to.deep.equal([
        'google-ai-mode',
        'chatgpt-paid',
        'chatgpt-free',
        'copilot',
        'gemini',
        'google-ai-overview',
        'perplexity',
      ]);
    });

    it('filters unsupported providers and de-duplicates repeated mappings', () => {
      expect(getBrandPresenceDbModels([
        'chatgpt',
        'does-not-exist',
        'chatgpt',
        'perplexity',
      ])).to.deep.equal([
        'chatgpt-free',
        'perplexity',
      ]);
    });
  });

  describe('getDateWindowForPreviousWeeks', () => {
    it('returns the min/max date window for the selected ISO weeks', () => {
      const result = getDateWindowForPreviousWeeks(DEFAULT_PREVIOUS_WEEKS);

      expect(result).to.deep.equal({
        startDate: '2026-03-02',
        endDate: '2026-03-15',
      });
    });

    it('returns null when previousWeeks is missing or empty', () => {
      expect(getDateWindowForPreviousWeeks()).to.equal(null);
      expect(getDateWindowForPreviousWeeks([])).to.equal(null);
    });

    it('returns null when every supplied ISO week is invalid', () => {
      expect(getDateWindowForPreviousWeeks([
        { week: 0, year: 2026 },
        { week: 54, year: 2026 },
      ])).to.equal(null);
    });

    it('handles years where ISO week 1 starts in the previous calendar year', () => {
      expect(getDateWindowForPreviousWeeks([
        { week: 1, year: 2015 },
      ])).to.deep.equal({
        startDate: '2014-12-29',
        endDate: '2015-01-04',
      });
    });

    it('handles years where January 4th is not a Sunday', () => {
      expect(getDateWindowForPreviousWeeks([
        { week: 1, year: 2021 },
      ])).to.deep.equal({
        startDate: '2021-01-04',
        endDate: '2021-01-10',
      });
    });
  });

  describe('mapExecutionsToLegacyBrandPresenceRows', () => {
    it('maps executions with embedded sources to the legacy row shape', () => {
      const result = mapExecutionsToLegacyBrandPresenceRows([
        makeExecution({
          topics: 'Topic A',
          prompt: 'Prompt A',
          category_name: 'Category A',
          brand_presence_sources: [
            embeddedSource('https://a.example.com'),
            embeddedSource('https://b.example.com'),
          ],
        }),
      ]);

      expect(result).to.deep.equal([{
        Sources: 'https://a.example.com;\nhttps://b.example.com',
        Region: 'US',
        Topics: 'Topic A',
        Prompt: 'Prompt A',
        Category: 'Category A',
      }]);
    });

    it('ignores malformed embedded sources and defaults missing execution fields to empty strings', () => {
      const result = mapExecutionsToLegacyBrandPresenceRows([{
        id: 'exec-1',
        brand_presence_sources: [
          { source_urls: {} },
          { source_urls: null },
          embeddedSource('https://valid.example.com'),
        ],
      }]);

      expect(result).to.deep.equal([{
        Sources: 'https://valid.example.com',
        Region: '',
        Topics: '',
        Prompt: '',
        Category: '',
      }]);
    });
  });

  describe('loadBrandPresenceDataFromPostgrest', () => {
    function loadWith(overrides = {}) {
      return loadBrandPresenceDataFromPostgrest({
        siteId: SITE_ID,
        organizationId: ORG_ID,
        previousWeeks: SINGLE_WEEK,
        postgrestClient: null,
        log,
        ...overrides,
      });
    }

    it('returns null when required identifiers or the PostgREST client are missing', async () => {
      expect(await loadWith({ siteId: null, postgrestClient: null })).to.equal(null);
    });

    it('returns null when previousWeeks does not resolve to a valid date window', async () => {
      const postgrestClient = { from: sandbox.stub() };
      const result = await loadWith({
        previousWeeks: [{ week: 0, year: 2026 }],
        postgrestClient,
      });

      expect(result).to.equal(null);
      expect(postgrestClient.from).to.not.have.been.called;
    });

    it('returns null when no execution rows are found', async () => {
      const capture = createCapture();
      const chain = createQueryChain(capture, [{ data: [], error: null }]);
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      const result = await loadWith({
        previousWeeks: DEFAULT_PREVIOUS_WEEKS,
        postgrestClient,
      });

      expect(result).to.equal(null);
      expect(capture.eq).to.deep.include(['region_code', 'US']);
      expect(capture.in[0][0]).to.equal('model');
    });

    it('treats null execution data as an empty result set', async () => {
      const chain = createQueryChain(createCapture(), [{ data: null, error: null }]);
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.info).to.have.been.calledWithMatch('No execution rows found');
    });

    it('queries executions with embedded sources, mapped models, and region_code = US', async () => {
      const capture = createCapture();
      const chain = createQueryChain(capture, [{
        data: [makeExecution({
          topics: 'Topic A',
          prompt: 'Prompt A',
          category_name: 'Category A',
          brand_presence_sources: [embeddedSource('https://reddit.com/r/test')],
        })],
        error: null,
      }]);
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      const result = await loadWith({
        previousWeeks: DEFAULT_PREVIOUS_WEEKS,
        postgrestClient,
      });

      expect(result).to.deep.equal({
        data: [{
          Sources: 'https://reddit.com/r/test',
          Region: 'US',
          Topics: 'Topic A',
          Prompt: 'Prompt A',
          Category: 'Category A',
        }],
      });
      expect(postgrestClient.from).to.have.been.calledWith('brand_presence_executions');
      expect(capture.select[0]).to.include('brand_presence_sources(source_urls(url))');
      expect(capture.eq).to.deep.include.members([
        ['organization_id', ORG_ID],
        ['site_id', SITE_ID],
        ['region_code', 'US'],
      ]);
      expect(capture.in[0]).to.deep.equal(
        ['model', getBrandPresenceDbModels()],
      );
      expect(capture.order).to.deep.equal([
        ['execution_date', { ascending: false }],
        ['id', { ascending: false }],
      ]);
      expect(capture.limit).to.deep.equal([EXECUTION_FETCH_BATCH_SIZE]);
    });

    it('uses keyset pagination and re-fetches when a batch fills the limit', async () => {
      const capture = createCapture();
      const firstBatch = Array.from(
        { length: EXECUTION_FETCH_BATCH_SIZE },
        (_, i) => makeExecution({
          id: `exec-${i + 1}`,
          execution_date: '2026-03-12',
          brand_presence_sources: [embeddedSource(`https://example.com/${i + 1}`)],
        }),
      );
      const chain = createQueryChain(capture, [
        { data: firstBatch, error: null },
        { data: null, error: { message: 'page 2 failed' } },
      ]);
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      expect(await loadWith({ postgrestClient })).to.equal(null);

      const lastExec = firstBatch.at(-1);
      expect(capture.or).to.have.lengthOf(1);
      expect(capture.or[0]).to.include(lastExec.execution_date);
      expect(capture.or[0]).to.include(lastExec.id);
      expect(log.warn).to.have.been.calledOnce;
      expect(log.warn.firstCall.args[0]).to.include('page 2 failed');
    });

    it('accumulates rows across two successful pages via keyset cursor', async () => {
      const capture = createCapture();
      const firstBatch = Array.from(
        { length: EXECUTION_FETCH_BATCH_SIZE },
        (_, i) => makeExecution({
          id: `exec-${i + 1}`,
          execution_date: '2026-03-12',
          topics: `T${i + 1}`,
          prompt: `P${i + 1}`,
          category_name: 'C',
          brand_presence_sources: [embeddedSource(`https://example.com/exec-${i + 1}`)],
        }),
      );
      const secondBatch = Array.from({ length: 3 }, (_, i) => {
        const n = EXECUTION_FETCH_BATCH_SIZE + i + 1;
        return makeExecution({
          id: `exec-${n}`,
          execution_date: '2026-03-11',
          topics: `T${n}`,
          prompt: `P${n}`,
          category_name: 'C',
          brand_presence_sources: [embeddedSource(`https://example.com/exec-${n}`)],
        });
      });
      const chain = createQueryChain(capture, [
        { data: firstBatch, error: null },
        { data: secondBatch, error: null },
      ]);
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      const result = await loadWith({
        previousWeeks: DEFAULT_PREVIOUS_WEEKS,
        postgrestClient,
      });

      expect(capture.or).to.have.lengthOf(1);
      expect(result.data).to.have.lengthOf(EXECUTION_FETCH_BATCH_SIZE + 3);
      expect(result.data[0].Sources).to.equal('https://example.com/exec-1');
      expect(result.data[EXECUTION_FETCH_BATCH_SIZE + 2].Sources)
        .to.equal(`https://example.com/exec-${EXECUTION_FETCH_BATCH_SIZE + 3}`);
    });

    it('returns null when execution rows have no embedded sources', async () => {
      const chain = createQueryChain(createCapture(), [{
        data: [makeExecution()],
        error: null,
      }]);
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.info).to.have.been.calledWithMatch('No usable rows found');
    });

    it('returns null when embedded brand_presence_sources is null', async () => {
      const chain = createQueryChain(createCapture(), [{
        data: [makeExecution({ brand_presence_sources: null })],
        error: null,
      }]);
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.info).to.have.been.calledWithMatch('No usable rows found');
    });

    it('returns null when embedded source_urls have no valid url', async () => {
      const chain = createQueryChain(createCapture(), [{
        data: [makeExecution({
          brand_presence_sources: [{ source_urls: {} }],
        })],
        error: null,
      }]);
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.info).to.have.been.calledWithMatch('No usable rows found');
    });

    it('returns null and warns when the query fails', async () => {
      const chain = createQueryChain(createCapture(), [{
        data: null,
        error: { message: 'query failed' },
      }]);
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        '[BrandPresencePostgrest] PostgREST query failed for site site-123: Failed to fetch brand_presence_executions: query failed',
      );
    });

    it('returns null when keyset pagination reaches the max-page guard', async () => {
      const fullBatch = new Array(EXECUTION_FETCH_BATCH_SIZE).fill(makeExecution({
        brand_presence_sources: [embeddedSource('https://example.com/full-page')],
      }));
      const chain = createQueryChain(
        createCapture(),
        Array.from({ length: MAX_EXECUTION_FETCH_PAGES }, () => ({
          data: fullBatch,
          error: null,
        })),
      );
      const postgrestClient = { from: sandbox.stub().returns(chain) };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        `Exceeded maximum brand_presence_executions pages (${MAX_EXECUTION_FETCH_PAGES})`,
      );
    });
  });
});
