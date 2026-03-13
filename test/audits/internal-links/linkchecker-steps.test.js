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

describe('LinkChecker Steps Tests', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();
  let context;
  let mockSplunkClient;
  let mockCreateSplunkClient;
  let fetchLinkCheckerLogsStep;
  let resumeLinkCheckerPollingStep;

  beforeEach(async () => {
    // Mock Splunk client
    mockSplunkClient = {
      login: sandbox.stub().resolves({ sessionId: 'test-session', cookie: 'test-cookie' }),
      fetchAPI: sandbox.stub(),
      apiBaseUrl: 'https://splunk.example.com:8089',
    };

    mockCreateSplunkClient = sandbox.stub().resolves(mockSplunkClient);

    // Mock the module imports
    const mockedHandler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/support/splunk-client-loader.js': { createSplunkClient: mockCreateSplunkClient },
      '../../../src/internal-links/batch-state.js': {
        saveBatchResults: sandbox.stub().resolves(),
        updateCache: sandbox.stub().resolves(),
        loadCache: sandbox.stub().resolves({ brokenUrlsCache: [], workingUrlsCache: [] }),
        markBatchCompleted: sandbox.stub().resolves(),
        isBatchCompleted: sandbox.stub().resolves(false),
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

    fetchLinkCheckerLogsStep = mockedHandler.fetchLinkCheckerLogsStep;
    resumeLinkCheckerPollingStep = mockedHandler.resumeLinkCheckerPollingStep;

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
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('fetchLinkCheckerLogsStep', () => {
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
      const timeoutHandler = await esmock('../../../src/internal-links/handler.js', {
        '../../../src/support/splunk-client-loader.js': { createSplunkClient: mockCreateSplunkClient },
        '../../../src/internal-links/batch-state.js': {
          saveBatchResults: sandbox.stub().resolves(),
          updateCache: sandbox.stub().resolves(),
          loadCache: sandbox.stub().resolves({ brokenUrlsCache: [], workingUrlsCache: [] }),
          markBatchCompleted: sandbox.stub().resolves(),
          isBatchCompleted: sandbox.stub().resolves(false),
          loadFinalResults: sandbox.stub().resolves([]),
          cleanupBatchState: sandbox.stub().resolves(),
          getTimeoutStatus: () => ({
            elapsed: 14 * 60 * 1000,
            remaining: 60 * 1000,
            safeTimeRemaining: -60 * 1000,
            isApproachingTimeout: true,
            percentUsed: 96,
          }),
        },
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

    it('should proceed to finalization when Splunk job fails', async () => {
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

      expect(context.log.error).to.have.been.calledWith(sinon.match('Splunk job failed'));
      expect(context.log.warn).to.have.been.calledWith(sinon.match('Proceeding to finalization without LinkChecker data'));
    });

    it('should handle Splunk job submission error gracefully', async () => {
      // Mock Splunk job submission failure
      mockSplunkClient.fetchAPI
        .onFirstCall().resolves({
          status: 500,
          text: sandbox.stub().resolves('Internal Server Error'),
        });

      const result = await fetchLinkCheckerLogsStep(context);

      expect(context.log.error).to.have.been.calledWith(sinon.match('LinkChecker detection failed'));
      expect(context.log.warn).to.have.been.calledWith(sinon.match('Proceeding to finalization without LinkChecker data'));
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
    beforeEach(() => {
      context.auditContext = {
        linkCheckerJobId: 'job-123',
        linkCheckerStartTime: Date.now() - 10000, // 10 seconds ago
        skipCrawlDetection: false,
      };
    });

    it('should error when linkCheckerJobId is missing', async () => {
      context.auditContext = {
        // Missing linkCheckerJobId
        linkCheckerStartTime: Date.now(),
      };

      const result = await resumeLinkCheckerPollingStep(context);

      expect(context.log.error).to.have.been.calledWith(sinon.match('Missing linkCheckerJobId'));
    });

    it('should abort when job exceeds max duration', async () => {
      context.auditContext = {
        linkCheckerJobId: 'job-123',
        linkCheckerStartTime: Date.now() - (61 * 60 * 1000), // 61 minutes ago
        skipCrawlDetection: false,
      };

      const result = await resumeLinkCheckerPollingStep(context);

      expect(context.log.warn).to.have.been.calledWith(sinon.match('LinkChecker job has been running for'));
      expect(context.log.warn).to.have.been.calledWith(sinon.match('Proceeding to finalization without LinkChecker data'));
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

    it('should proceed to finalization when job fails on continuation', async () => {
      // Mock job status (failed)
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

      const result = await resumeLinkCheckerPollingStep(context);

      expect(context.log.error).to.have.been.calledWith(sinon.match('Splunk job failed'));
    });

    it('should handle error during continuation polling gracefully', async () => {
      // Mock Splunk API error
      mockSplunkClient.fetchAPI
        .onFirstCall().rejects(new Error('Network error'));

      const result = await resumeLinkCheckerPollingStep(context);

      expect(context.log.error).to.have.been.calledWith(sinon.match('LinkChecker polling continuation failed'));
      expect(context.log.warn).to.have.been.calledWith(sinon.match('Proceeding to finalization without LinkChecker data'));
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
      const timeoutHandler = await esmock('../../../src/internal-links/handler.js', {
        '../../../src/support/splunk-client-loader.js': { createSplunkClient: mockCreateSplunkClient },
        '../../../src/internal-links/batch-state.js': {
          saveBatchResults: sandbox.stub().resolves(),
          updateCache: sandbox.stub().resolves(),
          loadCache: sandbox.stub().resolves({ brokenUrlsCache: [], workingUrlsCache: [] }),
          markBatchCompleted: sandbox.stub().resolves(),
          isBatchCompleted: sandbox.stub().resolves(false),
          loadFinalResults: sandbox.stub().resolves([]),
          cleanupBatchState: sandbox.stub().resolves(),
          getTimeoutStatus: () => ({
            elapsed: 14 * 60 * 1000,
            remaining: 60 * 1000,
            safeTimeRemaining: -60 * 1000,
            isApproachingTimeout: true,
            percentUsed: 96,
          }),
        },
      });

      const result = await timeoutHandler.resumeLinkCheckerPollingStep(context);
      expect(result).to.deep.equal({ status: 'linkchecker-polling-continuation' });
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
    });
  });
});
