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

function createExecutionChain(capture, responses) {
  const chain = {};
  chain.select = sinon.stub().returns(chain);
  chain.eq = sinon.stub().callsFake((field, value) => {
    capture.eq.push([field, value]);
    return chain;
  });
  chain.in = sinon.stub().callsFake((field, value) => {
    capture.in.push([field, value]);
    return chain;
  });
  chain.gte = sinon.stub().callsFake((field, value) => {
    capture.gte.push([field, value]);
    return chain;
  });
  chain.lte = sinon.stub().callsFake((field, value) => {
    capture.lte.push([field, value]);
    return chain;
  });
  chain.range = sinon.stub().callsFake((start, end) => {
    capture.range.push([start, end]);
    return Promise.resolve(responses.shift());
  });

  return chain;
}

function createSourceChain(capture, response) {
  const chain = {
    select: sinon.stub().callsFake((fields) => {
      capture.select.push(fields);
      return chain;
    }),
    eq: sinon.stub().callsFake((field, value) => {
      capture.eq.push([field, value]);
      return chain;
    }),
    gte: sinon.stub().callsFake((field, value) => {
      capture.gte.push([field, value]);
      return chain;
    }),
    lte: sinon.stub().callsFake((field, value) => {
      capture.lte.push([field, value]);
      return chain;
    }),
    in: sinon.stub().callsFake((field, value) => {
      capture.in.push([field, value]);
      return Promise.resolve(response);
    }),
  };

  return chain;
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
  });

  describe('getDateWindowForPreviousWeeks', () => {
    it('returns the min/max date window for the selected ISO weeks', () => {
      const result = getDateWindowForPreviousWeeks([
        { week: 11, year: 2026 },
        { week: 10, year: 2026 },
      ]);

      expect(result).to.deep.equal({
        startDate: '2026-03-02',
        endDate: '2026-03-15',
      });
    });
  });

  describe('mapExecutionsToLegacyBrandPresenceRows', () => {
    it('maps executions and joined source rows back to the legacy row shape', () => {
      const result = mapExecutionsToLegacyBrandPresenceRows(
        [{
          id: 'exec-1',
          region_code: 'US',
          topics: 'Topic A',
          prompt: 'Prompt A',
          category_name: 'Category A',
        }],
        [
          { execution_id: 'exec-1', source_urls: { url: 'https://a.example.com' } },
          { execution_id: 'exec-1', source_urls: { url: 'https://b.example.com' } },
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
  });

  describe('loadBrandPresenceDataFromPostgrest', () => {
    it('returns null when no execution rows are found', async () => {
      const executionCapture = {
        select: null,
        eq: [],
        in: [],
        gte: [],
        lte: [],
        range: [],
      };
      const executionChain = createExecutionChain(executionCapture, [
        { data: [], error: null },
      ]);
      const postgrestClient = {
        from: sandbox.stub().returns(executionChain),
      };

      const result = await loadBrandPresenceDataFromPostgrest({
        siteId: 'site-123',
        organizationId: 'org-123',
        previousWeeks: [{ week: 11, year: 2026 }, { week: 10, year: 2026 }],
        postgrestClient,
        log,
      });

      expect(result).to.equal(null);
      expect(executionCapture.eq).to.deep.include(['region_code', 'US']);
      expect(executionCapture.in[0][0]).to.equal('model');
    });

    it('queries executions with the mapped models and region_code = US', async () => {
      const executionCapture = {
        select: null,
        eq: [],
        in: [],
        gte: [],
        lte: [],
        range: [],
      };
      const sourceCapture = {
        select: [],
        eq: [],
        gte: [],
        lte: [],
        in: [],
      };
      const executionChain = createExecutionChain(executionCapture, [
        {
          data: [{
            id: 'exec-1',
            execution_date: '2026-03-12',
            region_code: 'US',
            topics: 'Topic A',
            prompt: 'Prompt A',
            category_name: 'Category A',
            model: 'chatgpt-free',
          }],
          error: null,
        },
      ]);
      const sourceChain = createSourceChain(sourceCapture, {
        data: [{
          execution_id: 'exec-1',
          source_urls: { url: 'https://reddit.com/r/test' },
        }],
        error: null,
      });
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .onSecondCall()
          .returns(sourceChain),
      };

      const result = await loadBrandPresenceDataFromPostgrest({
        siteId: 'site-123',
        organizationId: 'org-123',
        previousWeeks: [{ week: 11, year: 2026 }, { week: 10, year: 2026 }],
        postgrestClient,
        log,
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
      expect(executionCapture.eq).to.deep.include.members([
        ['organization_id', 'org-123'],
        ['site_id', 'site-123'],
        ['region_code', 'US'],
      ]);
      expect(executionCapture.in[0]).to.deep.equal(['model', getBrandPresenceDbModels()]);
    });

    it('batches source queries in chunks of 50 execution IDs', async () => {
      const executions = new Array(51).fill(null).map((_, index) => ({
        id: `exec-${index + 1}`,
        execution_date: '2026-03-12',
        region_code: 'US',
        topics: `Topic ${index + 1}`,
        prompt: `Prompt ${index + 1}`,
        category_name: 'Category',
      }));
      const executionCapture = {
        select: null,
        eq: [],
        in: [],
        gte: [],
        lte: [],
        range: [],
      };
      const sourceCaptures = [
        {
          select: [],
          eq: [],
          gte: [],
          lte: [],
          in: [],
        },
        {
          select: [],
          eq: [],
          gte: [],
          lte: [],
          in: [],
        },
      ];
      const executionChain = createExecutionChain(executionCapture, [
        { data: executions, error: null },
      ]);
      const sourceChain1 = createSourceChain(sourceCaptures[0], {
        data: executions.slice(0, 50).map((execution) => ({
          execution_id: execution.id,
          source_urls: { url: `https://example.com/${execution.id}` },
        })),
        error: null,
      });
      const sourceChain2 = createSourceChain(sourceCaptures[1], {
        data: executions.slice(50).map((execution) => ({
          execution_id: execution.id,
          source_urls: { url: `https://example.com/${execution.id}` },
        })),
        error: null,
      });
      const postgrestClient = {
        from: sandbox.stub()
          .onFirstCall()
          .returns(executionChain)
          .onSecondCall()
          .returns(sourceChain1)
          .onThirdCall()
          .returns(sourceChain2),
      };

      const result = await loadBrandPresenceDataFromPostgrest({
        siteId: 'site-123',
        organizationId: 'org-123',
        previousWeeks: [{ week: 11, year: 2026 }, { week: 10, year: 2026 }],
        postgrestClient,
        log,
      });

      expect(result.data).to.have.lengthOf(51);
      expect(sourceCaptures[0].in[0][1]).to.have.lengthOf(50);
      expect(sourceCaptures[1].in[0][1]).to.have.lengthOf(1);
    });
  });
});
