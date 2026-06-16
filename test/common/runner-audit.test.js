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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { ok } from '@adobe/spacecat-shared-http-utils';
import { parseMessageDataForRunnerAudit } from '../../src/common/audit-utils.js';
import { buildRunnerAuditContext } from '../../src/common/runner-audit.js';

use(sinonChai);
use(chaiAsPromised);

describe('buildRunnerAuditContext', () => {
  it('treats null message as empty audit context', () => {
    expect(buildRunnerAuditContext(null)).to.deep.equal({});
  });

  it('returns base auditContext when data is absent', () => {
    expect(buildRunnerAuditContext({ auditContext: {} })).to.deep.equal({});
  });

  it('handles explicit data: null', () => {
    expect(buildRunnerAuditContext({ auditContext: { a: 1 }, data: null })).to.deep.equal({ a: 1 });
  });
});

describe('RunnerAudit', () => {
  let sandbox;
  let RunnerAudit;
  let isAuditDisabledForSite;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    isAuditDisabledForSite = sandbox.stub().resolves(false);
    const mod = await esmock(
      '../../src/common/runner-audit.js',
      import.meta.url,
      {
        '../../src/common/audit-utils.js': {
          isAuditDisabledForSite,
          parseMessageDataForRunnerAudit,
        },
        '../../src/utils/slack-utils.js': {
          sendAuditFailureNotification: sandbox.stub().resolves(),
        },
      },
    );
    RunnerAudit = mod.RunnerAudit;
  });

  afterEach(() => {
    sandbox.restore();
  });

  function buildInstance(runner, persister) {
    const site = {
      getId: () => 'site-1',
      getBaseURL: () => 'https://example.com',
      getIsLive: () => true,
    };
    const siteProvider = sandbox.stub().resolves(site);
    const urlResolver = sandbox.stub().resolves('https://example.com');
    const messageSender = sandbox.stub().resolves();
    const orgProvider = sandbox.stub();
    return {
      instance: new RunnerAudit(
        siteProvider,
        orgProvider,
        urlResolver,
        runner,
        persister,
        messageSender,
        [],
      ),
      site,
    };
  }

  it('attaches parsed message.data as auditContext.messageData before invoking the runner', async () => {
    const runner = sandbox.stub().resolves({
      auditResult: { success: true },
      fullAuditRef: 'https://example.com',
    });
    const auditRecord = { getId: () => 'audit-1' };
    const persister = sandbox.stub().resolves(auditRecord);
    const { instance, site } = buildInstance(runner, persister);

    const context = {
      log: {
        warn: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {},
      invocation: {},
    };

    const message = {
      type: 'reddit-analysis',
      siteId: 'site-1',
      auditContext: { slackContext: { channelId: 'C' } },
      data: '{"urlLimit":"3"}',
    };

    await instance.run(message, context);

    expect(runner).to.have.been.calledWith(
      'https://example.com',
      context,
      site,
      sinon.match({
        slackContext: { channelId: 'C' },
        messageData: { urlLimit: '3' },
      }),
    );
  });

  it('attaches object message.data as messageData', async () => {
    const runner = sandbox.stub().resolves({
      auditResult: { success: true },
      fullAuditRef: 'https://example.com',
    });
    const persister = sandbox.stub().resolves({ getId: () => 'audit-1' });
    const { instance, site } = buildInstance(runner, persister);

    const context = {
      log: {
        warn: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {},
      invocation: {},
    };

    await instance.run(
      {
        type: 'reddit-analysis',
        siteId: 'site-1',
        auditContext: {},
        data: { urlLimit: 9 },
      },
      context,
    );

    expect(runner).to.have.been.calledWith(
      'https://example.com',
      context,
      site,
      sinon.match({ messageData: { urlLimit: 9 } }),
    );
  });

  it('returns ok when the audit is disabled for the site', async () => {
    isAuditDisabledForSite.resolves(true);
    const runner = sandbox.stub();
    const persister = sandbox.stub();
    const { instance } = buildInstance(runner, persister);

    const context = {
      log: {
        warn: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {},
      invocation: {},
    };

    const result = await instance.run(
      {
        type: 'reddit-analysis',
        siteId: 'site-1',
        auditContext: {},
      },
      context,
    );

    expect(result.status).to.equal(ok().status);
    expect(runner).not.to.have.been.called;
    expect(context.log.info).to.have.been.calledWith(
      'Audit reddit-analysis is disabled for site site-1, skipping',
    );
  });

  it('wraps runner failures with a descriptive error', async () => {
    const runner = sandbox.stub().rejects(new Error('runner boom'));
    const persister = sandbox.stub();
    const { instance } = buildInstance(runner, persister);

    const context = {
      log: {
        warn: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {},
      invocation: {},
    };

    await expect(
      instance.run(
        {
          type: 'reddit-analysis',
          siteId: 'site-1',
          auditContext: {},
        },
        context,
      ),
    ).to.be.rejectedWith('reddit-analysis audit failed for site site-1. Reason: runner boom');
  });

  it('falls back to siteId when site.getBaseURL() throws during siteUrl caching', async () => {
    // site.getBaseURL() throws — inner try-catch keeps siteUrl = siteId
    const throwingSite = {
      getId: () => 'site-1',
      getBaseURL: () => { throw new Error('getBaseURL not available'); },
      getIsLive: () => true,
    };
    const siteProvider = sandbox.stub().resolves(throwingSite);
    // urlResolver must not call getBaseURL on the site
    const urlResolver = sandbox.stub().resolves('https://resolved.example.com');
    const runner = sandbox.stub().rejects(new Error('runner failed after bad url'));
    const persister = sandbox.stub();
    const messageSender = sandbox.stub();

    const instance = new RunnerAudit(
      siteProvider,
      sandbox.stub(),
      urlResolver,
      runner,
      persister,
      messageSender,
      [],
    );

    const context = {
      log: {
        warn: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {},
      invocation: {},
    };

    await expect(
      instance.run({ type: 'test-audit', siteId: 'site-1', auditContext: {} }, context),
    ).to.be.rejectedWith('test-audit audit failed for site site-1. Reason: runner failed after bad url');
  });

  it('posts an "Audit Completed" Slack message on success when slackContext is present', async () => {
    // Wiring test: lets the real say() path execute through RunnerAudit's
    // success branch. Mocks BaseSlackClient.createFrom so we can assert that
    // postMessage was called with the completion text without needing a real
    // Slack workspace.
    const { BaseSlackClient } = await import('@adobe/spacecat-shared-slack-client');
    const slackPostMessage = sandbox.stub().resolves({ ok: true });
    const createFromStub = sandbox.stub(BaseSlackClient, 'createFrom').returns({
      postMessage: slackPostMessage,
    });

    // Re-build the instance using the un-esmocked module so the real say()
    // runs (the beforeEach esmock stubs sendAuditFailureNotification, but
    // sendAuditCompletionNotification was inlined — we're calling say() directly
    // from runner-audit.js, and say() is not stubbed).
    const realMod = await import('../../src/common/runner-audit.js');
    const realInstance = new realMod.RunnerAudit(
      sandbox.stub().resolves({
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getIsLive: () => true,
      }),
      sandbox.stub(),
      sandbox.stub().resolves('https://example.com'),
      sandbox.stub().resolves({ auditResult: { ok: true }, fullAuditRef: 'ref' }),
      sandbox.stub().resolves({ getId: () => 'audit-1' }),
      sandbox.stub().resolves(),
      [],
    );

    const context = {
      env: {
        SLACK_BOT_TOKEN: 'tok',
        SLACK_SIGNING_SECRET: 'sec',
        SLACK_TOKEN_WORKSPACE_INTERNAL: 'wtok',
        SLACK_OPS_CHANNEL_WORKSPACE_INTERNAL: 'ops',
      },
      log: {
        warn: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {},
      invocation: {},
    };

    await realInstance.run(
      {
        type: 'cwv',
        siteId: 'site-1',
        auditContext: { slackContext: { channelId: 'C123', threadTs: '1.2' } },
      },
      context,
    );

    expect(slackPostMessage).to.have.been.calledOnce;
    const msg = slackPostMessage.firstCall.args[0];
    expect(msg.thread_ts).to.equal('1.2');
    expect(msg.channel).to.equal('C123');
    expect(msg.text).to.include('Audit Completed');
    expect(msg.text).to.include('cwv');

    createFromStub.restore();
  });
});
