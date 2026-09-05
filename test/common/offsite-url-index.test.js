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
import { createOffsiteLogger } from '../../src/utils/offsite-logging.js';

use(sinonChai);

describe('offsite-url-index (offsite adapter)', () => {
  const sandbox = sinon.createSandbox();
  const context = { dataAccess: { services: { postgrestClient: { id: 'pg-client' } } } };
  const opportunity = { getId: () => 'oppty-1' };
  let coreStub;
  let syncOffsiteUrlIndex;
  let logStub;
  let olog;

  const load = async () => {
    ({ syncOffsiteUrlIndex } = await esmock('../../src/common/offsite-url-index.js', {
      '../../src/common/url-index.js': { syncOpportunityUrlIndex: coreStub },
    }));
  };

  beforeEach(() => {
    coreStub = sandbox.stub();
    logStub = {
      debug: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub(), error: sandbox.stub(),
    };
    // The real offsite logger the handlers pass in, bound with the ids `ologOpp` carries.
    olog = createOffsiteLogger(logStub, {
      audit: 'wikipedia', siteId: 'site-1', auditId: 'audit-1', opportunityId: 'oppty-1',
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('delegates to the generic writer with the audit args', async () => {
    coreStub.resolves({ status: 'skipped' });
    await load();

    await syncOffsiteUrlIndex({
      context, opportunity, auditType: 'wikipedia-analysis', olog,
    });

    expect(coreStub).to.have.been.calledOnceWith({
      context, opportunity, auditType: 'wikipedia-analysis',
    });
  });

  it('logs a success outcome through the offsite taxonomy on status "ok"', async () => {
    coreStub.resolves({ status: 'ok', urlCount: 1, suggestionCount: 2 });
    await load();

    await syncOffsiteUrlIndex({
      context, opportunity, auditType: 'wikipedia-analysis', olog,
    });

    expect(logStub.warn).to.not.have.been.called;
    expect(logStub.debug).to.have.been.calledOnce;
    const line = logStub.debug.firstCall.args[0];
    expect(line).to.include('[offsite:wikipedia]');
    expect(line).to.include('event=url_index_sync');
    expect(line).to.include('outcome=success');
    expect(line).to.include('audit=wikipedia');
    expect(line).to.include('auditId=audit-1');
    expect(line).to.include('opportunityId=oppty-1');
    expect(line).to.include('peer=postgres');
    expect(line).to.include('entityType=wikipedia-analysis');
    expect(line).to.include('urlCount=1');
    expect(line).to.include('suggestionCount=2');
  });

  it('logs a degraded outcome with the failing phase on status "error"', async () => {
    coreStub.resolves({
      status: 'error', phase: 'suggestion-index', error: new Error('batch boom'),
    });
    await load();

    await syncOffsiteUrlIndex({
      context, opportunity, auditType: 'wikipedia-analysis', olog,
    });

    expect(logStub.debug).to.not.have.been.called;
    expect(logStub.warn).to.have.been.calledOnce;
    const line = logStub.warn.firstCall.args[0];
    expect(line).to.include('event=url_index_sync');
    expect(line).to.include('outcome=degraded'); // best-effort/self-healing, not terminal
    expect(line).to.include('phase=suggestion-index');
    expect(line).to.include('peer=postgres');
    expect(line).to.include('errorName=Error');
    expect(line).to.include('batch boom');
  });

  it('logs nothing when the writer skips (no registered extractor)', async () => {
    coreStub.resolves({ status: 'skipped' });
    await load();

    await syncOffsiteUrlIndex({
      context, opportunity, auditType: 'cited-analysis', olog,
    });

    expect(logStub.debug).to.not.have.been.called;
    expect(logStub.warn).to.not.have.been.called;
  });
});
