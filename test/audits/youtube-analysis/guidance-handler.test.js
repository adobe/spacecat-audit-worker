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
// Use the REAL applyScopeToOpportunity (see cited-analysis test for rationale).
import { applyScopeToOpportunity as realApplyScopeToOpportunity } from '../../../src/utils/brand-resolver.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('YouTube Analysis Guidance Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockOpportunity;
  let guidanceHandler;
  let mockFetchAnalysis;
  let mockConvertToOpportunity;
  let mockSyncSuggestions;
  let mockPostMessageOptional;
  let resolveBrandResultForSiteStub;

  const siteId = 'test-site-id';
  const auditId = 'test-audit-id';
  const baseURL = 'https://example.com';

  const mockAnalysisData = {
    suggestions: [
      {
        id: 'suggestion-1',
        type: 'CONTENT_UPDATE',
        priority: 'HIGH',
        title: 'Improve video engagement',
        description: 'Add more calls to action',
      },
      {
        id: 'suggestion-2',
        type: 'METADATA_UPDATE',
        priority: 'MEDIUM',
        title: 'Optimize video titles',
        description: 'Use more descriptive titles',
      },
    ],
    opportunity: {
      title: 'YouTube Content Optimization',
      description: 'Opportunities to improve YouTube presence',
    },
  };

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
      getId: sandbox.stub().returns('opportunity-123'),
      getData: sandbox.stub().returns({}),
      setData: sandbox.stub(),
      setStatus: sandbox.stub(),
      setScopeType: sandbox.stub(),
      setScopeId: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    mockFetchAnalysis = sandbox.stub();
    mockConvertToOpportunity = sandbox.stub().resolves(mockOpportunity);
    mockSyncSuggestions = sandbox.stub().resolves();
    mockPostMessageOptional = sandbox.stub().resolves({ success: true });
    resolveBrandResultForSiteStub = sandbox.stub().resolves({ brand: null, resolved: true });

    guidanceHandler = await esmock('../../../src/youtube-analysis/guidance-handler.js', {
      '../../../src/utils/analysis-fetch.js': {
        fetchAnalysisFromPresignedUrl: mockFetchAnalysis,
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: mockSyncSuggestions,
      },
      '../../../src/common/offsite-refresh.js': {
        persistOffsiteOpportunity: mockConvertToOpportunity,
      },
      '../../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
      },
      '../../../src/utils/brand-resolver.js': {
        resolveBrandResultForSite: resolveBrandResultForSiteStub,
        applyScopeToOpportunity: realApplyScopeToOpportunity,
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

  describe('Mystique Error Handling', () => {
    it('should return noContent when Mystique returns an error', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          error: true,
          errorMessage: 'DRS service unavailable',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(204);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Mystique returned an error/),
      );
    });
  });

  describe('Presigned URL Handling', () => {
    it('should fetch analysis data from presigned URL when provided', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/analysis.json';
      mockFetchAnalysis.resolves(mockAnalysisData);

      const message = {
        siteId,
        auditId,
        data: {
          presignedUrl,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(mockFetchAnalysis).to.have.been.calledWith(presignedUrl, sinon.match.object);
      expect(response.status).to.equal(200);
    });

    it('should return badRequest when presigned URL fetch fails', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/analysis.json';
      mockFetchAnalysis.rejects(new Error('[YouTube] analysis fetch failed: 404 Not Found'));

      const message = {
        siteId,
        auditId,
        data: {
          presignedUrl,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error fetching from presigned URL/),
      );
    });

    it('should return badRequest when presigned URL hostname is not allowlisted (SSRF guard)', async () => {
      mockFetchAnalysis.rejects(new Error('presignedUrl hostname is not an allowlisted S3 hostname: internal.example'));

      const message = {
        siteId,
        auditId,
        data: {
          presignedUrl: 'https://internal.example/analysis.json',
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/hostname is not an allowlisted/),
      );
    });

    it('should return badRequest when presigned URL fetch throws error', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/analysis.json';
      mockFetchAnalysis.rejects(new Error('Network error'));

      const message = {
        siteId,
        auditId,
        data: {
          presignedUrl,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error fetching from presigned URL/),
      );
    });
  });

  describe('Direct Analysis Data Handling', () => {
    it('should use analysis data directly when provided without presigned URL', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: mockAnalysisData,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(mockFetchAnalysis).to.not.have.been.called;
      expect(response.status).to.equal(200);
    });

    it('should return badRequest when no analysis data is provided', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/No analysis data provided/),
      );
    });

    it('should handle when data is null', async () => {
      const message = {
        siteId,
        auditId,
        data: null,
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/No analysis data provided/),
      );
    });

    it('should handle when data is undefined', async () => {
      const message = {
        siteId,
        auditId,
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/No analysis data provided/),
      );
    });
  });

  describe('Site and Audit Validation', () => {
    it('should return notFound when site is not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      const message = {
        siteId,
        auditId,
        data: {
          analysis: mockAnalysisData,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(404);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Site not found/),
      );
    });

    it('should return notFound when audit is not found', async () => {
      context.dataAccess.Audit.findById.resolves(null);

      const message = {
        siteId,
        auditId,
        data: {
          analysis: mockAnalysisData,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(404);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Audit not found/),
      );
    });
  });

  describe('Suggestions Processing', () => {
    it('should return noContent when no suggestions are found', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: [],
            opportunity: {},
          },
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(204);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No suggestions found/),
      );
    });

    it('should handle when suggestions is undefined', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            opportunity: {},
          },
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(204);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No suggestions found/),
      );
    });

    it('should handle when opportunity is undefined', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: mockAnalysisData.suggestions,
          },
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(200);
      expect(mockConvertToOpportunity).to.have.been.calledWith(
        baseURL,
        sinon.match.any,
        context,
        sinon.match.any,
        sinon.match.any,
        { opportunityData: {}, existingOpportunity: null },
      );
    });

    it('should process suggestions and create opportunity', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: mockAnalysisData,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(mockConvertToOpportunity).to.have.been.calledOnce;
      expect(mockSyncSuggestions).to.have.been.calledOnce;
      expect(mockOpportunity.setStatus).to.have.been.calledWith('NEW');
      expect(mockOpportunity.save).to.have.been.calledOnce;
      expect(response.status).to.equal(200);
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

      await guidanceHandler.default(message, context);

      expect(mockOpportunity.setStatus).to.have.been.calledWith('IGNORED');
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

      await guidanceHandler.default(message, context);

      expect(mockConvertToOpportunity.firstCall.args[6]).to.be.undefined;
    });

    it('should pass rank and data from Mystique suggestion', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: [
              {
                id: 'sug-1',
                rank: 1,
                type: 'CONTENT_UPDATE',
                data: { suggestionValue: 'Analysis A' },
              },
              {
                id: 'sug-2',
                rank: 2,
                type: 'METADATA_UPDATE',
                data: { suggestionValue: 'Analysis B' },
              },
            ],
            opportunity: {},
          },
          companyName: 'Example Corp',
        },
      };

      await guidanceHandler.default(message, context);

      const syncCall = mockSyncSuggestions.firstCall;
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
          analysis: {
            suggestions: [
              {
                id: 'sug_no_type',
                rank: 0,
                data: { suggestionValue: 'No type' },
              },
            ],
            opportunity: {},
          },
          companyName: 'Example Corp',
        },
      };

      await guidanceHandler.default(message, context);

      const syncCall = mockSyncSuggestions.firstCall;
      const { newData, mapNewSuggestion } = syncCall.args[0];

      const mapped = mapNewSuggestion(newData[0]);
      expect(mapped.type).to.equal('CONTENT_UPDATE');
    });

    it('should use correct buildKey function', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: [
              { id: 'my_suggestion_id', priority: 'HIGH', title: 'Test', description: 'Test' },
            ],
          },
          companyName: 'Example Corp',
        },
      };

      await guidanceHandler.default(message, context);

      const syncCall = mockSyncSuggestions.firstCall;
      const { buildKey } = syncCall.args[0];
      const key = buildKey({ id: 'my_suggestion_id' });

      expect(key).to.equal('youtube::my_suggestion_id');
    });

    it('should save full analysis data to opportunity', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: mockAnalysisData,
          companyName: 'Example Corp',
        },
      };

      await guidanceHandler.default(message, context);

      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({
          fullAnalysis: mockAnalysisData,
        }),
      );
    });

    it('should return badRequest when processing fails', async () => {
      mockConvertToOpportunity.rejects(new Error('Database error'));

      const message = {
        siteId,
        auditId,
        data: {
          analysis: mockAnalysisData,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error processing YouTube analysis/),
      );
    });
  });

  describe('Slack Notifications', () => {
    const SLACK_CHANNEL_ID = 'C-test-channel';
    const SLACK_THREAD_TS = '1700000000.123456';

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

      await guidanceHandler.default(message, context);

      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const [callCtx, callChannelId, callText, callOptions] = mockPostMessageOptional.firstCall.args;
      expect(callCtx).to.equal(context);
      expect(callChannelId).to.equal(SLACK_CHANNEL_ID);
      expect(callOptions).to.deep.equal({ threadTs: SLACK_THREAD_TS });
      expect(callText).to.include('youtube-analysis');
      expect(callText).to.include('audit finished');
      expect(callText).to.include(baseURL);
      expect(callText).to.include('2 suggestions processed');
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

      await guidanceHandler.default(message, context);

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

      await guidanceHandler.default(message, context);

      expect(mockPostMessageOptional).to.not.have.been.called;
    });

    it('should handle singular suggestion count in Slack message', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            suggestions: [{ id: 'sug-1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
            opportunity: {},
          },
          companyName: 'Example Corp',
        },
      };

      await guidanceHandler.default(message, context);

      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include('1 suggestion processed');
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
            suggestions: [{ id: 'sug-1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
            opportunity: { status: 'NEW', qaVerdict: { rate: 0.12, rateDetermined: true } },
          },
          companyName: 'Example Corp',
        },
      };

      await guidanceHandler.default(message, context);

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
            suggestions: [{ id: 'sug-1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
            opportunity: { status: 'IGNORED', qaVerdict: { rate: 0.42, rateDetermined: true } },
          },
          companyName: 'Example Corp',
        },
      };

      await guidanceHandler.default(message, context);

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
            suggestions: [{ id: 'sug-1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
            opportunity: { status: 'NEW', qaVerdict: { rate: 0, rateDetermined: false } },
          },
          companyName: 'Example Corp',
        },
      };

      await guidanceHandler.default(message, context);

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
            suggestions: [{ id: 'sug-1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
            opportunity: { status: 'NEW' },
          },
          companyName: 'Example Corp',
        },
      };

      await guidanceHandler.default(message, context);

      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include('Visible in the UI');
      expect(callText).to.not.include('hallucination');
    });
  });

  describe('Complete Flow', () => {
    it('should handle complete successful flow with presigned URL', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/analysis.json';
      mockFetchAnalysis.resolves(mockAnalysisData);

      const message = {
        siteId,
        auditId,
        data: {
          presignedUrl,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(mockFetchAnalysis).to.have.been.calledWith(presignedUrl, sinon.match.object);
      expect(context.dataAccess.Site.findById).to.have.been.calledWith(siteId);
      expect(context.dataAccess.Audit.findById).to.have.been.calledWith(auditId);
      expect(mockConvertToOpportunity).to.have.been.calledOnce;
      expect(mockSyncSuggestions).to.have.been.calledOnce;
      expect(mockOpportunity.save).to.have.been.calledOnce;
      expect(response.status).to.equal(200);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Successfully processed YouTube analysis/),
      );
    });
  });

  describe('Message logging', () => {
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

      await guidanceHandler.default(message, context);

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

      await guidanceHandler.default(message, context);

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

      await guidanceHandler.default(message, context);

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

      await guidanceHandler.default(message, context);

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

      await guidanceHandler.default(message, context);

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

      await guidanceHandler.default(message, context);

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

      const result = await guidanceHandler.default(message, context);

      expect(result.status).to.equal(400);
      expect(mockConvertToOpportunity).to.not.have.been.called;
      expect(mockSyncSuggestions).to.not.have.been.called;
    });

    it('should persist a suppressed run as a new opportunity without touching the visible one', async () => {
      const visibleOpportunity = {
        getId: sandbox.stub().returns('existing-opp-1'),
        getType: sandbox.stub().returns('youtube-analysis'),
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

      const result = await guidanceHandler.default(message, context);

      expect(result.status).to.equal(200);
      expect(mockConvertToOpportunity).to.have.been.calledOnce;
      expect(mockSyncSuggestions).to.have.been.calledOnce;
      expect(mockOpportunity.setStatus).to.have.been.calledWith('IGNORED');
      // existingOpportunity is explicitly null so persistOffsiteOpportunity creates a record
      // a new opportunity, never reusing (or re-querying for) the visible one.
      const propsArg = mockConvertToOpportunity.firstCall.args[5];
      expect(propsArg).to.have.property('existingOpportunity', null);
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

      const result = await guidanceHandler.default(message, context);

      expect(result.status).to.equal(200);
      expect(mockConvertToOpportunity).to.have.been.calledOnce;
      expect(mockOpportunity.setStatus).to.have.been.calledWith('IGNORED');
      const propsArg = mockConvertToOpportunity.firstCall.args[5];
      expect(propsArg).to.have.property('existingOpportunity', null);
    });

    it('should hand the resolved evergreen to persistOffsiteOpportunity for a surfaced run', async () => {
      const visibleOpportunity = {
        getId: sandbox.stub().returns('existing-opp-1'),
        getType: sandbox.stub().returns('youtube-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2026-01-01T00:00:00.000Z'),
      };
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().resolves([visibleOpportunity]),
      };

      const message = validMessage();

      await guidanceHandler.default(message, context);

      const propsArg = mockConvertToOpportunity.firstCall.args[5];
      expect(propsArg.existingOpportunity).to.equal(visibleOpportunity);
      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledOnce;
    });

    it('should lazily retire duplicate NEW opportunities of the same type via saveMany, keeping the most recent as evergreen', async () => {
      const older = {
        getId: sandbox.stub().returns('older-opp'),
        getType: sandbox.stub().returns('youtube-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2025-01-01T00:00:00.000Z'),
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const newer = {
        getId: sandbox.stub().returns('newer-opp'),
        getType: sandbox.stub().returns('youtube-analysis'),
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

      const result = await guidanceHandler.default(message, context);

      expect(result.status).to.equal(200);
      expect(older.setStatus).to.have.been.calledWith('IGNORED');
      expect(newer.setStatus).to.not.have.been.called;
      expect(saveManyStub).to.have.been.calledOnce;
      expect(saveManyStub.firstCall.args[0]).to.deep.equal([older]);
      expect(mockConvertToOpportunity).to.have.been.calledOnce;
      expect(mockConvertToOpportunity.firstCall.args[5].existingOpportunity).to.equal(newer);
    });

    it('should propagate the error (badRequest) when duplicate retirement fails, without proceeding', async () => {
      const older = {
        getId: sandbox.stub().returns('older-opp'),
        getType: sandbox.stub().returns('youtube-analysis'),
        getStatus: sandbox.stub().returns('NEW'),
        getUpdatedAt: sandbox.stub().returns('2025-01-01T00:00:00.000Z'),
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const newer = {
        getId: sandbox.stub().returns('newer-opp'),
        getType: sandbox.stub().returns('youtube-analysis'),
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

      const result = await guidanceHandler.default(message, context);

      expect(result.status).to.equal(400);
      expect(mockConvertToOpportunity).to.not.have.been.called;
    });

    it('should propagate the error (badRequest) when the initial opportunity lookup fails, without creating a duplicate', async () => {
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub().rejects(new Error('DB down')),
      };

      const message = validMessage();

      const result = await guidanceHandler.default(message, context);

      expect(result.status).to.equal(400);
      // A transient read failure must never be treated as "nothing exists yet" (which
      // would otherwise create a duplicate NEW opportunity) — conversion is never attempted.
      expect(mockConvertToOpportunity).to.not.have.been.called;
      expect(mockSyncSuggestions).to.not.have.been.called;
    });
  });
});
