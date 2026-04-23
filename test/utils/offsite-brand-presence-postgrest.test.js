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
    eq: [], in: [], gte: [], lte: [], order: [], range: [], select: [],
  };
}

function capturingStub(capture, key, returnValue) {
  return sinon.stub().callsFake((...args) => {
    capture[key].push(args.length === 1 ? args[0] : args);
    return returnValue;
  });
}

function createExecutionChain(capture, responses) {
  const chain = {};
  chain.select = sinon.stub().returns(chain);
  chain.eq = capturingStub(capture, 'eq', chain);
  chain.in = capturingStub(capture, 'in', chain);
  chain.gte = capturingStub(capture, 'gte', chain);
  chain.lte = capturingStub(capture, 'lte', chain);
  chain.order = capturingStub(capture, 'order', chain);
  chain.range = sinon.stub().callsFake((start, end) => {
    capture.range.push([start, end]);
    return Promise.resolve(responses.shift());
  });
  return chain;
}

function createSourceChain(capture, responses) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const chain = {};
  chain.select = capturingStub(capture, 'select', chain);
  chain.eq = capturingStub(capture, 'eq', chain);
  chain.gte = capturingStub(capture, 'gte', chain);
  chain.lte = capturingStub(capture, 'lte', chain);
  chain.range = sinon.stub().callsFake((start, end) => {
    capture.range.push([start, end]);
    return Promise.resolve(queue.shift());
  });
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
    ...overrides,
  };
}

