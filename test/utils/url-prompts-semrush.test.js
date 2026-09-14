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
const IMS_ORG_ID = '1234567890ABCDEF12345678@AdobeOrg';
const BRAND_ID = 'cb84e91a-f7e9-488b-8220-e0d031941cd7';
const SITE_ID = '5b0d4d6e-3d2e-4a5b-8e2a-9b6f7c9c1e2a';
const API_BASE = 'https://llmo.experiencecloud.live/api/v1';
const TIMEOUT_MS = 30_000;

const URL_A = 'https://www.youtube.com/watch?v=abc';
const URL_B = 'https://www.reddit.com/r/example/comments/1/post';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

describe('url-prompts-semrush', function () {
  this.timeout(10000);

  let sandbox;
  let log;
  let olog;
  let fetchStub;
  let resolveBrandResultForSite;
  let getImsOrgId;
  let getS2sSessionAuthorization;
  let evictS2sSessionToken;
  let resolveApiBaseUrl;
  let resolveSemrushTimeoutMs;
  let decodeS2sConsumerClaims;
  let mod;

  const site = { getOrganizationId: () => ORG_ID, getId: () => SITE_ID };
  const makeContext = (env = {}, extra = {}) => ({
    log, env, dataAccess: {}, ...extra,
  });

  async function loadModule(overrides = {}) {
    return esmock('../../src/utils/url-prompts-semrush.js', {
      '../../src/utils/brand-resolver.js': { resolveBrandResultForSite },
      '../../src/utils/data-access.js': { getImsOrgId },
      '../../src/utils/offsite-s2s-auth.js': {
        resolveApiBaseUrl,
        getS2sSessionAuthorization,
        evictS2sSessionToken,
        decodeS2sConsumerClaims,
      },
      '../../src/utils/offsite-brand-presence-semrush.js': {
        resolveSemrushTimeoutMs,
      },
      '@adobe/spacecat-shared-utils': { ...spacecatSharedUtils, tracingFetch: fetchStub },
      ...overrides,
    });
  }

  // Passes the mock olog by default; a couple of tests omit it to exercise the fallback logger.
  const run = (urls, env = {}, extra = {}, withOlog = true) => mod.loadUrlPromptsFromSemrush({
    site, urls, context: makeContext(env, extra), ...(withOlog && { olog }),
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    olog = {
      start: sandbox.stub(),
      success: sandbox.stub(),
      warn: sandbox.stub(),
      failure: sandbox.stub(),
      skip: sandbox.stub(),
      debug: sandbox.stub(),
    };
    fetchStub = sandbox.stub();
    resolveBrandResultForSite = sandbox.stub()
      .resolves({ brand: { brandId: BRAND_ID }, resolved: true });
    getImsOrgId = sandbox.stub().resolves(IMS_ORG_ID);
    getS2sSessionAuthorization = sandbox.stub()
      .resolves({ authorization: 'Bearer stok', sessionToken: 'stok', fromCache: false });
    evictS2sSessionToken = sandbox.stub();
    resolveApiBaseUrl = sandbox.stub().returns(API_BASE);
    resolveSemrushTimeoutMs = sandbox.stub().returns(TIMEOUT_MS);
    decodeS2sConsumerClaims = sandbox.stub().returns({ consumerClientId: 'consumer-1' });
    mod = await loadModule();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns an empty Map without calling anything when urls is empty', async () => {
    const result = await run([]);
    expect(result.size).to.equal(0);
    expect(fetchStub).to.not.have.been.called;
    expect(getS2sSessionAuthorization).to.not.have.been.called;
    expect(olog.start).to.not.have.been.called;
  });

  it('fetches prompts per URL, capped at MAX_URL_PROMPTS, keyed by url', async () => {
    fetchStub.callsFake(async (url) => {
      const target = new URL(url).searchParams.get('url');
      if (target === URL_A) {
        return okJson({
          prompts: Array.from({ length: 7 }, (_, i) => ({ prompt: `prompt-${i}` })),
        });
      }
      return okJson({ prompts: [{ prompt: 'only-one' }] });
    });

    const result = await run([{ url: URL_A }, { url: URL_B }]);

    expect(result.get(URL_A)).to.deep.equal(['prompt-0', 'prompt-1', 'prompt-2', 'prompt-3', 'prompt-4']);
    expect(result.get(URL_B)).to.deep.equal(['only-one']);
    expect(fetchStub.callCount).to.equal(2);
  });

  it('scopes the session token to the customer IMS org id', async () => {
    fetchStub.resolves(okJson({ prompts: [] }));
    await run([{ url: URL_A }]);
    expect(getS2sSessionAuthorization).to.have.been.calledWithMatch({ imsOrgId: IMS_ORG_ID });
  });

  it('tolerates a context without dataAccess when resolving the IMS org id', async () => {
    fetchStub.resolves(okJson({ prompts: [] }));
    await run([{ url: URL_A }], {}, { dataAccess: undefined });
    expect(getImsOrgId).to.have.been.calledWith(site, sinon.match.object, log);
  });

  it('sends query params, session-token Authorization/Accept, and the shared timeout', async () => {
    fetchStub.resolves(okJson({ prompts: [] }));
    await run([{ url: URL_A }]);

    const [requestUrl, opts] = fetchStub.firstCall.args;
    const params = new URL(requestUrl).searchParams;
    expect(requestUrl).to.contain(`${API_BASE}/v2/orgs/${ORG_ID}/brands/${BRAND_ID}/serenity/brand-presence/url-inspector/url-prompts?`);
    expect(params.get('url')).to.equal(URL_A);
    expect(params.get('platform')).to.equal('all');
    expect(params.get('startDate')).to.be.a('string');
    expect(params.get('endDate')).to.be.a('string');
    expect(opts.headers.Authorization).to.equal('Bearer stok');
    expect(opts.headers.Accept).to.equal('application/json');
    expect(opts.headers).to.not.have.property('x-promise-token');
    expect(opts.timeout).to.equal(TIMEOUT_MS);
    // url-prompts passes its own 30s default; the shared env override still applies to both.
    expect(resolveSemrushTimeoutMs).to.have.been.calledWith(sinon.match.any, 30_000);
  });

  it('uses the timeout resolved from env (shared OFFSITE_SEMRUSH_TIMEOUT_MS)', async () => {
    resolveSemrushTimeoutMs.returns(30_000);
    fetchStub.resolves(okJson({ prompts: [] }));
    await run([{ url: URL_A }]);
    expect(fetchStub.firstCall.args[1].timeout).to.equal(30_000);
  });

  it('builds the request URL from resolveApiBaseUrl (LLMO host + prefix)', async () => {
    resolveApiBaseUrl.returns('https://stage.example/api/ci');
    fetchStub.resolves(okJson({ prompts: [] }));
    await run([{ url: URL_A }]);
    expect(fetchStub.firstCall.args[0]).to.contain('https://stage.example/api/ci/v2/orgs/');
  });

  it('logs a start line with the request template and a degraded summary on per-URL failure', async () => {
    fetchStub.rejects(new Error('network down'));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(olog.start).to.have.been.calledWithMatch(
      'data_acquisition_url_prompts_read',
      sinon.match.string,
      sinon.match({ apiBaseUrl: API_BASE, urlCount: 1, requestUrlSample: sinon.match.string }),
    );
    expect(olog.warn).to.have.been.calledWithMatch(
      'data_acquisition_url_prompts_read',
      sinon.match.string,
      sinon.match({ tried: 1, errors: 1, totalPrompts: 0 }),
    );
    expect(evictS2sSessionToken).to.not.have.been.called;
  });

  it('logs a success summary with stats when every URL resolves', async () => {
    fetchStub.resolves(okJson({ prompts: [{ prompt: 'p1' }, { prompt: 'p2' }] }));
    await run([{ url: URL_A }, { url: URL_B }]);
    expect(olog.success).to.have.been.calledWithMatch(
      'data_acquisition_url_prompts_read',
      sinon.match.string,
      sinon.match({
        tried: 2, urlsWithPrompts: 2, totalPrompts: 4, ok: 2, non2xx: 0, errors: 0,
      }),
    );
    expect(olog.warn).to.not.have.been.called;
  });

  it('counts a non-auth non-2xx as a failure without evicting the token', async () => {
    fetchStub.resolves({ ok: false, status: 500 });
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(evictS2sSessionToken).to.not.have.been.called;
    expect(olog.warn.lastCall.args[2]).to.include({ non2xx: 1 });
  });

  it('evicts the cached session token when a request is rejected with 401/403', async () => {
    fetchStub.callsFake(async (url) => {
      const target = new URL(url).searchParams.get('url');
      if (target === URL_A) {
        return { ok: false, status: 403 };
      }
      return okJson({ prompts: [{ prompt: 'kept' }] });
    });
    const result = await run([{ url: URL_A }, { url: URL_B }]);
    expect(result.get(URL_B)).to.deep.equal(['kept']);
    expect(result.has(URL_A)).to.be.false;
    expect(evictS2sSessionToken).to.have.been.calledOnceWith(IMS_ORG_ID);
  });

  it('treats a body that fails to parse as a per-URL error', async () => {
    fetchStub.resolves({
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json'); },
    });
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(olog.warn.lastCall.args[2]).to.include({ errors: 1 });
  });

  it('treats falsy/empty prompt rows as no prompts (still a successful call)', async () => {
    fetchStub.resolves(okJson({ prompts: [{ prompt: '' }, { notPrompt: true }] }));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(olog.success.lastCall.args[2]).to.include({ ok: 1, urlsWithPrompts: 0 });
  });

  it('treats a non-array prompts body as no prompts', async () => {
    fetchStub.resolves(okJson({ prompts: null }));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(olog.success).to.have.been.called;
  });

  it('caps in-flight requests but still resolves every URL, order-independent', async () => {
    const urls = Array.from({ length: 12 }, (_, i) => ({ url: `https://ex.com/p/${i}` }));
    fetchStub.callsFake(async (url) => {
      const target = new URL(url).searchParams.get('url');
      return okJson({ prompts: [{ prompt: `for-${target}` }] });
    });
    const result = await run(urls);
    expect(result.size).to.equal(12);
    expect(fetchStub.callCount).to.equal(12);
    expect(result.get('https://ex.com/p/0')).to.deep.equal(['for-https://ex.com/p/0']);
    expect(result.get('https://ex.com/p/11')).to.deep.equal(['for-https://ex.com/p/11']);
  });

  it('falls back to a generic offsite logger when no olog is passed', async () => {
    fetchStub.resolves(okJson({ prompts: [{ prompt: 'p' }] }));
    const result = await run([{ url: URL_A }], {}, {}, false);
    expect(result.get(URL_A)).to.deep.equal(['p']);
    // The fallback createOffsiteLogger routes through context.log.
    expect(log.info).to.have.been.called;
  });

  it('returns an empty Map when the site has no organization id', async () => {
    const result = await mod.loadUrlPromptsFromSemrush({
      site: { getOrganizationId: () => null, getId: () => SITE_ID },
      urls: [{ url: URL_A }],
      context: makeContext(),
      olog,
    });
    expect(result.size).to.equal(0);
    expect(fetchStub).to.not.have.been.called;
    expect(olog.warn).to.have.been.calledWithMatch(sinon.match.string, sinon.match.string, sinon.match({ reason: 'no_organization_id' }));
  });

  it('returns an empty Map when no brand is resolved', async () => {
    resolveBrandResultForSite.resolves({ brand: null, resolved: true });
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(fetchStub).to.not.have.been.called;
    expect(olog.warn).to.have.been.calledWithMatch(sinon.match.string, sinon.match.string, sinon.match({ reason: 'no_active_brand' }));
  });

  it('returns an empty Map when no date window can be derived', async () => {
    mod = await loadModule({
      '../../src/utils/offsite-brand-presence-postgrest.js': {
        getDateWindowForPreviousWeeks: () => null,
      },
    });
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(fetchStub).to.not.have.been.called;
    expect(olog.warn).to.have.been.calledWithMatch(sinon.match.string, sinon.match.string, sinon.match({ reason: 'no_date_window' }));
  });

  it('returns an empty Map when the customer IMS org id cannot be resolved', async () => {
    getImsOrgId.resolves(null);
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(getS2sSessionAuthorization).to.not.have.been.called;
    expect(fetchStub).to.not.have.been.called;
    expect(olog.warn).to.have.been.calledWithMatch(sinon.match.string, sinon.match.string, sinon.match({ reason: 'no_ims_org_id' }));
  });

  it('logs a failure with reason/status and returns empty when the session token fails', async () => {
    const err = new Error('login 403');
    err.reason = 'session_token_auth_failed';
    err.status = 403;
    getS2sSessionAuthorization.rejects(err);
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(fetchStub).to.not.have.been.called;
    expect(olog.failure).to.have.been.calledWithMatch(
      'data_acquisition_url_prompts_read',
      sinon.match.string,
      sinon.match({ reason: 'session_token_auth_failed', status: 403 }),
    );
  });

  it('defaults the failure reason when the session-token error is unclassified', async () => {
    getS2sSessionAuthorization.rejects(new Error('ims down'));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(olog.failure.lastCall.args[2]).to.include({ reason: 'session_token_failed' });
  });

  // Best-effort contract: a THROW from a prerequisite resolver must not fail the audit.
  it('returns an empty Map when resolveBrandResultForSite rejects (never throws out)', async () => {
    resolveBrandResultForSite.rejects(new Error('data-access down'));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(fetchStub).to.not.have.been.called;
    expect(olog.failure.lastCall.args[2]).to.include({ reason: 'prerequisites_failed' });
  });

  it('returns an empty Map when getImsOrgId rejects (never throws out)', async () => {
    getImsOrgId.rejects(new Error('org lookup failed'));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(getS2sSessionAuthorization).to.not.have.been.called;
    expect(olog.failure.lastCall.args[2]).to.include({ reason: 'prerequisites_failed' });
  });

  it('coerces non-string prompt rows out and truncates oversized strings at ingestion', async () => {
    const huge = 'x'.repeat(9000);
    fetchStub.resolves(okJson({
      prompts: [
        { prompt: 42 }, // non-string → dropped
        { prompt: { nested: true } }, // non-string → dropped
        { prompt: 'kept' },
        { prompt: huge }, // oversized → truncated
      ],
    }));
    const result = await run([{ url: URL_A }]);
    const prompts = result.get(URL_A);
    expect(prompts).to.have.lengthOf(2);
    expect(prompts[0]).to.equal('kept');
    expect(prompts[1]).to.have.lengthOf(4096);
  });

  it('logs the granted consumer identity and cache state after obtaining the token', async () => {
    fetchStub.resolves(okJson({ prompts: [] }));
    await run([{ url: URL_A }]);
    expect(olog.debug).to.have.been.calledWithMatch(
      'data_acquisition_url_prompts_read',
      sinon.match.string,
      sinon.match({ fromCache: false, consumerClientId: 'consumer-1' }),
    );
  });

  it('honours OFFSITE_URL_PROMPTS_MAX for the per-URL prompt cap', async () => {
    fetchStub.resolves(okJson({
      prompts: Array.from({ length: 5 }, (_, i) => ({ prompt: `p${i}` })),
    }));
    const result = await run([{ url: URL_A }], { OFFSITE_URL_PROMPTS_MAX: '2' });
    expect(result.get(URL_A)).to.have.lengthOf(2);
  });

  it('preserves per-URL prompt mapping even when responses resolve out of order', async () => {
    // URL_A resolves AFTER URL_B; each url must still get ITS OWN prompts (no index misalignment).
    fetchStub.callsFake((requestUrl) => {
      const target = new URL(requestUrl).searchParams.get('url');
      const delay = target === URL_A ? 20 : 1;
      return new Promise((resolve) => {
        setTimeout(() => resolve(okJson({ prompts: [{ prompt: `for-${target}` }] })), delay);
      });
    });
    const result = await run([{ url: URL_A }, { url: URL_B }]);
    expect(result.get(URL_A)).to.deep.equal([`for-${URL_A}`]);
    expect(result.get(URL_B)).to.deep.equal([`for-${URL_B}`]);
  });

  describe('resolveMaxUrlPrompts', () => {
    const r = (env) => mod.resolveMaxUrlPrompts(env);

    it('defaults to MAX_URL_PROMPTS when unset or invalid', () => {
      expect(r(undefined)).to.equal(mod.MAX_URL_PROMPTS);
      expect(r({ OFFSITE_URL_PROMPTS_MAX: 'abc' })).to.equal(mod.MAX_URL_PROMPTS);
      expect(r({ OFFSITE_URL_PROMPTS_MAX: '0' })).to.equal(mod.MAX_URL_PROMPTS);
      expect(r({ OFFSITE_URL_PROMPTS_MAX: '2.5' })).to.equal(mod.MAX_URL_PROMPTS);
    });

    it('accepts a valid integer override and clamps to the ceiling', () => {
      expect(r({ OFFSITE_URL_PROMPTS_MAX: '10' })).to.equal(10);
      expect(r({ OFFSITE_URL_PROMPTS_MAX: '9999' })).to.equal(50);
    });
  });

  describe('enrichUrlsWithSemrushPrompts', () => {
    const enrich = (urls, limit) => mod.enrichUrlsWithSemrushPrompts({
      urls, site, context: makeContext(), olog, limit,
    });

    it('tags only the first `limit` URLs, attaches prompts, and leaves the rest untouched', async () => {
      fetchStub.callsFake((requestUrl) => {
        const target = new URL(requestUrl).searchParams.get('url');
        return okJson({ prompts: target === URL_A ? [{ prompt: 'pa' }] : [] });
      });
      const urls = [{ url: URL_A }, { url: URL_B }, { url: 'https://ex.com/x' }];
      const result = await enrich(urls, 2);
      expect(result[0]).to.include({ isUrlFromSemrush: true });
      expect(result[0].prompts).to.deep.equal(['pa']);
      expect(result[1]).to.include({ isUrlFromSemrush: true });
      expect(result[1].prompts).to.be.undefined;
      expect(result[2]).to.not.have.property('isUrlFromSemrush');
      expect(fetchStub.callCount).to.equal(2);
    });

    it('enriches every URL when no limit is provided', async () => {
      fetchStub.resolves(okJson({ prompts: [] }));
      const result = await enrich([{ url: URL_A }, { url: URL_B }]);
      expect(result.every((u) => u.isUrlFromSemrush)).to.be.true;
      expect(fetchStub.callCount).to.equal(2);
    });
  });

  describe('buildUrlPromptsUrl', () => {
    it('encodes path segments and defaults platform to "all"', () => {
      const url = mod.buildUrlPromptsUrl({
        baseUrl: 'https://h/api',
        spaceCatId: 'o/x',
        brandId: 'b?y',
        url: URL_A,
        startDate: '2026-07-06',
        endDate: '2026-08-02',
      });
      expect(url).to.contain('/v2/orgs/o%2Fx/brands/b%3Fy/serenity/brand-presence/url-inspector/url-prompts?');
      expect(new URL(url).searchParams.get('platform')).to.equal('all');
    });
  });
});
