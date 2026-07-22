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
import { AUDIT_TRIGGER_COOLDOWN_MS } from '../../src/offsite-brand-presence/constants.js';

use(sinonChai);

describe('offsite-brand-presence DRS status handler', () => {
  let sandbox;
  let handler;
  let mockGetJob;
  let mockPostMessageOptional;
  let context;
  let log;

  const BASE_URL = 'https://example.com';
  const SITE_ID = 'site-123';

  function buildMessage(overrides = {}) {
    return {
      type: 'offsite-brand-presence-drs-status',
      siteId: SITE_ID,
      auditContext: {
        baseURL: BASE_URL,
        slackContext: { channelId: 'C123', threadTs: '111.222' },
        jobs: [
          { domain: 'reddit.com', datasetId: 'reddit_comments', jobId: 'job-1' },
          { domain: 'youtube.com', datasetId: 'youtube_videos', jobId: 'job-2' },
        ],
        deadline: Date.now() + 600000,
        ...overrides,
      },
    };
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockGetJob = sandbox.stub();
    mockPostMessageOptional = sandbox.stub().resolves({ success: true, result: {} });

    handler = await esmock('../../src/offsite-brand-presence/drs-status-handler.js', {
      '@adobe/spacecat-shared-drs-client': {
        default: { createFrom: () => ({ getJob: mockGetJob }) },
      },
      '../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
      },
    });

    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    context = {
      log,
      sqs: { sendMessage: sandbox.stub().resolves() },
      dataAccess: {
        Configuration: {
          findLatest: sandbox.stub().resolves({ getQueues: () => ({ audits: 'audits-queue-url' }) }),
        },
        LatestAudit: {
          findBySiteIdAndAuditType: sandbox.stub().resolves(null),
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('posts a single summary when all jobs are terminal', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED_WITH_ERRORS' });

    const result = await handler.default(buildMessage(), context);

    expect(result.status).to.equal(200);
    // No re-enqueue (all terminal); instead the analysis audits are triggered.
    const sentTypes = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
    expect(sentTypes).to.not.include('offsite-brand-presence-drs-status');
    expect(sentTypes).to.have.members(['reddit-analysis', 'youtube-analysis']);
    expect(mockPostMessageOptional).to.have.been.calledOnce;
    const [, channelId, text, opts] = mockPostMessageOptional.firstCall.args;
    expect(channelId).to.equal('C123');
    expect(opts).to.deep.equal({ threadTs: '111.222' });
    expect(text).to.include('example.com');
    expect(text).to.include('reddit_comments');
    expect(text).to.include('COMPLETED');
    expect(text).to.include('COMPLETED_WITH_ERRORS');
    // All jobs terminal → header says "complete".
    expect(text).to.include('complete');
    expect(text).to.not.include('status update');
  });

  it('appends the DRS scraping elapsed time when drsStartedAt is present', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED' });

    await handler.default(buildMessage({ drsStartedAt: Date.now() - 5000 }), context);

    const text = mockPostMessageOptional.firstCall.args[2];
    expect(text).to.include('DRS scraping elapsed: ~');
  });

  it('omits the elapsed line when drsStartedAt is absent', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED' });

    await handler.default(buildMessage(), context);

    const text = mockPostMessageOptional.firstCall.args[2];
    expect(text).to.not.include('DRS scraping elapsed');
  });

  it('includes the error message for a failed job', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'FAILED', error_message: 'boom' });

    await handler.default(buildMessage(), context);

    const text = mockPostMessageOptional.firstCall.args[2];
    expect(text).to.include('FAILED');
    expect(text).to.include('boom');
  });

  it('omits the error suffix for a failed job with no error message', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'CANCELLED' });

    await handler.default(buildMessage(), context);

    const text = mockPostMessageOptional.firstCall.args[2];
    expect(text).to.include('CANCELLED');
    // The line should end with the status, not have a ": <error>" suffix
    expect(text).to.match(/CANCELLED\s*$/m);
  });

  it('re-enqueues with a delay when jobs are still pending and budget remains', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'RUNNING' });

    const message = buildMessage();
    const originalDeadline = message.auditContext.deadline;
    const result = await handler.default(message, context);

    expect(result.status).to.equal(200);
    expect(mockPostMessageOptional).to.not.have.been.called;
    // The completed reddit bucket is dispatched now; the poll is re-enqueued for youtube.
    const pollCall = context.sqs.sendMessage.getCalls()
      .find((c) => c.args[1].type === 'offsite-brand-presence-drs-status');
    expect(pollCall).to.not.be.undefined;
    const [queueUrl, sentMessage, groupId, delaySeconds] = pollCall.args;
    expect(queueUrl).to.equal('audits-queue-url');
    expect(sentMessage.auditContext.jobs).to.have.length(2);
    // The absolute deadline must be preserved across re-enqueues so the wait budget
    // genuinely bounds total polling time regardless of SQS delivery jitter.
    expect(sentMessage.auditContext.deadline).to.equal(originalDeadline);
    // Already-dispatched audit types travel with the poll so they are not re-triggered.
    expect(sentMessage.auditContext.triggeredAuditTypes).to.include('reddit-analysis');
    expect(groupId).to.equal(null);
    expect(delaySeconds).to.equal(300);
  });

  it('caps the re-enqueue delay at the seconds remaining until the deadline', async () => {
    mockGetJob.resolves({ status: 'RUNNING' });

    // 30s left before deadline → delay should be 30, not the 300s interval.
    await handler.default(buildMessage({ deadline: Date.now() + 30000 }), context);

    const delaySeconds = context.sqs.sendMessage.firstCall.args[3];
    expect(delaySeconds).to.be.at.most(30);
    expect(delaySeconds).to.be.greaterThan(0);
  });

  it('posts the summary at the deadline even if jobs are still running', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'RUNNING' });

    await handler.default(buildMessage({ deadline: Date.now() - 1 }), context);

    // No re-enqueue past the deadline; only the succeeded domain's audit is triggered.
    const sentTypes = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
    expect(sentTypes).to.deep.equal(['reddit-analysis']);
    expect(mockPostMessageOptional).to.have.been.calledOnce;
    const text = mockPostMessageOptional.firstCall.args[2];
    expect(text).to.include('still running (timed out waiting)');
    // Not all jobs terminal → header says "status update", not "complete".
    expect(text).to.include('status update');
    expect(text).to.not.include('jobs *complete*');
  });

  it('treats a getJob error as non-terminal and keeps polling', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').rejects(new Error('DRS 503'));

    const result = await handler.default(buildMessage(), context);

    expect(result.status).to.equal(200);
    expect(mockPostMessageOptional).to.not.have.been.called;
    // reddit completed → dispatched now; youtube errored (non-terminal) → keep polling.
    const sentTypes = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
    expect(sentTypes).to.include('reddit-analysis');
    expect(sentTypes).to.include('offsite-brand-presence-drs-status');
    expect(log.warn).to.have.been.calledWithMatch(/getJob failed for job-2/);
  });

  it('reports a job as still running when getJob errors past the deadline', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').rejects(new Error('DRS 503'));

    await handler.default(buildMessage({ deadline: Date.now() - 1 }), context);

    expect(mockPostMessageOptional).to.have.been.calledOnce;
    expect(mockPostMessageOptional.firstCall.args[2]).to.include('still running (timed out waiting)');
  });

  it('no-ops when slackContext is missing', async () => {
    const result = await handler.default(buildMessage({ slackContext: {} }), context);

    expect(result.status).to.equal(200);
    expect(mockGetJob).to.not.have.been.called;
    expect(mockPostMessageOptional).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('no-ops when there are no jobs to track', async () => {
    const result = await handler.default(buildMessage({ jobs: [] }), context);

    expect(result.status).to.equal(200);
    expect(mockGetJob).to.not.have.been.called;
    expect(mockPostMessageOptional).to.not.have.been.called;
  });

  describe('analysis audit auto-triggering', () => {
    it('triggers an analysis audit for each succeeded domain with forwarded Slack context', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED_WITH_ERRORS' });

      await handler.default(buildMessage(), context);

      const calls = context.sqs.sendMessage.getCalls();
      expect(calls).to.have.length(2);
      const reddit = calls.find((c) => c.args[1].type === 'reddit-analysis');
      expect(reddit.args[0]).to.equal('audits-queue-url');
      expect(reddit.args[1]).to.deep.equal({
        type: 'reddit-analysis',
        siteId: SITE_ID,
        auditContext: {
          slackContext: { channelId: 'C123', threadTs: '111.222' },
          drsScrapeRequested: true,
        },
      });
    });

    it('forwards DRS phase timings to the triggered analysis audit when drsStartedAt is set', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED' });
      const drsStartedAt = Date.now() - 5000;

      await handler.default(buildMessage({ drsStartedAt }), context);

      const reddit = context.sqs.sendMessage.getCalls()
        .find((c) => c.args[1].type === 'reddit-analysis');
      const { timings } = reddit.args[1].auditContext;
      expect(timings.drsStartedAt).to.equal(drsStartedAt);
      expect(timings.drsCompletedAt).to.be.a('number').and.to.be.at.least(drsStartedAt);
    });

    it('maps top-cited to cited-analysis and does not trigger wikipedia-analysis', async () => {
      mockGetJob.withArgs('job-c').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-w').resolves({ status: 'COMPLETED' });

      await handler.default(buildMessage({
        jobs: [
          { domain: 'top-cited', datasetId: 'top_cited', jobId: 'job-c' },
          // wikipedia is no longer DRS-scraped, so a wikipedia.org job maps to nothing.
          { domain: 'wikipedia.org', datasetId: 'wikipedia', jobId: 'job-w' },
        ],
      }), context);

      const types = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(types).to.deep.equal(['cited-analysis']);
    });

    it('triggers a domain\'s analysis audit only once across multiple datasets', async () => {
      mockGetJob.withArgs('job-rp').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-rc').resolves({ status: 'COMPLETED' });

      await handler.default(buildMessage({
        jobs: [
          { domain: 'reddit.com', datasetId: 'reddit_posts', jobId: 'job-rp' },
          { domain: 'reddit.com', datasetId: 'reddit_comments', jobId: 'job-rc' },
        ],
      }), context);

      const types = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(types).to.deep.equal(['reddit-analysis']);
    });

    it('does not trigger analysis audits for failed or cancelled domains', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'FAILED', error_message: 'x' });
      mockGetJob.withArgs('job-2').resolves({ status: 'CANCELLED' });

      await handler.default(buildMessage(), context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('skips domains that do not map to an analysis audit', async () => {
      mockGetJob.withArgs('job-x').resolves({ status: 'COMPLETED' });

      await handler.default(buildMessage({
        jobs: [{ domain: 'unknown.com', datasetId: 'whatever', jobId: 'job-x' }],
      }), context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('does not fail the run when triggering an analysis audit throws', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED' });
      context.sqs.sendMessage.rejects(new Error('SQS down'));

      const result = await handler.default(buildMessage(), context);

      expect(result.status).to.equal(200);
      expect(mockPostMessageOptional).to.have.been.calledOnce;
      expect(log.warn).to.have.been.calledWithMatch(/Failed to trigger .* analysis audit for site/);
    });

    it('skips an audit type when a recent audit exists within the cooldown window', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED' });

      const recentAudit = { getAuditedAt: () => new Date(Date.now() - AUDIT_TRIGGER_COOLDOWN_MS / 2).toISOString() };
      context.dataAccess.LatestAudit.findBySiteIdAndAuditType
        .withArgs(SITE_ID, 'reddit-analysis').resolves(recentAudit);

      await handler.default(buildMessage(), context);

      const types = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(types).to.include('youtube-analysis');
      expect(types).to.not.include('reddit-analysis');
      expect(log.info).to.have.been.calledWithMatch(/Skipping reddit-analysis.*recent audit exists/);
    });

    it('triggers within the cooldown when the recent audit is a pending_scrape run', async () => {
      // A pending_scrape run is the analysis waiting for the DRS scrape this poll just
      // completed — it must not block its own re-trigger, even inside the cooldown window.
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED' });

      const pendingScrapeAudit = {
        getAuditedAt: () => new Date(Date.now() - AUDIT_TRIGGER_COOLDOWN_MS / 2).toISOString(),
        getAuditResult: () => ({ success: false, status: 'pending_scrape' }),
      };
      context.dataAccess.LatestAudit.findBySiteIdAndAuditType
        .withArgs(SITE_ID, 'reddit-analysis').resolves(pendingScrapeAudit);

      await handler.default(buildMessage(), context);

      const types = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(types).to.include('reddit-analysis');
      expect(types).to.include('youtube-analysis');
    });

    it('triggers the audit when the most recent audit is older than the cooldown window', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED' });

      const oldAudit = { getAuditedAt: () => new Date(Date.now() - AUDIT_TRIGGER_COOLDOWN_MS * 2).toISOString() };
      context.dataAccess.LatestAudit.findBySiteIdAndAuditType
        .withArgs(SITE_ID, 'reddit-analysis').resolves(oldAudit);

      await handler.default(buildMessage(), context);

      const types = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(types).to.include('reddit-analysis');
      expect(types).to.include('youtube-analysis');
    });

    it('still triggers when the recent-audit lookup fails', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED' });

      context.dataAccess.LatestAudit.findBySiteIdAndAuditType.rejects(new Error('DB timeout'));

      await handler.default(buildMessage(), context);

      const types = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(types).to.include('reddit-analysis');
      expect(types).to.include('youtube-analysis');
      expect(log.warn).to.have.been.calledWithMatch(/Failed to check recent/);
    });

    it('dispatches a completed bucket immediately while still polling for a slower one', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' }); // reddit
      mockGetJob.withArgs('job-2').resolves({ status: 'RUNNING' }); // youtube

      await handler.default(buildMessage(), context);

      const sentTypes = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(sentTypes).to.include('reddit-analysis');
      expect(sentTypes).to.not.include('youtube-analysis');
      // Still polling for the running youtube job; no summary until everything resolves.
      expect(sentTypes).to.include('offsite-brand-presence-drs-status');
      expect(mockPostMessageOptional).to.not.have.been.called;
    });

    it('does not re-dispatch an audit type already triggered on a previous poll', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' }); // reddit
      mockGetJob.withArgs('job-2').resolves({ status: 'RUNNING' }); // youtube

      await handler.default(
        buildMessage({ triggeredAuditTypes: ['reddit-analysis'] }),
        context,
      );

      const sentTypes = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(sentTypes).to.not.include('reddit-analysis');
      const pollCall = context.sqs.sendMessage.getCalls()
        .find((c) => c.args[1].type === 'offsite-brand-presence-drs-status');
      expect(pollCall.args[1].auditContext.triggeredAuditTypes).to.include('reddit-analysis');
    });

    it('waits for all datasets of an audit type before dispatching it', async () => {
      mockGetJob.withArgs('job-yv').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-yc').resolves({ status: 'RUNNING' });

      await handler.default(buildMessage({
        jobs: [
          { domain: 'youtube.com', datasetId: 'youtube_videos', jobId: 'job-yv' },
          { domain: 'youtube.com', datasetId: 'youtube_comments', jobId: 'job-yc' },
        ],
      }), context);

      // One dataset still running → hold youtube-analysis; only the poll is re-enqueued.
      const sentTypes = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(sentTypes).to.deep.equal(['offsite-brand-presence-drs-status']);
    });

    it('does not fail the run when resolving the audits queue throws', async () => {
      mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED' });
      // Rejecting Configuration.findLatest makes triggerAnalysisAudits throw before its
      // per-type try/catch, exercising the handler's outer safety net.
      context.dataAccess.Configuration.findLatest.rejects(new Error('config down'));

      const result = await handler.default(buildMessage(), context);

      expect(result.status).to.equal(200);
      expect(mockPostMessageOptional).to.have.been.calledOnce;
      expect(log.warn).to.have.been.calledWithMatch(/Failed to trigger analysis audits for/);
    });

    it('dispatches with partial data at the deadline if a dataset is still running', async () => {
      mockGetJob.withArgs('job-yv').resolves({ status: 'COMPLETED' });
      mockGetJob.withArgs('job-yc').resolves({ status: 'RUNNING' });

      await handler.default(buildMessage({
        jobs: [
          { domain: 'youtube.com', datasetId: 'youtube_videos', jobId: 'job-yv' },
          { domain: 'youtube.com', datasetId: 'youtube_comments', jobId: 'job-yc' },
        ],
        deadline: Date.now() - 1,
      }), context);

      const sentTypes = context.sqs.sendMessage.getCalls().map((c) => c.args[1].type);
      expect(sentTypes).to.include('youtube-analysis');
      expect(mockPostMessageOptional).to.have.been.calledOnce;
    });
  });
});
