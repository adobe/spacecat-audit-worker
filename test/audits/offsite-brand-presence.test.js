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
import { PROVIDERS, filterBrandPresenceFiles } from '../../src/offsite-brand-presence/handler.js';

use(sinonChai);

const DEFAULT_WEEK = 7;

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
    mockIsoCalendarWeek = sandbox.stub().returns({ week: 7, year: 2026 });
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
      all: {
        data: sources.map((s) => ({ Sources: s })),
      },
    };
  }

  // Generates a query-index response containing brand presence file entries
  function makeQueryIndex(providers = PROVIDERS, week = DEFAULT_WEEK) {
    return {
      data: providers.map((p) => ({
        path: `/adobe/brand-presence/w${week}/brandpresence-${p}-w${week}-2026-010126.json`,
      })),
    };
  }

  // Expected file path for a provider in test query-index data
  function expectedFilePath(providerId, week = DEFAULT_WEEK) {
    return `brand-presence/w${week}/brandpresence-${providerId}-w${week}-2026-010126.json`;
  }

  // Provider data response (one per provider)
  function stubProviderData(sources) {
    return okJsonResponse(makeBrandPresenceData(sources));
  }

  // Build a full set of fetch responses: query-index + providers + url-store + DRS jobs
  function buildHappyResponses({
    queryIndex = null,
    providerResponses = null,
    urlStoreResponse = null,
    drsResponses = [],
    week = DEFAULT_WEEK,
  } = {}) {
    const qi = queryIndex || makeQueryIndex(PROVIDERS, week);
    const responses = [];
    // 1. Query-index
    responses.push(okJsonResponse(qi));
    // 2. Provider data responses (one per matched file)
    if (providerResponses) {
      responses.push(...providerResponses);
    } else {
      for (const _ of (qi.data || [])) {
        responses.push(okJsonResponse({}));
      }
    }
    // 3. URL store response (POST)
    if (urlStoreResponse) {
      responses.push(urlStoreResponse);
    }
    // 4. DRS responses
    responses.push(...drsResponses);
    return responses;
  }

  // ----- Tests -----

  describe('Default Export', () => {
    it('should export a valid audit handler object', () => {
      expect(handlerDefault).to.be.an('object');
      expect(handlerDefault).to.have.property('runner');
      expect(handlerDefault.runner).to.be.a('function');
    });

    it('should have URL resolver configured', () => {
      expect(handlerDefault).to.have.property('urlResolver');
      expect(handlerDefault.urlResolver).to.be.a('function');
    });
  });

  describe('Environment Validation', () => {
    it('should return error when SPACECAT_API_URI is missing', async () => {
      delete env.SPACECAT_API_URI;

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('SPACECAT_API_URI or SPACECAT_API_KEY not configured');
      expect(result.fullAuditRef).to.equal(FINAL_URL);
      expect(mockFetch).to.not.have.been.called;
    });

    it('should return error when SPACECAT_API_KEY is missing', async () => {
      delete env.SPACECAT_API_KEY;

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('SPACECAT_API_URI or SPACECAT_API_KEY not configured');
      expect(mockFetch).to.not.have.been.called;
    });

    it('should return error when both SPACECAT_API_URI and SPACECAT_API_KEY are missing', async () => {
      env.SPACECAT_API_URI = '';
      env.SPACECAT_API_KEY = '';

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.false;
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

    it('should return error when query-index returns 404', async () => {
      mockFetch.resolves(failResponse(404, 'Not Found'));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Failed to fetch query-index');
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
        'Content-Type': 'application/json',
        'x-api-key': env.SPACECAT_API_KEY,
      });
    });
  });

  describe('Query Index Filtering', () => {
    it('should match files with single-digit week index', () => {
      const qi = { data: [{ path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' }] };
      const result = filterBrandPresenceFiles(qi, 7);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.equal('brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json');
    });

    it('should match files with double-digit week index', () => {
      const qi = { data: [{ path: '/adobe/brand-presence/w12/brandpresence-perplexity-w12-2026-030326.json' }] };
      const result = filterBrandPresenceFiles(qi, 12);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('perplexity');
    });

    it('should filter out files for a different week', () => {
      const qi = {
        data: [
          { path: '/adobe/brand-presence/w6/brandpresence-chatgpt-w6-2026-020226.json' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' },
        ],
      };
      const result = filterBrandPresenceFiles(qi, 7);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('w7');
    });

    it('should filter out files for unknown providers', () => {
      const qi = {
        data: [
          { path: '/adobe/brand-presence/w7/brandpresence-unknown-provider-w7-2026-010126.json' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' },
        ],
      };
      const result = filterBrandPresenceFiles(qi, 7);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('chatgpt');
    });

    it('should handle provider IDs with hyphens (google-ai-overview)', () => {
      const qi = { data: [{ path: '/adobe/brand-presence/w7/brandpresence-google-ai-overview-w7-2026-010126.json' }] };
      const result = filterBrandPresenceFiles(qi, 7);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('google-ai-overview');
    });

    it('should ignore entries without a path', () => {
      const qi = { data: [{ name: 'no-path' }, { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' }] };
      const result = filterBrandPresenceFiles(qi, 7);
      expect(result).to.have.lengthOf(1);
    });

    it('should ignore non-brand-presence files', () => {
      const qi = {
        data: [
          { path: '/adobe/query-index.json' },
          { path: '/adobe/other-data/report.json' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' },
        ],
      };
      const result = filterBrandPresenceFiles(qi, 7);
      expect(result).to.have.lengthOf(1);
    });

    it('should skip files in brand-presence/ that do not match the filename pattern', () => {
      const qi = {
        data: [
          { path: '/adobe/agentic-traffic/agentictraffic-w07-2026.json' },
          { path: '/adobe/brand-presence/w7/summary-report-w7.json' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.csv' },
          { path: '/adobe/brand-presence/w7/' },
          { path: '/adobe/brand-presence/w7/brandpresence-chatgpt-w7-2026-010126.json' },
        ],
      };
      const result = filterBrandPresenceFiles(qi, 7);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('chatgpt');
    });

    it('should return empty array when query-index has no data', () => {
      expect(filterBrandPresenceFiles({}, 7)).to.deep.equal([]);
      expect(filterBrandPresenceFiles({ data: [] }, 7)).to.deep.equal([]);
      expect(filterBrandPresenceFiles(null, 7)).to.deep.equal([]);
    });

    it('should only fetch providers present in query-index, not all PROVIDERS', async () => {
      // Query-index only has 2 providers
      const qi = makeQueryIndex(['chatgpt', 'perplexity']);
      const responses = buildHappyResponses({
        queryIndex: qi,
        providerResponses: [okJsonResponse({}), okJsonResponse({})],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // query-index + 2 provider fetches only
      expect(mockFetch.callCount).to.equal(3);
      expect(result.auditResult.success).to.be.true;
    });

    it('should complete successfully when query-index has no matching files', async () => {
      const qi = { data: [{ path: '/adobe/other/report.json' }] };
      const responses = buildHappyResponses({ queryIndex: qi });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // Only 1 call: query-index (no provider fetches)
      expect(mockFetch.callCount).to.equal(1);
      expect(result.auditResult.success).to.be.true;
    });
  });

  describe('Provider Data Fetching', () => {
    it('should fetch data for all providers found in query-index', async () => {
      const responses = buildHappyResponses();
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // 1 query-index + all providers
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
        `${env.SPACECAT_API_URI}/sites/${SITE_ID}/llmo/data/${expectedFilePath(PROVIDERS[0])}`,
      );
    });

    it('should handle provider returning non-ok response gracefully', async () => {
      const providerResponses = [
        failResponse(404), // ai-mode fails
        okJsonResponse({}), // all
        okJsonResponse({}), // chatgpt
        okJsonResponse({}), // copilot
        okJsonResponse({}), // gemini
        okJsonResponse({}), // google-ai-overview
        okJsonResponse({}), // perplexity
      ];
      const responses = buildHappyResponses({ providerResponses });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
    });

    it('should handle provider throwing an exception gracefully', async () => {
      mockFetch.onCall(0).resolves(okJsonResponse(makeQueryIndex())); // query-index
      mockFetch.onCall(1).rejects(new Error('Network timeout')); // ai-mode
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
        stubProviderData(['https://www.youtube.com/watch?v=abc']), // ai-mode
        stubProviderData([]), // all
        stubProviderData(['https://reddit.com/r/test']), // chatgpt
        okJsonResponse({}), // copilot - empty data
        okJsonResponse({}), // gemini
        okJsonResponse({}), // google-ai-overview
        okJsonResponse({}), // perplexity
      ];
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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

  describe('URL Extraction', () => {
    it('should extract youtube.com URLs from Sources', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://www.youtube.com/watch?v=abc123']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should extract reddit.com URLs from Sources', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://www.reddit.com/r/adobe/post1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should extract wikipedia.com URLs from Sources', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://en.wikipedia.com/wiki/Adobe_Inc.']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['wikipedia.com']).to.equal(1);
    });

    it('should match subdomains (www.youtube.com, m.reddit.com)', async () => {
      const urls = [
        'https://www.youtube.com/watch?v=x',
        'https://m.reddit.com/r/test',
        'https://en.wikipedia.com/wiki/Test',
      ].join(';');

      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([urls]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
          okJsonResponse({ jobId: 'j3' }),
          okJsonResponse({ jobId: 'j4' }),
          okJsonResponse({ jobId: 'j5' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
      expect(result.auditResult.urlCounts['wikipedia.com']).to.equal(1);
    });

    it('should handle semicolon-separated URLs in Sources field', async () => {
      const sources = 'https://youtube.com/v1;https://reddit.com/r/test;https://example.com/page';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([sources]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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
      // example.com is not an offsite domain
      expect(result.auditResult.urlCounts['wikipedia.com']).to.equal(0);
    });

    it('should ignore invalid URLs without crashing', async () => {
      const sources = 'not-a-url;https://youtube.com/v1;;  ;ftp://weird';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([sources]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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

    it('should ignore URLs with empty or missing hostname', async () => {
      const sources = 'https:///path;://nohost;plain-text;https://youtube.com/v1';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([sources]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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

    it('should ignore URLs that do not match offsite domains', async () => {
      const sources = 'https://google.com/search;https://adobe.com/products;https://twitter.com/post';
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
      expect(result.auditResult.urlCounts['wikipedia.com']).to.equal(0);
    });

    it('should deduplicate URLs across multiple providers', async () => {
      const sharedUrl = 'https://www.youtube.com/watch?v=shared';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i < 3) return stubProviderData([sharedUrl]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // Same URL from 3 providers should only count once
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should handle rows without Sources field', async () => {
      const data = {
        all: {
          data: [
            { Prompt: 'test prompt' }, // no Sources field
            { Sources: 'https://youtube.com/v1' },
          ],
        },
      };
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return okJsonResponse(data);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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

    it('should handle missing "all" sheet gracefully', async () => {
      const data = {
        other: { data: [{ Sources: 'https://reddit.com/r/test' }] },
      };
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return okJsonResponse(data);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({ providerResponses });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
    });

    it('should handle "all" sheet with missing data array', async () => {
      const data = { all: {} };
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

    it('should extract URLs from real brand presence structure with provider-keyed sheets', async () => {
      const data = {
        all: {
          data: [
            { Sources: 'https://www.youtube.com/watch?v=abc;https://reddit.com/r/adobe' },
            { Sources: 'https://en.wikipedia.com/wiki/Adobe' },
          ],
        },
      };
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return okJsonResponse(data);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
          okJsonResponse({ jobId: 'j3' }),
          okJsonResponse({ jobId: 'j4' }),
          okJsonResponse({ jobId: 'j5' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
      expect(result.auditResult.urlCounts['wikipedia.com']).to.equal(1);
    });

    it('should not match a domain that merely contains the offsite domain as substring', async () => {
      // notyoutube.com should NOT match youtube.com
      const sources = 'https://notyoutube.com/watch;https://fakereddit.com/r/test';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([sources]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({ providerResponses });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
    });
  });

  describe('No URLs Found', () => {
    it('should return success with zero counts when no offsite URLs found', async () => {
      const responses = buildHappyResponses();
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
      expect(result.auditResult.urlCounts['wikipedia.com']).to.equal(0);
      expect(result.fullAuditRef).to.equal(FINAL_URL);
      expect(log.info).to.have.been.calledWith(
        sinon.match(/No offsite URLs found/),
      );
    });

    it('should not call URL store or DRS when no URLs found', async () => {
      const responses = buildHappyResponses();
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // Only query-index + provider fetches
      expect(mockFetch.callCount).to.equal(1 + PROVIDERS.length);
    });

    it('should still include week and year when no URLs found', async () => {
      const responses = buildHappyResponses();
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.week).to.be.a('string');
      expect(result.auditResult.year).to.be.a('number');
    });
  });

  describe('URL Store Integration', () => {
    function setupWithYoutubeUrl() {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/watch?v=test']);
        return okJsonResponse({});
      });
      return providerResponses;
    }

    it('should add URLs to URL store with correct audit types', async () => {
      const providerResponses = setupWithYoutubeUrl();
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // Find the URL store call (POST to /url-store)
      const urlStoreCall = mockFetch.getCalls().find(
        (call) => call.args[0].includes('/url-store'),
      );
      expect(urlStoreCall).to.exist;

      const [url, options] = urlStoreCall.args;
      expect(url).to.equal(`${env.SPACECAT_API_URI}/sites/${SITE_ID}/url-store`);
      expect(options.method).to.equal('POST');
      expect(options.headers['x-api-key']).to.equal(env.SPACECAT_API_KEY);

      const body = JSON.parse(options.body);
      expect(body).to.be.an('array');
      expect(body[0]).to.deep.include({
        url: 'https://youtube.com/watch?v=test',
        byCustomer: false,
      });
      expect(body[0].audits).to.include('youtube-analysis');
    });

    it('should handle URL store API failure gracefully', async () => {
      const providerResponses = setupWithYoutubeUrl();
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: failResponse(500, 'Internal Server Error'),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // Should continue and still trigger DRS even if URL store fails
      expect(result.auditResult.success).to.be.true;
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to add URLs to URL store/),
      );
    });

    it('should handle URL store network error gracefully', async () => {
      // query-index + providers
      mockFetch.onCall(0).resolves(okJsonResponse(makeQueryIndex()));
      for (let i = 1; i <= PROVIDERS.length; i += 1) {
        if (i === 1) {
          mockFetch.onCall(i).resolves(stubProviderData(['https://youtube.com/v1']));
        } else {
          mockFetch.onCall(i).resolves(okJsonResponse({}));
        }
      }
      // URL store throws
      const urlStoreIdx = 1 + PROVIDERS.length;
      mockFetch.onCall(urlStoreIdx).rejects(new Error('Connection refused'));
      // DRS calls
      mockFetch.onCall(urlStoreIdx + 1).resolves(okJsonResponse({ jobId: 'j1' }));
      mockFetch.onCall(urlStoreIdx + 2).resolves(okJsonResponse({ jobId: 'j2' }));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Error adding URLs to URL store/),
      );
    });

    it('should call URL store exactly once when there are offsite URLs', async () => {
      const providerResponses = setupWithYoutubeUrl();
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const urlStoreCalls = mockFetch.getCalls().filter(
        (call) => call.args[0].includes('/url-store'),
      );
      expect(urlStoreCalls).to.have.lengthOf(1);
    });
  });

  describe('DRS Scraping', () => {
    it('should trigger DRS jobs for youtube (2 datasets) and reddit (2 datasets)', async () => {
      const urls = 'https://youtube.com/v1;https://reddit.com/r/test';
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData([urls]);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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
        urlStoreResponse: okJsonResponse({}),
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
      expect(body.parameters.urls).to.deep.equal(['https://youtube.com/watch?v=x']);
      expect(body.parameters.metadata).to.deep.include({
        imsOrgId: IMS_ORG_ID,
        brand: 'Example Corp',
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
        urlStoreResponse: okJsonResponse({}),
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
        if (body.parameters.metadata.site === 'reddit.com') {
          expect(body.parameters.days_back).to.equal(30);
        }
      }
    });

    it('should NOT include days_back parameter for non-reddit domains', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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
        if (i === 0) return stubProviderData(['https://youtube.com/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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
      // Setup calls manually for network error
      mockFetch.onCall(0).resolves(okJsonResponse(makeQueryIndex())); // query-index
      mockFetch.onCall(1).resolves(stubProviderData(['https://youtube.com/v1']));
      for (let i = 2; i <= PROVIDERS.length; i += 1) {
        mockFetch.onCall(i).resolves(okJsonResponse({}));
      }
      const urlStoreIdx = 1 + PROVIDERS.length;
      mockFetch.onCall(urlStoreIdx).resolves(okJsonResponse({})); // URL store
      mockFetch.onCall(urlStoreIdx + 1).rejects(new Error('DNS resolution failed')); // DRS job 1
      mockFetch.onCall(urlStoreIdx + 2).rejects(new Error('DNS resolution failed')); // DRS job 2

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.have.lengthOf(2);
      expect(result.auditResult.drsJobs[0].status).to.equal('error');
      expect(result.auditResult.drsJobs[0].error).to.equal('DNS resolution failed');
    });

    it('should skip DRS when DRS_API_URL is missing', async () => {
      delete env.DRS_API_URL;

      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.deep.equal([]);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/DRS_API_URL or DRS_API_KEY not configured/),
      );
    });

    it('should skip DRS when DRS_API_KEY is missing', async () => {
      delete env.DRS_API_KEY;

      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.deep.equal([]);
    });

    it('should use baseURL as brand when getConfig returns null', async () => {
      site.getConfig.returns(null);

      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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

      const body = JSON.parse(drsCalls[0].args[1].body);
      expect(body.parameters.metadata.brand).to.equal(BASE_URL);
    });

    it('should use baseURL as brand when getCompanyName returns falsy', async () => {
      site.getConfig.returns({
        getCompanyName: sandbox.stub().returns(''),
      });

      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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
      expect(body.parameters.metadata.brand).to.equal(BASE_URL);
    });

    it('should use empty string for brand when both getCompanyName and baseURL are falsy', async () => {
      site.getConfig.returns(null);
      site.getBaseURL.returns('');

      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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
        if (i === 0) return stubProviderData(['https://youtube.com/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
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

    it('should trigger DRS for wikipedia with only 1 dataset', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://en.wikipedia.com/wiki/Test']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'wiki-1' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs).to.have.lengthOf(1);
      expect(result.auditResult.drsJobs[0]).to.deep.include({
        domain: 'wikipedia.com',
        datasetId: 'wikipedia_placeholder',
        status: 'success',
      });
    });
  });

  describe('Full Integration Flow', () => {
    it('should complete full audit with URLs from multiple domains', async () => {
      const sources = [
        'https://www.youtube.com/watch?v=abc;https://reddit.com/r/adobe/post1',
        'https://en.wikipedia.com/wiki/Adobe',
        'https://youtube.com/watch?v=def;https://example.com/unrelated',
      ];
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(sources);
        return okJsonResponse({});
      });
      // URL store + 5 DRS jobs (2 youtube + 2 reddit + 1 wikipedia)
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'yt-vid' }),
          okJsonResponse({ jobId: 'yt-comm' }),
          okJsonResponse({ jobId: 'rd-post' }),
          okJsonResponse({ jobId: 'rd-comm' }),
          okJsonResponse({ jobId: 'wiki' }),
        ],
      });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
      expect(result.auditResult.urlCounts['wikipedia.com']).to.equal(1);
      expect(result.auditResult.drsJobs).to.have.lengthOf(5);
      expect(result.fullAuditRef).to.equal(FINAL_URL);
    });

    it('should include week and year in the audit result', async () => {
      mockIsoCalendarWeek.returns({ week: 12, year: 2026 });
      const responses = buildHappyResponses({ week: 12 });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.week).to.equal('12');
      expect(result.auditResult.year).to.equal(2026);
    });

    it('should pad single-digit week with leading zero', async () => {
      mockIsoCalendarWeek.returns({ week: 5, year: 2026 });
      const responses = buildHappyResponses({ week: 5 });
      stubFetchSequence(responses);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.week).to.equal('05');
    });

    it('should call getImsOrgId with correct arguments', async () => {
      const providerResponses = new Array(PROVIDERS.length).fill(null).map((_, i) => {
        if (i === 0) return stubProviderData(['https://youtube.com/v1']);
        return okJsonResponse({});
      });
      const responses = buildHappyResponses({
        providerResponses,
        urlStoreResponse: okJsonResponse({}),
        drsResponses: [
          okJsonResponse({ jobId: 'j1' }),
          okJsonResponse({ jobId: 'j2' }),
        ],
      });
      stubFetchSequence(responses);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(mockGetImsOrgId).to.have.been.calledOnce;
      expect(mockGetImsOrgId).to.have.been.calledWith(site, dataAccess, log);
    });
  });
});
