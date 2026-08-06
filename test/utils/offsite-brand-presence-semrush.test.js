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
import * as spacecatSharedUtils from '@adobe/spacecat-shared-utils';

use(sinonChai);

const ORG_ID = 'e07a0aae-b794-41f6-9622-a602203c5a3e';
const BRAND_ID = 'cb84e91a-f7e9-488b-8220-e0d031941cd7';
const PREVIOUS_WEEKS = [{ week: 29, year: 2026 }, { week: 28, year: 2026 }];

const YT_URL = 'https://www.youtube.com/watch?v=abc';
const YT_NORM = 'https://youtu.be/abc';
const RD_URL = 'https://www.reddit.com/r/Lovesac/comments/1/pros_cons';

// Full provider engine set (SEMRUSH_PLATFORM_BY_PROVIDER values), the default.
const DEFAULT_PLATFORMS = [
  'google-ai-mode', 'search-gpt', 'microsoft-copilot', 'gemini-2.5-flash', 'google-ai-overview', 'perplexity',
];

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const ONE_ENGINE = { OFFSITE_SEMRUSH_PLATFORMS: 'search-gpt' };
const TWO_ENGINES = { OFFSITE_SEMRUSH_PLATFORMS: 'search-gpt, google-ai-mode' };

describe('offsite-brand-presence-semrush', function () {
  this.timeout(10000);

  let sandbox;
  let log;
  let fetchStub;
  let resolveBrandResultForSite;
  let getServiceAccessTokenV3;
  let imsCreateFrom;
  let mod;

  const SITE_ID = '5b0d4d6e-3d2e-4a5b-8e2a-9b6f7c9c1e2a';
  const site = { getOrganizationId: () => ORG_ID, getId: () => SITE_ID };
  const makeContext = (env = {}, extra = {}) => ({ log, env, ...extra });
  const warnedWith = (re) => log.warn.getCalls().some((c) => re.test(c.args[0]));
  const erroredWith = (re) => log.error.getCalls().some((c) => re.test(c.args[0]));

  async function loadModule() {
    return esmock('../../src/utils/offsite-brand-presence-semrush.js', {
      '@adobe/spacecat-shared-ims-client': { ImsClient: { createFrom: imsCreateFrom } },
      '../../src/utils/brand-resolver.js': { resolveBrandResultForSite },
      '@adobe/spacecat-shared-utils': { ...spacecatSharedUtils, tracingFetch: fetchStub },
    });
  }

  function stubByHostname(fn) {
    fetchStub.callsFake(async (url) => {
      const params = new URL(url).searchParams;
      return fn(params.get('hostname'), params.get('platform'));
    });
  }

  const run = (env = {}, extra = {}) => mod.loadCitedUrlsFromSemrush({
    site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(env, extra),
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    fetchStub = sandbox.stub();
    resolveBrandResultForSite = sandbox.stub()
      .resolves({ brand: { brandId: BRAND_ID }, resolved: true });
    getServiceAccessTokenV3 = sandbox.stub().resolves({ token_type: 'Bearer', access_token: 'tok' });
    imsCreateFrom = sandbox.stub().returns({ getServiceAccessTokenV3 });
    mod = await loadModule();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // --- happy path -----------------------------------------------------------

  it('queries each engine per hostname and SUMS citations per URL', async () => {
    stubByHostname((hostname, platform) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: platform === 'google-ai-mode' ? 5 : 10 }] })
      : okJson({ urls: [{ url: RD_URL, citations: platform === 'google-ai-mode' ? 4 : 7 }] })));

    const allUrls = await run(TWO_ENGINES);

    expect(fetchStub.callCount).to.equal(4); // 2 hosts x 2 engines
    expect(allUrls.get(YT_NORM)).to.deep.equal({ count: 15, domain: 'youtube.com' }); // 10 + 5
    expect(allUrls.get(RD_URL)).to.deep.equal({ count: 11, domain: 'reddit.com' }); // 7 + 4
  });

  it('defaults to the full provider engine set (one request per engine per hostname)', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    await run();
    expect(mod.getSemrushPlatforms(undefined)).to.have.lengthOf(6);
    expect(fetchStub.callCount).to.equal(12); // 2 hosts x 6 engines
  });

  it('sends Authorization+Accept+timeout, no Content-Type, no x-promise-token by default', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    await run();

    const [url, opts] = fetchStub.firstCall.args;
    expect(url).to.contain(`${mod.SPACECAT_API_DEFAULT_BASE_URL}/v2/orgs/${ORG_ID}/brands/${BRAND_ID}`);
    expect(new URL(url).searchParams.get('platform')).to.be.oneOf(DEFAULT_PLATFORMS);
    expect(opts.headers.Authorization).to.equal('Bearer tok');
    expect(opts.headers.Accept).to.equal('application/json');
    expect(opts.headers).to.not.have.property('Content-Type');
    expect(opts.headers).to.not.have.property('x-promise-token');
    expect(opts.timeout).to.equal(10000);
  });

  it('normalizes a lowercase token_type to Bearer', async () => {
    getServiceAccessTokenV3.resolves({ token_type: 'bearer', access_token: 'tok' });
    fetchStub.resolves(okJson({ urls: [] }));
    await run();
    expect(fetchStub.firstCall.args[1].headers.Authorization).to.equal('Bearer tok');
  });

  it('forwards x-promise-token when present on the context', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    await run({}, { promiseToken: 'ptok' });
    expect(fetchStub.firstCall.args[1].headers['x-promise-token']).to.equal('ptok');
  });

  it('honours the SPACECAT_API_URI override', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    await run({ SPACECAT_API_URI: 'https://stage.example/api' });
    expect(fetchStub.firstCall.args[0]).to.contain('https://stage.example/api/v2/orgs/');
  });

  it('honours an OFFSITE_SEMRUSH_PLATFORMS override', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    await run(ONE_ENGINE);
    expect(fetchStub.callCount).to.equal(2); // 2 hosts x 1 engine
    fetchStub.getCalls().forEach((c) => {
      expect(new URL(c.args[0]).searchParams.get('platform')).to.equal('search-gpt');
    });
  });

  // --- filtering / scope ----------------------------------------------------

  it('drops URLs failing the strict youtube/reddit formats', async () => {
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: 10 }, { url: 'https://music.youtube.com/watch?v=z', citations: 99 }] })
      : okJson({ urls: [{ url: RD_URL, citations: 7 }, { url: 'https://www.reddit.com/settings', citations: 99 }] })));

    const allUrls = await run(ONE_ENGINE);
    expect([...allUrls.keys()].sort()).to.deep.equal([YT_NORM, RD_URL].sort());
  });

  it('drops off-host (domain: null) rows so nothing leaks into top-cited', async () => {
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: 10 }, { url: 'https://example.org/page', citations: 99 }] })
      : okJson({ urls: [{ url: RD_URL, citations: 7 }] })));

    const allUrls = await run(ONE_ENGINE);
    expect([...allUrls.keys()]).to.not.include('https://example.org/page');
    expect(allUrls.has(YT_NORM)).to.equal(true);
  });

  it('filters owned URLs (siteHostname) and rows without a url', async () => {
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: 10 }, { citations: 3 }] }) // 2nd: no url
      : okJson({ urls: [{ url: 'https://www.lovesac.com/owned', citations: 99 }] }))); // owned

    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(ONE_ENGINE), siteHostname: 'lovesac.com',
    });
    expect([...allUrls.keys()]).to.deep.equal([YT_NORM]);
  });

  // --- citation clamping ----------------------------------------------------

  it('drops a URL whose citations are negative (clamped to 0 -> dropped)', async () => {
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: -5 }] })
      : okJson({ urls: [{ url: RD_URL, citations: 7 }] })));
    const allUrls = await run(ONE_ENGINE);
    expect(allUrls.has(YT_NORM)).to.equal(false);
    expect(allUrls.get(RD_URL).count).to.equal(7);
  });

  it('drops a URL whose citations are non-numeric or missing (0 -> dropped)', async () => {
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: 'abc' }] }) // NaN -> 0
      : okJson({ urls: [{ url: RD_URL }] }))); // missing -> 0
    const allUrls = await run(ONE_ENGINE);
    expect(allUrls.size).to.equal(0);
  });

  it('keeps a URL when one engine reports 0 but another reports a positive count', async () => {
    stubByHostname((hostname, platform) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: platform === 'google-ai-mode' ? 5 : 0 }] })
      : okJson({ urls: [{ url: RD_URL, citations: 7 }] })));
    const allUrls = await run(TWO_ENGINES);
    expect(allUrls.get(YT_NORM)).to.deep.equal({ count: 5, domain: 'youtube.com' });
  });

  it('sums duplicate URLs within a single page', async () => {
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: 3 }, { url: YT_URL, citations: 4 }] })
      : okJson({ urls: [{ url: RD_URL, citations: 1 }] })));
    const allUrls = await run(ONE_ENGINE);
    expect(allUrls.get(YT_NORM).count).to.equal(7);
  });

  // --- body / truncation ----------------------------------------------------

  it('treats a non-array urls body as empty (no fallback)', async () => {
    fetchStub.resolves(okJson({ notUrls: true }));
    const allUrls = await run();
    expect(allUrls.size).to.equal(0);
  });

  it('warns and hard-caps at PAGE_SIZE when a full page is returned', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ url: `${YT_URL}${i}`, citations: 1 }));
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: rows })
      : okJson({ urls: [{ url: RD_URL, citations: 1 }] })));
    const allUrls = await run(ONE_ENGINE);
    expect(warnedWith(/full page/)).to.equal(true);
    expect([...allUrls.keys()].filter((k) => k.startsWith('https://youtu.be/')).length).to.equal(100);
  });

  it('does not warn on a 99-row page (truncation off-by-one)', async () => {
    const rows = Array.from({ length: 99 }, (_, i) => ({ url: `${YT_URL}${i}`, citations: 1 }));
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: rows })
      : okJson({ urls: [{ url: RD_URL, citations: 1 }] })));
    await run(ONE_ENGINE);
    expect(warnedWith(/full page/)).to.equal(false);
  });

  it('warns on an exactly-PAGE_SIZE (100-row) page (>= boundary, not >)', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ url: `${YT_URL}${i}`, citations: 1 }));
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: rows })
      : okJson({ urls: [{ url: RD_URL, citations: 1 }] })));
    await run(ONE_ENGINE);
    expect(warnedWith(/full page/)).to.equal(true);
  });

  // --- surface-level fallback (returns null) --------------------------------

  it('falls back (null) when a whole hostname has no successful response — reject', async () => {
    stubByHostname((hostname) => {
      if (hostname === 'reddit.com') {
        return Promise.reject(new Error('network down'));
      }
      return okJson({ urls: [{ url: YT_URL, citations: 10 }] });
    });
    const result = await run(ONE_ENGINE);
    expect(result).to.equal(null);
    expect(warnedWith(/No successful Semrush response for reddit\.com/)).to.equal(true);
  });

  it('falls back (null) on a non-2xx surface', async () => {
    stubByHostname((hostname) => (hostname === 'reddit.com'
      ? { ok: false, status: 500 }
      : okJson({ urls: [{ url: YT_URL, citations: 10 }] })));
    expect(await run(ONE_ENGINE)).to.equal(null);
  });

  it('logs a distinct rejection and falls back on a 401/403 surface', async () => {
    stubByHostname((hostname) => (hostname === 'reddit.com'
      ? { ok: false, status: 401 }
      : okJson({ urls: [{ url: YT_URL, citations: 10 }] })));
    const result = await run(ONE_ENGINE);
    expect(result).to.equal(null);
    expect(erroredWith(/Service token rejected/)).to.equal(true);
  });

  it('falls back (null) when a surface body fails to parse', async () => {
    stubByHostname((hostname) => (hostname === 'reddit.com'
      ? { ok: true, status: 200, json: async () => { throw new Error('bad json'); } }
      : okJson({ urls: [{ url: YT_URL, citations: 10 }] })));
    expect(await run(ONE_ENGINE)).to.equal(null);
  });

  it('tolerates a single failed engine when the surface still has a successful response', async () => {
    stubByHostname((hostname, platform) => {
      if (hostname === 'youtube.com' && platform === 'search-gpt') {
        return Promise.reject(new Error('flaky engine'));
      }
      return hostname === 'youtube.com'
        ? okJson({ urls: [{ url: YT_URL, citations: 5 }] })
        : okJson({ urls: [{ url: RD_URL, citations: 7 }] });
    });
    const allUrls = await run(TWO_ENGINES);
    expect(allUrls).to.not.equal(null);
    expect(allUrls.get(YT_NORM).count).to.equal(5);
    expect(allUrls.get(RD_URL).count).to.equal(14); // reddit ok on both engines
  });

  // --- precondition guards (return null) -----------------------------------

  it('returns null when the site has no organization id', async () => {
    const result = await mod.loadCitedUrlsFromSemrush({
      site: { getOrganizationId: () => null },
      previousWeeks: PREVIOUS_WEEKS,
      context: makeContext(),
    });
    expect(result).to.equal(null);
    expect(fetchStub).to.not.have.been.called;
  });

  it('returns null and logs info when the brand is confirmed absent (resolved=true)', async () => {
    resolveBrandResultForSite.resolves({ brand: null, resolved: true });
    expect(await run()).to.equal(null);
    expect(log.info).to.have.been.called;
  });

  it('returns null and warns when brand resolution failed (resolved=false)', async () => {
    resolveBrandResultForSite.resolves({ brand: null, resolved: false });
    expect(await run()).to.equal(null);
    expect(warnedWith(/transient/)).to.equal(true);
  });

  it('returns null when no date window can be derived', async () => {
    const result = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: [], context: makeContext(),
    });
    expect(result).to.equal(null);
  });

  it('returns null when the IMS service token cannot be minted', async () => {
    getServiceAccessTokenV3.rejects(new Error('ims down'));
    expect(await run()).to.equal(null);
    expect(log.error).to.have.been.called;
  });

  it('returns null when the IMS token response has no access_token', async () => {
    getServiceAccessTokenV3.resolves({ token_type: 'Bearer' });
    expect(await run()).to.equal(null);
    expect(erroredWith(/access_token/)).to.equal(true);
  });

  // --- pure helpers ---------------------------------------------------------

  describe('getSemrushPlatforms', () => {
    it('defaults to the confirmed engine list', () => {
      expect(mod.getSemrushPlatforms(undefined)).to.deep.equal(DEFAULT_PLATFORMS);
      expect(mod.getSemrushPlatforms({})).to.deep.equal(DEFAULT_PLATFORMS);
      expect(mod.getSemrushPlatforms({ OFFSITE_SEMRUSH_PLATFORMS: '   ' })).to.deep.equal(DEFAULT_PLATFORMS);
      // separators-only must NOT disable all requests
      expect(mod.getSemrushPlatforms({ OFFSITE_SEMRUSH_PLATFORMS: ' , , ' })).to.deep.equal(DEFAULT_PLATFORMS);
    });

    it('parses a comma-separated override, trimming and dropping empties', () => {
      expect(mod.getSemrushPlatforms({ OFFSITE_SEMRUSH_PLATFORMS: 'search-gpt, ,google-ai-mode ' }))
        .to.deep.equal(['search-gpt', 'google-ai-mode']);
    });
  });

  describe('buildDomainUrlsUrl', () => {
    const baseArgs = {
      baseUrl: 'https://h/api', spaceCatId: 'o', brandId: 'b', hostname: 'reddit.com', startDate: '2026-07-06', endDate: '2026-08-02',
    };

    it('omits platform when not provided and encodes path segments', () => {
      const url = mod.buildDomainUrlsUrl({ ...baseArgs, spaceCatId: 'o/x', brandId: 'b?y' });
      expect(url).to.contain('/v2/orgs/o%2Fx/brands/b%3Fy/serenity/brand-presence/url-inspector/domain-urls?');
      expect(new URL(url).searchParams.has('platform')).to.equal(false);
      expect(new URL(url).searchParams.get('hostname')).to.equal('reddit.com');
    });

    it('includes platform when provided', () => {
      const url = mod.buildDomainUrlsUrl({ ...baseArgs, platform: 'search-gpt' });
      expect(new URL(url).searchParams.get('platform')).to.equal('search-gpt');
    });
  });
});
