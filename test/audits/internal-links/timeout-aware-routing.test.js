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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

describe('Timeout-Aware Routing Tests', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();
  let context;
  let runCrawlDetectionBatch;
  let fetchLinkCheckerLogsStep;
  let mockIsBatchCompleted;

  beforeEach(async () => {
    mockIsBatchCompleted = sandbox.stub().resolves(false);

    // Mock the handler with S3 and Splunk clients
    const mockedHandler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/support/splunk-client-loader.js': {
        createSplunkClient: () => Promise.resolve({
          login: sandbox.stub().resolves({ sessionId: 'test', cookie: 'test' }),
          fetchAPI: sandbox.stub().resolves({
            status: 200,
            json: () => Promise.resolve({ results: [] }),
          }),
          apiBaseUrl: 'https://splunk.test',
        }),
      },
      '../../../src/internal-links/batch-state.js': {
        loadCache: sandbox.stub().resolves({ brokenUrlsCache: [], workingUrlsCache: [] }),
        isBatchCompleted: mockIsBatchCompleted,
        saveBatchResults: sandbox.stub().resolves(),
        updateCache: sandbox.stub().resolves(),
        markBatchCompleted: sandbox.stub().resolves(),
        loadFinalResults: sandbox.stub().resolves([]),
        cleanupBatchState: sandbox.stub().resolves(),
        getTimeoutStatus: (startTime) => {
          const elapsed = Date.now() - startTime;
          const lambdaTimeoutMs = 15 * 60 * 1000;
          const safeTimeRemaining = lambdaTimeoutMs - elapsed - (2 * 60 * 1000);
          return {
            elapsed,
            remaining: lambdaTimeoutMs - elapsed,
            safeTimeRemaining,
            isApproachingTimeout: elapsed > (13 * 60 * 1000),
            percentUsed: (elapsed / lambdaTimeoutMs) * 100,
          };
        },
      },
    });

    runCrawlDetectionBatch = mockedHandler.runCrawlDetectionBatch;
    fetchLinkCheckerLogsStep = mockedHandler.fetchLinkCheckerLogsStep;

    // Create basic context
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: {
          getId: () => 'site123',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getHandlers: () => ({
              'broken-internal-links': {
                config: {
                  isLinkcheckerEnabled: false, // Disabled to test routing only
                },
              },
            }),
          }),
        },
        audit: {
          getId: () => 'audit123',
          getAuditType: () => AUDIT_TYPE,
          getFullAuditRef: () => 'https://example.com',
          getAuditResult: () => ({ brokenInternalLinks: [] }),
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
        auditContext: {
          auditId: 'audit123',
          scrapeJobId: 'job123',
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
        env: {
          AUDIT_JOBS_QUEUE_URL: 'https://sqs.aws.com/queue',
          LINKCHECKER_POLL_INTERVAL_MS: '1',
        },
        scrapeResultPaths: new Map(),
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('startLinkChecker flag routing', () => {
    it('should jump directly to LinkChecker when startLinkChecker flag is set', async () => {
      context.scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3://bucket/page1.html'],
      ]);

      context.auditContext = {
        ...context.auditContext,
        startLinkChecker: true, // Flag to skip batch processing
      };

      const result = await runCrawlDetectionBatch(context);

      // Should not process batches, should call fetchLinkCheckerLogsStep
      expect(result).to.exist;
    });
  });

  describe('resumePolling flag routing', () => {
    it('should jump directly to LinkChecker polling continuation when resumePolling is set', async () => {
      context.scrapeResultPaths = new Map([
        ['https://example.com/page1', 'path1'],
      ]);
      context.auditContext = {
        ...context.auditContext,
        resumePolling: true,
        linkCheckerJobId: 'job-123',
        linkCheckerStartTime: Date.now() - 1000,
      };

      const result = await runCrawlDetectionBatch(context);
      expect(result).to.exist;
      expect(context.log.info).to.have.been.calledWith(sinon.match('Resuming LinkChecker polling'));
    });
  });

  describe('Timeout-aware routing - sufficient time', () => {
    it('should proceed with direct call when >5 min remaining', async () => {
      context.scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3://bucket/page1.html'],
      ]);

      context.auditContext = {
        ...context.auditContext,
        batchStartIndex: 100, // Beyond total pages
      };

      // Mock that there's plenty of time (Lambda just started)
      sandbox.stub(Date, 'now').returns(Date.now()); // Fresh start

      const result = await runCrawlDetectionBatch(context);

      // Should proceed to LinkChecker directly (no SQS message sent for deferral)
      expect(result).to.exist;
      // Verify no "deferred" SQS message was sent
      const sqsCalls = context.sqs.sendMessage.getCalls();
      const deferredCalls = sqsCalls.filter(call =>
        call.args[1]?.auditContext?.startLinkChecker === true,
      );
      expect(deferredCalls).to.have.length(0);
    });
  });

  describe('Timeout-aware routing - insufficient time', () => {
    it('should defer to fresh Lambda when <5 min remaining', async () => {
      context.scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3://bucket/page1.html'],
      ]);

      context.auditContext = {
        ...context.auditContext,
        batchStartIndex: 100, // Beyond total pages
      };

      // Simulate Lambda that has been running for 11 minutes (4 min left, < 5 min threshold)
      const nowStub = sandbox.stub(Date, 'now');
      nowStub.onFirstCall().returns(0);
      nowStub.callsFake(() => 11 * 60 * 1000);

      const result = await runCrawlDetectionBatch(context);

      // Should defer with SQS message
      expect(result).to.deep.equal({ status: 'linkchecker-deferred' });
      expect(context.sqs.sendMessage).to.have.been.calledOnce;

      const sqsCall = context.sqs.sendMessage.getCall(0);
      const message = sqsCall.args[1];

      expect(message.auditContext.startLinkChecker).to.equal(true);
      expect(message.auditContext.next).to.equal('runCrawlDetectionBatch');
    });
  });

  describe('No scraping scenario', () => {
    it('should proceed directly to LinkChecker with no scraping (safe - no time consumed)', async () => {
      context.scrapeResultPaths = new Map(); // Empty

      const result = await runCrawlDetectionBatch(context);

      // Should proceed directly (no batch processing = plenty of time)
      expect(result).to.exist;
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });
  });

  describe('Duplicate message with insufficient time', () => {
    it('should defer when duplicate batch message arrives with <5 min left', async () => {
      context.scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3://bucket/page1.html'],
      ]);

      context.auditContext = {
        ...context.auditContext,
        batchStartIndex: 0,
      };

      // Mock that batch is already completed
      mockIsBatchCompleted.resolves(true);

      // Mock insufficient time remaining
      const nowStub = sandbox.stub(Date, 'now');
      nowStub.onFirstCall().returns(0);
      nowStub.callsFake(() => 11 * 60 * 1000);

      const result = await runCrawlDetectionBatch(context);

      // Should defer
      expect(result).to.deep.equal({ status: 'linkchecker-deferred' });
      expect(context.sqs.sendMessage).to.have.been.calledOnce;

      const message = context.sqs.sendMessage.getCall(0).args[1];
      expect(message.auditContext.startLinkChecker).to.equal(true);
    });
  });
});
