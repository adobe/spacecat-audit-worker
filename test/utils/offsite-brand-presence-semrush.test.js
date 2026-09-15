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
import {
  resolveApiBaseUrl as realResolveApiBaseUrl,
  decodeS2sConsumerClaims as realDecodeS2sConsumerClaims,
  imsConfigDiagnostics as realImsConfigDiagnostics,
  readErrorBodySnippet as realReadErrorBodySnippet,
  LLMO_API_DEFAULT_BASE_URL,
  LLMO_API_DEFAULT_PREFIX,
} from '../../src/utils/offsite-s2s-auth.js';
import {
  SEMRUSH_NOT_ENTITLED_REASON,
  SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON,
  SEMRUSH_ENTITLEMENT_REASONS,
} from '../../src/utils/semrush-entitlement.js';

use(sinonChai);

const ORG_ID = 'e07a0aae-b794-41f6-9622-a602203c5a3e';
const BRAND_ID = 'cb84e91a-f7e9-488b-8220-e0d031941cd7';
const IMS_ORG_ID = '899D173E60B73D8B0A495C0A@AdobeOrg';
const SESSION_TOKEN = 'sess-jwt-token';
const PREVIOUS_WEEKS = [{ week: 29, year: 2026 }, { week: 28, year: 2026 }];

