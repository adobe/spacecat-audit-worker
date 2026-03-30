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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { createContextLogger } from '../../../src/common/context-logger.js';
import {
  buildLinkCheckerQuery,
  submitSplunkJob,
  pollJobStatus,
  fetchJobResults,
} from '../../../src/internal-links/linkchecker-splunk.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

describe('LinkChecker Steps Tests', function () {
  this.timeout(60000);
  const sandbox = sinon.createSandbox();
  let context;
  let mockSplunkClient;
  let mockCreateSplunkClient;
  let fetchLinkCheckerLogsStep;
  let resumeLinkCheckerPollingStep;
  let batchStateMock;
  let createLinkCheckerOrchestration;

  beforeEach(async () => {
    // Mock Splunk client
    mockSplunkClient = {
      login: sandbox.stub().resolves({ sessionId: 'test-session', cookie: 'test-cookie' }),
      fetchAPI: sandbox.stub(),
      apiBaseUrl: 'https://splunk.example.com:8089',
      env: {
        SPLUNK_SEARCH_NAMESPACE: 'team/search',
      },
    };

    mockCreateSplunkClient = sandbox.stub().resolves(mockSplunkClient);

    // Mock the module imports
    batchStateMock = {
      saveBatchResults: sandbox.stub().resolves(),
      updateCache: sandbox.stub().resolves(),
      loadCache: sandbox.stub().resolves({ brokenUrlsCache: [], workingUrlsCache: [] }),
      markBatchCompleted: sandbox.stub().resolves(),
      isBatchCompleted: sandbox.stub().resolves(false),
        loadFinalResults: sandbox.stub().resolves([]),
        cleanupBatchState: sandbox.stub().resolves(),
        tryAcquireFinalizationLock: sandbox.stub().resolves('"finalization-lock-etag"'),
        releaseFinalizationLock: sandbox.stub().resolves(),
        reserveWorkflowDispatch: sandbox.stub().resolves({ acquired: true, state: 'acquired' }),
        markWorkflowDispatchSent: sandbox.stub().resolves(),
        markWorkflowDispatchSentWithRetry: sandbox.stub().resolves(),
        clearWorkflowDispatchReservation: sandbox.stub().resolves(),
        releaseBatchProcessingClaim: sandbox.stub().resolves(),
        tryStartBatchProcessing: sandbox.stub().resolves('"mock-claim-etag"'),
        tryAcquireExecutionLock: sandbox.stub().resolves('"exec-lock-etag"'),
        releaseExecutionLock: sandbox.stub().resolves(),
        saveScrapeResultPaths: sandbox.stub().resolves(),
        loadScrapeResultPaths: sandbox.stub().resolves(new Map()),
      getTimeoutStatus: (startTime) => {
        const elapsed = Date.now() - startTime;
        const lambdaTimeoutMs = 15 * 60 * 1000;
        const safeTimeRemaining = lambdaTimeoutMs - elapsed - (2 * 60 * 1000);
        return {
          elapsed,
          remaining: lambdaTimeoutMs - elapsed,
          safeTimeRemaining,
          isApproachingTimeout: safeTimeRemaining <= 0,
          percentUsed: (elapsed / lambdaTimeoutMs) * 100,
        };
      },
      BATCH_TIMEOUT_CONFIG: {
        LAMBDA_TIMEOUT_MS: 15 * 60 * 1000,
        TIMEOUT_BUFFER_MS: 2 * 60 * 1000,
        SAFE_PROCESSING_TIME_MS: 13 * 60 * 1000,
        BATCH_CLAIM_TTL_MS: 15 * 60 * 1000,
        DISPATCH_RESERVATION_TTL_MS: 5 * 60 * 1000,
      },
    };
    ({ createLinkCheckerOrchestration } = await esmock(
      '../../../src/internal-links/linkchecker-orchestration.js',
      {
        '../../../src/internal-links/batch-state.js': batchStateMock,
      },
    ));

    // Create basic context
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: {
          getId: () => 'site123',
          getBaseURL: () => 'https://example.com',
          getDeliveryConfig: () => ({}),
          getConfig: () => ({
            getHandlers: () => ({
              'broken-internal-links': {
                config: {
                  isLinkcheckerEnabled: true,
                  linkCheckerLookbackMinutes: 1440,
                  aemProgramId: 'program123',
                  aemEnvironmentId: 'env456',
                },
              },
            }),
          }),
        },
        audit: {
          getId: () => 'audit123',
          getAuditType: () => AUDIT_TYPE,
          getFullAuditRef: () => 'https://example.com',
          getAuditResult: () => ({
            brokenInternalLinks: [],
            success: true,
          }),
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
        env: {
          AUDIT_JOBS_QUEUE_URL: 'https://sqs.aws.com/queue',
          LINKCHECKER_POLL_INTERVAL_MS: '1',
        },
        dataAccess: {
          Opportunity: {
            create: sandbox.stub().resolves({
              getId: () => 'oppty-1',
              setStatus: sandbox.stub(),
              getSuggestions: sandbox.stub().resolves([]),
              addSuggestions: sandbox.stub().resolves([]),
              setUpdatedBy: sandbox.stub(),
              save: sandbox.stub().resolves(),
            }),
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
            findById: sandbox.stub().resolves(null),
            bulkUpdateStatus: sandbox.stub().resolves(),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
          },
        },
      })
      .build();

    const finalizeCrawlDetection = sandbox.stub().callsFake(async (finalizeContext) => {
      const currentAuditResult = context.audit.getAuditResult?.() || {};
      const nextAuditResult = {
        ...currentAuditResult,
        internalLinksLinkCheckerStatus: finalizeContext.linkCheckerStatus,
      };

      if (finalizeContext.linkCheckerError) {
        nextAuditResult.internalLinksLinkCheckerError = finalizeContext.linkCheckerError;
      }

      if (finalizeContext.linkCheckerResults) {
        nextAuditResult.internalLinksLinkCheckerResults = finalizeContext.linkCheckerResults;
      }

      context.audit.setAuditResult(nextAuditResult);
      await context.audit.save();
      return { status: 'finalized' };
    });

    ({
      fetchLinkCheckerLogsStep,
      resumeLinkCheckerPollingStep,
    } = createLinkCheckerOrchestration({
      auditType: AUDIT_TYPE,
      createContextLogger,
      getTimeoutStatus: batchStateMock.getTimeoutStatus,
      buildLinkCheckerQuery,
      submitSplunkJob,
      pollJobStatus,
      fetchJobResults,
      createSplunkClient: mockCreateSplunkClient,
      finalizeCrawlDetection,
    }));
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('fetchLinkCheckerLogsStep', () => {
    it('should skip stale LinkChecker start when workflow already completed', async () => {
      context.audit.getAuditResult = () => ({
        brokenInternalLinks: [],
        internalLinksWorkflowCompletedAt: '2026-03-14T09:45:00.000Z',
      });

      const result = await fetchLinkCheckerLogsStep(context);

      expect(result).to.deep.equal({ status: 'already-finalized' });
      expect(batchStateMock.tryAcquireExecutionLock).to.not.have.been.called;
      expect(mockCreateSplunkClient).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match('Audit already finalized at 2026-03-14T09:45:00.000Z'),
      );
    });

    it('should skip LinkChecker detection when feature flag is disabled', async () => {
      context.site.getConfig = () => ({
        getHandlers: () => ({
          'broken-internal-links': {
            config: {
              isLinkcheckerEnabled: false,
            },
          },
        }),
      });

      const result = await fetchLinkCheckerLogsStep(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match('LinkChecker detection disabled'));
      expect(context.audit.setAuditResult).to.have.been.called;
      expect(context.audit.setAuditResult.lastCall.args[0]).to.include({
        internalLinksLinkCheckerStatus: 'skipped',
      });
      // Should proceed to finalization without LinkChecker data
      expect(result).to.exist;
    });

    it('should skip LinkChecker detection when programId is missing', async () => {
      context.site.getConfig = () => ({
        getHandlers: () => ({
          'broken-internal-links': {
            config: {
              isLinkcheckerEnabled: true,
              aemEnvironmentId: 'env456',
            },
          },
        }),
      });

      const result = await fetchLinkCheckerLogsStep(context);

      expect(context.log.warn).to.have.been.calledWith(sinon.match('Missing AEM programId or environmentId'));
    });

    it('should skip LinkChecker detection when environmentId is missing', async () => {
      context.site.getConfig = () => ({
        getHandlers: () => ({
          'broken-internal-links': {
            config: {
              isLinkcheckerEnabled: true,
              aemProgramId: 'program123',
            },
          },
        }),
      });

      const result = await fetchLinkCheckerLogsStep(context);

      expect(context.log.warn).to.have.been.calledWith(sinon.match('Missing AEM programId or environmentId'));
    });

    it('should use deliveryConfig programId and environmentId when present', async () => {
      context.site.getDeliveryConfig = () => ({
        programId: 'delivery-program',
        environmentId: 'delivery-env',
      });
      context.site.getConfig = () => ({
        getHandlers: () => ({
          'broken-internal-links': {
            config: {
              isLinkcheckerEnabled: true,
              aemProgramId: 'handler-program',
              aemEnvironmentId: 'handler-env',
            },
          },
        }),
      });

      mockSplunkClient.fetchAPI
        .onFirstCall().resolves({
          status: 201,
          json: sandbox.stub().resolves({ sid: 'job-123' }),
        })
        .onSecondCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            entry: [{
              content: {
                isDone: true,
                dispatchState: 'DONE',
                resultCount: 0,
              },
            }],
          }),
        })
        .onThirdCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({ results: [] }),
        });

      await fetchLinkCheckerLogsStep(context);

      expect(context.log.info).to.have.been.calledWith(
        sinon.match('Starting LinkChecker detection: programId=delivery-program, environmentId=delivery-env'),
      );
    });

    it('should submit Splunk job and fetch results when job completes quickly', async () => {
      // Mock Splunk job submission
      mockSplunkClient.fetchAPI
        .onFirstCall().resolves({
          status: 201,
          json: sandbox.stub().resolves({ sid: 'job-123' }),
        })
        // Mock job status (done immediately)
        .onSecondCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            entry: [{
              content: {
                isDone: true,
                dispatchState: 'DONE',
                resultCount: 2,
              },
            }],
          }),
        })
        // Mock fetch results
        .onThirdCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            results: [
              {
                urlFrom: 'https://example.com/page1',
                urlTo: 'https://example.com/broken1',
                anchorText: 'Link 1',
                itemType: 'link',
                httpStatus: '404',
              },
              {
                urlFrom: 'https://example.com/page2',
                urlTo: 'https://example.com/broken2',
                anchorText: 'Link 2',
                itemType: 'link',
                httpStatus: '404',
              },
            ],
          }),
        });

      const result = await fetchLinkCheckerLogsStep(context);

      expect(mockCreateSplunkClient).to.have.been.calledOnce;
      expect(mockSplunkClient.login).to.have.been.called;
      expect(context.log.info).to.have.been.calledWith(sinon.match('Splunk job submitted successfully'));
      expect(context.log.info).to.have.been.calledWith(sinon.match('LinkChecker detection found 2 broken links'));
    });

    it('should send continuation message when approaching Lambda timeout', async () => {
      const timeoutHandler = createLinkCheckerOrchestration({
        auditType: AUDIT_TYPE,
        createContextLogger,
        getTimeoutStatus: () => ({
          elapsed: 14 * 60 * 1000,
          remaining: 60 * 1000,
          safeTimeRemaining: -60 * 1000,
          isApproachingTimeout: true,
          percentUsed: 96,
        }),
        buildLinkCheckerQuery,
        submitSplunkJob,
        pollJobStatus,
        fetchJobResults,
        createSplunkClient: mockCreateSplunkClient,
        finalizeCrawlDetection: sandbox.stub().resolves({ status: 'finalized' }),
      });

      mockSplunkClient.fetchAPI
        .onFirstCall().resolves({
          status: 201,
          json: sandbox.stub().resolves({ sid: 'job-123' }),
        });

      const result = await timeoutHandler.fetchLinkCheckerLogsStep(context);
      expect(result).to.deep.equal({ status: 'linkchecker-polling-continuation' });
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
    });

    it('should finalize with failed LinkChecker status when Splunk job fails', async () => {
      // Mock Splunk job submission
      mockSplunkClient.fetchAPI
        .onFirstCall().resolves({
          status: 201,
          json: sandbox.stub().resolves({ sid: 'job-123' }),
        })
        // Mock job status (failed)
        .onSecondCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            entry: [{
              content: {
                isDone: false,
                isFailed: true,
                dispatchState: 'FAILED',
                resultCount: 0,
              },
            }],
          }),
        });

      const result = await fetchLinkCheckerLogsStep(context);

      expect(result).to.exist;
      expect(context.log.error).to.have.been.calledWith(sinon.match('LinkChecker Splunk job failed'));
      expect(context.audit.setAuditResult).to.have.been.called;
      expect(context.audit.setAuditResult.lastCall.args[0]).to.include({
        internalLinksLinkCheckerStatus: 'failed',
        internalLinksLinkCheckerError: 'LinkChecker Splunk job failed: sid=job-123, dispatchState=FAILED',
      });
    });

    it('should finalize with failed LinkChecker status when Splunk job submission fails', async () => {
      // Mock Splunk job submission failure
      mockSplunkClient.fetchAPI.resolves({
        status: 500,
        text: sandbox.stub().resolves('Internal Server Error'),
      });

      const result = await fetchLinkCheckerLogsStep(context);

      expect(result).to.exist;
      expect(context.log.error).to.have.been.calledWith(sinon.match('LinkChecker detection failed'));
      expect(context.audit.setAuditResult).to.have.been.called;
      expect(context.audit.setAuditResult.lastCall.args[0]).to.include({
        internalLinksLinkCheckerStatus: 'failed',
        internalLinksLinkCheckerError: 'Splunk job submission failed. Status: 500. Body: Internal Server Error',
      });
    });

    it('should send continuation when max poll attempts reached', async () => {
      // Mock Splunk job submission
      mockSplunkClient.fetchAPI
        .onFirstCall().resolves({
          status: 201,
          json: sandbox.stub().resolves({ sid: 'job-123' }),
        });

      // Mock job status (running) for all poll attempts
      for (let i = 0; i < 10; i += 1) {
        mockSplunkClient.fetchAPI
          .onCall(i + 1).resolves({
            status: 200,
            json: sandbox.stub().resolves({
              entry: [{
                content: {
                  isDone: false,
                  isFailed: false,
                  dispatchState: 'RUNNING',
                  resultCount: 0,
                },
              }],
            }),
          });
      }

      const result = await fetchLinkCheckerLogsStep(context);

      expect(context.log.warn).to.have.been.calledWith(sinon.match('Max poll attempts'));
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(result).to.deep.equal({ status: 'linkchecker-polling-continuation' });
    });

    it('should use custom lookback minutes from site config', async () => {
      context.site.getConfig = () => ({
        getHandlers: () => ({
          'broken-internal-links': {
            config: {
              isLinkcheckerEnabled: true,
              linkCheckerLookbackMinutes: 720, // 12 hours
              aemProgramId: 'program123',
              aemEnvironmentId: 'env456',
            },
          },
        }),
      });

      // Mock Splunk job submission
      mockSplunkClient.fetchAPI
        .onFirstCall().resolves({
          status: 201,
          json: sandbox.stub().resolves({ sid: 'job-123' }),
        })
        .onSecondCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            entry: [{
              content: {
                isDone: true,
                dispatchState: 'DONE',
                resultCount: 0,
              },
            }],
          }),
        })
        .onThirdCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({ results: [] }),
        });

      await fetchLinkCheckerLogsStep(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match('lookback=720m'));
    });

    it('should pass skipCrawlDetection flag through to finalization', async () => {
      context.skipCrawlDetection = true;

      context.site.getConfig = () => ({
        getHandlers: () => ({
          'broken-internal-links': {
            config: {
              isLinkcheckerEnabled: false,
            },
          },
        }),
      });

      const result = await fetchLinkCheckerLogsStep(context);

      // Should skip and proceed with skipCrawlDetection=true
      expect(result).to.exist;
    });
  });

  describe('resumeLinkCheckerPollingStep', () => {
    it('should skip stale LinkChecker polling when workflow already completed', async () => {
      context.audit.getAuditResult = () => ({
        brokenInternalLinks: [],
        internalLinksWorkflowCompletedAt: '2026-03-14T10:00:00.000Z',
      });
      context.auditContext = {
        ...context.auditContext,
        resumePolling: true,
        linkCheckerJobId: 'job-123',
        linkCheckerStartTime: Date.now() - 1000,
        pollingContinuationCount: 1,
      };

      const result = await resumeLinkCheckerPollingStep(context);

      expect(result).to.deep.equal({ status: 'already-finalized' });
      expect(batchStateMock.tryAcquireExecutionLock).to.not.have.been.called;
      expect(mockCreateSplunkClient).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match('Audit already finalized at 2026-03-14T10:00:00.000Z'),
      );
    });
  });

  describe('resumeLinkCheckerPollingStep', () => {
    beforeEach(() => {
      context.auditContext = {
        linkCheckerJobId: 'job-123',
        linkCheckerStartTime: Date.now() - 10000, // 10 seconds ago
        skipCrawlDetection: false,
      };
    });

    it('should throw when linkCheckerJobId is missing', async () => {
      context.auditContext = {
        linkCheckerStartTime: Date.now(),
      };

      await expect(resumeLinkCheckerPollingStep(context)).to.be.rejectedWith(
        'Missing linkCheckerJobId in auditContext, cannot resume polling',
      );

      expect(context.log.error).to.have.been.calledWith(sinon.match('Missing linkCheckerJobId'));
    });

    it('should throw when job exceeds max duration', async () => {
      context.auditContext = {
        linkCheckerJobId: 'job-123',
        linkCheckerStartTime: Date.now() - (61 * 60 * 1000), // 61 minutes ago
        skipCrawlDetection: false,
      };

      await expect(resumeLinkCheckerPollingStep(context)).to.be.rejectedWith(
        'LinkChecker job exceeded max duration for sid=job-123',
      );

      expect(context.log.warn).to.have.been.calledWith(sinon.match('LinkChecker job exceeded max duration'));
    });

    it('should fetch results when job completes on continuation', async () => {
      // Mock job status (done)
      mockSplunkClient.fetchAPI
        .onFirstCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            entry: [{
              content: {
                isDone: true,
                dispatchState: 'DONE',
                resultCount: 1,
              },
            }],
          }),
        })
        // Mock fetch results
        .onSecondCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            results: [
              {
                urlFrom: 'https://example.com/page1',
                urlTo: 'https://example.com/broken1',
                anchorText: 'Link 1',
                itemType: 'link',
                httpStatus: '404',
              },
            ],
          }),
        });

      const result = await resumeLinkCheckerPollingStep(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match('LinkChecker detection found 1 broken links'));
    });

    it('should send another continuation when max poll attempts reached', async () => {
      // Mock job status (running) for all attempts
      for (let i = 0; i < 10; i += 1) {
        mockSplunkClient.fetchAPI
          .onCall(i).resolves({
            status: 200,
            json: sandbox.stub().resolves({
              entry: [{
                content: {
                  isDone: false,
                  isFailed: false,
                  dispatchState: 'RUNNING',
                  resultCount: 0,
                },
              }],
            }),
          });
      }

      const result = await resumeLinkCheckerPollingStep(context);

      expect(context.log.warn).to.have.been.calledWith(sinon.match('Max poll attempts'));
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(result).to.deep.equal({ status: 'linkchecker-polling-continuation' });
    });

    it('should throw when job fails on continuation', async () => {
      mockSplunkClient.fetchAPI
        .onFirstCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            entry: [{
              content: {
                isDone: false,
                isFailed: true,
                dispatchState: 'FAILED',
                resultCount: 0,
              },
            }],
          }),
        });

      await expect(resumeLinkCheckerPollingStep(context)).to.be.rejectedWith(
        'LinkChecker Splunk job failed: sid=job-123, dispatchState=FAILED',
      );

      expect(context.log.error).to.have.been.calledWith(sinon.match('LinkChecker Splunk job failed'));
    });

    it('should throw when continuation polling errors', async () => {
      mockSplunkClient.fetchAPI.rejects(new Error('Network error'));

      await expect(resumeLinkCheckerPollingStep(context)).to.be.rejectedWith('Network error');

      expect(context.log.error).to.have.been.calledWith(sinon.match('LinkChecker polling continuation failed'));
    });

    it('should preserve skipCrawlDetection flag in continuation', async () => {
      context.auditContext.skipCrawlDetection = true;

      // Mock job status (running)
      for (let i = 0; i < 10; i += 1) {
        mockSplunkClient.fetchAPI
          .onCall(i).resolves({
            status: 200,
            json: sandbox.stub().resolves({
              entry: [{
                content: {
                  isDone: false,
                  isFailed: false,
                  dispatchState: 'RUNNING',
                  resultCount: 0,
                },
              }],
            }),
          });
      }

      await resumeLinkCheckerPollingStep(context);

      const sqsCall = context.sqs.sendMessage.getCall(0);
      expect(sqsCall.args[1].auditContext.skipCrawlDetection).to.be.true;
    });

    it('should include job metadata in continuation message', async () => {
      const jobStartTime = Date.now() - 30000; // 30 seconds ago
      context.auditContext = {
        linkCheckerJobId: 'job-123',
        linkCheckerStartTime: jobStartTime,
        skipCrawlDetection: false,
      };

      // Mock job status (running)
      for (let i = 0; i < 10; i += 1) {
        mockSplunkClient.fetchAPI
          .onCall(i).resolves({
            status: 200,
            json: sandbox.stub().resolves({
              entry: [{
                content: {
                  isDone: false,
                  isFailed: false,
                  dispatchState: 'RUNNING',
                  resultCount: 0,
                },
              }],
            }),
          });
      }

      await resumeLinkCheckerPollingStep(context);

      const sqsCall = context.sqs.sendMessage.getCall(0);
      const message = sqsCall.args[1];

      expect(message.auditContext.linkCheckerJobId).to.equal('job-123');
      expect(message.auditContext.linkCheckerStartTime).to.equal(jobStartTime);
      expect(message.auditContext.next).to.equal('runCrawlDetectionBatch');
    });

    it('should send continuation on resume when approaching Lambda timeout', async () => {
      const timeoutHandler = createLinkCheckerOrchestration({
        auditType: AUDIT_TYPE,
        createContextLogger,
        getTimeoutStatus: () => ({
          elapsed: 14 * 60 * 1000,
          remaining: 60 * 1000,
          safeTimeRemaining: -60 * 1000,
          isApproachingTimeout: true,
          percentUsed: 96,
        }),
        buildLinkCheckerQuery,
        submitSplunkJob,
        pollJobStatus,
        fetchJobResults,
        createSplunkClient: mockCreateSplunkClient,
        finalizeCrawlDetection: sandbox.stub().resolves({ status: 'finalized' }),
      });

      const result = await timeoutHandler.resumeLinkCheckerPollingStep(context);
      expect(result).to.deep.equal({ status: 'linkchecker-polling-continuation' });
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
    });
  });
});
