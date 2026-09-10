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
const IMS_ORG_ID = '899D173E60B73D8B0A495C0A@AdobeOrg';
const SITE_ID = '5b0d4d6e-3d2e-4a5b-8e2a-9b6f7c9c1e2a';
const PREVIOUS_WEEKS = [{ week: 29, year: 2026 }, { week: 28, year: 2026 }];
const DATE_WINDOW = { startDate: '2026-07-06', endDate: '2026-08-02' };

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const isLogin = (u) => String(u).includes('/auth/s2s/login');

describe('offsite-brand-presence-semrush-auth-probe', function () {
  this.timeout(10000);

  let sandbox;
  let log;
  let fetchStub;
  let resolveBrandResultForSite;
  let getImsOrgIdStub;
  let getDateWindowStub;
  let getServiceAccessToken;
  let imsCreateFrom;
  let mod;

  const site = {
    getOrganizationId: () => ORG_ID,
    getId: () => SITE_ID,
  };
  const makeContext = (env = {}) => ({ log, env, dataAccess: {} });

  const dataCalls = () => fetchStub.getCalls().filter((c) => !isLogin(c.args[0]));
  const loginCalls = () => fetchStub.getCalls().filter((c) => isLogin(c.args[0]));
  const infoWith = (re) => log.info.getCalls().some((c) => re.test(c.args[0]));
  const warnWith = (re) => log.warn.getCalls().some((c) => re.test(c.args[0]));

  async function loadModule() {
    return esmock('../../src/utils/offsite-brand-presence-semrush-auth-probe.js', {
      '@adobe/spacecat-shared-ims-client': { ImsClient: { createFrom: imsCreateFrom } },
      '@adobe/spacecat-shared-utils': { ...spacecatSharedUtils, tracingFetch: fetchStub },
      '../../src/utils/brand-resolver.js': { resolveBrandResultForSite },
      '../../src/utils/data-access.js': { getImsOrgId: getImsOrgIdStub },
      '../../src/utils/offsite-brand-presence-postgrest.js': {
        getDateWindowForPreviousWeeks: getDateWindowStub,
      },
    });
  }

  const run = (env = {}, imsOrgId = undefined) => mod.runSemrushAuthProbes({
    site, previousWeeks: PREVIOUS_WEEKS, context: makeContext(env), imsOrgId,
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    fetchStub = sandbox.stub();
    fetchStub.withArgs(sinon.match(isLogin)).resolves(okJson({ sessionToken: 'sess-jwt' }));
    fetchStub.resolves(okJson({ urls: [] })); // default = domain-urls
    resolveBrandResultForSite = sandbox.stub()
      .resolves({ brand: { brandId: BRAND_ID }, resolved: true });
    getImsOrgIdStub = sandbox.stub().resolves(IMS_ORG_ID);
    getDateWindowStub = sandbox.stub().returns(DATE_WINDOW);
    getServiceAccessToken = sandbox.stub().resolves({ token_type: 'Bearer', access_token: 'ims-tok' });
    imsCreateFrom = sandbox.stub().returns({ getServiceAccessToken });
    mod = await loadModule();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // --- happy path: both probes run ------------------------------------------

  it('runs probe A (login->data) then probe B (direct) using the existing IMS client', async () => {
    await run();

    expect(getServiceAccessToken).to.have.been.calledOnce; // one IMS token, reused
    expect(loginCalls().length).to.equal(1);
    expect(dataCalls().length).to.equal(2); // probe A (session token) + probe B (direct)

    // Probe A login succeeded and yielded a session token.
    expect(infoWith(/login_existing_ims\] login.*sessionToken received/)).to.equal(true);
    // Both probes hit domain-urls; default 200 -> authorized.
    expect(infoWith(/login_existing_ims\] domain-urls: HTTP 200 \(authorized\)/)).to.equal(true);
    expect(infoWith(/direct_ims\] domain-urls: HTTP 200 \(authorized\)/)).to.equal(true);
  });

  it('sends the IMS bearer to the login POST and the session token to probe A domain-urls', async () => {
    await run();
    const login = loginCalls()[0];
    expect(login.args[1].method).to.equal('POST');
    expect(login.args[1].headers.Authorization).to.equal('Bearer ims-tok');
    expect(JSON.parse(login.args[1].body)).to.deep.equal({ imsOrgId: IMS_ORG_ID });

    const probeA = dataCalls()[0];
    expect(probeA.args[1].headers.Authorization).to.equal('Bearer sess-jwt');
    const probeB = dataCalls()[1];
    expect(probeB.args[1].headers.Authorization).to.equal('Bearer ims-tok'); // direct: raw IMS
  });

  it('logs the IMS client id used (identifier, not a secret)', async () => {
    await run({ IMS_CLIENT_ID: 'the-worker-client-id' });
    expect(infoWith(/imsClientId=the-worker-client-id/)).to.equal(true);
  });

  it('prefers a threaded imsOrgId and skips the getImsOrgId lookup', async () => {
    await run({}, 'threaded@AdobeOrg');
    expect(getImsOrgIdStub).to.not.have.been.called;
    expect(JSON.parse(loginCalls()[0].args[1].body)).to.deep.equal({ imsOrgId: 'threaded@AdobeOrg' });
  });

  it('falls back to getImsOrgId when no imsOrgId is threaded', async () => {
    await run();
    expect(getImsOrgIdStub).to.have.been.calledOnceWith(site, sinon.match.object);
  });

  it('defaults dataAccess to an empty object when the context omits it', async () => {
    await mod.runSemrushAuthProbes({
      site, previousWeeks: PREVIOUS_WEEKS, context: { log, env: {} },
    });
    expect(getImsOrgIdStub.firstCall.args[1]).to.deep.equal({});
  });

  // --- prerequisites --------------------------------------------------------

  it('skips when the site has no organization id', async () => {
    const bare = { getOrganizationId: () => null, getId: () => SITE_ID };
    await mod.runSemrushAuthProbes({
      site: bare, previousWeeks: PREVIOUS_WEEKS, context: makeContext(),
    });
    expect(warnWith(/skipped — missing prerequisites/)).to.equal(true);
    expect(fetchStub).to.not.have.been.called;
  });

  it('skips when no active brand resolves', async () => {
    resolveBrandResultForSite.resolves({ brand: null, resolved: true });
    await run();
    expect(warnWith(/missing prerequisites/)).to.equal(true);
    expect(fetchStub).to.not.have.been.called;
  });

  it('skips when the customer IMS org id cannot be resolved', async () => {
    getImsOrgIdStub.resolves(null);
    await run();
    expect(warnWith(/missing prerequisites/)).to.equal(true);
    expect(fetchStub).to.not.have.been.called;
  });

  it('skips when no date window can be derived', async () => {
    getDateWindowStub.returns(null);
    await run();
    expect(warnWith(/missing prerequisites/)).to.equal(true);
    expect(fetchStub).to.not.have.been.called;
  });

  // --- IMS mint -------------------------------------------------------------

  it('logs ims_mint_failed and runs no probes when the IMS token cannot be minted', async () => {
    getServiceAccessToken.rejects(new Error('ims down'));
    await run();
    expect(warnWith(/could not mint an IMS token/)).to.equal(true);
    expect(fetchStub).to.not.have.been.called;
  });

  it('logs ims_mint_failed when the IMS token response has no access_token', async () => {
    getServiceAccessToken.resolves({ token_type: 'Bearer' });
    await run();
    expect(warnWith(/could not mint an IMS token/)).to.equal(true);
    expect(fetchStub).to.not.have.been.called;
  });

  // --- probe A (login exchange) --------------------------------------------

  it('logs a login rejection (non-2xx) and does not call domain-urls for probe A', async () => {
    fetchStub.withArgs(sinon.match(isLogin)).resolves({ ok: false, status: 403, text: async () => 'no-access' });
    await run();
    expect(warnWith(/login_existing_ims\] login: HTTP 403 \(rejected/)).to.equal(true);
    expect(warnWith(/responseBody=no-access/)).to.equal(true);
    // Probe A skipped its data call; only probe B (direct) hits domain-urls.
    expect(dataCalls().length).to.equal(1);
  });

  it('logs a login network error for probe A', async () => {
    fetchStub.withArgs(sinon.match(isLogin)).rejects(new Error('login net down'));
    await run();
    expect(warnWith(/login_existing_ims\] login request failed \(network\)/)).to.equal(true);
    expect(dataCalls().length).to.equal(1); // only probe B
  });

  it('logs when login is 200 but the body has no sessionToken', async () => {
    fetchStub.withArgs(sinon.match(isLogin)).resolves(okJson({ notAToken: true }));
    await run();
    expect(warnWith(/login: HTTP 200 but no sessionToken/)).to.equal(true);
    expect(dataCalls().length).to.equal(1); // only probe B
  });

  it('treats an unparseable login body as no sessionToken', async () => {
    fetchStub.withArgs(sinon.match(isLogin)).resolves({
      ok: true, status: 200, json: async () => { throw new Error('bad json'); },
    });
    await run();
    expect(warnWith(/no sessionToken/)).to.equal(true);
    expect(dataCalls().length).to.equal(1);
  });

  // --- domain-urls outcomes (shared by both probes) -------------------------

  it('logs a non-authorized domain-urls result with the response body', async () => {
    fetchStub.withArgs(sinon.match((u) => !isLogin(u)))
      .resolves({ ok: false, status: 401, text: async () => 'denied' });
    await run();
    expect(warnWith(/domain-urls: HTTP 401 \(not authorized\)/)).to.equal(true);
    expect(warnWith(/responseBody=denied/)).to.equal(true);
  });

  it('tolerates an unreadable error body (text() throws) — no responseBody token emitted', async () => {
    fetchStub.withArgs(sinon.match((u) => !isLogin(u)))
      .resolves({ ok: false, status: 500, text: async () => { throw new Error('unreadable'); } });
    await run();
    expect(warnWith(/domain-urls: HTTP 500 \(not authorized\)/)).to.equal(true);
    expect(log.warn.getCalls().some((c) => /status=500/.test(c.args[0]) && !/responseBody=/.test(c.args[0]))).to.equal(true);
  });

  it('handles an empty domain-urls error body (no responseBody token emitted)', async () => {
    fetchStub.withArgs(sinon.match((u) => !isLogin(u)))
      .resolves({ ok: false, status: 500, text: async () => '' });
    await run();
    expect(log.warn.getCalls().some((c) => /status=500/.test(c.args[0]) && !/responseBody=/.test(c.args[0]))).to.equal(true);
  });

  it('logs a domain-urls network error', async () => {
    fetchStub.withArgs(sinon.match((u) => !isLogin(u))).rejects(new Error('data net down'));
    await run();
    expect(warnWith(/domain-urls request failed \(network\)/)).to.equal(true);
  });

  // --- crash safety ---------------------------------------------------------

  it('swallows any unexpected error and never throws (audit unaffected)', async () => {
    resolveBrandResultForSite.rejects(new Error('unexpected'));
    await run(); // must not throw
    expect(warnWith(/Auth probe crashed \(swallowed/)).to.equal(true);
  });

  it('honours LLMO_API_BASE_URL / LLMO_S2S_LOGIN_URL overrides', async () => {
    await run({
      LLMO_API_BASE_URL: 'https://stage.example',
      LLMO_S2S_LOGIN_URL: 'https://stage.example/api/ci/auth/s2s/login',
    });
    expect(loginCalls()[0].args[0]).to.equal('https://stage.example/api/ci/auth/s2s/login');
    expect(dataCalls()[0].args[0]).to.contain('https://stage.example/v2/orgs/');
  });
});
