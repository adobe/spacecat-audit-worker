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
  let resolveSemrushEntitlement;
  let getServiceAccessToken;
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
      '../../src/utils/semrush-entitlement.js': { resolveSemrushEntitlement },
      '@adobe/spacecat-shared-utils': { ...spacecatSharedUtils, tracingFetch: fetchStub },
    });
  }

  function stubByHostname(fn) {
    fetchStub.callsFake(async (url) => {
      const params = new URL(url).searchParams;
      return fn(params.get('hostname'), params.get('platform'));
    });
  }

  const run = (env = {}, extra = {}, onProgress = undefined, diagnostics = undefined) => mod
    .loadCitedUrlsFromSemrush({
      site,
      previousWeeks: PREVIOUS_WEEKS,
      context: makeContext(env, extra),
      onProgress,
      diagnostics,
    });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    fetchStub = sandbox.stub();
    resolveBrandResultForSite = sandbox.stub()
      .resolves({ brand: { brandId: BRAND_ID }, resolved: true });
    resolveSemrushEntitlement = sandbox.stub()
      .resolves({
        entitled: true, resolved: true, reason: 'entitled', mode: 'subworkspace',
      });
    getServiceAccessToken = sandbox.stub().resolves({ token_type: 'Bearer', access_token: 'tok' });
    imsCreateFrom = sandbox.stub().returns({ getServiceAccessToken });
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
    getServiceAccessToken.resolves({ token_type: 'bearer', access_token: 'tok' });
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

  it('logs a distinct rejection and falls back on a 401 surface', async () => {
    stubByHostname((hostname) => (hostname === 'reddit.com'
      ? { ok: false, status: 401 }
      : okJson({ urls: [{ url: YT_URL, citations: 10 }] })));
    const result = await run(ONE_ENGINE);
    expect(result).to.equal(null);
    expect(erroredWith(/Service token rejected/)).to.equal(true);
  });

  it('logs a distinct rejection and falls back on a 403 surface', async () => {
    stubByHostname((hostname) => (hostname === 'reddit.com'
      ? { ok: false, status: 403 }
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

  // --- diagnostics out-param --------------------------------------------------

  it('reports a specific fallbackReason for a fully-failed surface, distinct from other null causes', async () => {
    stubByHostname((hostname) => (hostname === 'reddit.com'
      ? Promise.reject(new Error('network down'))
      : okJson({ urls: [{ url: YT_URL, citations: 10 }] })));
    const diagnostics = {};
    expect(await run(ONE_ENGINE, {}, undefined, diagnostics)).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('surface-failed:reddit.com');
  });

  it('reports engineFailureCount/degradedHosts/authFailureDetected on a successful but degraded run', async () => {
    stubByHostname((hostname, platform) => {
      if (hostname === 'youtube.com' && platform === 'search-gpt') {
        return { ok: false, status: 401 };
      }
      return hostname === 'youtube.com'
        ? okJson({ urls: [{ url: YT_URL, citations: 5 }] })
        : okJson({ urls: [{ url: RD_URL, citations: 7 }] });
    });
    const diagnostics = {};
    const allUrls = await run(TWO_ENGINES, {}, undefined, diagnostics);
    expect(allUrls).to.not.equal(null);
    expect(diagnostics.engineFailureCount).to.equal(1);
    expect(diagnostics.degradedHosts).to.deep.equal(['youtube.com']);
    expect(diagnostics.authFailureDetected).to.equal(true);
  });

  it('reports no degradation on a fully clean run', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    const diagnostics = {};
    await run(ONE_ENGINE, {}, undefined, diagnostics);
    expect(diagnostics.engineFailureCount).to.equal(0);
    expect(diagnostics.degradedHosts).to.deep.equal([]);
    expect(diagnostics.authFailureDetected).to.equal(false);
  });

  // --- precondition guards (return null) -----------------------------------

  it('returns null when the site has no organization id', async () => {
    const diagnostics = {};
    const result = await mod.loadCitedUrlsFromSemrush({
      site: { getOrganizationId: () => null },
      previousWeeks: PREVIOUS_WEEKS,
      context: makeContext(),
      diagnostics,
    });
    expect(result).to.equal(null);
    expect(fetchStub).to.not.have.been.called;
    expect(diagnostics.fallbackReason).to.equal('no-organization-id');
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

  // --- entitlement gate (before any Semrush HTTP call) -----------------------

  it('returns null and does not call Semrush when the brand is not entitled', async () => {
    resolveSemrushEntitlement.resolves({ entitled: false, resolved: true, reason: 'no-workspace' });
    const diagnostics = {};
    const onProgress = sandbox.stub().resolves();

    const result = await run({}, {}, onProgress, diagnostics);

    expect(result).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('not-entitled');
    expect(diagnostics.entitlementReason).to.equal('no-workspace');
    expect(fetchStub).to.not.have.been.called;
    expect(getServiceAccessToken).to.not.have.been.called;
    expect(log.info).to.have.been.calledWithMatch(/not entitled for Semrush \(no-workspace\)/);
    expect(onProgress).to.have.been.calledWith(
      ':information_source: Brand is not entitled for Semrush — falling back to the legacy source.',
    );
  });

  it('returns null and warns (not entitled, transient) when the entitlement check itself fails', async () => {
    resolveSemrushEntitlement.resolves({ entitled: false, resolved: false, reason: 'check-failed' });
    const diagnostics = {};
    const onProgress = sandbox.stub().resolves();

    const result = await run({}, {}, onProgress, diagnostics);

    expect(result).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('entitlement-check-failed');
    expect(diagnostics.entitlementReason).to.equal('check-failed');
    expect(fetchStub).to.not.have.been.called;
    expect(warnedWith(/entitlement check failed \(transient\)/)).to.equal(true);
    expect(onProgress).to.have.been.calledWith(
      ':warning: Could not verify Semrush entitlement (transient) — falling back to the legacy source.',
    );
  });

  it('passes the resolved orgId/brandId to the entitlement check and proceeds when entitled', async () => {
    fetchStub.resolves(okJson({ urls: [] }));

    await run();

    expect(resolveSemrushEntitlement).to.have.been.calledOnce;
    expect(resolveSemrushEntitlement.firstCall.args[1]).to.deep.equal({
      orgId: ORG_ID, brandId: BRAND_ID,
    });
  });

  it('returns null when no date window can be derived', async () => {
    const result = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: [], context: makeContext(),
    });
    expect(result).to.equal(null);
  });

  it('returns null when the IMS service token cannot be minted', async () => {
    getServiceAccessToken.rejects(new Error('ims down'));
    expect(await run()).to.equal(null);
    expect(log.error).to.have.been.called;
  });

  it('returns null when the IMS token response has no access_token', async () => {
    getServiceAccessToken.resolves({ token_type: 'Bearer' });
    expect(await run()).to.equal(null);
    expect(erroredWith(/access_token/)).to.equal(true);
  });

  // --- progress notifications (onProgress) -----------------------------------

  it('invokes onProgress at each stage of a successful attempt', async () => {
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: 10 }] })
      : okJson({ urls: [{ url: RD_URL, citations: 7 }] })));
    const onProgress = sandbox.stub().resolves();

    const allUrls = await run(ONE_ENGINE, {}, onProgress);

    expect(allUrls.size).to.equal(2);
    expect(onProgress).to.have.been.called;
    const messages = onProgress.getCalls().map((c) => c.args[0]);
    expect(messages.some((m) => /Starting Semrush/.test(m))).to.equal(true);
    expect(messages.some((m) => /Querying/.test(m))).to.equal(true);
    expect(messages.some((m) => /youtube\.com.*engine requests succeeded/.test(m))).to.equal(true);
    expect(messages.some((m) => /reddit\.com.*engine requests succeeded/.test(m))).to.equal(true);
    expect(messages.some((m) => /Loaded 1 URL\(s\) from `youtube\.com`/.test(m))).to.equal(true);
    expect(messages.some((m) => /Loaded 1 URL\(s\) from `reddit\.com`/.test(m))).to.equal(true);
    expect(messages.some((m) => /total cited URL/.test(m))).to.equal(true);
  });

  it('invokes onProgress with a failure notice on the surface that triggers fallback', async () => {
    stubByHostname((hostname) => (hostname === 'youtube.com'
      ? okJson({ urls: [{ url: YT_URL, citations: 10 }] })
      : { ok: false, status: 500, json: async () => ({}) }));
    const onProgress = sandbox.stub().resolves();

    expect(await run(ONE_ENGINE, {}, onProgress)).to.equal(null);

    const messages = onProgress.getCalls().map((c) => c.args[0]);
    expect(messages.some((m) => /reddit\.com.*0\/1 engine requests succeeded/.test(m))).to.equal(true);
  });

  it('logs a warning and does not throw when onProgress rejects', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    const onProgress = sandbox.stub().rejects(new Error('slack down'));

    const allUrls = await run(ONE_ENGINE, {}, onProgress);

    expect(allUrls).to.not.equal(null);
    expect(warnedWith(/Failed to post Semrush progress update/)).to.equal(true);
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