const YT_URL = 'https://www.youtube.com/watch?v=abc';
const YT_NORM = 'https://youtu.be/abc';
const RD_URL = 'https://www.reddit.com/r/Lovesac/comments/1/pros_cons';
const CITED_URL = 'https://example.org/page';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
// Builds a JWT-shaped token (`header.payload.signature`) whose payload encodes `claims`.
const makeJwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('offsite-brand-presence-semrush', function () {
  this.timeout(10000);

  let sandbox;
  let log;
  let fetchStub;
  let resolveBrandResultForSite;
  let resolveSemrushEntitlement;
  let getS2sSessionAuthorizationStub;
  let evictS2sSessionTokenStub;
  let getImsOrgIdStub;
  let mod;

  const SITE_ID = '5b0d4d6e-3d2e-4a5b-8e2a-9b6f7c9c1e2a';
  const site = {
    getOrganizationId: () => ORG_ID,
    getId: () => SITE_ID,
    getConfig: () => ({ getBrandKeywords: () => [] }),
  };
  const makeContext = (env = {}, extra = {}) => ({
    log, env, dataAccess: {}, ...extra,
  });
  const warnedWith = (re) => log.warn.getCalls().some((c) => re.test(c.args[0]));

  // The S2S auth flow (IMS mint + login exchange + token cache) now lives in the mocked
  // `offsite-s2s-auth.js`; this module only makes the domain-urls DATA call through the
  // `tracingFetch` stub, so every recorded fetch is a data call.
  const dataCall = () => fetchStub.getCalls()[0];
  const dataCallCount = () => fetchStub.callCount;

  async function loadModule(overrides = {}) {
    // The auth module is mocked so the S2S session token is supplied directly by
    // `getS2sSessionAuthorizationStub` (no login round-trip through fetch). The pure decode/
    // diagnostics/base-url/error-body helpers pass through to the real implementations so their
    // loader-side behavior (grant line, ims_token_failed gotcha flags, prefix resolution,
    // data-call error-body snippet) is still exercised here. The data call (fetchDomainUrls)
    // goes through the `tracingFetch` stub from the shared-utils mock.
    return esmock('../../src/utils/offsite-brand-presence-semrush.js', {
      '../../src/utils/offsite-s2s-auth.js': {
        getS2sSessionAuthorization: getS2sSessionAuthorizationStub,
        evictS2sSessionToken: evictS2sSessionTokenStub,
        resolveApiBaseUrl: realResolveApiBaseUrl,
        decodeS2sConsumerClaims: realDecodeS2sConsumerClaims,
        imsConfigDiagnostics: realImsConfigDiagnostics,
        readErrorBodySnippet: realReadErrorBodySnippet,
      },
      '../../src/utils/brand-resolver.js': { resolveBrandResultForSite },
      '../../src/utils/semrush-entitlement.js': { resolveSemrushEntitlement },
      '../../src/utils/data-access.js': { getImsOrgId: getImsOrgIdStub },
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
    // The data call resolves an empty page by default; tests override it explicitly.
    fetchStub.resolves(okJson({ urls: [] }));
    resolveBrandResultForSite = sandbox.stub()
      .resolves({ brand: { brandId: BRAND_ID }, resolved: true });
    resolveSemrushEntitlement = sandbox.stub()
      .resolves({
        entitled: true,
        resolved: true,
        reason: SEMRUSH_ENTITLEMENT_REASONS.ENTITLED,
        mode: 'subworkspace',
      });
    // The shared auth helper hands back a ready-to-use session-token Authorization header; a
    // fresh mint by default (fromCache=false) so the loader logs the granted-identity line.
    getS2sSessionAuthorizationStub = sandbox.stub().resolves({
      authorization: `Bearer ${SESSION_TOKEN}`, sessionToken: SESSION_TOKEN, fromCache: false,
    });
    evictS2sSessionTokenStub = sandbox.stub();
    getImsOrgIdStub = sandbox.stub().resolves(IMS_ORG_ID);
    mod = await loadModule();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // --- happy path -----------------------------------------------------------

  it('makes exactly ONE domain-urls request (no hostname, platform=all)', async () => {
    await run();

    expect(dataCallCount()).to.equal(1);
    expect(getS2sSessionAuthorizationStub).to.have.been.calledOnce;
    const [url] = dataCall().args;
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

  // --- data call headers / URL / timeout ------------------------------------

  it('sends the session token as Bearer, with Accept and a timeout, and no Content-Type on the data call', async () => {
    await run();

    const [url, opts] = dataCall().args;
    expect(url).to.contain(`${LLMO_API_DEFAULT_BASE_URL}${LLMO_API_DEFAULT_PREFIX}/v2/orgs/${ORG_ID}/brands/${BRAND_ID}`);
    expect(opts.headers.Authorization).to.equal(`Bearer ${SESSION_TOKEN}`);
    expect(opts.headers.Accept).to.equal('application/json');
    expect(opts.headers).to.not.have.property('Content-Type');
    expect(opts.timeout).to.equal(60000); // domain-urls timeout (heavy query)
  });

  it('honours OFFSITE_SEMRUSH_TIMEOUT_MS for the data call', async () => {
    await run({ OFFSITE_SEMRUSH_TIMEOUT_MS: '30000' });
    expect(dataCall().args[1].timeout).to.equal(30000);
  });

  it('ignores an invalid OFFSITE_SEMRUSH_TIMEOUT_MS and uses the default', async () => {
    await run({ OFFSITE_SEMRUSH_TIMEOUT_MS: '0' });
    expect(dataCall().args[1].timeout).to.equal(60000);
  });

  it('clamps OFFSITE_SEMRUSH_TIMEOUT_MS to the 2-minute ceiling', async () => {
    await run({ OFFSITE_SEMRUSH_TIMEOUT_MS: '600000' }); // 10 min requested
    expect(dataCall().args[1].timeout).to.equal(120000); // clamped to 2 min
  });

  it('honours the LLMO_API_BASE_URL override for the data call', async () => {
    await run({ LLMO_API_BASE_URL: 'https://stage.example' });
    expect(dataCall().args[0]).to.contain('https://stage.example/api/v1/v2/orgs/');
  });

  it('carries the /api/v1 gateway prefix on the data URL by default', async () => {
    await run();
    expect(dataCall().args[0]).to.contain('/api/v1/v2/orgs/');
  });

  it('honours the LLMO_API_PREFIX override (e.g. non-prod /api/ci) on the data URL', async () => {
    await run({ LLMO_API_PREFIX: '/api/ci' });
    expect(dataCall().args[0]).to.contain('/api/ci/v2/orgs/');
    expect(dataCall().args[0]).to.not.contain('/api/v1/');
  });

  it('requests PAGE_SIZE (1000) by default', async () => {
    await run();
    expect(mod.PAGE_SIZE).to.equal(1000);
    expect(new URL(dataCall().args[0]).searchParams.get('pageSize')).to.equal('1000');
  });

  it('honours a smaller OFFSITE_SEMRUSH_PAGE_SIZE', async () => {
    await run({ OFFSITE_SEMRUSH_PAGE_SIZE: '200' });
    expect(new URL(dataCall().args[0]).searchParams.get('pageSize')).to.equal('200');
  });

  it('clamps OFFSITE_SEMRUSH_PAGE_SIZE to the server max (PAGE_SIZE)', async () => {
    await run({ OFFSITE_SEMRUSH_PAGE_SIZE: '5000' });
    expect(new URL(dataCall().args[0]).searchParams.get('pageSize')).to.equal('1000');
  });

  it('ignores a non-positive OFFSITE_SEMRUSH_PAGE_SIZE and uses the default', async () => {
    await run({ OFFSITE_SEMRUSH_PAGE_SIZE: '0' });
    expect(new URL(dataCall().args[0]).searchParams.get('pageSize')).to.equal('1000');
  });

  it('clamps a fractional OFFSITE_SEMRUSH_PAGE_SIZE up to 1 (never sends pageSize=0)', async () => {
    await run({ OFFSITE_SEMRUSH_PAGE_SIZE: '0.5' }); // floors to 0 without the lower clamp
    expect(new URL(dataCall().args[0]).searchParams.get('pageSize')).to.equal('1');
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

  it('drops opaque-scheme rows (mailto:/tel:/data:/javascript:) via the scheme allowlist', async () => {
    fetchStub.resolves(okJson({
      urls: [
        { url: 'mailto:foo@bar.com', citations: 99 },
        { url: 'tel:+123456789', citations: 99 },
        { url: 'data:text/plain;base64,SGVsbG8=', citations: 99 },
        { url: 'javascript:alert(1)', citations: 99 }, // eslint-disable-line no-script-url -- test data, never executed
        { url: CITED_URL, citations: 5 },
      ],
    }));
    const allUrls = await run();
    expect([...allUrls.keys()]).to.deep.equal([CITED_URL]);
  });

  it('drops non-http(s) schemes that reparse cleanly (ftp:/ws:) via the scheme allowlist', async () => {
    // These don't throw on reparse (unlike opaque schemes) — the allowlist is what catches
    // them, not an incidental parse failure.
    fetchStub.resolves(okJson({
      urls: [
        { url: 'ftp://example.com/file.txt', citations: 99 },
        { url: 'ws://example.com/socket', citations: 99 },
        { url: CITED_URL, citations: 5 },
      ],
    }));
    const allUrls = await run();
    expect([...allUrls.keys()]).to.deep.equal([CITED_URL]);
  });

  it('drops a row whose url is not a valid URL at all', async () => {
    fetchStub.resolves(okJson({
      urls: [{ url: 'not a url', citations: 99 }, { url: CITED_URL, citations: 5 }],
    }));
    const allUrls = await run();
    expect([...allUrls.keys()]).to.deep.equal([CITED_URL]);
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

  it('sums duplicate URLs within the cited bucket too', async () => {
    fetchStub.resolves(okJson({
      urls: [{ url: CITED_URL, citations: 3 }, { url: CITED_URL, citations: 4 }],
    }));
    const allUrls = await run();
    expect(allUrls.get(CITED_URL)).to.deep.equal({ count: 7, domain: null });
  });

  it('counts the cited bucket correctly (not mis-keyed) when only cited URLs are present', async () => {
    const CITED_URL_2 = 'https://another.example/page';
    fetchStub.resolves(okJson({
      urls: [{ url: CITED_URL, citations: 5 }, { url: CITED_URL_2, citations: 3 }],
    }));
    const onProgress = sandbox.stub().resolves();
    const allUrls = await run({}, {}, onProgress);
    expect(allUrls.size).to.equal(2);
    const messages = onProgress.getCalls().map((c) => c.args[0]);
    expect(messages.some((m) => /Loaded 0 `youtube\.com`, 0 `reddit\.com`, and 2 cited/.test(m))).to.equal(true);
  });

  // --- body / truncation ----------------------------------------------------

  it('treats a non-array urls body as empty (no fallback)', async () => {
    fetchStub.resolves(okJson({ notUrls: true }));
    const allUrls = await run();
    expect(allUrls.size).to.equal(0);
  });

  it('warns, sets diagnostics.truncated, and hard-caps at PAGE_SIZE when a full page is returned', async () => {
    const rows = Array.from({ length: mod.PAGE_SIZE + 1 }, (_, i) => ({ url: `${YT_URL}${i}`, citations: 1 }));
    fetchStub.resolves(okJson({ urls: rows }));
    const diagnostics = {};
    const allUrls = await run({}, {}, undefined, diagnostics);
    expect(warnedWith(/full page/)).to.equal(true);
    expect(allUrls.size).to.equal(mod.PAGE_SIZE);
    expect(diagnostics.truncated).to.equal(true);
  });

  it('does not warn and sets diagnostics.truncated to false on a page one row under PAGE_SIZE', async () => {
    const rows = Array.from({ length: mod.PAGE_SIZE - 1 }, (_, i) => ({ url: `${YT_URL}${i}`, citations: 1 }));
    fetchStub.resolves(okJson({ urls: rows }));
    const diagnostics = {};
    await run({}, {}, undefined, diagnostics);
    expect(warnedWith(/full page/)).to.equal(false);
    expect(diagnostics.truncated).to.equal(false);
  });

  it('detects truncation against an overridden (non-default) OFFSITE_SEMRUSH_PAGE_SIZE', async () => {
    // A full page at the OVERRIDDEN ceiling must still flag truncation — guards against a
    // future refactor closing the truncation check over the PAGE_SIZE constant.
    const rows = Array.from({ length: 5 }, (_, i) => ({ url: `${YT_URL}${i}`, citations: 1 }));
    fetchStub.resolves(okJson({ urls: rows }));
    const diagnostics = {};
    await run({ OFFSITE_SEMRUSH_PAGE_SIZE: '5' }, {}, undefined, diagnostics);
    expect(new URL(dataCall().args[0]).searchParams.get('pageSize')).to.equal('5');
    expect(warnedWith(/full page/)).to.equal(true);
    expect(diagnostics.truncated).to.equal(true);
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
    expect(diagnostics.fallbackReason).to.equal('domain_urls_failed');
  });

  it('falls back (null) on a non-2xx response', async () => {
    fetchStub.resolves({ ok: false, status: 500 });
    const diagnostics = {};
    expect(await run({}, {}, undefined, diagnostics)).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('domain_urls_failed');
  });

  it('logs a distinct rejection and falls back with domain-urls-auth-failed on a 401', async () => {
    fetchStub.resolves({ ok: false, status: 401 });
    const diagnostics = {};
    const result = await run({}, {}, undefined, diagnostics);
    expect(result).to.equal(null);
    expect(warnedWith(/session token rejected/i)).to.equal(true);
    expect(diagnostics.fallbackReason).to.equal('domain_urls_auth_failed');
  });

  it('logs the response body on a 401 so the rejecter (api-service vs Semrush) is identifiable', async () => {
    const proxyMsg = 'Denied - reason=no-org-access';
    fetchStub.resolves({ ok: false, status: 401, text: async () => proxyMsg });
    const result = await run();
    expect(result).to.equal(null);
    expect(warnedWith(/session token rejected/i)).to.equal(true);
    expect(log.warn.getCalls().some((c) => c.args[0].includes(`responseBody="${proxyMsg}"`))).to.equal(true);
    // The exact request URL is logged (org/brand/dates/params) to diagnose a malformed request.
    expect(warnedWith(/requestUrl="[^"]*\/domain-urls\?[^"]*"/)).to.equal(true);
  });

  it('handles an empty/unreadable error body on a non-2xx response', async () => {
    fetchStub.resolves({ ok: false, status: 500, text: async () => '' });
    const result = await run();
    expect(result).to.equal(null);
    expect(log.warn.getCalls().some((c) => c.args[0].includes('status=500') && !c.args[0].includes('responseBody='))).to.equal(true);
  });

  it('logs a distinct rejection and falls back with domain-urls-auth-failed on a 403', async () => {
    fetchStub.resolves({ ok: false, status: 403 });
    const diagnostics = {};
    const result = await run({}, {}, undefined, diagnostics);
    expect(result).to.equal(null);
    expect(warnedWith(/session token rejected/i)).to.equal(true);
    expect(diagnostics.fallbackReason).to.equal('domain_urls_auth_failed');
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
    expect(diagnostics.fallbackReason).to.equal('no_organization_id');
  });

  it('returns null and warns (skip) when the brand is confirmed absent (resolved=true)', async () => {
    resolveBrandResultForSite.resolves({ brand: null, resolved: true });
    expect(await run()).to.equal(null);
    expect(warnedWith(/No active brand/)).to.equal(true);
  });

  it('returns null and warns when brand resolution failed (resolved=false)', async () => {
    resolveBrandResultForSite.resolves({ brand: null, resolved: false });
    expect(await run()).to.equal(null);
    expect(warnedWith(/transient/)).to.equal(true);
  });

  // --- entitlement gate (before any Semrush HTTP call) -----------------------

  it('returns null and does not call Semrush when the brand is not entitled', async () => {
    resolveSemrushEntitlement.resolves({
      entitled: false, resolved: true, reason: SEMRUSH_ENTITLEMENT_REASONS.NO_WORKSPACE,
    });
    const diagnostics = {};
    const onProgress = sandbox.stub().resolves();

    const result = await run({}, {}, onProgress, diagnostics);

    expect(result).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal(SEMRUSH_NOT_ENTITLED_REASON);
    expect(diagnostics.entitlementReason).to.equal(SEMRUSH_ENTITLEMENT_REASONS.NO_WORKSPACE);
    expect(fetchStub).to.not.have.been.called;
    expect(getS2sSessionAuthorizationStub).to.not.have.been.called;
    expect(getImsOrgIdStub).to.not.have.been.called;
    expect(log.warn).to.have.been.calledWithMatch(/Brand not entitled for Semrush.*entitlementReason=no_workspace/);
    expect(onProgress).to.have.been.calledWith(
      ':information_source: Brand is not entitled for Semrush — falling back to the legacy source.',
    );
  });

  it('returns null and warns (not entitled, transient) when the entitlement check itself fails', async () => {
    resolveSemrushEntitlement.resolves({
      entitled: false, resolved: false, reason: SEMRUSH_ENTITLEMENT_REASONS.CHECK_FAILED,
    });
    const diagnostics = {};
    const onProgress = sandbox.stub().resolves();

    const result = await run({}, {}, onProgress, diagnostics);

    expect(result).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal(SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON);
    expect(diagnostics.entitlementReason).to.equal(SEMRUSH_ENTITLEMENT_REASONS.CHECK_FAILED);
    expect(fetchStub).to.not.have.been.called;
    expect(warnedWith(/entitlement check failed \(transient\)/)).to.equal(true);
    expect(onProgress).to.have.been.calledWith(
      ':warning: Could not verify Semrush entitlement (transient) — falling back to the legacy source.',
    );
  });

  it('passes the resolved orgId/brandId to the entitlement check and proceeds when entitled', async () => {
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

  // --- IMS org id resolution (leg 1) ----------------------------------------

  it('returns null (no_ims_org_id) and never requests a session token when the customer IMS org id cannot be resolved', async () => {
    getImsOrgIdStub.resolves(null);
    const diagnostics = {};
    const onProgress = sandbox.stub().resolves();

    const result = await run({}, {}, onProgress, diagnostics);

    expect(result).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('no_ims_org_id');
    expect(getS2sSessionAuthorizationStub).to.not.have.been.called;
    expect(fetchStub).to.not.have.been.called;
    expect(warnedWith(/Could not resolve customer IMS org id/)).to.equal(true);
    expect(onProgress).to.have.been.calledWith(
      ':x: Could not resolve the customer IMS org id — falling back to the legacy source.',
    );
  });

  it('passes the site and dataAccess through to getImsOrgId', async () => {
    const dataAccess = { Organization: {} };
    await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: { log, env: {}, dataAccess },
    });
    expect(getImsOrgIdStub).to.have.been.calledOnce;
    expect(getImsOrgIdStub.firstCall.args[0]).to.equal(site);
    expect(getImsOrgIdStub.firstCall.args[1]).to.equal(dataAccess);
  });

  it('defaults dataAccess to an empty object when the context omits it', async () => {
    await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: { log, env: {} },
    });
    expect(getImsOrgIdStub.firstCall.args[1]).to.deep.equal({});
  });

  it('prefers a threaded imsOrgId and skips the getImsOrgId lookup', async () => {
    await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(), imsOrgId: 'threaded@AdobeOrg',
    });
    expect(getImsOrgIdStub).to.not.have.been.called;
    expect(getS2sSessionAuthorizationStub.firstCall.args[0].imsOrgId).to.equal('threaded@AdobeOrg');
  });

  // --- IMS token minting (leg 2) --------------------------------------------

  it('returns null (ims_token_failed) when the IMS service token cannot be minted', async () => {
    getS2sSessionAuthorizationStub.rejects(Object.assign(new Error('ims down'), { reason: 'ims_token_failed' }));
    const diagnostics = {};
    expect(await run({}, {}, undefined, diagnostics)).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('ims_token_failed');
    expect(warnedWith(/Failed to obtain IMS service token/)).to.equal(true);
  });

  it('logs non-secret IMS config on ims_token_failed (host, clientId, scope, secret presence)', async () => {
    getS2sSessionAuthorizationStub.rejects(Object.assign(new Error('ims down'), { reason: 'ims_token_failed' }));
    await run({
      SEMRUSH_S2S_IMS_HOST: 'ims-na1.adobelogin.com',
      SEMRUSH_S2S_CLIENT_ID: 'cid',
      SEMRUSH_S2S_CLIENT_SECRET: 'sec',
      SEMRUSH_S2S_CLIENT_SCOPE: 'openid,AdobeID',
    });
    expect(warnedWith(/imsHost=ims-na1\.adobelogin\.com/)).to.equal(true);
    expect(warnedWith(/imsClientId=cid/)).to.equal(true);
    expect(warnedWith(/imsScope=openid,AdobeID/)).to.equal(true);
    expect(warnedWith(/hasClientSecret=true/)).to.equal(true);
  });

  it('reports hasClientSecret=false and no gotcha flags when config is absent', async () => {
    getS2sSessionAuthorizationStub.rejects(Object.assign(new Error('ims down'), { reason: 'ims_token_failed' }));
    await run();
    expect(warnedWith(/hasClientSecret=false/)).to.equal(true);
    expect(warnedWith(/imsHostHasScheme=/)).to.equal(false);
    expect(warnedWith(/imsScopeHasSpaces=/)).to.equal(false);
  });

  it('flags a scheme in SEMRUSH_S2S_IMS_HOST on ims_token_failed (the ENOTFOUND https bug)', async () => {
    getS2sSessionAuthorizationStub.rejects(Object.assign(new Error('getaddrinfo ENOTFOUND https'), { reason: 'ims_token_failed' }));
    await run({ SEMRUSH_S2S_IMS_HOST: 'https://ims-na1.adobelogin.com' });
    expect(warnedWith(/imsHostHasScheme=true/)).to.equal(true);
  });

  it('flags whitespace in SEMRUSH_S2S_CLIENT_SCOPE on ims_token_failed', async () => {
    getS2sSessionAuthorizationStub.rejects(Object.assign(new Error('invalid_scope'), { reason: 'ims_token_failed' }));
    await run({ SEMRUSH_S2S_CLIENT_SCOPE: 'openid, AdobeID' });
    expect(warnedWith(/imsScopeHasSpaces=true/)).to.equal(true);
  });

  // --- session token exchange (leg 3) ---------------------------------------

  it('splits a 403 session-token denial into session_token_auth_failed, logs the body, but keeps it out of Slack', async () => {
    const denyBody = 'Denied - reason=no-org-access secret=abc123';
    getS2sSessionAuthorizationStub.rejects(Object.assign(new Error('s2s login returned 403'), {
      reason: 'session_token_auth_failed', status: 403, responseBody: denyBody,
    }));
    const diagnostics = {};
    const onProgress = sandbox.stub().resolves();
    const result = await run({}, {}, onProgress, diagnostics);

    expect(result).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('session_token_auth_failed');
    expect(dataCall()).to.equal(undefined); // never reaches the data call
    expect(warnedWith(/session-token exchange denied/)).to.equal(true);
    // The untrusted upstream body is captured in the structured log...
    expect(log.warn.getCalls().some((c) => c.args[0].includes(`responseBody="${denyBody}"`))).to.equal(true);
    // ...but only the status (never the body) is forwarded to the user-facing Slack notify.
    const slack = onProgress.getCalls().map((c) => c.args[0]);
    expect(slack.some((m) => /S2S session token.*HTTP 403/.test(m))).to.equal(true);
    expect(slack.some((m) => m.includes(denyBody))).to.equal(false);
  });

  it('treats a 401 session-token denial as session_token_auth_failed too', async () => {
    getS2sSessionAuthorizationStub.rejects(Object.assign(new Error('s2s login returned 401'), {
      reason: 'session_token_auth_failed', status: 401,
    }));
    const diagnostics = {};
    expect(await run({}, {}, undefined, diagnostics)).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('session_token_auth_failed');
  });

  it('returns null (session_token_failed) on a non-auth non-2xx session-token response', async () => {
    getS2sSessionAuthorizationStub.rejects(Object.assign(new Error('s2s login returned 500'), {
      reason: 'session_token_failed', status: 500,
    }));
    const diagnostics = {};
    expect(await run({}, {}, undefined, diagnostics)).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('session_token_failed');
    expect(warnedWith(/Failed to exchange for an S2S session token/)).to.equal(true);
  });

  it('returns null (session_token_failed) on a network error (no status -> no HTTP suffix in Slack)', async () => {
    getS2sSessionAuthorizationStub.rejects(Object.assign(new Error('login down'), { reason: 'session_token_failed' }));
    const diagnostics = {};
    const onProgress = sandbox.stub().resolves();
    expect(await run({}, {}, onProgress, diagnostics)).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('session_token_failed');
    const slack = onProgress.getCalls().map((c) => c.args[0]);
    expect(slack.some((m) => /Failed to obtain an S2S session token — falling back/.test(m))).to.equal(true);
  });

  // --- session token eviction on a data-call rejection -----------------------

  it('evicts the cached session token when the data call rejects it (401), logging wasCachedToken', async () => {
    // A cache-hit token (fromCache=true) that the data call then rejects (401) must be evicted
    // so the next run re-mints instead of replaying a revoked/rotated token.
    getS2sSessionAuthorizationStub.resolves({
      authorization: `Bearer ${SESSION_TOKEN}`, sessionToken: SESSION_TOKEN, fromCache: true,
    });
    fetchStub.resolves({ ok: false, status: 401 });
    const diagnostics = {};

    const result = await run({}, {}, undefined, diagnostics);

    expect(result).to.equal(null);
    expect(diagnostics.fallbackReason).to.equal('domain_urls_auth_failed');
    expect(evictS2sSessionTokenStub).to.have.been.calledOnceWith(IMS_ORG_ID);
    // The stale-cache signal is logged so ops can tell it apart from a broken registration.
    expect(log.warn.getCalls().some((c) => c.args[0].includes('wasCachedToken=true'))).to.equal(true);
  });

  it('does not evict on a non-auth data failure (500) — only auth rejections poison the token', async () => {
    fetchStub.resolves({ ok: false, status: 500 });
    await run();
    expect(evictS2sSessionTokenStub).to.not.have.been.called;
  });

  // --- granted consumer identity (decoded from the session token) ------------

  const grantLine = () => log.info.getCalls()
    .map((c) => c.args[0])
    .find((m) => /Obtained S2S session token/.test(m));

  it('logs the granted consumer identity decoded from the session token on a fresh mint', async () => {
    getS2sSessionAuthorizationStub.resolves({
      authorization: 'Bearer x',
      sessionToken: makeJwt({
        client_id: 'consumer-cid', is_s2s_consumer: true, sub: 's2s:consumer-cid', tenants: [{ id: 'o1' }, { id: 'o2' }], consumerId: 'cons-123',
      }),
      fromCache: false,
    });
    await run();
    expect(grantLine()).to.match(/consumerClientId=consumer-cid/);
    expect(grantLine()).to.match(/isS2sConsumer=true/);
    expect(grantLine()).to.match(/consumerId=cons-123/);
    expect(grantLine()).to.match(/tenantCount=2/);
  });

  it('does not log the grant line on a cache hit (fromCache=true)', async () => {
    getS2sSessionAuthorizationStub.resolves({
      authorization: `Bearer ${SESSION_TOKEN}`, sessionToken: SESSION_TOKEN, fromCache: true,
    });
    await run();
    expect(grantLine()).to.equal(undefined);
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