function makeSource(executionId, url) {
  return { execution_id: executionId, source_urls: { url } };
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
    it('maps executions and joined source rows back to the legacy row shape', () => {
      const result = mapExecutionsToLegacyBrandPresenceRows(
        [makeExecution({ topics: 'Topic A', prompt: 'Prompt A', category_name: 'Category A' })],
        [
          makeSource('exec-1', 'https://a.example.com'),
          makeSource('exec-1', 'https://b.example.com'),
        ],
      );

      expect(result).to.deep.equal([{
        Sources: 'https://a.example.com;\nhttps://b.example.com',
        Region: 'US',
        Topics: 'Topic A',
        Prompt: 'Prompt A',
        Category: 'Category A',
      }]);
    });

    it('ignores malformed source rows and defaults missing execution fields to empty strings', () => {
      const result = mapExecutionsToLegacyBrandPresenceRows(
        [{ id: 'exec-1' }],
        [
          { execution_id: 'exec-1', source_urls: {} },
          { source_urls: { url: 'https://missing-execution.example.com' } },
          makeSource('exec-1', 'https://valid.example.com'),
        ],
      );

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
      const executionChain = createExecutionChain(capture, [{ data: [], error: null }]);
      const postgrestClient = { from: sandbox.stub().returns(executionChain) };

      const result = await loadWith({
        previousWeeks: DEFAULT_PREVIOUS_WEEKS,
        postgrestClient,
      });

      expect(result).to.equal(null);
      expect(capture.eq).to.deep.include(['region_code', 'US']);
      expect(capture.in[0][0]).to.equal('model');
    });

    it('treats null execution data as an empty result set', async () => {
      const executionChain = createExecutionChain(createCapture(), [{ data: null, error: null }]);
      const postgrestClient = { from: sandbox.stub().returns(executionChain) };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.info).to.have.been.calledWithMatch('No execution rows found');
    });

    it('queries executions with the mapped models and region_code = US', async () => {
      const capture = createCapture();
      const sourceCapture = createCapture();
      const executionChain = createExecutionChain(capture, [{
        data: [makeExecution({ topics: 'Topic A', prompt: 'Prompt A', category_name: 'Category A' })],
        error: null,
      }]);
      const sourceChain = createSourceChain(sourceCapture, {
        data: [makeSource('exec-1', 'https://reddit.com/r/test')],
        error: null,
      });
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .onSecondCall()
          .returns(sourceChain),
      };

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
      expect(sourceCapture.eq).to.deep.include.members([
        ['organization_id', ORG_ID],
        ['site_id', SITE_ID],
      ]);
      expect(sourceCapture.range).to.deep.equal([[0, 4999]]);
    });

    it('keeps paging execution rows until a batch is smaller than the configured limit', async () => {
      const capture = createCapture();
      const firstBatch = Array.from(
        { length: 5000 },
        (_, i) => makeExecution({ id: `exec-${i + 1}` }),
      );
      const executionChain = createExecutionChain(capture, [
        { data: firstBatch, error: null },
        { data: null, error: { message: 'page 2 failed' } },
      ]);
      const postgrestClient = {
        from: sandbox.stub().returns(executionChain),
      };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(capture.range).to.deep.equal([[0, 4999], [5000, 9999]]);
      expect(log.warn).to.have.been.calledOnce;
      expect(log.warn.firstCall.args[0]).to.include('page 2 failed');
    });

    it('fetches sources by date range and filters to valid execution IDs', async () => {
      const executions = [
        makeExecution({
          id: 'exec-1', topics: 'Topic 1', prompt: 'Prompt 1', category_name: 'Category',
        }),
        makeExecution({
          id: 'exec-2', topics: 'Topic 2', prompt: 'Prompt 2', category_name: 'Category',
        }),
      ];
      const capture = createCapture();
      const sourceCapture = createCapture();
      const executionChain = createExecutionChain(capture, [{ data: executions, error: null }]);
      const sourceChain = createSourceChain(sourceCapture, {
        data: [
          makeSource('exec-1', 'https://example.com/a'),
          makeSource('exec-2', 'https://example.com/b'),
          makeSource('exec-other', 'https://example.com/filtered-out'),
        ],
        error: null,
      });
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .onSecondCall()
          .returns(sourceChain),
      };

      const result = await loadWith({
        previousWeeks: DEFAULT_PREVIOUS_WEEKS,
        postgrestClient,
      });

      expect(result.data).to.have.lengthOf(2);
      expect(result.data.map((r) => r.Sources)).to.deep.equal([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      expect(sourceCapture.range).to.have.lengthOf(1);
    });

    it('paginates source fetches until a batch is smaller than the configured limit', async () => {
      const executions = [makeExecution({
        id: 'exec-1', topics: 'T', prompt: 'P', category_name: 'C',
      })];
      const capture = createCapture();
      const sourceCapture = createCapture();
      const executionChain = createExecutionChain(capture, [{ data: executions, error: null }]);
      const firstBatch = Array.from(
        { length: 5000 },
        (_, i) => makeSource('exec-1', `https://example.com/${i}`),
      );
      const sourceChain = createSourceChain(sourceCapture, [
        { data: firstBatch, error: null },
        { data: [makeSource('exec-1', 'https://example.com/last')], error: null },
      ]);
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .returns(sourceChain),
      };

      const result = await loadWith({ postgrestClient });

      expect(result.data).to.have.lengthOf(1);
      expect(sourceCapture.range).to.deep.equal([[0, 4999], [5000, 9999]]);
    });

    it('returns null when fetched execution rows do not include usable IDs', async () => {
      const executionChain = createExecutionChain(createCapture(), [{
        data: [makeExecution({ id: null })],
        error: null,
      }]);
      const postgrestClient = {
        from: sandbox.stub().returns(executionChain),
      };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(postgrestClient.from).to.have.been.calledOnce;
    });

    it('returns null when execution rows exist but no source rows are found', async () => {
      const executionChain = createExecutionChain(createCapture(), [{
        data: [makeExecution()],
        error: null,
      }]);
      const sourceChain = createSourceChain(createCapture(), {
        data: [], error: null,
      });
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .onSecondCall()
          .returns(sourceChain),
      };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.info).to.have.been.calledWithMatch('No source rows found');
    });

    it('treats null source data as an empty source result set', async () => {
      const executionChain = createExecutionChain(createCapture(), [{
        data: [makeExecution()],
        error: null,
      }]);
      const sourceChain = createSourceChain(createCapture(), {
        data: null, error: null,
      });
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .onSecondCall()
          .returns(sourceChain),
      };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.info).to.have.been.calledWithMatch('No source rows found');
    });

    it('returns null when all sources belong to non-matching executions', async () => {
      const executionChain = createExecutionChain(createCapture(), [{
        data: [makeExecution()],
        error: null,
      }]);
      const sourceChain = createSourceChain(createCapture(), {
        data: [makeSource('exec-other', 'https://example.com/a')],
        error: null,
      });
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .onSecondCall()
          .returns(sourceChain),
      };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.info).to.have.been.calledWithMatch('No source rows found');
    });

    it('returns null when source rows are present but none can be mapped back to legacy rows', async () => {
      const executionChain = createExecutionChain(createCapture(), [{
        data: [makeExecution()],
        error: null,
      }]);
      const sourceChain = createSourceChain(createCapture(), {
        data: [{ execution_id: 'exec-1', source_urls: {} }],
        error: null,
      });
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .onSecondCall()
          .returns(sourceChain),
      };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.info).to.have.been.calledWithMatch(
        'No usable source rows found',
      );
    });

    it('returns null and warns when source fetching fails', async () => {
      const executionChain = createExecutionChain(createCapture(), [{
        data: [makeExecution()],
        error: null,
      }]);
      const sourceChain = createSourceChain(createCapture(), {
        data: null,
        error: { message: 'source query failed' },
      });
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .onSecondCall()
          .returns(sourceChain),
      };

      expect(await loadWith({ postgrestClient })).to.equal(null);
      expect(log.warn).to.have.been.calledWithMatch(
        'source query failed',
      );
    });
  });
});
