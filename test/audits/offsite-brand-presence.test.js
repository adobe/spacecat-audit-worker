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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import {
  DRS_TOP_URLS_LIMIT,
  FETCH_PAGE_SIZE,
  INCLUDE_COLUMNS,
  PROVIDERS,
  REDDIT_COMMENTS_DAYS_BACK,
  filterBrandPresenceFiles,
} from '../../src/offsite-brand-presence/handler.js';
import * as handlerConstants from '../../src/offsite-brand-presence/constants.js';

use(sinonChai);

const DEFAULT_WEEK = 7;
const DEFAULT_YEAR = 2026;

describe('Offsite Brand Presence Handler', () => {
  let sandbox;
  let mockFetch;
  let mockIsoCalendarWeek;
  let mockGetImsOrgId;
  let offsiteBrandPresenceRunner;
  let handlerDefault;

  let site;
  let context;
  let env;
  let log;
  let dataAccess;

  const FINAL_URL = 'https://example.com';
  const SITE_ID = 'site-123';
  const BASE_URL = 'https://example.com';
  const ORG_ID = 'org-456';
  const IMS_ORG_ID = 'ims-org-789@AdobeOrg';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockFetch = sandbox.stub();
    mockIsoCalendarWeek = sandbox.stub().returns({ week: DEFAULT_WEEK, year: DEFAULT_YEAR });
    mockGetImsOrgId = sandbox.stub().resolves(IMS_ORG_ID);

    const mod = await esmock('../../src/offsite-brand-presence/handler.js', {
      '@adobe/spacecat-shared-utils': {
        isoCalendarWeek: mockIsoCalendarWeek,
        tracingFetch: mockFetch,
      },
      '../../src/utils/data-access.js': {
        getImsOrgId: mockGetImsOrgId,
      },
    });

    offsiteBrandPresenceRunner = mod.offsiteBrandPresenceRunner;
    handlerDefault = mod.default;

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    env = {
      SPACECAT_API_URI: 'https://spacecat.api.example.com',
      SPACECAT_API_KEY: 'test-api-key',
      DRS_API_URL: 'https://drs.api.example.com',
      DRS_API_KEY: 'test-drs-key',
    };

    dataAccess = {
      Organization: {
        findById: sandbox.stub().resolves({
          getImsOrgId: () => IMS_ORG_ID,
        }),
      },
      AuditUrl: {
        findBySiteIdAndUrl: sandbox.stub().resolves(null),
        create: sandbox.stub().resolves({}),
      },
    };

    site = {
      getId: sandbox.stub().returns(SITE_ID),
      getBaseURL: sandbox.stub().returns(BASE_URL),
      getOrganizationId: sandbox.stub().returns(ORG_ID),
      getDeliveryType: sandbox.stub().returns('aem_edge'),
      getConfig: sandbox.stub().returns({
        getCompanyName: sandbox.stub().returns('Example Corp'),
      }),
    };

    context = { dataAccess, env, log };
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ----- Helpers -----

  function stubFetchSequence(responses) {
    for (let i = 0; i < responses.length; i += 1) {
      mockFetch.onCall(i).resolves(responses[i]);
    }
  }

  function okJsonResponse(body) {
    return {
      ok: true,
      json: sandbox.stub().resolves(body),
      text: sandbox.stub().resolves(JSON.stringify(body)),
    };
  }

  function failResponse(status, statusText = 'Error') {
    return {
      ok: false,
      status,
      statusText,
      text: sandbox.stub().resolves(statusText),
    };
  }

  function makeBrandPresenceData(sources) {
    return {
      data: sources.map((s) => ({
        Sources: s,
        Region: 'US',
        Mentions: 'true',
        Citations: 'true',
      })),
    };
  }

  function makeQueryIndex(providers = PROVIDERS, week = DEFAULT_WEEK, year = DEFAULT_YEAR) {
    return {
      data: providers.map((p) => ({
        path: `/adobe/brand-presence/w${week}/brandpresence-${p}-w${week}-${year}-010126.json`,
      })),
    };
  }

  function expectedFilePath(providerId, week = DEFAULT_WEEK, year = DEFAULT_YEAR) {
    return `brand-presence/w${week}/brandpresence-${providerId}-w${week}-${year}-010126.json`;
  }

  function stubProviderData(sources) {
    return okJsonResponse(makeBrandPresenceData(sources));
  }

  /**
   * Build fetch responses: query-index + providers + DRS jobs.
   * URL store is handled via dataAccess (not fetch), so no urlStoreResponse needed.
   */
  function buildHappyResponses({
    queryIndex = null,
    providerResponses = null,
    drsResponses = [],
    week = DEFAULT_WEEK,
    year = DEFAULT_YEAR,
  } = {}) {
    const qi = queryIndex || makeQueryIndex(PROVIDERS, week, year);
    const responses = [];
    responses.push(okJsonResponse(qi));
    if (providerResponses) {
      responses.push(...providerResponses);
    } else {
      for (const _ of (qi.data || [])) {
        responses.push(okJsonResponse({}));
      }
    }
    responses.push(...drsResponses);
    return responses;
  }

  // ----- Tests -----

  describe('Default Export', () => {
    it('should export a valid audit handler with runner and urlResolver', () => {
      expect(handlerDefault).to.be.an('object');
      expect(handlerDefault.runner).to.be.a('function');
      expect(handlerDefault.urlResolver).to.be.a('function');
    });
  });

  describe('Environment Validation', () => {
    it('should return error when SPACECAT_API_URI or SPACECAT_API_KEY is missing', async () => {
      delete env.SPACECAT_API_URI;

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('SPACECAT_API_URI or SPACECAT_API_KEY not configured');
      expect(result.fullAuditRef).to.equal(FINAL_URL);
      expect(mockFetch).to.not.have.been.called;
      expect(log.error).to.have.been.calledWith(
        sinon.match(/SPACECAT_API_URI or SPACECAT_API_KEY not configured/),
      );
    });
  });

  describe('Query Index Fetch', () => {
    it('should return error when query-index fetch fails', async () => {
      mockFetch.resolves(failResponse(500, 'Internal Server Error'));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Failed to fetch query-index');
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to fetch query-index: 500/),
      );
    });

    it('should return error when query-index fetch throws a network error', async () => {
      mockFetch.rejects(new Error('DNS resolution failed'));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Failed to fetch query-index');
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Error fetching query-index: DNS resolution failed/),
      );
    });

    it('should use correct API URL and headers for query-index fetch', async () => {
      mockFetch.resolves(failResponse(500));

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const [url, options] = mockFetch.firstCall.args;
      expect(url).to.equal(
        `${env.SPACECAT_API_URI}/sites/${SITE_ID}/llmo/data/query-index.json`,
      );
      expect(options.headers).to.deep.equal({
        'x-api-key': env.SPACECAT_API_KEY,
      });
    });
  });

  describe('Query Index Filtering', () => {
    it('should match files with single and double-digit week indices', () => {
      const qi = { data: [
        { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' },
        { path: '/adobe/brand-presence/w12/brandpresence-perplexity-w12-2026-030326.json' },
      ] };
      const singleDigit = filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR);
      expect(singleDigit).to.have.lengthOf(1);
      expect(singleDigit[0]).to.equal('brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json');

      const doubleDigit = filterBrandPresenceFiles(qi, 12, DEFAULT_YEAR);
      expect(doubleDigit).to.have.lengthOf(1);
      expect(doubleDigit[0]).to.include('perplexity');
    });

    it('should filter by week and year', () => {
      const qi = {
        data: [
          { path: '/adobe/brand-presence/w6/brandpresence-chatgpt-w6-2026-020226.json' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2025-301225.json' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' },
        ],
      };
      const result = filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('w7');
      expect(result[0]).to.include('2026');
    });

    it('should filter out files for unknown providers', () => {
      const qi = {
        data: [
          { path: '/adobe/brand-presence/w7/brandpresence-unknown-provider-w7-2026-010126.json' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' },
        ],
      };
      const result = filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('chatgpt');
    });

    it('should handle provider IDs with hyphens (google-ai-overview)', () => {
      const qi = { data: [{ path: '/adobe/brand-presence/w7/brandpresence-google-ai-overview-w7-2026-010126.json' }] };
      const result = filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('google-ai-overview');
    });

    it('should reject entries that do not match the brand-presence filename pattern', () => {
      const qi = {
        data: [
          { name: 'no-path' },
          { path: '/adobe/query-index.json' },
          { path: '/adobe/other-data/report.json' },
          { path: '/adobe/agentic-traffic/agentictraffic-w07-2026.json' },
          { path: '/adobe/brand-presence/w7/summary-report-w7.json' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.csv' },
          { path: '/adobe/brand-presence/w7/' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' },
        ],
      };
      const result = filterBrandPresenceFiles(qi, DEFAULT_WEEK, DEFAULT_YEAR);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('chatgpt');
    });

    it('should return empty array when query-index has no data', () => {
      expect(filterBrandPresenceFiles({}, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
      expect(filterBrandPresenceFiles({ data: [] }, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
      expect(filterBrandPresenceFiles(null, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('should only fetch providers present in query-index, not all PROVIDERS', async () => {
      const qi = makeQueryIndex(['chatgpt', 'perplexity']);
      const responses = buildHappyResponses({
        queryIndex: qi,
        providerResponses: [okJsonResponse({}), okJsonResponse({})],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(mockFetch.callCount).to.equal(3);
      expect(result.auditResult.success).to.be.true;
    });

    it('should complete successfully when query-index has no matching files', async () => {
      const qi = { data: [{ path: '/adobe/other/report.json' }] };
      const responses = buildHappyResponses({ queryIndex: qi });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(mockFetch.callCount).to.equal(1);
      expect(result.auditResult.success).to.be.true;
    });
  });

  describe('Provider Data Fetching', () => {
    it('should fetch data for all providers found in query-index', async () => {
      const responses = buildHappyResponses();
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(mockFetch.callCount).to.be.at.least(1 + PROVIDERS.length);

      for (const provider of PROVIDERS) {
        const called = mockFetch.getCalls().some(
          (call) => call.args[0].includes(expectedFilePath(provider)),
        );
        expect(called, `Expected fetch for provider ${provider}`).to.be.true;
      }
    });

    it('should use file name from query-index in fetch URL', async () => {
      const responses = buildHappyResponses();
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const providerCall = mockFetch.getCalls().find(
        (call) => call.args[0].includes('brandpresence-'),
      );
      expect(providerCall.args[0]).to.equal(
        `${env.SPACECAT_API_URI}/sites/${SITE_ID}/llmo/data/${expectedFilePath(PROVIDERS[0])}?sheet=all&include=${INCLUDE_COLUMNS}&limit=${FETCH_PAGE_SIZE}&offset=0`,
      );
    });

    it('should handle provider returning non-ok response gracefully', async () => {
      const providerResponses = [
        failResponse(404),
        okJsonResponse({}),
        okJsonResponse({}),
        okJsonResponse({}),
        okJsonResponse({}),
        okJsonResponse({}),
        okJsonResponse({}),
      ];
      const responses = buildHappyResponses({ providerResponses });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
    });

    it('should handle provider throwing an exception gracefully', async () => {
      mockFetch.onCall(0).resolves(okJsonResponse(makeQueryIndex()));
      mockFetch.onCall(1).rejects(new Error('Network timeout'));
      for (let i = 2; i <= PROVIDERS.length; i += 1) {
        mockFetch.onCall(i).resolves(okJsonResponse({}));
      }

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Error fetching brand presence file/),
      );
    });

    it('should report correct aggregated url counts', async () => {
      const providerResponses = [
        stubProviderData(['https://www.youtube.com/watch?v=abc']),
        stubProviderData([]),
        stubProviderData(['https://reddit.com/r/test']),
        okJsonResponse({}),
        okJsonResponse({}),
        okJsonResponse({}),
        okJsonResponse({}),
      ];
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
          okJsonResponse({ jobId: 'j3' }),
          okJsonResponse({ jobId: 'j4' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

  });

  describe('Pagination', () => {
    const TEST_PAGE_SIZE = 3;
    let paginationRunner;

    beforeEach(async () => {
      const mod = await esmock('../../src/offsite-brand-presence/handler.js', {
        '@adobe/spacecat-shared-utils': {
          isoCalendarWeek: mockIsoCalendarWeek,
          tracingFetch: mockFetch,
        },
        '../../src/utils/data-access.js': {
          getImsOrgId: mockGetImsOrgId,
        },
        '../../src/offsite-brand-presence/constants.js': {
          ...handlerConstants,
          FETCH_PAGE_SIZE: TEST_PAGE_SIZE,
        },
      });
      paginationRunner = mod.offsiteBrandPresenceRunner;
    });

    it('should paginate when a page returns exactly FETCH_PAGE_SIZE rows', async () => {
      const qi = makeQueryIndex(['chatgpt']);

      const page1Rows = new Array(TEST_PAGE_SIZE).fill({});
      page1Rows[0] = {
        Sources: 'https://youtube.com/shorts/p1', Region: 'US', Mentions: 'true', Citations: 'true',
      };
      const page1Response = okJsonResponse({ data: page1Rows });

      const page2Response = okJsonResponse({
        data: [{
          Sources: 'https://reddit.com/r/p2', Region: 'US', Mentions: 'true', Citations: 'true',
        }],
      });

      mockFetch.onCall(0).resolves(okJsonResponse(qi));
      mockFetch.onCall(1).resolves(page1Response);
      mockFetch.onCall(2).resolves(page2Response);
      mockFetch.onCall(3).resolves(okJsonResponse({ jobId: 'j1' }));
      mockFetch.onCall(4).resolves(okJsonResponse({ jobId: 'j2' }));
      mockFetch.onCall(5).resolves(okJsonResponse({ jobId: 'j3' }));
      mockFetch.onCall(6).resolves(okJsonResponse({ jobId: 'j4' }));

      const result = await paginationRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
      expect(mockFetch.callCount).to.equal(7);
    });

    it('should return partial data when a subsequent page fails during pagination', async () => {
      const qi = makeQueryIndex(['chatgpt']);

      const page1Rows = new Array(TEST_PAGE_SIZE).fill({});
      page1Rows[0] = {
        Sources: 'https://youtube.com/shorts/p1', Region: 'US', Mentions: 'true', Citations: 'true',
      };
      const page1Response = okJsonResponse({ data: page1Rows });

      mockFetch.onCall(0).resolves(okJsonResponse(qi));
      mockFetch.onCall(1).resolves(page1Response);
      mockFetch.onCall(2).resolves(failResponse(500, 'Internal Server Error'));
      mockFetch.onCall(3).resolves(okJsonResponse({ jobId: 'j1' }));
      mockFetch.onCall(4).resolves(okJsonResponse({ jobId: 'j2' }));

      const result = await paginationRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to fetch data for/),
        sinon.match.object,
      );
    });
  });

  describe('URL Extraction', () => {
    it('should extract youtube.com and reddit.com URLs including subdomains', async () => {
      const urls = 'https://www.youtube.com/watch?v=x;https://m.reddit.com/r/test';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([urls]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
          okJsonResponse({ jobId: 'j3' }),
          okJsonResponse({ jobId: 'j4' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should handle semicolon, newline, and mixed separators in Sources field', async () => {
      const sources = 'https://youtube.com/shorts/a;https://youtube.com/shorts/b\nhttps://reddit.com/r/test';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([sources]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
          okJsonResponse({ jobId: 'j3' }),
          okJsonResponse({ jobId: 'j4' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should ignore invalid, malformed, and unrecognized URLs without crashing', async () => {
      const sources = 'not-a-url;https://youtube.com/v1;;  ;ftp://weird;https:///path;://nohost;plain-text';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([sources]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should count URL occurrences across rows and providers', async () => {
      const sharedUrl = 'https://www.youtube.com/watch?v=shared';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i < 3) return stubProviderData([sharedUrl]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // Same URL from 3 providers: 1 unique URL, but counted 3 times
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should handle rows without Sources field', async () => {
      const data = {
        data: [
          {
            Prompt: 'test prompt', Region: 'US', Mentions: 'true', Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/v1', Region: 'US', Mentions: 'true', Citations: 'true',
          },
        ],
      };
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return okJsonResponse(data);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should only extract URLs with Region=US, Mentions=true, Citations=true', async () => {
      const data = {
        data: [
          {
            Sources: 'https://youtube.com/v1', Region: 'EU', Mentions: 'true', Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/v2', Region: 'US', Mentions: 'false', Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/v3', Region: 'US', Mentions: 'true', Citations: 'false',
          },
          {
            Sources: 'https://reddit.com/r/ok', Region: 'US', Mentions: 'true', Citations: 'true',
          },
        ],
      };
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return okJsonResponse(data);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should handle response with missing data array', async () => {
      const data = {};
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return okJsonResponse(data);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({ providerResponses });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
    });

    it('should ignore non-offsite and substring-matching domains', async () => {
      const sources = 'https://google.com/search;https://notyoutube.com/watch;https://fakereddit.com/r/test;https://twitter.com/post';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([sources]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({ providerResponses });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
    });
  });

  describe('URL Normalization', () => {
    it('should normalize youtube.com/watch URLs to youtu.be short form', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://www.youtube.com/watch?v=abc123']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );
      const videosCall = drsCalls.find((c) => {
        const body = JSON.parse(c.args[1].body);
        return body.parameters.dataset_id === 'youtube_videos';
      });
      const body = JSON.parse(videosCall.args[1].body);
      expect(body.parameters.urls).to.deep.equal(['https://youtu.be/abc123']);
    });

    it('should keep youtube.com/shorts URLs as-is (strip query params only)', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://www.youtube.com/shorts/xyz?feature=share']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );
      const videosCall = drsCalls.find((c) => {
        const body = JSON.parse(c.args[1].body);
        return body.parameters.dataset_id === 'youtube_videos';
      });
      const body = JSON.parse(videosCall.args[1].body);
      expect(body.parameters.urls).to.deep.equal(['https://www.youtube.com/shorts/xyz']);
    });

    it('should normalize youtu.be short URLs via domain alias', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtu.be/shortId']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );
      expect(drsCalls.length).to.be.at.least(1);
    });

    it('should strip trailing slash and query parameters from reddit URLs', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://reddit.com/r/test/post/?utm_source=share']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );
      const postsCall = drsCalls.find((c) => {
        const body = JSON.parse(c.args[1].body);
        return body.parameters.dataset_id === 'reddit_posts';
      });
      const body = JSON.parse(postsCall.args[1].body);
      expect(body.parameters.urls[0]).to.equal('https://reddit.com/r/test/post');
    });
  });

  describe('No URLs Found', () => {
    it('should return success with zero counts and skip URL store and DRS', async () => {
      const responses = buildHappyResponses();
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
      expect(result.fullAuditRef).to.equal(FINAL_URL);
      expect(log.info).to.have.been.calledWith(
        sinon.match(/No offsite URLs found/),
      );
      expect(mockFetch.callCount).to.equal(1 + PROVIDERS.length);
      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
    });
  });

  describe('URL Store Integration', () => {
    function setupWithYoutubeUrl() {
      return new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/watch?v=test']);
        return okJsonResponse({});
      });
    }

    it('should add URLs to URL store via dataAccess', async () => {
      const providerResponses = setupWithYoutubeUrl();
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.findBySiteIdAndUrl).to.have.been.calledWith(
        SITE_ID,
        'https://youtu.be/test',
      );
      expect(dataAccess.AuditUrl.create).to.have.been.calledOnce;
      const createArg = dataAccess.AuditUrl.create.firstCall.args[0];
      expect(createArg.siteId).to.equal(SITE_ID);
      expect(createArg.url).to.equal('https://youtu.be/test');
      expect(createArg.byCustomer).to.equal(false);
      expect(createArg.audits).to.deep.equal(['youtube-analysis']);
    });

    it('should skip existing URLs in URL store', async () => {
      dataAccess.AuditUrl.findBySiteIdAndUrl.resolves({ url: 'existing' });

      const providerResponses = setupWithYoutubeUrl();
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith(
        sinon.match(/0 created, 1 skipped/),
      );
    });

    it('should handle URL store create failure gracefully', async () => {
      dataAccess.AuditUrl.create.rejects(new Error('DynamoDB error'));

      const providerResponses = setupWithYoutubeUrl();
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to add URL to store/),
      );
      expect(log.info).to.have.been.calledWith(
        sinon.match(/0 created, 0 skipped, 1 failed/),
      );
    });

    it('should handle URL store findBySiteIdAndUrl failure gracefully', async () => {
      dataAccess.AuditUrl.findBySiteIdAndUrl.rejects(new Error('Lookup error'));

      const providerResponses = setupWithYoutubeUrl();
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to add URL to store/),
      );
    });

    it('should add URLs for multiple domains to URL store', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/shorts/a;https://reddit.com/r/test']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
          okJsonResponse({ jobId: 'j3' }),
          okJsonResponse({ jobId: 'j4' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.create).to.have.been.calledTwice;

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const auditTypes = createCalls.map((c) => c.args[0].audits[0]);
      expect(auditTypes).to.include('youtube-analysis');
      expect(auditTypes).to.include('reddit-analysis');
    });

  });

  describe('Top URLs Per Domain', () => {
    it('should limit DRS to top-N URLs but send all to URL store', async () => {
      const urls = [];
      for (let i = 0; i < 25; i += 1) {
        urls.push(`https://youtube.com/shorts/vid${i}`);
      }
      const sources = urls.join(';');
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([sources]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(25);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );
      const videosCall = drsCalls.find((c) => {
        const body = JSON.parse(c.args[1].body);
        return body.parameters.dataset_id === 'youtube_videos';
      });
      const body = JSON.parse(videosCall.args[1].body);
      expect(body.parameters.urls).to.have.lengthOf(DRS_TOP_URLS_LIMIT);
      expect(dataAccess.AuditUrl.create.callCount).to.equal(25);
    });

    it('should select most frequent URLs for DRS when counts differ', async () => {
      const data = {
        data: [
          {
            Sources: 'https://youtube.com/shorts/popular',
            Region: 'US',
            Mentions: 'true',
            Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/shorts/popular',
            Region: 'US',
            Mentions: 'true',
            Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/shorts/rare',
            Region: 'US',
            Mentions: 'true',
            Citations: 'true',
          },
        ],
      };
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return okJsonResponse(data);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
    });
  });

  describe('DRS Scraping', () => {
    it('should trigger DRS jobs for youtube (2 datasets) and reddit (2 datasets)', async () => {
      const urls = 'https://youtube.com/shorts/v1;https://reddit.com/r/test';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([urls]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'yt-videos' }),
          okJsonResponse({ jobId: 'yt-comments' }),
          okJsonResponse({ jobId: 'rd-posts' }),
          okJsonResponse({ jobId: 'rd-comments' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs).to.have.lengthOf(4);
      expect(result.auditResult.drsJobs[0]).to.deep.include({
        domain: 'youtube.com',
        datasetId: 'youtube_videos',
        status: 'success',
      });
      expect(result.auditResult.drsJobs[1]).to.deep.include({
        domain: 'youtube.com',
        datasetId: 'youtube_comments',
        status: 'success',
      });
      expect(result.auditResult.drsJobs[2]).to.deep.include({
        domain: 'reddit.com',
        datasetId: 'reddit_posts',
        status: 'success',
      });
      expect(result.auditResult.drsJobs[3]).to.deep.include({
        domain: 'reddit.com',
        datasetId: 'reddit_comments',
        status: 'success',
      });
    });

    it('should include correct payload structure in DRS requests', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/watch?v=x']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );
      expect(drsCalls.length).to.be.at.least(1);

      const [url, options] = drsCalls[0].args;
      expect(url).to.equal(`${env.DRS_API_URL}/jobs`);
      expect(options.method).to.equal('POST');
      expect(options.headers['x-api-key']).to.equal(env.DRS_API_KEY);

      const body = JSON.parse(options.body);
      expect(body.provider_id).to.equal('brightdata');
      expect(body.priority).to.equal('LOW');
      expect(body.parameters.dataset_id).to.equal('youtube_videos');
      expect(body.parameters.urls).to.deep.equal(['https://youtu.be/x']);
      expect(body.parameters.metadata).to.deep.include({
        imsOrgId: IMS_ORG_ID,
        brand: BASE_URL,
        site: 'youtube.com',
      });
    });

    it('should include days_back parameter for reddit.com', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://reddit.com/r/adobe']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );

      const commentsCall = drsCalls.find((c) => {
        const body = JSON.parse(c.args[1].body);
        return body.parameters.dataset_id === 'reddit_comments';
      });
      expect(commentsCall).to.exist;
      const body = JSON.parse(commentsCall.args[1].body);
      expect(body.parameters.days_back).to.equal(REDDIT_COMMENTS_DAYS_BACK);

      const postsCall = drsCalls.find((c) => {
        const b = JSON.parse(c.args[1].body);
        return b.parameters.dataset_id === 'reddit_posts';
      });
      expect(postsCall).to.exist;
      const postsBody = JSON.parse(postsCall.args[1].body);
      expect(postsBody.parameters).to.not.have.property('days_back');
    });

    it('should NOT include days_back parameter for non-reddit domains', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/shorts/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );

      for (const call of drsCalls) {
        const body = JSON.parse(call.args[1].body);
        if (body.parameters.metadata.site === 'youtube.com') {
          expect(body.parameters).to.not.have.property('days_back');
        }
      }
    });

    it('should handle DRS API returning error response', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/shorts/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          failResponse(503, 'Service Unavailable'),
          failResponse(503, 'Service Unavailable'),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.have.lengthOf(2);
      expect(result.auditResult.drsJobs[0].status).to.equal('error');
      expect(result.auditResult.drsJobs[0].statusCode).to.equal(503);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/DRS job failed/),
      );
    });

    it('should handle DRS network error gracefully', async () => {
      mockFetch.onCall(0).resolves(okJsonResponse(makeQueryIndex()));
      mockFetch.onCall(1).resolves(stubProviderData(['https://youtube.com/shorts/v1']));
      for (let i = 2; i <= PROVIDERS.length; i += 1) {
        mockFetch.onCall(i).resolves(okJsonResponse({}));
      }
      const drsStartIdx = 1 + PROVIDERS.length;
      mockFetch.onCall(drsStartIdx).rejects(new Error('DNS resolution failed'));
      mockFetch.onCall(drsStartIdx + 1).rejects(new Error('DNS resolution failed'));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.have.lengthOf(2);
      expect(result.auditResult.drsJobs[0].status).to.equal('error');
      expect(result.auditResult.drsJobs[0].error).to.equal('DNS resolution failed');
    });

    it('should skip DRS when DRS_API_URL or DRS_API_KEY is missing', async () => {
      delete env.DRS_API_URL;

      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/shorts/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({ providerResponses });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.deep.equal([]);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/DRS_API_URL or DRS_API_KEY not configured/),
      );
    });

    it('should use empty string for brand when baseURL is falsy', async () => {
      site.getBaseURL.returns('');

      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/shorts/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );
      const body = JSON.parse(drsCalls[0].args[1].body);
      expect(body.parameters.metadata.brand).to.equal('');
    });

    it('should use empty string for imsOrgId when getImsOrgId returns null', async () => {
      mockGetImsOrgId.resolves(null);

      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/shorts/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const drsCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes(`${env.DRS_API_URL}/jobs`),
      );
      const body = JSON.parse(drsCalls[0].args[1].body);
      expect(body.parameters.metadata.imsOrgId).to.equal('');
    });
  });

  describe('Full Integration Flow', () => {
    it('should complete full audit with URLs from multiple domains', async () => {
      const sources = [
        'https://www.youtube.com/watch?v=abc;https://reddit.com/r/adobe/post1',
        'https://youtube.com/watch?v=def;https://example.com/unrelated',
      ];
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(sources);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        drsResponses: [
          okJsonResponse({ jobId: 'yt-vid' }),
          okJsonResponse({ jobId: 'yt-comm' }),
          okJsonResponse({ jobId: 'rd-post' }),
          okJsonResponse({ jobId: 'rd-comm' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
      expect(result.auditResult.drsJobs).to.have.lengthOf(4);
      expect(result.fullAuditRef).to.equal(FINAL_URL);
      expect(mockGetImsOrgId).to.have.been.calledOnce;
      expect(mockGetImsOrgId).to.have.been.calledWith(site, dataAccess, log);
    });

    it('should include week (zero-padded) and year in the audit result', async () => {
      mockIsoCalendarWeek.returns({ week: 5, year: DEFAULT_YEAR });
      const responses = buildHappyResponses({ week: 5 });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.week).to.equal('05');
      expect(result.auditResult.year).to.equal(DEFAULT_YEAR);
    });

  });
});
