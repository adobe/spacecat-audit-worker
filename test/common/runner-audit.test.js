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
    const mod = await esmock('../../src/common/runner-audit.js', {
      '../../src/common/audit-utils.js': {
        isAuditDisabledForSite,
        parseMessageDataForRunnerAudit,
      },
    });
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
});
