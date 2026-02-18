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

  const identifyRedirects = (await esmock('../../src/identify-redirects/handler.js', {
    '@adobe/spacecat-shared-splunk-client': { default: SplunkAPIClient },
    '../../src/utils/slack-utils.js': { postMessageSafe },
  })).default;

  return {
    identifyRedirects,
    SplunkAPIClient,
    splunkClient,
    login,
    oneshotSearch,
    postMessageSafe,
  };
}

describe('identify-redirects handler', () => {
  let sandbox;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
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
    };
  });

  afterEach(() => {
    sandbox.restore();
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
    expect(postMessageSafe.secondCall.args[2]).to.include('Failed to query Splunk');
    expect(postMessageSafe.secondCall.args[2]).to.include('splunk down');
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

    expect(oneshotSearch.callCount).to.equal(4);
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

  it('posts a no-patterns message when all queries return zero results', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves(undefined)
      .onCall(1).resolves({ results: null })
      .onCall(2).resolves({ results: [] })
      .onCall(3).resolves({ results: [] });

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
  });

  it('includes top paths for the winner when examples are available', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves({
        results: [
          { url: '/etc/acs-commons/redirect-maps/map', count: '3' },
          { url: '/etc/acs-commons/redirect-maps/other', count: 'foo' },
        ],
      })
      .onCall(1).resolves({ results: [] })
      .onCall(2).resolves({ results: [] })
      .onCall(3).resolves({ results: [] });

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
    expect(text).to.include('*Top paths for winner');
    expect(text).to.include('/etc/acs-commons/redirect-maps/map');
  });

  it('omits the examples block when winner has no string paths and supports splunkFields overrides', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves({
        results: [
          { path: undefined, count: '5' },
          { count: '2' },
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
    expect(firstQuery).to.include('env="e1"');
    expect(firstQuery).to.include('prog="p1"');
    expect(firstQuery).to.include('| stats count by path');

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    expect(loaded.postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*:');
    expect(text).to.not.include('*Top paths for winner');
  });

  it('breaks ties by totalCount when scores are equal', async () => {
    const loaded = await loadHandler();
    loaded.oneshotSearch
      .onCall(0).resolves({ results: [] })
      .onCall(1).resolves({
        // 90 * 0.95 = 85.5
        results: [{ url: '/etc/acs-commons/redirect-maps/a', count: '90' }],
      })
      .onCall(2).resolves({
        // 95 * 0.90 = 85.5 (exact tie in JS float math)
        results: [{ url: '/content/dam/something.redirectmap.txt', count: '95' }],
      })
      .onCall(3).resolves({ results: [] });

    await loaded.identifyRedirects({
      baseURL: 'https://example.com',
      programId: 'p1',
      environmentId: 'e1',
      slackContext: { channelId: 'C1', threadTs: '123.456' },
    }, context);

    expect(loaded.postMessageSafe).to.have.been.calledTwice;
    expect(loaded.postMessageSafe.firstCall.args[2]).to.include(':hourglass: Started Splunk searches');
    const text = loaded.postMessageSafe.secondCall.args[2];
    expect(text).to.include('*Winner*: `redirectmapTxt`');
  });
});

