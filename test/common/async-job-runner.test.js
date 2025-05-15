/*
 * Copyright 2025 Adobe. All rights reserved.
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
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access/src/models/audit/index.js';
import sinon from 'sinon';
import { MockContextBuilder } from '../shared.js';
import { AuditBuilder } from '../../src/common/audit-builder.js';

use(sinonChai);
use(chaiAsPromised);

const { AUDIT_STEP_DESTINATIONS } = AuditModel;

describe('Job-based Step-Audit Tests', () => {
  const sandbox = sinon.createSandbox();
  const mockDate = '2024-03-12T15:24:51.231Z';
  const baseURL = 'https://www.space.cat';

  let clock;
  let context;
  let site;
  let configuration;

  beforeEach(() => {
    clock = sandbox.useFakeTimers({
      now: +new Date(mockDate),
      toFake: ['Date'],
    });

    site = {
      getId: () => '42322ae6-b8b1-4a61-9c88-25205fa65b07',
      getBaseURL: () => baseURL,
      getIsLive: () => true,
    };

    configuration = {
      isHandlerEnabledForSite: sandbox.stub().returns(true),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();
    context.dataAccess.Site.findById.resolves(site);
    context.dataAccess.Configuration.findLatest.resolves(configuration);

    context.env = {
      CONTENT_SCRAPER_QUEUE_URL: 'https://space.cat/content-scraper',
      IMPORT_WORKER_QUEUE_URL: 'https://space.cat/import-worker',
      AUDIT_JOBS_QUEUE_URL: 'https://space.cat/audit-jobs',
    };
  });

  afterEach(() => {
    clock.restore();
    sandbox.restore();
  });

  it('should create an async job runner', () => {
    const runner = new AuditBuilder()
      .withAsyncJob()
      .addStep('first', () => {}, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
      .addStep('second', () => {})
      .build();
    expect(runner.getNextStepName('first')).to.equal('second');
  });

  // Helper to create a mock job
  function createMockJob(metadata = {}) {
    return {
      getId: () => metadata.jobId || 'job-123',
      getMetadata: () => metadata,
    };
  }

  it('skips execution when audit is disabled for site', async () => {
    configuration.isHandlerEnabledForSite.returns(false);

    const runner = new AuditBuilder()
      .withAsyncJob()
      .addStep('first', async () => ({}), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
      .build();

    // Mock job provider
    runner.jobProvider = async () => createMockJob({
      payload: { siteId: site.getId() },
    });

    const message = {
      type: 'content-audit',
      jobId: 'job-123',
    };

    const result = await runner.run(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith('content-audit audits disabled for site 42322ae6-b8b1-4a61-9c88-25205fa65b07, skipping...');
  });

  it('executes first step and sends continuation message', async () => {
    const runner = new AuditBuilder()
      .withAsyncJob()
      .addStep('first', async () => ({ foo: 'bar' }), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
      .addStep('second', async () => ({ baz: 'qux' }))
      .build();

    runner.jobProvider = async () => createMockJob({
      jobId: 'job-123',
      payload: { siteId: site.getId() },
    });

    // Stub sendContinuationMessage
    const sendMsgStub = context.sqs.sendMessage || sandbox.stub();
    context.sqs.sendMessage = sendMsgStub;

    const message = {
      type: 'content-audit',
      jobId: 'job-123',
    };

    await runner.run(message, context);

    // Should send a continuation message for the next step
    expect(sendMsgStub).to.have.been.called;
  }).timeout(20000);

  it('continues execution from specified step', async () => {
    const runner = new AuditBuilder()
      .withAsyncJob()
      .addStep('first', async () => ({ foo: 'bar' }), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
      .addStep('second', async () => ({ baz: 'qux' }))
      .build();

    runner.jobProvider = async () => createMockJob({
      jobId: 'job-123',
      payload: { siteId: site.getId() },
    });

    const sendMsgStub = context.sqs.sendMessage || sandbox.stub();
    context.sqs.sendMessage = sendMsgStub;

    const message = {
      type: 'content-audit',
      jobId: 'job-123',
      auditContext: { next: 'first' },
    };

    await runner.run(message, context);

    expect(sendMsgStub).to.have.been.called;
  }).timeout(10000);

  it('handles final step without sending continuation message', async () => {
    const runner = new AuditBuilder()
      .withAsyncJob()
      .addStep('first', async () => ({ foo: 'bar' }), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
      .addStep('second', async () => ({ baz: 'qux' }))
      .build();

    runner.jobProvider = async () => createMockJob({
      jobId: 'job-123',
      payload: { siteId: site.getId() },
    });

    const sendMsgStub = context.sqs.sendMessage || sandbox.stub();
    context.sqs.sendMessage = sendMsgStub;

    const message = {
      type: 'content-audit',
      jobId: 'job-123',
      auditContext: { next: 'second' },
    };

    await runner.run(message, context);

    expect(sendMsgStub).not.to.have.been.called;
  }).timeout(10000);

  it('fails if job is not found', async () => {
    const runner = new AuditBuilder()
      .withAsyncJob()
      .addStep('first', async () => ({}), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
      .build();

    runner.jobProvider = async () => null;

    const message = {
      type: 'content-audit',
      jobId: 'job-123',
    };

    await expect(runner.run(message, context)).to.be.rejectedWith('content-audit audit failed for job job-123 at step initial. Reason: Cannot read properties of null');
  });

  it('fails if siteId is invalid', async () => {
    const runner = new AuditBuilder()
      .withAsyncJob()
      .addStep('first', async () => ({}), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
      .build();

    runner.jobProvider = async () => createMockJob({
      jobId: 'job-123',
      payload: { siteId: 'not-a-uuid' },
    });

    const message = {
      type: 'content-audit',
      jobId: 'job-123',
    };

    await expect(runner.run(message, context)).to.be.rejectedWith('content-audit audit failed for job job-123 at step initial. Reason:');
  });

  it('fails when step configuration is invalid', async () => {
    const runner = new AuditBuilder()
      .withAsyncJob()
      .addStep('first', async () => ({})) // No destination for non-final step
      .addStep('second', async () => ({}));

    try {
      runner.build();
    } catch (e) {
      expect(e.message).to.equal('Step first must specify a destination as it is not the last step');
    }
  });

  it('fails when step destination configuration is invalid', async () => {
    const runner = new AuditBuilder()
      .withAsyncJob();
    try {
      runner.addStep('first', async () => ({}), 'non-existent-destination');
    } catch (e) {
      expect(e.message).to.equal('Invalid destination: non-existent-destination. Must be one of: content-scraper, import-worker');
    }
  });

  it('fails when metadata is not an object', async () => {
    const runner = new AuditBuilder()
      .withAsyncJob()
      .addStep('first', async () => ({}), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
      .build();

    runner.jobProvider = async () => createMockJob('not-an-object');
    const message = {
      type: 'content-audit',
      jobId: 'job-123',
    };

    await expect(runner.run(message, context)).to.be.rejectedWith('content-audit audit failed for job job-123 at step initial. Reason: Job job-123 metadata is not an object');
  });
});
