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

const IMS_ORG_ID = '899D173E60B73D8B0A495C0A@AdobeOrg';
const SESSION_TOKEN = 'sess-jwt-token';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const isLogin = (u) => String(u).includes('/auth/s2s/login');
// Builds a JWT-shaped token (`header.payload.signature`) whose payload encodes `claims`.
const makeJwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('offsite-s2s-auth', function () {
  this.timeout(10000);

  let sandbox;
  let fetchStub;
  let getServiceAccessTokenV3;
  let imsCreateFrom;
  let mod;

  const makeContext = (env = {}) => ({ env });
  const loginCall = () => fetchStub.getCalls().find((c) => isLogin(c.args[0]));
  const loginCallCount = () => fetchStub.getCalls().filter((c) => isLogin(c.args[0])).length;

  async function loadModule() {
    return esmock('../../src/utils/offsite-s2s-auth.js', {}, {
      '@adobe/spacecat-shared-ims-client': { ImsClient: { createFrom: imsCreateFrom } },
      '@adobe/spacecat-shared-utils': { ...spacecatSharedUtils, tracingFetch: fetchStub },
    });
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    fetchStub = sandbox.stub();
    fetchStub.withArgs(sinon.match(isLogin)).resolves(okJson({ sessionToken: SESSION_TOKEN }));
    getServiceAccessTokenV3 = sandbox.stub().resolves({ token_type: 'Bearer', access_token: 'tok' });
    imsCreateFrom = sandbox.stub().returns({ getServiceAccessTokenV3 });
    mod = await loadModule();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('resolveApiBaseUrl', () => {
    it('defaults to the LLMO host + /api/v1 prefix', () => {
      expect(mod.resolveApiBaseUrl(undefined)).to.equal('https://llmo.experiencecloud.live/api/v1');
    });

    it('honours LLMO_API_BASE_URL and LLMO_API_PREFIX overrides', () => {
      expect(mod.resolveApiBaseUrl({
        LLMO_API_BASE_URL: 'https://stage.example', LLMO_API_PREFIX: '/api/ci',
      })).to.equal('https://stage.example/api/ci');
    });
  });

  describe('getS2sSessionAuthorization', () => {
    const getAuth = (env = {}) => mod.getS2sSessionAuthorization({
      context: makeContext(env), imsOrgId: IMS_ORG_ID,
    });
    const capture = async (promise) => {
      try {
        await promise;
        return null;
      } catch (error) {
        return error;
      }
    };

    it('mints an IMS token, exchanges it, and returns the Bearer session token (fresh)', async () => {
      const auth = await getAuth();
      expect(auth).to.deep.equal({
        authorization: `Bearer ${SESSION_TOKEN}`,
        sessionToken: SESSION_TOKEN,
        fromCache: false,
      });
      expect(loginCallCount()).to.equal(1);
      expect(imsCreateFrom).to.have.been.called;
    });

    it('maps the SEMRUSH_S2S_* env into IMS_* and defaults the client-code placeholder', async () => {
      await getAuth({
        SEMRUSH_S2S_IMS_HOST: 'ims.example.com',
        SEMRUSH_S2S_CLIENT_ID: 'cid',
        SEMRUSH_S2S_CLIENT_SECRET: 'sec',
        SEMRUSH_S2S_CLIENT_SCOPE: 'openid,AdobeID',
      });
      const { env } = imsCreateFrom.firstCall.args[0];
      expect(env).to.include({
        IMS_HOST: 'ims.example.com',
        IMS_CLIENT_ID: 'cid',
        IMS_CLIENT_SECRET: 'sec',
        IMS_SCOPE: 'openid,AdobeID',
        // The client_credentials grant never sends the code, but createFrom validates it —
        // so a placeholder is set explicitly rather than surfacing as a confusing throw.
        IMS_CLIENT_CODE: 'unused-for-client-credentials',
      });
    });

    it('honours a SEMRUSH_S2S_CLIENT_CODE override for IMS_CLIENT_CODE', async () => {
      await getAuth({ SEMRUSH_S2S_CLIENT_CODE: 'real-code' });
      expect(imsCreateFrom.firstCall.args[0].env.IMS_CLIENT_CODE).to.equal('real-code');
    });

    it('sends a well-formed POST to the login endpoint with the imsOrgId body and Bearer IMS token', async () => {
      await getAuth();
      const [, opts] = loginCall().args;
      expect(opts.method).to.equal('POST');
      expect(opts.headers.Authorization).to.equal('Bearer tok');
      expect(opts.headers['Content-Type']).to.equal('application/json');
      expect(opts.headers.Accept).to.equal('application/json');
      expect(JSON.parse(opts.body)).to.deep.equal({ imsOrgId: IMS_ORG_ID });
      expect(opts.timeout).to.equal(10_000);
    });

    it('normalizes a lowercase token_type to a Bearer scheme on the IMS authorization', async () => {
      getServiceAccessTokenV3.resolves({ token_type: 'bearer', access_token: 'tok' });
      await getAuth();
      expect(loginCall().args[1].headers.Authorization).to.equal('Bearer tok');
    });

    // Both loaders (domain-urls + url-prompts) import getS2sSessionAuthorization from THIS one
    // module, so at runtime they share this single module-level cache — the "no double-mint
    // across entry points" guarantee is structural. A cross-loader esmock test can't prove it
    // (esmock gives each esmock() call its own module instance / cache), so it's asserted here on
    // the shared implementation both consumers route through.
    it('reuses the cached token for the same org (no double-mint), flagged fromCache', async () => {
      const first = await getAuth();
      const second = await getAuth();
      expect(first.fromCache).to.equal(false);
      expect(second.fromCache).to.equal(true);
      expect(second.authorization).to.equal(first.authorization);
      expect(loginCallCount()).to.equal(1);
      expect(getServiceAccessTokenV3).to.have.been.calledOnce;
    });

    it('honours the LLMO_S2S_LOGIN_URL override', async () => {
      await getAuth({ LLMO_S2S_LOGIN_URL: 'https://alt.example/auth/s2s/login' });
      expect(loginCall().args[0]).to.equal('https://alt.example/auth/s2s/login');
    });

    it('throws with reason=ims_token_failed when the IMS mint fails', async () => {
      getServiceAccessTokenV3.rejects(new Error('ims down'));
      const error = await capture(getAuth());
      expect(error).to.be.an('error');
      expect(error.reason).to.equal('ims_token_failed');
      expect(loginCallCount()).to.equal(0);
    });

    it('throws with reason=ims_token_failed when the token response has no access_token', async () => {
      getServiceAccessTokenV3.resolves({ token_type: 'Bearer' });
      const error = await capture(getAuth());
      expect(error.reason).to.equal('ims_token_failed');
    });

    it('throws with reason=session_token_auth_failed on a 403 exchange (with body)', async () => {
      fetchStub.withArgs(sinon.match(isLogin))
        .resolves({ ok: false, status: 403, text: async () => 'denied' });
      const error = await capture(getAuth());
      expect(error.reason).to.equal('session_token_auth_failed');
      expect(error.status).to.equal(403);
      expect(error.responseBody).to.equal('denied');
    });

    it('classifies a 401 exchange as session_token_auth_failed too', async () => {
      fetchStub.withArgs(sinon.match(isLogin))
        .resolves({ ok: false, status: 401, text: async () => '' });
      const error = await capture(getAuth());
      expect(error.reason).to.equal('session_token_auth_failed');
      expect(error.status).to.equal(401);
    });

    it('throws with reason=session_token_failed on a non-auth exchange failure', async () => {
      fetchStub.withArgs(sinon.match(isLogin))
        .resolves({ ok: false, status: 500, text: async () => 'boom' });
      const error = await capture(getAuth());
      expect(error.reason).to.equal('session_token_failed');
    });

    it('throws when the login response is not parseable JSON', async () => {
      fetchStub.withArgs(sinon.match(isLogin)).resolves({
        ok: true, status: 200, json: async () => { throw new Error('bad json'); },
      });
      const error = await capture(getAuth());
      expect(error).to.be.an('error');
    });

    it('throws when the login response is missing sessionToken', async () => {
      fetchStub.withArgs(sinon.match(isLogin)).resolves(okJson({ notToken: true }));
      const error = await capture(getAuth());
      expect(error.message).to.match(/missing sessionToken/);
    });

    it('honours SEMRUSH_S2S_SESSION_TTL_MS and sweeps expired entries on write', async () => {
      const clock = sandbox.useFakeTimers();
      try {
        const auth = (org, ttl) => mod.getS2sSessionAuthorization({
          context: makeContext({ SEMRUSH_S2S_SESSION_TTL_MS: ttl }), imsOrgId: org,
        });
        await auth('A@AdobeOrg', '1000'); // cached, expires at t=1000
        clock.tick(500);
        await auth('B@AdobeOrg', '1000'); // A not expired yet → kept (sweep no-op branch)
        clock.tick(2000); // t=2500 → A and B both expired
        await auth('C@AdobeOrg', '1000'); // caching C sweeps the expired A/B (sweep-delete branch)
        const mintsBefore = loginCallCount();
        await auth('A@AdobeOrg', '1000'); // A was swept → re-mints
        expect(loginCallCount()).to.equal(mintsBefore + 1);
      } finally {
        clock.restore();
      }
    });
  });

  describe('evictS2sSessionToken', () => {
    it('drops the cached token so the next call re-mints', async () => {
      const context = makeContext();
      await mod.getS2sSessionAuthorization({ context, imsOrgId: IMS_ORG_ID });
      expect(loginCallCount()).to.equal(1);
      mod.evictS2sSessionToken(IMS_ORG_ID);
      await mod.getS2sSessionAuthorization({ context, imsOrgId: IMS_ORG_ID });
      expect(loginCallCount()).to.equal(2);
    });
  });

  describe('decodeS2sConsumerClaims', () => {
    it('decodes client_id / sub / is_s2s_consumer / tenant count', () => {
      const token = makeJwt({
        client_id: 'cid', sub: 's2s:cid', is_s2s_consumer: true, tenants: ['a', 'b'],
      });
      expect(mod.decodeS2sConsumerClaims(token)).to.deep.equal({
        consumerClientId: 'cid', consumerSub: 's2s:cid', isS2sConsumer: true, tenantCount: 2,
      });
    });

    it('includes consumerId from either consumerId or consumer_id', () => {
      expect(mod.decodeS2sConsumerClaims(makeJwt({ consumerId: 'x' }))).to.include({ consumerId: 'x' });
      expect(mod.decodeS2sConsumerClaims(makeJwt({ consumer_id: 'y' }))).to.include({ consumerId: 'y' });
    });

    it('omits tenantCount when the token has no tenants claim', () => {
      expect(mod.decodeS2sConsumerClaims(makeJwt({ client_id: 'cid' }))).to.not.have.property('tenantCount');
    });

    it('returns {} for a token with no payload segment', () => {
      expect(mod.decodeS2sConsumerClaims('nopayload')).to.deep.equal({});
    });

    it('returns {} for an undecodable/opaque token', () => {
      expect(mod.decodeS2sConsumerClaims('a.%%%.c')).to.deep.equal({});
    });
  });

  describe('imsConfigDiagnostics', () => {
    it('reports non-secret config with the secret as a presence boolean', () => {
      const fields = mod.imsConfigDiagnostics({
        SEMRUSH_S2S_IMS_HOST: 'ims.example.com',
        SEMRUSH_S2S_CLIENT_ID: 'cid',
        SEMRUSH_S2S_CLIENT_SCOPE: 'openid,AdobeID',
        SEMRUSH_S2S_CLIENT_SECRET: 'shh',
      });
      expect(fields).to.deep.equal({
        imsHost: 'ims.example.com',
        imsClientId: 'cid',
        imsScope: 'openid,AdobeID',
        hasClientSecret: true,
      });
    });

    it('flags a scheme in the host and whitespace in the scope', () => {
      const fields = mod.imsConfigDiagnostics({
        SEMRUSH_S2S_IMS_HOST: 'https://ims.example.com',
        SEMRUSH_S2S_CLIENT_SCOPE: 'openid, AdobeID',
      });
      expect(fields.imsHostHasScheme).to.equal(true);
      expect(fields.imsScopeHasSpaces).to.equal(true);
      expect(fields.hasClientSecret).to.equal(false);
    });

    it('tolerates a missing host/scope without emitting the derived flags', () => {
      const fields = mod.imsConfigDiagnostics({});
      expect(fields).to.not.have.property('imsHostHasScheme');
      expect(fields).to.not.have.property('imsScopeHasSpaces');
      expect(fields.hasClientSecret).to.equal(false);
    });
  });

  describe('readErrorBodySnippet', () => {
    it('caps the body to 500 chars', async () => {
      const snippet = await mod.readErrorBodySnippet({ text: async () => 'x'.repeat(600) });
      expect(snippet).to.have.lengthOf(500);
    });

    it('returns empty string for an empty body', async () => {
      expect(await mod.readErrorBodySnippet({ text: async () => '' })).to.equal('');
    });

    it('returns empty string when reading the body throws', async () => {
      expect(await mod.readErrorBodySnippet({
        text: async () => { throw new Error('unreadable'); },
      })).to.equal('');
    });
  });
});
