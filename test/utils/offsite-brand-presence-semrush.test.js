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
const CITED_URL = 'https://example.org/page';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

describe('offsite-brand-presence-semrush', function () {
  this.timeout(10000);

  let sandbox;
  let log;
  let fetchStub;
  let resolveBrandResultForSite;
  let getServiceAccessToken;
  let imsCreateFrom;
  let mod;

  const SITE_ID = '5b0d4d6e-3d2e-4a5b-8e2a-9b6f7c9c1e2a';
  const site = {
    getOrganizationId: () => ORG_ID,
    getId: () => SITE_ID,
    getConfig: () => ({ getBrandKeywords: () => [] }),
  };
  const makeContext = (env = {}, extra = {}) => ({ log, env, ...extra });
  const warnedWith = (re) => log.warn.getCalls().some((c) => re.test(c.args[0]));
  const erroredWith = (re) => log.error.getCalls().some((c) => re.test(c.args[0]));

  async function loadModule(overrides = {}) {
    return esmock('../../src/utils/offsite-brand-presence-semrush.js', {
      '@adobe/spacecat-shared-ims-client': { ImsClient: { createFrom: imsCreateFrom } },
      '../../src/utils/brand-resolver.js': { resolveBrandResultForSite },
      '@adobe/spacecat-shared-utils': { ...spacecatSharedUtils, tracingFetch: fetchStub },
      ...overrides,
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
    getServiceAccessToken = sandbox.stub().resolves({ token_type: 'Bearer', access_token: 'tok' });
    imsCreateFrom = sandbox.stub().returns({ getServiceAccessToken });
    mod = await loadModule();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // --- happy path -----------------------------------------------------------

  it('makes exactly ONE domain-urls request (no hostname, platform=all)', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    await run();

    expect(fetchStub.callCount).to.equal(1);
    const [url] = fetchStub.firstCall.args;
    expect(new URL(url).searchParams.has('hostname')).to.equal(false);
    expect(new URL(url).searchParams.get('platform')).to.equal('all');
  });

  it('splits the single response into youtube / reddit / cited buckets', async () => {
    fetchStub.resolves(okJson({
      urls: [
        { url: YT_URL, citations: 10 },
        { url: RD_URL, citations: 7 },
        { url: CITED_URL, citations: 5, contentType: 'Third-party' },
      ],
    }));

    const allUrls = await run();

    expect(allUrls.get(YT_NORM)).to.deep.equal({ count: 10, domain: 'youtube.com' });
    expect(allUrls.get(RD_URL)).to.deep.equal({ count: 7, domain: 'reddit.com' });
    expect(allUrls.get(CITED_URL)).to.deep.equal({ count: 5, domain: null });
  });

  it('sends Authorization+Accept+timeout, no Content-Type, no x-promise-token by default', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    await run();

    const [url, opts] = fetchStub.firstCall.args;
    expect(url).to.contain(`${mod.SPACECAT_API_DEFAULT_BASE_URL}/v2/orgs/${ORG_ID}/brands/${BRAND_ID}`);
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

  it('always requests PAGE_SIZE', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    await run();
    expect(new URL(fetchStub.firstCall.args[0]).searchParams.get('pageSize')).to.equal(String(mod.PAGE_SIZE));
  });

  // --- filtering / scope ----------------------------------------------------

  it('drops URLs failing the strict youtube/reddit formats', async () => {
    fetchStub.resolves(okJson({
      urls: [
        { url: YT_URL, citations: 10 },
        { url: 'https://music.youtube.com/watch?v=z', citations: 99 },
        { url: RD_URL, citations: 7 },
        { url: 'https://www.reddit.com/settings', citations: 99 },
      ],
    }));

    const allUrls = await run();
    expect([...allUrls.keys()].sort()).to.deep.equal([YT_NORM, RD_URL].sort());
  });

  it('drops Owned rows from the cited bucket', async () => {
    fetchStub.resolves(okJson({
      urls: [{ url: CITED_URL, citations: 99, contentType: 'Owned' }],
    }));
    const allUrls = await run();
    expect(allUrls.size).to.equal(0);
  });

  it('drops TOP_CITED_EXCLUDED_DOMAINS (e.g. wikipedia.org) from the cited bucket', async () => {
    fetchStub.resolves(okJson({
      urls: [{ url: 'https://en.wikipedia.org/wiki/Foo', citations: 99 }],
    }));
    const allUrls = await run();
    expect(allUrls.size).to.equal(0);
  });

  it('drops social/search excluded-domain lookalikes (isExcludedCitedHost) from the cited bucket', async () => {
    fetchStub.resolves(okJson({
      urls: [{ url: 'https://www.facebook.com/somepage', citations: 99 }],
    }));
    const allUrls = await run();
    expect(allUrls.size).to.equal(0);
  });

  it('drops brand-token lookalikes from the cited bucket', async () => {
    const brandSite = {
      ...site,
      getConfig: () => ({ getBrandKeywords: () => ['lovesac'] }),
    };
    fetchStub.resolves(okJson({
      urls: [{ url: 'https://lovedbylovesac.com/page', citations: 99 }],
    }));
    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site: brandSite, previousWeeks: PREVIOUS_WEEKS, context: makeContext(), siteHostname: 'lovesac.com',
    });
    expect(allUrls.size).to.equal(0);
  });

  it('drops (does not throw on) a cited row whose classified URL fails re-parsing', async () => {
    const modWithBadUrl = await loadModule({
      '../../src/utils/offsite-brand-presence-enrichment.js': {
        classifyAndNormalize: () => ({ url: 'not a valid url', domain: null }),
      },
    });
    fetchStub.resolves(okJson({ urls: [{ url: CITED_URL, citations: 99 }] }));
    const allUrls = await modWithBadUrl.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });
    expect(allUrls.size).to.equal(0);
  });

  it('filters owned URLs (siteHostname) and rows without a url', async () => {
    fetchStub.resolves(okJson({
      urls: [
        { url: YT_URL, citations: 10 },
        { citations: 3 }, // no url
        { url: 'https://www.lovesac.com/owned', citations: 99 }, // site's own host
      ],
    }));

    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(), siteHostname: 'lovesac.com',
    });
    expect([...allUrls.keys()]).to.deep.equal([YT_NORM]);
  });

  it('tolerates a site with no getConfig()/getBrandKeywords()', async () => {
    fetchStub.resolves(okJson({ urls: [{ url: YT_URL, citations: 10 }] }));
    const bareSite = { getOrganizationId: () => ORG_ID, getId: () => SITE_ID };
    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site: bareSite, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });
    expect(allUrls.get(YT_NORM)).to.deep.equal({ count: 10, domain: 'youtube.com' });
  });

  // --- citation clamping ----------------------------------------------------

  it('drops a URL whose citations are negative (clamped to 0 -> dropped)', async () => {
    fetchStub.resolves(okJson({
      urls: [{ url: YT_URL, citations: -5 }, { url: RD_URL, citations: 7 }],
    }));
    const allUrls = await run();
    expect(allUrls.has(YT_NORM)).to.equal(false);
    expect(allUrls.get(RD_URL).count).to.equal(7);
  });

  it('drops a URL whose citations are non-numeric or missing (0 -> dropped)', async () => {
    fetchStub.resolves(okJson({
      urls: [{ url: YT_URL, citations: 'abc' }, { url: RD_URL }],
    }));
    const allUrls = await run();
    expect(allUrls.size).to.equal(0);
  });

  it('sums duplicate URLs within the single page', async () => {
    fetchStub.resolves(okJson({
      urls: [{ url: YT_URL, citations: 3 }, { url: YT_URL, citations: 4 }],
    }));
    const allUrls = await run();
    expect(allUrls.get(YT_NORM).count).to.equal(7);
  });

  // --- body / truncation ----------------------------------------------------

  it('treats a non-array urls body as empty (no fallback)', async () => {
    fetchStub.resolves(okJson({ notUrls: true }));
    const allUrls = await run();
    expect(allUrls.size).to.equal(0);
  });

  it('warns and hard-caps at PAGE_SIZE when a full page is returned', async () => {
    const rows = Array.from({ length: mod.PAGE_SIZE + 1 }, (_, i) => ({ url: `${YT_URL}${i}`, citations: 1 }));
    fetchStub.resolves(okJson({ urls: rows }));
    const allUrls = await run();
    expect(warnedWith(/full page/)).to.equal(true);
    expect(allUrls.size).to.equal(mod.PAGE_SIZE);
  });

  it('does not warn on a page one row under PAGE_SIZE (truncation off-by-one)', async () => {
    const rows = Array.from({ length: mod.PAGE_SIZE - 1 }, (_, i) => ({ url: `${YT_URL}${i}`, citations: 1 }));
    fetchStub.resolves(okJson({ urls: rows }));
    await run();
    expect(warnedWith(/full page/)).to.equal(false);
  });

  it('warns on an exactly-PAGE_SIZE page (>= boundary, not >)', async () => {
    const rows = Array.from({ length: mod.PAGE_SIZE }, (_, i) => ({ url: `${YT_URL}${i}`, citations: 1 }));
    fetchStub.resolves(okJson({ urls: rows }));
    await run();
    expect(warnedWith(/full page/)).to.equal(true);
  });

  // --- request-level fallback (returns null) --------------------------------

  it('falls back (null) on a network error', async () => {
    fetchStub.rejects(new Error('network down'));
    const diagnostics = {};
    const result = await run({}, {}, undefined, diagnostics);
    expect(result).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('domain-urls-failed');
  });

  it('falls back (null) on a non-2xx response', async () => {
    fetchStub.resolves({ ok: false, status: 500 });
    const diagnostics = {};
    expect(await run({}, {}, undefined, diagnostics)).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('domain-urls-failed');
  });

  it('logs a distinct rejection and falls back with domain-urls-auth-failed on a 401', async () => {
    fetchStub.resolves({ ok: false, status: 401 });
    const diagnostics = {};
    const result = await run({}, {}, undefined, diagnostics);
    expect(result).to.equal(null);
    expect(erroredWith(/Service token rejected/)).to.equal(true);
    expect(diagnostics.fallbackReason).to.equal('domain-urls-auth-failed');
  });

  it('logs a distinct rejection and falls back with domain-urls-auth-failed on a 403', async () => {
    fetchStub.resolves({ ok: false, status: 403 });
    const diagnostics = {};
    const result = await run({}, {}, undefined, diagnostics);
    expect(result).to.equal(null);
    expect(erroredWith(/Service token rejected/)).to.equal(true);
    expect(diagnostics.fallbackReason).to.equal('domain-urls-auth-failed');
  });

  it('falls back (null) when the response body fails to parse', async () => {
    fetchStub.resolves({
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json'); },
    });
    expect(await run()).to.equal(null);
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
    fetchStub.resolves(okJson({
      urls: [{ url: YT_URL, citations: 10 }, { url: RD_URL, citations: 7 }],
    }));
    const onProgress = sandbox.stub().resolves();

    const allUrls = await run({}, {}, onProgress);

    expect(allUrls.size).to.equal(2);
    expect(onProgress).to.have.been.called;
    const messages = onProgress.getCalls().map((c) => c.args[0]);
    expect(messages.some((m) => /Starting Semrush/.test(m))).to.equal(true);
    expect(messages.some((m) => /Querying.*single request/.test(m))).to.equal(true);
    expect(messages.some((m) => /Loaded 1 `youtube\.com`, 1 `reddit\.com`, and 0 cited/.test(m))).to.equal(true);
    expect(messages.some((m) => /total cited URL/.test(m))).to.equal(true);
  });

  it('invokes onProgress with a failure notice when the request fails', async () => {
    fetchStub.resolves({ ok: false, status: 500 });
    const onProgress = sandbox.stub().resolves();

    expect(await run({}, {}, onProgress)).to.equal(null);

    const messages = onProgress.getCalls().map((c) => c.args[0]);
    expect(messages.some((m) => /domain-urls.*request failed/.test(m))).to.equal(true);
  });

  it('logs a warning and does not throw when onProgress rejects', async () => {
    fetchStub.resolves(okJson({ urls: [] }));
    const onProgress = sandbox.stub().rejects(new Error('slack down'));

    const allUrls = await run({}, {}, onProgress);

    expect(allUrls).to.not.equal(null);
    expect(warnedWith(/Failed to post Semrush progress update/)).to.equal(true);
  });

  // --- pure helpers ---------------------------------------------------------

  describe('buildDomainUrlsUrl', () => {
    const baseArgs = {
      baseUrl: 'https://h/api', spaceCatId: 'o', brandId: 'b', startDate: '2026-07-06', endDate: '2026-08-02', pageSize: 500,
    };

    it('encodes path segments and never includes hostname', () => {
      const url = mod.buildDomainUrlsUrl({ ...baseArgs, spaceCatId: 'o/x', brandId: 'b?y' });
      expect(url).to.contain('/v2/orgs/o%2Fx/brands/b%3Fy/serenity/brand-presence/url-inspector/domain-urls?');
      expect(new URL(url).searchParams.has('hostname')).to.equal(false);
    });

    it('always sends platform=all', () => {
      const url = mod.buildDomainUrlsUrl(baseArgs);
      expect(new URL(url).searchParams.get('platform')).to.equal('all');
    });

    it('sends the requested pageSize', () => {
      const url = mod.buildDomainUrlsUrl({ ...baseArgs, pageSize: 777 });
      expect(new URL(url).searchParams.get('pageSize')).to.equal('777');
    });
  });
});
