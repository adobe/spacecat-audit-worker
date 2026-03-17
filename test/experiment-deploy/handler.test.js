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

import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';

describe('experiment-deploy handler', () => {
  let sandbox;
  let handler;
  let processExperimentDeployJobStub;
  let allByStatusStub;
  let log;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    processExperimentDeployJobStub = sandbox.stub().resolves();
    allByStatusStub = sandbox.stub().resolves([]);
    log = {
      info: sandbox.spy(),
      warn: sandbox.spy(),
      error: sandbox.spy(),
      debug: sandbox.spy(),
    };

    handler = await esmock('../../src/experiment-deploy/handler.js', {
      '../../src/experiment-deploy/state-machine.js': {
        processExperimentDeployJob: processExperimentDeployJobStub,
      },
    });
    handler = handler.default;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns ok and does not call processExperimentDeployJob when no in-progress experiment-deploy jobs', async () => {
    const context = {
      log,
      dataAccess: { AsyncJob: { allByStatus: allByStatusStub } },
    };

    const result = await handler({}, context);

    expect(result.status).to.equal(200);
    expect(allByStatusStub.calledOnceWith('IN_PROGRESS')).to.be.true;
    expect(processExperimentDeployJobStub.called).to.be.false;
    expect(log.info.calledWith('[experiment-deploy-poller] No in-progress experiment-deploy jobs found')).to.be.true;
  });

  it('processes each in-progress experiment-deploy job', async () => {
    const job1 = { getMetadata: () => ({ jobType: 'experiment-deploy' }), getId: () => 'job-1' };
    const job2 = { getMetadata: () => ({ jobType: 'experiment-deploy' }), getId: () => 'job-2' };
    const otherJob = { getMetadata: () => ({ jobType: 'preflight' }), getId: () => 'other' };
    allByStatusStub.resolves([job1, otherJob, job2]);

    const context = {
      log,
      dataAccess: { AsyncJob: { allByStatus: allByStatusStub } },
    };

    const result = await handler({}, context);

    expect(result.status).to.equal(200);
    expect(processExperimentDeployJobStub.callCount).to.equal(2);
    expect(processExperimentDeployJobStub.firstCall.args).to.deep.equal([context, 'job-1']);
    expect(processExperimentDeployJobStub.secondCall.args).to.deep.equal([context, 'job-2']);
    expect(log.info.calledWith('[experiment-deploy-poller] Found 2 in-progress experiment-deploy job(s), processing 10 jobs in this run')).to.be.true;
  });

  it('continues processing remaining jobs when one throws', async () => {
    const job1 = { getMetadata: () => ({ jobType: 'experiment-deploy' }), getId: () => 'job-1' };
    const job2 = { getMetadata: () => ({ jobType: 'experiment-deploy' }), getId: () => 'job-2' };
    allByStatusStub.resolves([job1, job2]);
    processExperimentDeployJobStub.onFirstCall().rejects(new Error('fail'));

    const context = {
      log,
      dataAccess: { AsyncJob: { allByStatus: allByStatusStub } },
    };

    const result = await handler({}, context);

    expect(result.status).to.equal(200);
    expect(processExperimentDeployJobStub.callCount).to.equal(2);
    expect(log.error.calledWith('[experiment-deploy-poller] Error processing job job-1: fail')).to.be.true;
  });
});
