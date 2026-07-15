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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
// Use the REAL applyScopeToOpportunity (see cited-analysis test for rationale).
import { applyScopeToOpportunity as realApplyScopeToOpportunity } from '../../../src/utils/brand-resolver.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Reddit Analysis Guidance Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockOpportunity;
  let handler;
  let syncSuggestionsStub;
  let convertToOpportunityStub;
  let fetchAnalysisStub;
  let mockPostMessageOptional;
  let resolveBrandResultForSiteStub;
  let supersededRunSnapshotCreationStub;
  let findSnapshotByTriggerAuditIdStub;
  let prepareSuppressedRunSnapshotStub;
  let prepareSupersededRunSnapshotStub;

  const baseURL = 'https://example.com';
  const siteId = 'test-site-id';
  const auditId = 'test-audit-id';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockSite = {
      getId: sandbox.stub().returns(siteId),
      getBaseURL: sandbox.stub().returns(baseURL),
    };

    mockAudit = {
      getId: sandbox.stub().returns(auditId),
      getAuditResult: sandbox.stub().returns({}),
    };

    mockOpportunity = {
      getId: sandbox.stub().returns('opp-123'),
      getData: sandbox.stub().returns({ existingData: true }),
      setData: sandbox.stub(),
      setStatus: sandbox.stub(),
      setScopeType: sandbox.stub(),
      setScopeId: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    syncSuggestionsStub = sandbox.stub().resolves();
    convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
    fetchAnalysisStub = sandbox.stub();
    mockPostMessageOptional = sandbox.stub().resolves({ success: true });
    resolveBrandResultForSiteStub = sandbox.stub().resolves({ brand: null, resolved: true });
    supersededRunSnapshotCreationStub = sandbox.stub().resolves(null);
    findSnapshotByTriggerAuditIdStub = sandbox.stub().resolves(null);
    prepareSuppressedRunSnapshotStub = sandbox.stub().callsFake(async ({
      triggerAuditId,
      opportunityData,
      evergreenOpportunity,
    }) => {
      const existingSuppressedRunSnapshot = triggerAuditId
        ? await findSnapshotByTriggerAuditIdStub()
        : null;
      return {
        opportunityToUpdate: existingSuppressedRunSnapshot,
        opportunityData: {
          ...opportunityData,
          tags: [...new Set([...(opportunityData.tags || []), 'offsite-snapshot'])],
          data: {
            ...(opportunityData.data || {}),
            snapshot: {
              ...(evergreenOpportunity
                ? { evergreenOpportunityId: evergreenOpportunity.getId() }
                : {}),
              kind: 'suppressed-refresh',
              ...(triggerAuditId ? { triggerAuditId } : {}),
            },
          },
        },
      };
    });
    prepareSupersededRunSnapshotStub = sandbox.stub().callsFake(async ({
      dataAccess,
      siteId: refreshSiteId,
      auditType,
      triggerAuditId,
      opportunityData,
      evergreenOpportunity,
      log,
    }) => {
      if (evergreenOpportunity) {
        await supersededRunSnapshotCreationStub({
          dataAccess,
          siteId: refreshSiteId,
          auditType,
          triggerAuditId,
          evergreenOpportunity,
          log,
        });
        if (!triggerAuditId) {
          log.warn('[OffsiteSnapshot] Missing auditId; snapshot idempotency and traceability are unavailable');
        }
      }
      return { opportunityData, opportunityToUpdate: evergreenOpportunity };
    });

    handler = await esmock('../../../src/reddit-analysis/guidance-handler.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
      '../../../src/common/offsite-refresh.js': {
        persistOffsiteOpportunity: convertToOpportunityStub,
      },
      '../../../src/utils/slack-utils.js': { postMessageOptional: mockPostMessageOptional },
      '../../../src/utils/analysis-fetch.js': {
        fetchAnalysisFromPresignedUrl: fetchAnalysisStub,
      },
      '../../../src/utils/brand-resolver.js': {
        resolveBrandResultForSite: resolveBrandResultForSiteStub,
        applyScopeToOpportunity: realApplyScopeToOpportunity,
      },
      '../../../src/common/offsite-snapshot.js': {
        prepareSuppressedRunSnapshot: prepareSuppressedRunSnapshotStub,
        prepareSupersededRunSnapshot: prepareSupersededRunSnapshotStub,
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves(mockSite),
          },
          Audit: {
            findById: sandbox.stub().resolves(mockAudit),
          },
          // withOverrides() shallow-replaces the whole dataAccess object, so Opportunity
          // must be provided here too — otherwise resolveEvergreenOpportunity's internal
          // Opportunity.allBySiteIdAndStatus call throws on `undefined` for every test in
          // this file that doesn't set its own dataAccess.Opportunity mock below.
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Handler with inline analysis data', () => {
    it('should process analysis with suggestions successfully', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              {
                id: 'sug_1',
                priority: 'HIGH',
                title: 'Improve community engagement',
                description: 'Engage more in relevant subreddits',
              },
              {
                id: 'sug_2',
                priority: 'MEDIUM',
                title: 'Address sentiment',
                description: 'Respond to negative feedback',
              },
            ],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      expect(mockOpportunity.setStatus).to.have.been.calledWith('NEW');
      expect(mockOpportunity.setData).to.have.been.called;
      expect(mockOpportunity.save).to.have.been.called;
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Successfully processed Reddit analysis/));
    });

    it('should pass opportunityData from BO JSON to persistOffsiteOpportunity', async () => {
      const opportunityData = {
        title: '[ʙᴇᴛᴀ] Reddit Sentiment Analysis - Cited',
        description: 'Custom description from Mystique',
        runbook: 'https://adobe.sharepoint.com/sites/reddit-analysis',
        origin: 'ESS_OPS',
        tags: ['Reddit', 'Social Media', 'social', 'isElmo'],
      };
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: opportunityData,
            suggestions: [
              { id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const convertCall = convertToOpportunityStub.firstCall;
      const propsArg = convertCall.args[5];
      expect(propsArg.opportunityData).to.deep.equal(opportunityData);
    });

    it('should not pass a comparisonFn, relying on default match-by-type for a stable opportunity per (site, type)', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              { id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' },
            ],
          },
        },
      };

      await handler.default(message, context);

      expect(convertToOpportunityStub.firstCall.args[6]).to.be.undefined;
    });

    it('should set status from opportunityData when provided by Mystique', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: { status: 'IGNORED' },
            suggestions: [
              { id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' },
            ],
          },
        },
      };

      await handler.default(message, context);

      expect(mockOpportunity.setStatus).to.have.been.calledWith('IGNORED');
    });

    it('should return noContent when no suggestions found', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      expect(convertToOpportunityStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith('[Reddit] No suggestions found in analysis');
    });

    it('should return noContent when suggestions property is missing from analysis', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: { title: 'Some title' },
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      expect(convertToOpportunityStub).to.not.have.been.called;
    });

    it('should return noContent and log error when Mystique returns an error', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          error: true,
          errorMessage: 'HTTP error in content store /url-lookup (dataset=reddit_posts): 400 Bad Request',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Mystique returned an error.*400 Bad Request/),
      );
      expect(convertToOpportunityStub).to.not.have.been.called;
    });

    it('should return badRequest when no analysis data provided', async () => {
      const message = {
        siteId,
        auditId,
        data: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith('[Reddit] No analysis data provided in message');
    });

    it('should return notFound when site not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      const message = {
        siteId: 'non-existent-site',
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' }],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(404);
      expect(context.log.error).to.have.been.calledWith(sinon.match(/Site not found/));
    });
  });

  describe('Handler with presigned URL', () => {
    it('should fetch BO JSON from presigned URL and pass opportunityData', async () => {
      const opportunityData = {
        id: 'opp-1',
        title: '[ʙᴇᴛᴀ] Reddit Sentiment Analysis - Cited',
        description: 'Analysis description',
        runbook: 'https://adobe.sharepoint.com/sites/reddit-analysis',
        origin: 'ESS_OPS',
        tags: ['Reddit', 'Social Media'],
      };
      const boJson = {
        opportunity: opportunityData,
        suggestions: [
          {
            id: 'critical_1',
            priority: 'CRITICAL',
            type: 'CONTENT_UPDATE',
            rank: 1,
            data: { title: 'Critical improvement' },
          },
        ],
      };

      fetchAnalysisStub.resolves(boJson);

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          presignedUrl: 'https://s3.amazonaws.com/bucket/bo.json',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(fetchAnalysisStub).to.have.been.calledWith('https://s3.amazonaws.com/bucket/bo.json', sinon.match.object);
      expect(convertToOpportunityStub).to.have.been.calledOnce;

      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg.opportunityData).to.deep.equal(opportunityData);
    });

    it('should return badRequest when presigned URL fetch fails with non-ok response', async () => {
      fetchAnalysisStub.rejects(new Error('[Reddit] analysis fetch failed: 500 Internal Server Error'));

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          presignedUrl: 'https://s3.amazonaws.com/bucket/bo.json',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(sinon.match(/Error fetching from presigned URL/));
    });

    it('should return badRequest when presigned URL hostname is not allowlisted (SSRF guard)', async () => {
      fetchAnalysisStub.rejects(new Error('presignedUrl hostname is not an allowlisted S3 hostname: internal.example'));

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          presignedUrl: 'https://internal.example/analysis.json',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(sinon.match(/hostname is not an allowlisted/));
    });

    it('should return badRequest when presigned URL fetch throws error', async () => {
      fetchAnalysisStub.rejects(new Error('Network error'));

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          presignedUrl: 'https://s3.amazonaws.com/bucket/bo.json',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(sinon.match(/Error fetching from presigned URL/));
    });
  });

  describe('Slack Notifications', () => {
    const SLACK_CHANNEL_ID = 'C-test-channel';
    const SLACK_THREAD_TS = '1700000000.123456';
    const mockAnalysisData = {
      suggestions: [
        { id: 's1', priority: 'HIGH', title: 'Test', description: 'Test' },
      ],
    };

    it('should send Slack notification when slackContext is stored on audit', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: {
          analysis: mockAnalysisData,
          companyName: 'Example Corp',
        },
      };

      await handler.default(message, context);

      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const [callCtx, callChannelId, callText, callOptions] = mockPostMessageOptional.firstCall.args;
      expect(callCtx).to.equal(context);
      expect(callChannelId).to.equal(SLACK_CHANNEL_ID);
      expect(callOptions).to.deep.equal({ threadTs: SLACK_THREAD_TS });
      expect(callText).to.include('reddit-analysis');
      expect(callText).to.include('audit finished');
      expect(callText).to.include(baseURL);
    });

    it('should not send Slack notification when no slackContext on audit', async () => {
      mockAudit.getAuditResult.returns({});

      const message = {
        siteId,
        auditId,
        data: {
          analysis: mockAnalysisData,
          companyName: 'Example Corp',
        },
      };

      await handler.default(message, context);

      expect(mockPostMessageOptional).to.not.have.been.called;
    });

    it('should not send Slack notification when auditId is missing', async () => {
      const message = {
        siteId,
        data: {
          analysis: mockAnalysisData,
          companyName: 'Example Corp',
        },
      };

      await handler.default(message, context);

      expect(mockPostMessageOptional).to.not.have.been.called;
    });

    it('should handle plural suggestion count in Slack message', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: [
              { id: 's1', type: 'CONTENT_UPDATE', rank: 1, data: {} },
              { id: 's2', type: 'CONTENT_UPDATE', rank: 2, data: {} },
            ],
            opportunity: {},
          },
          companyName: 'Example Corp',
        },
      };

      await handler.default(message, context);

      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include('2 suggestions processed');
    });

    it('reports a visible opportunity as below threshold without the raw rate', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: [{ id: 's1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
            opportunity: { status: 'NEW', qaVerdict: { rate: 0.12, rateDetermined: true } },
          },
          companyName: 'Example Corp',
        },
      };

      await handler.default(message, context);

      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include(':white_check_mark:');
      expect(callText).to.include('Visible in the UI');
      expect(callText).to.include('below hallucination threshold');
      expect(callText).to.not.include('12%');
    });

    it('reports a hidden opportunity (IGNORED) with the hallucination rate', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: [{ id: 's1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
            opportunity: { status: 'IGNORED', qaVerdict: { rate: 0.42, rateDetermined: true } },
          },
          companyName: 'Example Corp',
        },
      };

      await handler.default(message, context);

      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include(':warning:');
      expect(callText).to.include('Not visible in the UI');
      expect(callText).to.include('hallucination 42%');
    });

    it('shows "n/a" when the rate is visible but undetermined', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: [{ id: 's1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
            opportunity: { status: 'NEW', qaVerdict: { rate: 0, rateDetermined: false } },
          },
          companyName: 'Example Corp',
        },
      };

      await handler.default(message, context);

      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include('Visible in the UI');
      expect(callText).to.include('hallucination rate n/a');
      expect(callText).to.not.include('hallucination 0%');
    });

    it('omits the hallucination note when no qaVerdict is present', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: [{ id: 's1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
            opportunity: { status: 'NEW' },
          },
          companyName: 'Example Corp',
        },
      };

      await handler.default(message, context);

      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include('Visible in the UI');
      expect(callText).to.not.include('hallucination');
    });
  });

  describe('Suggestion mapping', () => {
    it('should pass rank and data from Mystique suggestion', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              {
                id: 'sug_a',
                rank: 1,
                type: 'CONTENT_UPDATE',
                data: { suggestionValue: 'Analysis A' },
              },
              {
                id: 'sug_b',
                rank: 2,
                type: 'METADATA_UPDATE',
                data: { suggestionValue: 'Analysis B' },
              },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { newData, mapNewSuggestion } = syncCall.args[0];

      const mapped0 = mapNewSuggestion(newData[0]);
      expect(mapped0.rank).to.equal(1);
      expect(mapped0.type).to.equal('CONTENT_UPDATE');
      expect(mapped0.data).to.deep.equal({ suggestionValue: 'Analysis A' });

      const mapped1 = mapNewSuggestion(newData[1]);
      expect(mapped1.rank).to.equal(2);
      expect(mapped1.type).to.equal('METADATA_UPDATE');
      expect(mapped1.data).to.deep.equal({ suggestionValue: 'Analysis B' });
    });

    it('should default type to CONTENT_UPDATE when not provided', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              {
                id: 'sug_no_type',
                rank: 0,
                data: { suggestionValue: 'No type' },
              },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { newData, mapNewSuggestion } = syncCall.args[0];

      const mapped = mapNewSuggestion(newData[0]);
      expect(mapped.type).to.equal('CONTENT_UPDATE');
    });

    it('should use correct buildKey function', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              { id: 'my_suggestion_id', priority: 'HIGH', title: 'My Title', description: 'Desc' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { buildKey } = syncCall.args[0];
      const key = buildKey({ id: 'my_suggestion_id' });

      expect(key).to.equal('reddit::my_suggestion_id');
    });
  });

  describe('Error handling', () => {
    it('should handle errors during opportunity creation', async () => {
      convertToOpportunityStub.rejects(new Error('Database connection failed'));

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              { id: 's1', priority: 'HIGH', title: 'Test', description: 'Test' },
            ],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error processing Reddit analysis/),
        sinon.match.any,
      );
    });

    it('should skip audit lookup when auditId is not provided', async () => {
      const message = {
        siteId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              { id: 's1', priority: 'HIGH', title: 'Test', description: 'Test' },
            ],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(context.dataAccess.Audit.findById).to.not.have.been.called;
    });

    it('should return badRequest when data is undefined', async () => {
      const message = { siteId, auditId };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith('[Reddit] No analysis data provided in message');
    });

    it('should return notFound when audit not found', async () => {
      context.dataAccess.Audit.findById.resolves(null);

      const message = {
        siteId,
        auditId: 'non-existent-audit',
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              { id: 's1', priority: 'HIGH', title: 'Test', description: 'Test' },
            ],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(404);
      expect(context.log.error).to.have.been.calledWith(sinon.match(/Audit not found/));
    });

    it('should store full analysis in opportunity data', async () => {
      const boJson = {
        suggestions: [
          { id: 's1', priority: 'HIGH', title: 'Test', description: 'Test' },
        ],
        extraData: 'should be preserved',
      };

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: boJson,
        },
      };

      await handler.default(message, context);

      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({
          existingData: true,
          fullAnalysis: sinon.match({ suggestions: boJson.suggestions }),
        }),
      );
    });
  });

  describe('Message logging', () => {
    it('should log received message', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Test',
          analysis: {
            suggestions: [],
          },
        },
      };

      await handler.default(message, context);

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Received Reddit analysis guidance for siteId/),
      );
    });

    it('should NOT log inbound brandId from message (trust boundary)', async () => {
      const message = {
        siteId,
        auditId,
        brandId: 'brand-uuid-123',
        data: {
          companyName: 'Test',
          analysis: {
            suggestions: [],
          },
        },
      };

      await handler.default(message, context);

      const infoCalls = context.log.info.getCalls();
      const found = infoCalls.find((c) => /brandId: brand-uuid-123/.test(String(c.args[0])));
      expect(found, 'inbound brandId should not be logged from message').to.equal(undefined);
    });
  });

  describe('Brand scope', () => {
    it('should set scope when brand is resolved server-side', async () => {
      resolveBrandResultForSiteStub.resolves({ brand: { brandId: 'brand-uuid-123' }, resolved: true });

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Test Corp',
          analysis: {
            suggestions: [{ id: 's1', type: 'CONTENT_UPDATE', rank: 1 }],
          },
        },
      };

      await handler.default(message, context);

      expect(mockOpportunity.setScopeType).to.have.been.calledWith('brand');
      expect(mockOpportunity.setScopeId).to.have.been.calledWith('brand-uuid-123');
    });

    it('should clear scope (null) when no brand is resolved AND resolution succeeded', async () => {
      resolveBrandResultForSiteStub.resolves({ brand: null, resolved: true });

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Test Corp',
          analysis: {
            suggestions: [{ id: 's1', type: 'CONTENT_UPDATE', rank: 1 }],
          },
        },
      };

      await handler.default(message, context);

      expect(mockOpportunity.setScopeType).to.have.been.calledWith(null);
      expect(mockOpportunity.setScopeId).to.have.been.calledWith(null);
    });

    it('should PRESERVE existing scope when PostgREST resolution fails (transient outage)', async () => {
      resolveBrandResultForSiteStub.resolves({ brand: null, resolved: false });

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Test Corp',
          analysis: {
            suggestions: [{ id: 's1', type: 'CONTENT_UPDATE', rank: 1 }],
          },
        },
      };

      await handler.default(message, context);

      expect(mockOpportunity.setScopeType).to.not.have.been.called;
      expect(mockOpportunity.setScopeId).to.not.have.been.called;
    });

    it('should rollback scopeType when setScopeId throws (partial-write rollback)', async () => {
      resolveBrandResultForSiteStub.resolves({ brand: { brandId: 'brand-uuid-123' }, resolved: true });
      mockOpportunity.setScopeId.throws(new Error('invalid uuid'));

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Test Corp',
          analysis: {
            suggestions: [{ id: 's1', type: 'CONTENT_UPDATE', rank: 1 }],
          },
        },
      };

      await handler.default(message, context);

      expect(mockOpportunity.setScopeType).to.have.been.calledTwice;
      expect(mockOpportunity.setScopeType.firstCall).to.have.been.calledWith('brand');
      expect(mockOpportunity.setScopeType.secondCall).to.have.been.calledWith(null);
    });

    it('should ignore inbound brandId from message and use server-side resolved brand', async () => {
      resolveBrandResultForSiteStub.resolves({ brand: { brandId: 'current-uuid' }, resolved: true });

      const message = {
        siteId,
        auditId,
        brandId: 'stale-uuid',
        data: {
          companyName: 'Test Corp',
          analysis: {
            suggestions: [{ id: 's1', type: 'CONTENT_UPDATE', rank: 1 }],
          },
        },
      };

      await handler.default(message, context);

      expect(resolveBrandResultForSiteStub).to.have.been.called;
      expect(mockOpportunity.setScopeId).to.have.been.calledWith('current-uuid');
      expect(mockOpportunity.setScopeId).not.to.have.been.calledWith('stale-uuid');
    });
  });

  describe('Evergreen opportunity refresh safety', () => {
    const validMessage = (overrides = {}) => ({
      siteId,
      auditId,
      data: {
        companyName: 'Example Corp',
        analysis: {
          suggestions: [
            { id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' },
          ],
        },
      },
      ...overrides,
    });

    it('should return badRequest and skip all mutation when analysis.opportunity is malformed', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: ['not', 'an', 'object'],
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' }],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(convertToOpportunityStub).to.not.have.been.called;
      expect(syncSuggestionsStub).to.not.have.been.called;
    });

    it('should persist a suppressed run as a new opportunity without touching the visible one', async () => {
      const visibleOpportunity = {
        getId: sandbox.stub().returns('existing-opp-1'),
        getType: sandbox.stub().returns('reddit-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2026-01-01T00:00:00.000Z'),
      };
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([visibleOpportunity]),
      };

      const message = validMessage({
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: { status: 'IGNORED' },
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' }],
          },
        },
      });

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      expect(mockOpportunity.setStatus).to.have.been.calledWith('IGNORED');
      // opportunityToUpdate is explicitly null so persistOffsiteOpportunity creates a record
      // a new opportunity, never reusing (or re-querying for) the visible one.
      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg).to.have.property('opportunityToUpdate', null);
    });

    // Whether nothing exists yet, or the only prior opportunity is already IGNORED, the
    // NEW-status lookup that feeds resolution returns the same thing (no matches) — so both
    // states exercise this same "create a new row" path.
    it('should create a new (hidden) opportunity for a suppressed run when nothing is visible yet', async () => {
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
      };

      const message = validMessage({
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: { status: 'IGNORED' },
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' }],
          },
        },
      });

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(mockOpportunity.setStatus).to.have.been.calledWith('IGNORED');
      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg).to.have.property('opportunityToUpdate', null);
    });

    it('should hand the resolved evergreen to persistOffsiteOpportunity for a surfaced run', async () => {
      const visibleOpportunity = {
        getId: sandbox.stub().returns('existing-opp-1'),
        getType: sandbox.stub().returns('reddit-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2026-01-01T00:00:00.000Z'),
      };
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([visibleOpportunity]),
      };

      const message = validMessage();

      await handler.default(message, context);

      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg.opportunityToUpdate).to.equal(visibleOpportunity);
      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledOnce;
    });

    it('should lazily retire duplicate NEW opportunities of the same type via saveMany, keeping the most recent as evergreen', async () => {
      const older = {
        getId: sandbox.stub().returns('older-opp'),
        getType: sandbox.stub().returns('reddit-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2025-01-01T00:00:00.000Z'),
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const newer = {
        getId: sandbox.stub().returns('newer-opp'),
        getType: sandbox.stub().returns('reddit-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2026-01-01T00:00:00.000Z'),
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const saveManyStub = sandbox.stub().resolves();
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([older, newer]),
        saveMany: saveManyStub,
      };

      const message = validMessage();

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(older.setStatus).to.have.been.calledWith('IGNORED');
      expect(newer.setStatus).to.not.have.been.called;
      expect(saveManyStub).to.have.been.calledOnce;
      expect(saveManyStub.firstCall.args[0]).to.deep.equal([older]);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(convertToOpportunityStub.firstCall.args[5].opportunityToUpdate).to.equal(newer);
    });

    it('should propagate the error (badRequest) when duplicate retirement fails, without proceeding', async () => {
      const older = {
        getId: sandbox.stub().returns('older-opp'),
        getType: sandbox.stub().returns('reddit-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2025-01-01T00:00:00.000Z'),
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const newer = {
        getId: sandbox.stub().returns('newer-opp'),
        getType: sandbox.stub().returns('reddit-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2026-01-01T00:00:00.000Z'),
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([older, newer]),
        saveMany: sandbox.stub().rejects(new Error('save failed')),
      };

      const message = validMessage();

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(convertToOpportunityStub).to.not.have.been.called;
    });

    it('should propagate the error (badRequest) when the initial opportunity lookup fails, without creating a duplicate', async () => {
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().rejects(new Error('DB down')),
      };

      const message = validMessage();

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      // A transient read failure must never be treated as "nothing exists yet" (which
      // would otherwise create a duplicate NEW opportunity) — persistence is never attempted.
      expect(convertToOpportunityStub).to.not.have.been.called;
      expect(syncSuggestionsStub).to.not.have.been.called;
    });
  });

  describe('Suppressed and superseded run snapshots', () => {
    const validMessage = (overrides = {}) => ({
      siteId,
      auditId,
      data: {
        companyName: 'Example Corp',
        analysis: {
          suggestions: [
            { id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' },
          ],
        },
      },
      ...overrides,
    });

    it('snapshots the evergreen opportunity before a surfaced run overwrites it', async () => {
      const visibleOpportunity = {
        getId: sandbox.stub().returns('existing-opp-1'),
        getType: sandbox.stub().returns('reddit-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2026-01-01T00:00:00.000Z'),
      };
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([visibleOpportunity]),
      };

      await handler.default(validMessage(), context);

      expect(supersededRunSnapshotCreationStub).to.have.been.calledOnce;
      const callArgs = supersededRunSnapshotCreationStub.firstCall.args[0];
      expect(callArgs.siteId).to.equal(siteId);
      expect(callArgs.auditType).to.equal('reddit-analysis');
      expect(callArgs.triggerAuditId).to.equal(auditId);
      expect(callArgs.evergreenOpportunity).to.equal(visibleOpportunity);
    });

    it('does not attempt a snapshot on a genuine first-ever run (no evergreen exists yet)', async () => {
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
      };

      await handler.default(validMessage(), context);

      expect(supersededRunSnapshotCreationStub).to.not.have.been.called;
    });

    it('passes suppressed run snapshot identity in the initial create data, linked to the evergreen', async () => {
      const visibleOpportunity = {
        getId: sandbox.stub().returns('existing-opp-1'),
        getType: sandbox.stub().returns('reddit-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2026-01-01T00:00:00.000Z'),
      };
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([visibleOpportunity]),
      };

      const message = validMessage({
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: {
              status: 'IGNORED',
              tags: ['custom-tag'],
              data: { qa: 'suppressed' },
            },
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' }],
          },
        },
      });

      await handler.default(message, context);

      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg.opportunityData.tags).to.include.members(['custom-tag', 'offsite-snapshot']);
      expect(propsArg.opportunityData.data).to.deep.equal({
        qa: 'suppressed',
        snapshot: {
          evergreenOpportunityId: 'existing-opp-1',
          kind: 'suppressed-refresh',
          triggerAuditId: auditId,
        },
      });
    });

    it('passes initial suppressed run snapshot identity without a linked evergreen when none exists yet', async () => {
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
      };

      const message = validMessage({
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: { status: 'IGNORED' },
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' }],
          },
        },
      });

      await handler.default(message, context);

      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg.opportunityData.tags).to.include('offsite-snapshot');
      expect(propsArg.opportunityData.data.snapshot).to.deep.equal({
        kind: 'suppressed-refresh',
        triggerAuditId: auditId,
      });
    });

    it('does not label a surfaced (NEW) run as a snapshot', async () => {
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
      };

      await handler.default(validMessage(), context);
    });

    it('reuses a snapshot already tagged for this auditId instead of creating a duplicate on suppressed-run redelivery', async () => {
      const existingSuppressedRunSnapshot = {
        getId: sandbox.stub().returns('snapshot-opp-1'),
      };
      findSnapshotByTriggerAuditIdStub.resolves(existingSuppressedRunSnapshot);
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
      };

      const message = validMessage({
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: { status: 'IGNORED' },
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' }],
          },
        },
      });

      await handler.default(message, context);

      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg.opportunityToUpdate).to.equal(existingSuppressedRunSnapshot);
    });

    it('propagates the error (badRequest) when the suppressed-run snapshot idempotency lookup fails', async () => {
      findSnapshotByTriggerAuditIdStub.rejects(new Error('DB down'));
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
      };

      const message = validMessage({
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: { status: 'IGNORED' },
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' }],
          },
        },
      });

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(convertToOpportunityStub).to.not.have.been.called;
    });

    it('creates a superseded snapshot for a surfaced refresh when auditId is missing', async () => {
      const visibleOpportunity = {
        getId: sandbox.stub().returns('existing-opp-1'),
        getType: sandbox.stub().returns('reddit-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2026-01-01T00:00:00.000Z'),
      };
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([visibleOpportunity]),
      };

      const result = await handler.default(validMessage({ auditId: undefined }), context);

      expect(result.status).to.equal(200);
      expect(supersededRunSnapshotCreationStub).to.have.been.calledOnce;
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(context.log.warn).to.have.been.calledWithMatch(/idempotency.*traceability/i);
    });

    it('creates a managed suppressed snapshot without lookup when auditId is missing', async () => {
      const message = validMessage({
        auditId: undefined,
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: { status: 'IGNORED', data: { qa: 'legacy' } },
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' }],
          },
        },
      });

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(findSnapshotByTriggerAuditIdStub).to.not.have.been.called;
      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg.opportunityData.tags).to.include('offsite-snapshot');
      expect(propsArg.opportunityData.data).to.deep.equal({
        qa: 'legacy',
        snapshot: { kind: 'suppressed-refresh' },
      });
      expect(propsArg.opportunityData.data.snapshot).to.not.have.property('triggerAuditId');
    });
  });
});
