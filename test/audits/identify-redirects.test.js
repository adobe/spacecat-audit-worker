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
import esmock from 'esmock';

use(sinonChai);

async function loadHandler({ loginImpl, oneshotImpl } = {}) {
  const login = sinon.stub();
  if (loginImpl) {
    login.callsFake(loginImpl);
  } else {
    login.resolves();
  }

  const oneshotSearch = sinon.stub();
  if (oneshotImpl) {
    oneshotSearch.callsFake(oneshotImpl);
  } else {
    oneshotSearch.resolves({ results: [] });
  }

  const splunkClient = {
    login,
    oneshotSearch,
  };

  const SplunkAPIClient = {
    createFrom: sinon.stub().returns(splunkClient),
  };

  const postMessageSafe = sinon.stub().resolves({ success: true });

  const handlerModule = await esmock('../../src/identify-redirects/handler.js', {
    '@adobe/spacecat-shared-splunk-client': { default: SplunkAPIClient },
    '../../src/utils/slack-utils.js': { postMessageSafe },
  });

  return {
    identifyRedirects: handlerModule.default,
    pickWinner: handlerModule.pickWinner,
    SplunkAPIClient,
    splunkClient,
    login,
    oneshotSearch,
    postMessageSafe,
  };
}

// identify-redirects handler tests group
describe('identify-redirects handler', () => {
  let sandbox;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const siteStub = {
      getDeliveryConfig: sandbox.stub().returns({}),
      setDeliveryConfig: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };
    context = {
      log: {
        info: sandbox.spy(),
        warn: sandbox.spy(),
        error: sandbox.spy(),
        debug: sandbox.spy(),
      },
      env: {
        SPLUNK_API_BASE_URL: 'https://splunk.example.test',
        SPLUNK_API_USER: 'user',
        SPLUNK_API_PASS: 'pass',
      },
      dataAccess: {
        Site: {
          findById: sandbox.stub().resolves(siteStub),
        },
      },
      _siteStub: siteStub,
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('pickWinner returns none when patternResults.error is set', async () => {
    const { pickWinner } = await loadHandler();
    const result = pickWinner({ error: true });
    expect(result).to.deep.equal({ redirectMethodUsed: 'none', fileName: 'none' });
  });

  it('ignores messages missing slackContext.channelId/threadTs', async () => {
    const { identifyRedirects, postMessageSafe } = await loadHandler();
    const resp = await identifyRedirects(null, context);
    expect(resp).to.exist;
    expect(context.log.warn).to.have.been.calledWithMatch('Missing slackContext.channelId');
    expect(postMessageSafe).to.not.have.been.called;
  });

  it('posts a warning when required inputs are missing', async () => {
    const { identifyRedirects, postMessageSafe } = await loadHandler();
    await identifyRedirects({
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(postMessageSafe).to.have.been.calledOnce;
    expect(postMessageSafe.firstCall.args[1]).to.equal('C1');
    expect(postMessageSafe.firstCall.args[2]).to.include('identify-redirects job missing required inputs');
    expect(postMessageSafe.firstCall.args[2]).to.include('baseURL=n/a');
    expect(postMessageSafe.firstCall.args[2]).to.include('programId=n/a');
    expect(postMessageSafe.firstCall.args[2]).to.include('environmentId=n/a');
  });

  it('includes slack target in missing-inputs messages when provided', async () => {
    const { identifyRedirects, postMessageSafe } = await loadHandler();
    await identifyRedirects({
      slackContext: {
        channelId: 'C1',
        threadTs: '123.456',
        target: 'WORKSPACE_EXTERNAL',
      },
    }, context);

    expect(postMessageSafe).to.have.been.calledOnce;
    expect(postMessageSafe.firstCall.args[3]).to.deep.include({
      threadTs: '123.456',
      target: 'WORKSPACE_EXTERNAL',
    });
  });

  it('posts an error when Splunk login/search fails', async () => {
    const { identifyRedirects, postMessageSafe } = await loadHandler({
      loginImpl: async () => {
        throw new Error('splunk down');
      },
    });

    await identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(postMessageSafe).to.have.been.calledTwice;
    expect(postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    const text = postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*: none');
    expect(text).to.include('*Results*');
    expect(text).to.include('splunk down');
  });

  it('includes slack target in splunk-failure messages when provided', async () => {
    const { identifyRedirects, postMessageSafe } = await loadHandler({
      loginImpl: async () => {
        throw new Error('splunk down');
      },
    });

    await identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456', target: 'WORKSPACE_EXTERNAL' },
    }, context);

    expect(postMessageSafe).to.have.been.calledTwice;
    expect(postMessageSafe.firstCall.args[3]).to.deep.include({
      threadTs: '123.456',
      target: 'WORKSPACE_EXTERNAL',
    });
    expect(postMessageSafe.secondCall.args[3]).to.deep.include({
      threadTs: '123.456',
      target: 'WORKSPACE_EXTERNAL',
    });
  });

  it('formats results with no winner when all queries are rejected', async () => {
    const { identifyRedirects, postMessageSafe, oneshotSearch } = await loadHandler({
      oneshotImpl: async () => {
        throw 'nope';
      },
    });

    await identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456', target: 'WORKSPACE_INTERNAL' },
    }, context);

    expect(oneshotSearch.callCount).to.equal(1);
    expect(postMessageSafe).to.have.been.calledTwice;
    expect(postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    const text = postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*: none');
    expect(text).to.include('*Results*');
    expect(text).to.include('failed: nope');
    expect(postMessageSafe.firstCall.args[3]).to.deep.include({
      threadTs: '123.456',
      target: 'WORKSPACE_INTERNAL',
    });
    expect(postMessageSafe.secondCall.args[3]).to.deep.include({
      threadTs: '123.456',
      target: 'WORKSPACE_INTERNAL',
    });
  });

  it('formats results with no winner when Splunk returns response.error', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch.onCall(0).resolves({
      error: true,
      reason: { message: 'Search job failed' },
    });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*: none');
    expect(text).to.include('*Results*');
    expect(text).to.include('Search job failed');
  });

  it('formats results with no winner when Splunk returns response.error with reason as string', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch.onCall(0).resolves({
      error: true,
      reason: 'Splunk service unavailable',
    });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*: none');
    expect(text).to.include('*Results*');
    expect(text).to.include('Splunk service unavailable');
  });

  it('treats response with no results key as zero results (uses [] fallback)', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch.onCall(0).resolves({});

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      minutes: 5,
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('No redirect patterns detected');
    expect(text).to.include('*Winner*: `vanityurlmgr` (no patterns)');
  });

  it('allZero message shows none when winner has no redirectMethodUsed (raw shape)', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch.onCall(0).resolves({
      results: [{ totalLogHits: 0 }],
    });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      minutes: 5,
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('No redirect patterns detected');
    expect(text).to.include('*Winner*: `none` (no patterns)');
  });

  it('posts a no-patterns message when all queries return zero results', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch.onCall(0).resolves({
      results: [],
    });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      minutes: 5,
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    expect(loaded.postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    expect(loaded.postMessageSafe.secondCall.args[2]).to.include('No redirect patterns detected');
    expect(loaded.postMessageSafe.secondCall.args[2]).to.include('last 5m');
    expect(loaded.postMessageSafe.secondCall.args[2]).to.include('*Winner*: `vanityurlmgr` (no patterns)');
    expect(loaded.postMessageSafe.secondCall.args[2]).to.include('*Queries run*');
  });

  it('truncates response preview when it would exceed the slack limit', async () => {
    const loaded = await loadHandler();
    const longUrl = `/${'x'.repeat(2000)}`;

    loaded.oneshotSearch.onCall(0).resolves({
      results: [{
        redirectMethodUsed: 'acsredirectmapmanager',
        fileName: longUrl,
        totalLogHits: 1,
        mostRecentEpoch: 1,
      }],
    });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Response preview');
    expect(text).to.include('# acsredirectmapmanager');
    expect(text).to.not.include('# vanityurlmgr');
  });

  it('omits response preview when the first pattern block exceeds the limit', async () => {
    const loaded = await loadHandler();
    const longUrl = `/${'x'.repeat(3000)}`;

    loaded.oneshotSearch.onCall(0).resolves({
      results: [{
        redirectMethodUsed: 'acsredirectmapmanager',
        fileName: longUrl,
        totalLogHits: 1,
        mostRecentEpoch: 1,
      }],
    });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.not.include('*Response preview');
  });

  it('includes file name for redirect method used when the file name is available', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch.onCall(0).resolves({
      results: [
        {
          redirectMethodUsed: 'acsredirectmapmanager',
          fileName: '/etc/acs-commons/redirect-maps/map',
          totalLogHits: 10,
          mostRecentEpoch: 1715328000,
        },
        {
          redirectMethodUsed: 'acsredirectmapmanager',
          fileName: '/etc/acs-commons/redirect-maps/other',
          totalLogHits: 5,
          mostRecentEpoch: 1715327999,
        },
      ],
    });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    expect(loaded.postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*:');
    expect(text).to.include('*Top matched strings for winner');
    expect(text).to.include('/etc/acs-commons/redirect-maps/map');
    expect(text).to.include('*Response preview');
  });

  it('formats result status with rows length when rowsCount is missing (raw Splunk shape)', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch.onCall(0).resolves({
      results: [{
        redirectMethodUsed: 'dispatcher-logs',
        rows: [{ url: '/foo' }, { url: '/bar' }],
        totalLogHits: 2,
        mostRecentEpoch: 1,
      }],
    });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Results*');
    expect(text).to.include('rows=2');
    expect(text).to.include('count=2');
  });

  it('omits the examples block when winner has no string paths and supports splunkFields overrides', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves({
        results: [
          { path: undefined },
          { other: 'x' },
        ],
      })
      .onCall(1).resolves({ results: [] })
      .onCall(2).resolves({ results: [] })
      .onCall(3).resolves({ results: [] });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      splunkFields: {
        envField: 'env',
        programField: 'prog',
        pathField: 'path',
      },
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.oneshotSearch).to.have.been.called;
    const firstQuery = loaded.oneshotSearch.firstCall.args[0];
    expect(firstQuery).to.include('aem_service="cm-pp1-ee1"');
    expect(firstQuery).to.include('httpderror');

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    expect(loaded.postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*:');
    expect(text).to.not.include('*Top matched strings for winner');
  });

  it('determine winner by most recent', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves({
        results: [
          {
            redirectMethodUsed: 'acsredirectmanager',
            fileName: '/etc/acs-commons/redirect-maps/a',
            mostRecentEpoch: 1715328000,
            totalLogHits: 10,
          },
          {
            redirectMethodUsed: 'damredirectmgr',
            fileName: '/content/dam/something.redirectmap.txt',
            mostRecentEpoch: 1715328001,
            totalLogHits: 11,
          },
        ],
      });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    expect(loaded.postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*: `damredirectmgr`');
  });

  it('determine winner by most loghits when most recent is tied', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves({
        results: [
          {
            redirectMethodUsed: 'acsredirectmanager',
            fileName: '/etc/acs-commons/redirect-maps/a',
            mostRecentEpoch: 1715328000,
            totalLogHits: 10,
          },
          {
            redirectMethodUsed: 'damredirectmgr',
            fileName: '/content/dam/something.redirectmap.txt',
            mostRecentEpoch: 1715328000,
            totalLogHits: 11,
          },
        ],
      });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    expect(loaded.postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*: `damredirectmgr`');
  });

  it('determine winner by array index when most recent and most loghits are tied', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves({
        results: [
          {
            redirectMethodUsed: 'acsredirectmanager',
            fileName: '/etc/acs-commons/redirect-maps/a',
            mostRecentEpoch: 1715328000,
            totalLogHits: 10,
          },
          {
            redirectMethodUsed: 'damredirectmgr',
            fileName: '/content/dam/something.redirectmap.txt',
            mostRecentEpoch: 1715328000,
            totalLogHits: 10,
          },
        ],
      });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    expect(loaded.postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*: `acsredirectmanager`');
  });

  it('falls back to compat oneshot search when oneshotSearch is missing', async () => {
    const login = sinon.stub().callsFake(async function loginFake() {
      // mimic <=1.0.30 behavior: sets loginObj on the instance
      // eslint-disable-next-line no-invalid-this
      this.loginObj = { sessionId: 's', cookie: 'c' };
      // eslint-disable-next-line no-invalid-this
      return this.loginObj;
    });
    const fetchAPI = sinon.stub().resolves({
      status: 200,
      json: async () => ({
        results: [{ url: '/etc/acs-commons/redirect-maps/map', count: '1' }],
      }),
    });

    const splunkClient = {
      apiBaseUrl: 'https://splunk.example.test',
      fetchAPI,
      loginObj: null,
      login,
    };

    const SplunkAPIClient = {
      createFrom: sinon.stub().returns(splunkClient),
    };
    const postMessageSafe = sinon.stub().resolves({ success: true });

    const identifyRedirects = (await esmock('../../src/identify-redirects/handler.js', {
      '@adobe/spacecat-shared-splunk-client': { default: SplunkAPIClient },
      '../../src/utils/slack-utils.js': { postMessageSafe },
    })).default;

    await identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(fetchAPI).to.have.been.called;
    expect(postMessageSafe).to.have.been.calledTwice;
    const finalText = postMessageSafe.secondCall.args[2];
    expect(finalText).to.include('*Winner*:');
  });

  it('compat path re-logins when loginObj is not set', async () => {
    const login = sinon.stub();
    // first login call (from handler) returns success but does not set loginObj
    login.onCall(0).resolves({ sessionId: 's', cookie: 'c' });
    // second login call (from compat) sets loginObj (mimic older client behavior)
    login.onCall(1).callsFake(async function loginFake() {
      // eslint-disable-next-line no-invalid-this
      this.loginObj = { sessionId: 's', cookie: 'c' };
      // eslint-disable-next-line no-invalid-this
      return this.loginObj;
    });

    const fetchAPI = sinon.stub().resolves({
      status: 200,
      json: async () => ({ results: [] }),
    });

    const splunkClient = {
      apiBaseUrl: 'https://splunk.example.test',
      fetchAPI,
      loginObj: null,
      login,
    };

    const SplunkAPIClient = {
      createFrom: sinon.stub().returns(splunkClient),
    };
    const postMessageSafe = sinon.stub().resolves({ success: true });

    const identifyRedirects = (await esmock('../../src/identify-redirects/handler.js', {
      '@adobe/spacecat-shared-splunk-client': { default: SplunkAPIClient },
      '../../src/utils/slack-utils.js': { postMessageSafe },
    })).default;

    await identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(login.callCount).to.equal(2);
    expect(fetchAPI).to.have.been.called;
  });

  it('compat path surfaces non-Error login errors', async () => {
    const login = sinon.stub().resolves({ error: 'Login failed' });

    const splunkClient = {
      apiBaseUrl: 'https://splunk.example.test',
      fetchAPI: sinon.stub(),
      loginObj: null,
      login,
    };

    const SplunkAPIClient = {
      createFrom: sinon.stub().returns(splunkClient),
    };
    const postMessageSafe = sinon.stub().resolves({ success: true });

    const identifyRedirects = (await esmock('../../src/identify-redirects/handler.js', {
      '@adobe/spacecat-shared-splunk-client': { default: SplunkAPIClient },
      '../../src/utils/slack-utils.js': { postMessageSafe },
    })).default;

    await identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(postMessageSafe).to.have.been.calledTwice;
    expect(postMessageSafe.secondCall.args[2]).to.include('Login failed');
  });

  it('compat path surfaces Error login errors', async () => {
    const login = sinon.stub().resolves({ error: new Error('Login failed') });

    const splunkClient = {
      apiBaseUrl: 'https://splunk.example.test',
      fetchAPI: sinon.stub(),
      loginObj: null,
      login,
    };

    const SplunkAPIClient = {
      createFrom: sinon.stub().returns(splunkClient),
    };
    const postMessageSafe = sinon.stub().resolves({ success: true });

    const identifyRedirects = (await esmock('../../src/identify-redirects/handler.js', {
      '@adobe/spacecat-shared-splunk-client': { default: SplunkAPIClient },
      '../../src/utils/slack-utils.js': { postMessageSafe },
    })).default;

    await identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(postMessageSafe).to.have.been.calledTwice;
    expect(postMessageSafe.secondCall.args[2]).to.include('Login failed');
  });

  it('compat path includes non-200 response body in error', async () => {
    const login = sinon.stub().callsFake(async function loginFake() {
      // eslint-disable-next-line no-invalid-this
      this.loginObj = { sessionId: 's', cookie: 'c' };
      // eslint-disable-next-line no-invalid-this
      return this.loginObj;
    });

    const fetchAPI = sinon.stub().resolves({
      status: 400,
      text: async () => 'bad_request',
    });

    const splunkClient = {
      apiBaseUrl: 'https://splunk.example.test',
      fetchAPI,
      loginObj: null,
      login,
    };

    const SplunkAPIClient = {
      createFrom: sinon.stub().returns(splunkClient),
    };
    const postMessageSafe = sinon.stub().resolves({ success: true });

    const identifyRedirects = (await esmock('../../src/identify-redirects/handler.js', {
      '@adobe/spacecat-shared-splunk-client': { default: SplunkAPIClient },
      '../../src/utils/slack-utils.js': { postMessageSafe },
    })).default;

    await identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(postMessageSafe).to.have.been.calledTwice;
    expect(postMessageSafe.secondCall.args[2]).to.include('Status: 400');
    expect(postMessageSafe.secondCall.args[2]).to.include('bad_request');
  });

  it('includes query strings in the slack message when there is no winner', async () => {
    const loaded = await loadHandler({
      oneshotImpl: async () => {
        throw 'nope';
      },
    });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Queries run*');
    expect(text).to.include('sourcetype=httpderror');
  });

  it('does not update site config when updateRedirects is true but there is no winner', async () => {
    const loaded = await loadHandler({
      oneshotImpl: async () => {
        throw new Error('search failed');
      },
    });

    await loaded.identifyRedirects({
      siteId: 'site-123',
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      updateRedirects: true,
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    expect(context._siteStub.setDeliveryConfig).to.not.have.been.called;
    expect(context._siteStub.save).to.not.have.been.called;
  });

  it('updates site delivery config and saves when updateRedirects is true and there is a winner', async () => {
    const loaded = await loadHandler();
    const examplePath = '/etc/acs-commons/redirect-maps/my-map';
    const ExampleMode = 'acsredirectmanager';
    loaded.oneshotSearch
      .onCall(0).resolves({
        results: [
          { redirectMethodUsed: ExampleMode, fileName: examplePath },
        ],
      })
      .onCall(1).resolves({ results: [] })
      .onCall(2).resolves({ results: [] })
      .onCall(3).resolves({ results: [] });

    await loaded.identifyRedirects({
      siteId: 'site-123',
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      updateRedirects: true,
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(context.dataAccess.Site.findById).to.have.been.calledOnceWith('site-123');
    expect(context._siteStub.getDeliveryConfig).to.have.been.called;
    expect(context._siteStub.setDeliveryConfig).to.have.been.calledOnce;
    expect(context._siteStub.setDeliveryConfig.firstCall.args[0]).to.include({
      redirectsSource: examplePath,
      redirectsMode: ExampleMode,
    });
    expect(context._siteStub.save).to.have.been.calledOnce;
  });

  it('sets redirectsSource to "none" when updateRedirects is true and winner has no fileName', async () => {
    const loaded = await loadHandler();
    // One row with redirectMethodUsed but no fileName → redirectsSource = 'none', redirectsMode = method
    loaded.oneshotSearch.resolves({
      results: [{ redirectMethodUsed: 'acsredirectmanager' }],
    });

    await loaded.identifyRedirects({
      siteId: 'site-123',
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      updateRedirects: true,
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(context._siteStub.setDeliveryConfig).to.have.been.calledOnce;
    expect(context._siteStub.setDeliveryConfig.firstCall.args[0]).to.include({
      redirectsSource: 'none',
      redirectsMode: 'acsredirectmanager',
    });
    expect(context._siteStub.save).to.have.been.calledOnce;
  });

  it('sets redirectsSource to "none" when updateRedirects is true and winner is vanityurlmgr', async () => {
    const loaded = await loadHandler();
    // Empty query result → pickWinner([]) returns { redirectMethodUsed: 'vanityurlmgr', fileName: 'none' }
    loaded.oneshotSearch.resolves({ results: [] });

    await loaded.identifyRedirects({
      siteId: 'site-123',
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      updateRedirects: true,
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(context._siteStub.setDeliveryConfig).to.have.been.calledOnce;
    expect(context._siteStub.setDeliveryConfig.firstCall.args[0]).to.include({
      redirectsSource: 'none',
      redirectsMode: 'vanityurlmgr',
    });
    expect(context._siteStub.save).to.have.been.calledOnce;
  });

  it('posts warning and skips config update when updateRedirects is true, winner exists, but siteId is missing', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves({ results: [{}] })
      .onCall(1).resolves({ results: [] })
      .onCall(2).resolves({ results: [] })
      .onCall(3).resolves({ results: [] });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      updateRedirects: true,
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(context.dataAccess.Site.findById).to.not.have.been.called;
    expect(context.log.warn).to.have.been.calledWithMatch('Skipping config update: missing siteId');
    expect(loaded.postMessageSafe).to.have.been.calledThrice;
    const configMsg = loaded.postMessageSafe.thirdCall.args[2];
    expect(configMsg).to.include('Could not update delivery config');
    expect(configMsg).to.include('missing siteId');
    expect(configMsg).to.include('https://example.com');
    expect(context._siteStub.setDeliveryConfig).to.not.have.been.called;
    expect(context._siteStub.save).to.not.have.been.called;
  });

  it('posts warning and skips config update when updateRedirects is true, winner exists, but site is not found', async () => {
    const loaded = await loadHandler();
    context.dataAccess.Site.findById.resolves(null);
    loaded.oneshotSearch
      .onCall(0).resolves({ results: [{}] })
      .onCall(1).resolves({ results: [] })
      .onCall(2).resolves({ results: [] })
      .onCall(3).resolves({ results: [] });

    await loaded.identifyRedirects({
      siteId: 'site-123',
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      updateRedirects: true,
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(context.dataAccess.Site.findById).to.have.been.calledOnceWith('site-123');
    expect(context.log.warn).to.have.been.calledWithMatch('Skipping config update: site not found');
    expect(loaded.postMessageSafe).to.have.been.calledThrice;
    const configMsg = loaded.postMessageSafe.thirdCall.args[2];
    expect(configMsg).to.include('Could not update delivery config');
    expect(configMsg).to.include('site not found');
    expect(configMsg).to.include('https://example.com');
    expect(context._siteStub.setDeliveryConfig).to.not.have.been.called;
    expect(context._siteStub.save).to.not.have.been.called;
  });

  it('includes slack target in "Could not update delivery config" message when site missing and target provided', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves({ results: [{}] })
      .onCall(1).resolves({ results: [] })
      .onCall(2).resolves({ results: [] })
      .onCall(3).resolves({ results: [] });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      updateRedirects: true,
      slackContext: { channelId: 'C1', threadTs: '123.456', target: 'WORKSPACE_EXTERNAL' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledThrice;
    expect(loaded.postMessageSafe.thirdCall.args[3]).to.deep.include({
      threadTs: '123.456',
      target: 'WORKSPACE_EXTERNAL',
    });
  });
});

