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
const SITE_ID = '5b0d4d6e-3d2e-4a5b-8e2a-9b6f7c9c1e2a';

const URL_A = 'https://www.youtube.com/watch?v=abc';
const URL_B = 'https://www.reddit.com/r/example/comments/1/post';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

describe('url-prompts-semrush', function () {
  this.timeout(10000);

  let sandbox;
  let log;
  let fetchStub;
  let resolveBrandResultForSite;
  let getAuthorizationHeader;
  let mod;

  const site = { getOrganizationId: () => ORG_ID, getId: () => SITE_ID };
  const makeContext = (env = {}, extra = {}) => ({ log, env, ...extra });

  async function loadModule(overrides = {}) {
    return esmock('../../src/utils/url-prompts-semrush.js', {
      '../../src/utils/brand-resolver.js': { resolveBrandResultForSite },
      '../../src/utils/offsite-brand-presence-semrush.js': {
        SPACECAT_API_DEFAULT_BASE_URL: 'https://spacecat.experiencecloud.live/api/v1',
        getAuthorizationHeader,
      },
      '@adobe/spacecat-shared-utils': { ...spacecatSharedUtils, tracingFetch: fetchStub },
      ...overrides,
    });
  }

  const run = (urls, env = {}, extra = {}) => mod.loadUrlPromptsFromSemrush({
    site, urls, context: makeContext(env, extra),
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    fetchStub = sandbox.stub();
    resolveBrandResultForSite = sandbox.stub()
      .resolves({ brand: { brandId: BRAND_ID }, resolved: true });
    getAuthorizationHeader = sandbox.stub().resolves('Bearer tok');
    mod = await loadModule();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns an empty Map without calling anything when urls is empty', async () => {
    const result = await run([]);
    expect(result.size).to.equal(0);
    expect(fetchStub).to.not.have.been.called;
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

  it('sends the expected query params, Authorization/Accept headers, and cross-model platform', async () => {
    fetchStub.resolves(okJson({ prompts: [] }));
    await run([{ url: URL_A }]);

    const [requestUrl, opts] = fetchStub.firstCall.args;
    const params = new URL(requestUrl).searchParams;
    expect(requestUrl).to.contain(`/v2/orgs/${ORG_ID}/brands/${BRAND_ID}/serenity/brand-presence/url-inspector/url-prompts?`);
    expect(params.get('url')).to.equal(URL_A);
    expect(params.get('platform')).to.equal('all');
    expect(params.get('startDate')).to.be.a('string');
    expect(params.get('endDate')).to.be.a('string');
    expect(opts.headers.Authorization).to.equal('Bearer tok');
    expect(opts.headers.Accept).to.equal('application/json');
    expect(opts.timeout).to.equal(10000);
  });

  it('forwards x-promise-token when present on the context', async () => {
    fetchStub.resolves(okJson({ prompts: [] }));
    await run([{ url: URL_A }], {}, { promiseToken: 'ptok' });
    expect(fetchStub.firstCall.args[1].headers['x-promise-token']).to.equal('ptok');
  });

  it('honours the SPACECAT_API_URI override', async () => {
    fetchStub.resolves(okJson({ prompts: [] }));
    await run([{ url: URL_A }], { SPACECAT_API_URI: 'https://stage.example/api' });
    expect(fetchStub.firstCall.args[0]).to.contain('https://stage.example/api/v2/orgs/');
  });

  it('omits a URL from the result when its request rejects (network error)', async () => {
    fetchStub.rejects(new Error('network down'));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(log.warn).to.have.been.called;
  });

  it('omits a URL from the result on a non-2xx response', async () => {
    fetchStub.resolves({ ok: false, status: 500 });
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
  });

  it('omits a URL from the result when the body fails to parse', async () => {
    fetchStub.resolves({
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json'); },
    });
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
  });

  it('treats falsy/empty prompt rows as no prompts', async () => {
    fetchStub.resolves(okJson({ prompts: [{ prompt: '' }, { notPrompt: true }] }));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
  });

  it('treats a non-array prompts body as no prompts', async () => {
    fetchStub.resolves(okJson({ prompts: null }));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
  });

  it('returns an empty Map when the site has no organization id', async () => {
    const result = await mod.loadUrlPromptsFromSemrush({
      site: { getOrganizationId: () => null, getId: () => SITE_ID },
      urls: [{ url: URL_A }],
      context: makeContext(),
    });
    expect(result.size).to.equal(0);
    expect(fetchStub).to.not.have.been.called;
  });

  it('returns an empty Map when no brand is resolved', async () => {
    resolveBrandResultForSite.resolves({ brand: null, resolved: true });
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(fetchStub).to.not.have.been.called;
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
  });

  it('returns an empty Map when the IMS service token cannot be minted', async () => {
    getAuthorizationHeader.rejects(new Error('ims down'));
    const result = await run([{ url: URL_A }]);
    expect(result.size).to.equal(0);
    expect(log.error).to.have.been.called;
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
