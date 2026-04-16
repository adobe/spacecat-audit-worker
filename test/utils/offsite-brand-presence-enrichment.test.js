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
import esmock from 'esmock';
import {
  BRAND_PRESENCE_REGEX,
  FETCH_TIMEOUT_MS,
  INCLUDE_COLUMNS,
  OFFSITE_DOMAINS,
  PROVIDERS_SET,
} from '../../src/offsite-brand-presence/constants.js';

use(sinonChai);

const MOCK_FETCH_PAGE_SIZE = 100;
const SITE_ID = 'site-123';
const DEFAULT_WEEK = 7;
const DEFAULT_WEEK_2 = 6;
const DEFAULT_YEAR = 2026;

const SHARED_CONSTANTS_MOCK = {
  BRAND_PRESENCE_REGEX,
  PROVIDERS_SET,
  INCLUDE_COLUMNS,
  FETCH_PAGE_SIZE: MOCK_FETCH_PAGE_SIZE,
  FETCH_TIMEOUT_MS,
  OFFSITE_DOMAINS,
};

function okJsonResponse(sandbox, body) {
  return {
    ok: true,
    json: sandbox.stub().resolves(body),
    text: sandbox.stub().resolves(JSON.stringify(body)),
  };
}

function failResponse(sandbox, status, statusText = 'Error') {
  return {
    ok: false,
    status,
    statusText,
    text: sandbox.stub().resolves(statusText),
  };
}

function makeQueryIndex(providers = ['copilot'], week = DEFAULT_WEEK, year = DEFAULT_YEAR) {
  return {
    data: providers.map((p) => ({
      path: `/adobe/brand-presence/w${week}/brandpresence-${p}-w${week}-${year}-010126.json`,
    })),
  };
}

function makeBrandPresenceRow(overrides = {}) {
  return {
    Sources: 'https://www.reddit.com/r/test/comments/abc',
    Region: 'US',
    Topics: 'MyTopic',
    Category: 'Insurance',
    Prompt: 'Why choose us?',
    ...overrides,
  };
}

