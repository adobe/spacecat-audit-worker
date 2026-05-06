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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('brand-resolver (LLMO-4716)', () => {
  let sandbox;
  let mockFetch;
  let resolveBrandIdForSite;
  let log;

  const ORG_ID = 'org-uuid-1';
  const SITE_ID = 'site-uuid-1';
  const ENV = {
    SPACECAT_API_BASE_URL: 'https://spacecat.example.com/api/v1',
    SPACECAT_API_KEY: 'test-key',
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockFetch = sandbox.stub();
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mod = await esmock('../../src/utils/brand-resolver.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: mockFetch,
      },
    });
    resolveBrandIdForSite = mod.resolveBrandIdForSite;
  });

  afterEach(() => sandbox.restore());

  function makeResponse({
    status, ok, body, throwOnText, throwOnJson,
  }) {
    return {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      ok: ok !== undefined ? ok : status >= 200 && status < 300,
      json: throwOnJson
        ? sandbox.stub().rejects(new Error('bad json'))
        : sandbox.stub().resolves(body),
      text: throwOnText
        ? sandbox.stub().rejects(new Error('cannot read body'))
        : sandbox.stub().resolves(typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }

  it('throws when SPACECAT_API_BASE_URL is missing', async () => {
    await expect(resolveBrandIdForSite(ORG_ID, SITE_ID, { SPACECAT_API_KEY: 'k' }, log))
      .to.be.rejectedWith(/SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured/);
  });

  it('throws when SPACECAT_API_KEY is missing', async () => {
    await expect(resolveBrandIdForSite(ORG_ID, SITE_ID, { SPACECAT_API_BASE_URL: 'http://x' }, log))
      .to.be.rejectedWith(/SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured/);
  });

  it('throws when env is undefined', async () => {
    await expect(resolveBrandIdForSite(ORG_ID, SITE_ID, undefined, log))
      .to.be.rejectedWith(/SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured/);
  });

  it('throws when orgId is missing', async () => {
    await expect(resolveBrandIdForSite('', SITE_ID, ENV, log))
      .to.be.rejectedWith(/orgId and siteId are required/);
  });

  it('throws when siteId is missing', async () => {
    await expect(resolveBrandIdForSite(ORG_ID, '', ENV, log))
      .to.be.rejectedWith(/orgId and siteId are required/);
  });

  it('returns the brand id on 200', async () => {
    mockFetch.resolves(makeResponse({
      status: 200,
      body: { id: 'brand-uuid-42', name: 'Acme', status: 'active' },
    }));

    const result = await resolveBrandIdForSite(ORG_ID, SITE_ID, ENV, log);

    expect(result).to.equal('brand-uuid-42');
    expect(mockFetch).to.have.been.calledOnce;
    const [url, opts] = mockFetch.firstCall.args;
    expect(url).to.equal(
      `${ENV.SPACECAT_API_BASE_URL}/v2/orgs/${ORG_ID}/sites/${SITE_ID}/brand`,
    );
    expect(opts.headers).to.include({
      'x-api-key': ENV.SPACECAT_API_KEY,
      'User-Agent': 'spacecat-audit-worker/brand-resolver',
    });
    expect(opts.timeout).to.equal(30000);
  });

  it('returns null on 404', async () => {
    mockFetch.resolves(makeResponse({ status: 404, ok: false, body: 'Not Found' }));

    const result = await resolveBrandIdForSite(ORG_ID, SITE_ID, ENV, log);

    expect(result).to.be.null;
    expect(log.info).to.have.been.calledWith(
      sinon.match(/No v2 brand for org=/),
    );
  });

  it('throws on 5xx (fail-closed)', async () => {
    mockFetch.resolves(makeResponse({
      status: 503, ok: false, body: 'Service Unavailable',
    }));

    await expect(resolveBrandIdForSite(ORG_ID, SITE_ID, ENV, log))
      .to.be.rejectedWith(/503/);
  });

  it('handles 5xx body-read failure gracefully', async () => {
    mockFetch.resolves(makeResponse({
      status: 502, ok: false, throwOnText: true, body: 'unused',
    }));

    await expect(resolveBrandIdForSite(ORG_ID, SITE_ID, ENV, log))
      .to.be.rejectedWith(/502/);
  });

  it('throws on network error', async () => {
    mockFetch.rejects(new Error('connect ECONNREFUSED'));

    await expect(resolveBrandIdForSite(ORG_ID, SITE_ID, ENV, log))
      .to.be.rejectedWith(/network\/timeout/);
  });

  it('throws on non-JSON 200 body', async () => {
    mockFetch.resolves(makeResponse({
      status: 200, throwOnJson: true, body: '<html>',
    }));

    await expect(resolveBrandIdForSite(ORG_ID, SITE_ID, ENV, log))
      .to.be.rejectedWith(/non-JSON/);
  });

  it('returns null on 200 body with no id (treated as no brand)', async () => {
    mockFetch.resolves(makeResponse({ status: 200, body: { name: 'No-id' } }));

    const result = await resolveBrandIdForSite(ORG_ID, SITE_ID, ENV, log);
    expect(result).to.be.null;
    expect(log.warn).to.have.been.calledWith(
      sinon.match(/returned no id/),
    );
  });

  it('returns null on 200 body that is null', async () => {
    mockFetch.resolves(makeResponse({ status: 200, body: null }));

    const result = await resolveBrandIdForSite(ORG_ID, SITE_ID, ENV, log);
    expect(result).to.be.null;
  });

  it('returns null on 200 body where id is empty string', async () => {
    mockFetch.resolves(makeResponse({ status: 200, body: { id: '' } }));

    const result = await resolveBrandIdForSite(ORG_ID, SITE_ID, ENV, log);
    expect(result).to.be.null;
  });

  it('url-encodes orgId and siteId path segments', async () => {
    mockFetch.resolves(makeResponse({ status: 200, body: { id: 'b1' } }));

    await resolveBrandIdForSite('org with space', 'site/with/slashes', ENV, log);

    const [url] = mockFetch.firstCall.args;
    expect(url).to.equal(
      `${ENV.SPACECAT_API_BASE_URL}/v2/orgs/org%20with%20space/sites/site%2Fwith%2Fslashes/brand`,
    );
  });
});
