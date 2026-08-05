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

use(sinonChai);

const ORG_ID = 'e07a0aae-b794-41f6-9622-a602203c5a3e';
const BRAND_ID = 'cb84e91a-f7e9-488b-8220-e0d031941cd7';
const PREVIOUS_WEEKS = [{ week: 29, year: 2026 }, { week: 28, year: 2026 }];

const YT_URL = 'https://www.youtube.com/watch?v=abc';
const RD_URL = 'https://www.reddit.com/r/Lovesac/comments/1/pros_cons';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

describe('offsite-brand-presence-semrush', function () {
  this.timeout(10000);

  let sandbox;
  let log;
  let fetchStub;
  let resolveBrandForSite;
  let getServiceAccessTokenV3;
  let imsCreateFrom;
  let mod;

  const site = { getOrganizationId: () => ORG_ID };

  const makeContext = (env = {}, extra = {}) => ({ log, env, ...extra });

  async function loadModule() {
    return esmock('../../src/utils/offsite-brand-presence-semrush.js', {
      '@adobe/spacecat-shared-ims-client': {
        ImsClient: { createFrom: imsCreateFrom },
      },
      '../../src/utils/brand-resolver.js': { resolveBrandForSite },
    });
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    fetchStub = sandbox.stub(global, 'fetch');
    resolveBrandForSite = sandbox.stub().resolves({ brandId: BRAND_ID });
    getServiceAccessTokenV3 = sandbox.stub().resolves({ token_type: 'Bearer', access_token: 'tok' });
    imsCreateFrom = sandbox.stub().returns({ getServiceAccessTokenV3 });
    mod = await loadModule();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // --- happy path -----------------------------------------------------------

  it('loads youtube + reddit cited URLs and maps count=citations, domain', async () => {
    fetchStub.callsFake(async (url) => {
      const hostname = new URL(url).searchParams.get('hostname');
      return hostname === 'youtube.com'
        ? okJson({ urls: [{ url: YT_URL, citations: 10 }] })
        : okJson({ urls: [{ url: RD_URL, citations: 7 }] });
    });

    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });

    expect(fetchStub).to.have.been.calledTwice;
    // youtube watch?v=abc is normalized to the youtu.be canonical form
    expect(allUrls.get('https://youtu.be/abc')).to.deep.equal({ count: 10, domain: 'youtube.com' });
    expect(allUrls.get(RD_URL)).to.deep.equal({ count: 7, domain: 'reddit.com' });
  });

  it('sends Authorization but no platform param by default, and no x-promise-token', async () => {
    fetchStub.resolves(okJson({ urls: [] }));

    await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });

    const [url, opts] = fetchStub.firstCall.args;
    expect(new URL(url).searchParams.has('platform')).to.equal(false);
    expect(url).to.contain(`${mod.SPACECAT_API_DEFAULT_BASE_URL}/v2/orgs/${ORG_ID}/brands/${BRAND_ID}`);
    expect(opts.headers.Authorization).to.equal('Bearer tok');
    expect(opts.headers).to.not.have.property('x-promise-token');
  });

  it('forwards x-promise-token when present on the context', async () => {
    fetchStub.resolves(okJson({ urls: [] }));

    await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext({}, { promiseToken: 'ptok' }),
    });

    expect(fetchStub.firstCall.args[1].headers['x-promise-token']).to.equal('ptok');
  });

  it('honours the SPACECAT_API_URI override', async () => {
    fetchStub.resolves(okJson({ urls: [] }));

    await mod.loadCitedUrlsFromSemrush({
      site,
      previousWeeks: PREVIOUS_WEEKS,
      context: makeContext({ SPACECAT_API_URI: 'https://stage.example/api' }),
    });

    expect(fetchStub.firstCall.args[0]).to.contain('https://stage.example/api/v2/orgs/');
  });

  it('queries per platform and SUMS citations across engines', async () => {
    fetchStub.callsFake(async (url) => {
      const params = new URL(url).searchParams;
      const hostname = params.get('hostname');
      const platform = params.get('platform');
      if (hostname === 'youtube.com') {
        return okJson({ urls: [{ url: YT_URL, citations: platform === 'google-ai-mode' ? 5 : 10 }] });
      }
      return okJson({ urls: [{ url: RD_URL, citations: 7 }] });
    });

    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site,
      previousWeeks: PREVIOUS_WEEKS,
      context: makeContext({ OFFSITE_SEMRUSH_PLATFORMS: 'search-gpt, google-ai-mode' }),
    });

    // 2 hostnames x 2 platforms
    expect(fetchStub.callCount).to.equal(4);
    expect(allUrls.get('https://youtu.be/abc').count).to.equal(15); // 10 + 5
    expect(allUrls.get(RD_URL).count).to.equal(14); // 7 + 7
  });

  it('filters owned URLs (siteHostname) and rows without a url; defaults missing citations to 0', async () => {
    fetchStub.callsFake(async (url) => {
      const hostname = new URL(url).searchParams.get('hostname');
      if (hostname === 'youtube.com') {
        return okJson({
          urls: [
            { url: YT_URL }, // missing citations -> 0
            { citations: 3 }, // no url -> skipped
          ],
        });
      }
      return okJson({ urls: [{ url: 'https://www.lovesac.com/owned', citations: 99 }] });
    });

    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(), siteHostname: 'lovesac.com',
    });

    expect(allUrls.get('https://youtu.be/abc')).to.deep.equal({ count: 0, domain: 'youtube.com' });
    expect([...allUrls.keys()]).to.not.include('https://www.lovesac.com/owned');
    expect(allUrls.size).to.equal(1);
  });

  it('treats a non-array urls body as empty', async () => {
    fetchStub.resolves(okJson({ notUrls: true }));
    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });
    expect(allUrls.size).to.equal(0);
  });

  // --- per-request error handling ------------------------------------------

  it('skips a hostname whose fetch rejects, keeping the other', async () => {
    fetchStub.callsFake(async (url) => {
      const hostname = new URL(url).searchParams.get('hostname');
      if (hostname === 'youtube.com') {
        throw new Error('network down');
      }
      return okJson({ urls: [{ url: RD_URL, citations: 7 }] });
    });

    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });

    expect(allUrls.get(RD_URL)).to.deep.equal({ count: 7, domain: 'reddit.com' });
    expect(log.error).to.have.been.called;
  });

  it('skips a non-2xx response', async () => {
    fetchStub.resolves({ ok: false, status: 500 });
    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });
    expect(allUrls.size).to.equal(0);
    expect(log.error).to.have.been.called;
  });

  it('skips a response whose body fails to parse', async () => {
    const throwingJson = async () => {
      throw new Error('bad json');
    };
    fetchStub.resolves({ ok: true, status: 200, json: throwingJson });
    const allUrls = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });
    expect(allUrls.size).to.equal(0);
    expect(log.error).to.have.been.called;
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

  it('returns null when no active brand resolves', async () => {
    resolveBrandForSite.resolves(null);
    const result = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });
    expect(result).to.equal(null);
  });

  it('returns null when the brand has no brandId', async () => {
    resolveBrandForSite.resolves({});
    const result = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });
    expect(result).to.equal(null);
  });

  it('returns null when no date window can be derived', async () => {
    const result = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: [], context: makeContext(),
    });
    expect(result).to.equal(null);
  });

  it('returns null when the IMS service token cannot be minted', async () => {
    getServiceAccessTokenV3.rejects(new Error('ims down'));
    const result = await mod.loadCitedUrlsFromSemrush({
      site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });
    expect(result).to.equal(null);
    expect(log.error).to.have.been.called;
  });

  // --- pure helpers ---------------------------------------------------------

  describe('getSemrushPlatforms', () => {
    it('defaults to a single omitted platform', () => {
      expect(mod.getSemrushPlatforms(undefined)).to.deep.equal([undefined]);
      expect(mod.getSemrushPlatforms({})).to.deep.equal([undefined]);
      expect(mod.getSemrushPlatforms({ OFFSITE_SEMRUSH_PLATFORMS: '   ' }))
        .to.deep.equal([undefined]);
    });

    it('parses a comma-separated list, trimming and dropping empties', () => {
      expect(mod.getSemrushPlatforms({ OFFSITE_SEMRUSH_PLATFORMS: 'search-gpt, ,google-ai-mode ' }))
        .to.deep.equal(['search-gpt', 'google-ai-mode']);
    });
  });

  describe('buildDomainUrlsUrl', () => {
    const baseArgs = {
      baseUrl: 'https://h/api', spaceCatId: 'o', brandId: 'b', hostname: 'reddit.com', startDate: '2026-07-06', endDate: '2026-08-02',
    };

    it('omits platform when not provided', () => {
      const url = mod.buildDomainUrlsUrl(baseArgs);
      expect(url).to.contain('/v2/orgs/o/brands/b/serenity/brand-presence/url-inspector/domain-urls?');
      expect(new URL(url).searchParams.has('platform')).to.equal(false);
      expect(new URL(url).searchParams.get('hostname')).to.equal('reddit.com');
    });

    it('includes platform when provided', () => {
      const url = mod.buildDomainUrlsUrl({ ...baseArgs, platform: 'search-gpt' });
      expect(new URL(url).searchParams.get('platform')).to.equal('search-gpt');
    });
  });
});