describe('offsite-brand-presence-enrichment', () => {
  let sandbox;
  let mockFetch;
  let mockIsoCalendarWeek;
  let computeTopicsFromBrandPresence;
  let formatTopicsForEnrichment;
  let filterBrandPresenceFiles;
  let log;
  let env;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockFetch = sandbox.stub();
    mockIsoCalendarWeek = sandbox.stub();
    mockIsoCalendarWeek.onFirstCall().returns({ week: DEFAULT_WEEK, year: DEFAULT_YEAR });
    mockIsoCalendarWeek.onSecondCall().returns({ week: DEFAULT_WEEK_2, year: DEFAULT_YEAR });

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    env = {
      SPACECAT_API_BASE_URL: 'https://spacecat.api.example.com',
      SPACECAT_API_KEY: 'test-api-key',
    };

    const mod = await esmock('../../src/utils/offsite-brand-presence-enrichment.js', {
      '@adobe/spacecat-shared-utils': {
        isoCalendarWeek: mockIsoCalendarWeek,
        tracingFetch: mockFetch,
      },
      '../../src/offsite-brand-presence/constants.js': SHARED_CONSTANTS_MOCK,
    });

    computeTopicsFromBrandPresence = mod.computeTopicsFromBrandPresence;
    formatTopicsForEnrichment = mod.formatTopicsForEnrichment;
    filterBrandPresenceFiles = mod.filterBrandPresenceFiles;
  });

  afterEach(() => {
    sandbox.restore();
  });

  async function esmockWithPostgrest(brandalfOverrides = {}) {
    return esmock('../../src/utils/offsite-brand-presence-enrichment.js', {
      '@adobe/spacecat-shared-utils': {
        isoCalendarWeek: mockIsoCalendarWeek,
        tracingFetch: mockFetch,
      },
      '../../src/offsite-brand-presence/constants.js': SHARED_CONSTANTS_MOCK,
      '../../src/utils/brandalf-utils.js': {
        isBrandalfEnabled: sandbox.stub().resolves(true),
        resolveOrganizationIdForSite: sandbox.stub().resolves('org-123'),
        ...brandalfOverrides,
      },
      '../../src/utils/offsite-brand-presence-postgrest.js': {
        loadBrandPresenceDataFromPostgrest: sandbox.stub().resolves(null),
        ...brandalfOverrides,
      },
    });
  }

  function setupQueryIndexAndData(rows, providers = ['copilot']) {
    mockFetch
      .onFirstCall().resolves(okJsonResponse(sandbox, makeQueryIndex(providers)))
      .onSecondCall().resolves(okJsonResponse(sandbox, { data: rows }));
  }

  describe('filterBrandPresenceFiles', () => {
    it('returns paths matching week, year, and known provider', () => {
      const paths = filterBrandPresenceFiles(makeQueryIndex(), DEFAULT_WEEK, DEFAULT_YEAR);
      expect(paths).to.deep.equal([
        `brand-presence/w${DEFAULT_WEEK}/brandpresence-copilot-w${DEFAULT_WEEK}-${DEFAULT_YEAR}-010126.json`,
      ]);
    });

    it('returns empty array when no entries match', () => {
      expect(filterBrandPresenceFiles({ data: [] }, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('excludes files when ISO week in filename does not match target week', () => {
      const qi = { data: [{ path: `/adobe/brand-presence/w8/brandpresence-copilot-w8-${DEFAULT_YEAR}-010126.json` }] };
      expect(filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('treats null queryIndex as empty', () => {
      expect(filterBrandPresenceFiles(null, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('ignores entries without path, without brand-presence segment, or unknown provider id', () => {
      const qi = {
        data: [
          {},
          { path: '/other/file.json' },
          { path: `/adobe/brand-presence/w${DEFAULT_WEEK}/brandpresence-not-a-real-provider-w${DEFAULT_WEEK}-${DEFAULT_YEAR}-010126.json` },
        ],
      };
      expect(filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('ignores brand-presence paths that do not match the filename pattern', () => {
      const qi = { data: [{ path: '/adobe/brand-presence/w7/foo.json' }] };
      expect(filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('excludes files when year in filename does not match target year', () => {
      const qi = { data: [{ path: `/adobe/brand-presence/w${DEFAULT_WEEK}/brandpresence-copilot-w${DEFAULT_WEEK}-2025-010126.json` }] };
      expect(filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('matches filenames without a trailing date suffix', () => {
      const qi = { data: [{ path: `/site/brand-presence/brandpresence-copilot-w${DEFAULT_WEEK}-${DEFAULT_YEAR}.json` }] };
      const paths = filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR);
      expect(paths).to.have.lengthOf(1);
      expect(paths[0]).to.include('copilot');
    });
  });

  describe('formatTopicsForEnrichment', () => {
    it('maps topicMap and allUrls to enrichment topic shape', () => {
      const topicMap = new Map();
      const urlMap = new Map();
      urlMap.set('https://reddit.com/r/x', { category: 'cat', subPrompts: new Set(['p1']) });
      topicMap.set('T1', { category: 'cat', urlMap });

      const allUrls = new Map();
      allUrls.set('https://reddit.com/r/x', { count: 3, domain: 'reddit.com' });

      const topics = formatTopicsForEnrichment(topicMap, allUrls);
      expect(topics).to.deep.equal([{
        name: 'T1',
        urls: [{
          url: 'https://reddit.com/r/x',
          timesCited: 3,
          category: 'cat',
          subPrompts: ['p1'],
        }],
      }]);
    });

    it('uses zero timesCited when url missing from allUrls', () => {
      const topicMap = new Map();
      const urlMap = new Map();
      urlMap.set('https://example.com/a', { category: '', subPrompts: new Set() });
      topicMap.set('T', { category: '', urlMap });

      const topics = formatTopicsForEnrichment(topicMap, new Map());
      expect(topics[0].urls[0].timesCited).to.equal(0);
    });
  });

  describe('computeTopicsFromBrandPresence', () => {
    it('uses PostgREST data before query-index/file fetches', async () => {
      const loadBrandPresenceDataFromPostgrest = sandbox.stub().resolves({
        data: [makeBrandPresenceRow()],
      });
      const mod = await esmockWithPostgrest({ loadBrandPresenceDataFromPostgrest });
      const postgrestClient = { from: sandbox.stub() };

      const result = await mod.computeTopicsFromBrandPresence(SITE_ID, {
        env: {},
        log,
        dataAccess: { services: { postgrestClient } },
      });

      expect(result).to.have.lengthOf(1);
      expect(result[0].name).to.equal('MyTopic');
      expect(result[0].urls[0].url).to.equal('https://www.reddit.com/r/test/comments/abc');
      expect(mockFetch).to.not.have.been.called;
      expect(
        loadBrandPresenceDataFromPostgrest.firstCall.args[0].postgrestClient,
      ).to.equal(postgrestClient);
    });

    it('falls back to query-index/file fetches when PostgREST returns no rows', async () => {
      const mod = await esmockWithPostgrest();

      const fallbackRow = makeBrandPresenceRow({ Topics: 'Fallback Topic' });
      mockFetch
        .onFirstCall()
        .resolves(okJsonResponse(sandbox, makeQueryIndex()))
        .onSecondCall()
        .resolves(okJsonResponse(sandbox, { data: [fallbackRow] }));

      const result = await mod.computeTopicsFromBrandPresence(
        SITE_ID,
        { env, log, dataAccess: {} },
      );

      expect(result).to.have.lengthOf(1);
      expect(result[0].name).to.equal('Fallback Topic');
      expect(mockFetch.callCount).to.equal(2);
    });

    it('returns empty array when SPACECAT_API_BASE_URL is missing', async () => {
      const result = await computeTopicsFromBrandPresence(SITE_ID, {
        env: { SPACECAT_API_KEY: 'k' },
        log,
      });
      expect(result).to.deep.equal([]);
      expect(log.warn).to.have.been.calledWithMatch(/SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured/);
    });

    it('returns empty array when SPACECAT_API_KEY is missing', async () => {
      const result = await computeTopicsFromBrandPresence(SITE_ID, {
        env: { SPACECAT_API_BASE_URL: 'https://example.com' },
        log,
      });
      expect(result).to.deep.equal([]);
    });

    it('returns empty array when query-index fetch is not ok', async () => {
      mockFetch.resolves(failResponse(sandbox, 500));
      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result).to.deep.equal([]);
      expect(log.warn).to.have.been.calledWithMatch(/Failed to fetch query-index/);
    });

    it('returns empty array when query-index fetch throws', async () => {
      mockFetch.rejects(new Error('network'));
      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result).to.deep.equal([]);
      expect(log.error).to.have.been.calledWithMatch(/Error fetching query-index/);
    });

    it('returns empty array when query-index json() rejects', async () => {
      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().rejects(new SyntaxError('Unexpected token')),
      });
      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result).to.deep.equal([]);
      expect(log.error).to.have.been.calledWithMatch(/Error fetching query-index/);
      expect(log.warn).to.have.been.calledWithMatch(/Failed to fetch query-index for site/);
    });

    it('treats null JSON body on brand presence page as empty rows', async () => {
      mockFetch
        .onFirstCall().resolves(okJsonResponse(sandbox, makeQueryIndex()))
        .onSecondCall().resolves({
          ok: true,
          json: sandbox.stub().resolves(null),
          text: sandbox.stub().resolves(''),
        });

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result).to.deep.equal([]);
    });

    it('returns empty array when no brand presence files match the week', async () => {
      mockFetch.resolves(okJsonResponse(sandbox, { data: [] }));
      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result).to.deep.equal([]);
      expect(log.info).to.have.been.calledWithMatch(/Found 0 brand presence files/);
    });

    it('aggregates topics from brand presence rows (US, reddit URL, topic)', async () => {
      setupQueryIndexAndData([makeBrandPresenceRow()]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });

      expect(result).to.have.lengthOf(1);
      expect(result[0].name).to.equal('MyTopic');
      expect(result[0].urls).to.have.lengthOf(1);
      expect(result[0].urls[0].url).to.equal('https://www.reddit.com/r/test/comments/abc');
      expect(result[0].urls[0].timesCited).to.equal(1);
      expect(result[0].urls[0].category).to.equal('Insurance');
      expect(result[0].urls[0].subPrompts).to.deep.equal(['Why choose us?']);
    });

    it('skips non-US rows and rows without Sources', async () => {
      setupQueryIndexAndData([
        { Sources: 'https://reddit.com/r/a', Region: 'EU', Topics: 'T' },
        { Sources: '', Region: 'US', Topics: 'T' },
      ]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result).to.deep.equal([]);
    });

    it('skips empty source segments and invalid URL tokens', async () => {
      setupQueryIndexAndData([
        makeBrandPresenceRow({
          Sources: ';https://www.reddit.com/r/good',
          Topics: 'T',
          Category: 'C',
          Prompt: 'p',
        }),
        { Sources: ':::', Region: 'US', Topics: 'T2' },
      ]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result).to.have.lengthOf(1);
      expect(result[0].name).to.equal('T');
      expect(result[0].urls[0].url).to.equal('https://www.reddit.com/r/good');
    });

    it('increments citation count when the same normalized URL appears in multiple rows', async () => {
      const url = 'https://www.reddit.com/r/x/y';
      setupQueryIndexAndData([
        makeBrandPresenceRow({
          Sources: url, Topics: 'T', Category: 'C', Prompt: 'P',
        }),
        makeBrandPresenceRow({
          Sources: url, Topics: 'T', Category: 'C', Prompt: '',
        }),
      ]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result[0].urls[0].timesCited).to.equal(2);
    });

    it('does not track topic when Topics is empty', async () => {
      setupQueryIndexAndData([makeBrandPresenceRow({ Topics: '   ' })]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result).to.deep.equal([]);
    });

    describe('pagination (small FETCH_PAGE_SIZE)', () => {
      let computeTopicsPaginated;

      beforeEach(async () => {
        const mod = await esmock('../../src/utils/offsite-brand-presence-enrichment.js', {
          '@adobe/spacecat-shared-utils': {
            isoCalendarWeek: mockIsoCalendarWeek,
            tracingFetch: mockFetch,
          },
          '../../src/offsite-brand-presence/constants.js': {
            ...SHARED_CONSTANTS_MOCK,
            FETCH_PAGE_SIZE: 2,
          },
        });
        computeTopicsPaginated = mod.computeTopicsFromBrandPresence;
      });

      it('paginates brand presence fetch when rows exceed page size', async () => {
        const r1 = makeBrandPresenceRow({ Sources: 'https://reddit.com/r/a', Topics: 'T1' });
        const r2 = makeBrandPresenceRow({ Sources: 'https://reddit.com/r/b', Topics: 'T2' });
        const r3 = makeBrandPresenceRow({ Sources: 'https://reddit.com/r/c', Topics: 'T3' });
        mockFetch
          .onFirstCall()
          .resolves(okJsonResponse(sandbox, makeQueryIndex()))
          .onSecondCall()
          .resolves(okJsonResponse(sandbox, { data: [r1, r2] }))
          .onThirdCall()
          .resolves(okJsonResponse(sandbox, { data: [r3] }));

        const result = await computeTopicsPaginated(SITE_ID, { env, log });
        expect(mockFetch.callCount).to.be.at.least(3);
        expect(result.length).to.be.at.least(1);
      });

      it('returns partial rows when a later page fetch fails after at least one ok page', async () => {
        const r1 = makeBrandPresenceRow({ Sources: 'https://reddit.com/r/partial', Topics: 'T1' });
        const r2 = makeBrandPresenceRow({ Sources: 'https://reddit.com/r/partial2', Topics: 'T2' });
        mockFetch
          .onFirstCall()
          .resolves(okJsonResponse(sandbox, makeQueryIndex()))
          .onSecondCall()
          .resolves(okJsonResponse(sandbox, { data: [r1, r2] }))
          .onThirdCall()
          .resolves(failResponse(sandbox, 500));

        const result = await computeTopicsPaginated(SITE_ID, { env, log });
        expect(log.warn).to.have.been.calledWithMatch(/Failed to fetch data for/);
        expect(result.length).to.be.at.least(1);
      });
    });

    it('continues when one file fetch returns null and another succeeds', async () => {
      const qi = makeQueryIndex(['copilot', 'gemini']);
      const row = makeBrandPresenceRow({ Topics: 'T', Category: '', Prompt: 'x' });
      mockFetch
        .onFirstCall()
        .resolves(okJsonResponse(sandbox, qi))
        .onSecondCall()
        .resolves(failResponse(sandbox, 404))
        .onThirdCall()
        .resolves(okJsonResponse(sandbox, { data: [row] }));

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result).to.have.lengthOf(1);
    });

    it('logs and continues when fetchBrandPresenceData throws for a file', async () => {
      const qi = makeQueryIndex(['copilot', 'gemini']);
      const row = makeBrandPresenceRow({ Topics: 'T' });
      mockFetch
        .onFirstCall()
        .resolves(okJsonResponse(sandbox, qi))
        .onSecondCall()
        .rejects(new Error('boom'))
        .onThirdCall()
        .resolves(okJsonResponse(sandbox, { data: [row] }));

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(log.error).to.have.been.calledWithMatch(/Error fetching brand presence file/);
      expect(result).to.have.lengthOf(1);
    });

    it('normalizes youtu.be watch URLs and classifies youtube domain', async () => {
      setupQueryIndexAndData([makeBrandPresenceRow({
        Sources: 'https://www.youtube.com/watch?v=abc123',
        Topics: 'Vid',
        Category: 'C',
        Prompt: 'P',
      })]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result[0].urls[0].url).to.equal('https://youtu.be/abc123');
    });

    it('handles youtube watch without video id using origin pathname', async () => {
      setupQueryIndexAndData([makeBrandPresenceRow({
        Sources: 'https://www.youtube.com/watch',
        Topics: 'Vid',
        Category: undefined,
        Prompt: undefined,
      })]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result[0].urls[0].url).to.match(/youtube\.com\/watch$/);
    });

    it('maps youtu.be hostname through DOMAIN_ALIASES', async () => {
      setupQueryIndexAndData([makeBrandPresenceRow({
        Sources: 'https://youtu.be/xyz789',
        Topics: 'Short',
        Category: undefined,
        Prompt: undefined,
      })]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result[0].urls[0].url).to.equal('https://youtu.be/xyz789');
    });

    it('strips trailing slash from normalized URLs (non-root path)', async () => {
      setupQueryIndexAndData([makeBrandPresenceRow({
        Sources: 'https://www.reddit.com/r/foo/',
        Topics: 'Trailing',
        Category: undefined,
        Prompt: undefined,
      })]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result[0].urls[0].url).to.equal('https://www.reddit.com/r/foo');
    });

    it('includes generic (non-offsite) normalized URLs', async () => {
      setupQueryIndexAndData([makeBrandPresenceRow({
        Sources: 'https://news.example.com/story',
        Topics: 'News',
        Category: undefined,
        Prompt: undefined,
      })]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result[0].urls[0].url).to.equal('https://news.example.com/story');
    });

    it('merges duplicate trackTopicUrl entries for same url (subPrompts set)', async () => {
      setupQueryIndexAndData([
        makeBrandPresenceRow({ Sources: 'https://www.reddit.com/r/same', Topics: 'T', Prompt: 'a' }),
        makeBrandPresenceRow({ Sources: 'https://www.reddit.com/r/same', Topics: 'T', Prompt: 'b' }),
      ]);

      const result = await computeTopicsFromBrandPresence(SITE_ID, { env, log });
      expect(result[0].urls[0].subPrompts.sort()).to.deep.equal(['a', 'b']);
    });
  });
});
