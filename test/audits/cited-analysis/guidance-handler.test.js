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
// Import the REAL applyScopeToOpportunity so the handler test exercises the production
// implementation, not a stand-in. A regression in the real function (e.g. silently
// clearing scope on a transient resolver failure) must be visible here.
import { applyScopeToOpportunity as realApplyScopeToOpportunity } from '../../../src/utils/brand-resolver.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Cited Analysis Guidance Handler', () => {
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
    // Default: brand resolved with no match. Per-test cases override.
    resolveBrandResultForSiteStub = sandbox.stub().resolves({ brand: null, resolved: true });

    handler = await esmock('../../../src/cited-analysis/guidance-handler.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: convertToOpportunityStub,
      },
      '../../../src/utils/analysis-fetch.js': {
        fetchAnalysisFromPresignedUrl: fetchAnalysisStub,
      },
      '../../../src/utils/slack-utils.js': { postMessageOptional: mockPostMessageOptional },
      '../../../src/utils/brand-resolver.js': {
        resolveBrandResultForSite: resolveBrandResultForSiteStub,
        // Use the REAL applyScopeToOpportunity — see import above.
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
                title: 'Improve page content',
                description: 'Enhance content for LLM citability',
              },
              {
                id: 'sug_2',
                priority: 'MEDIUM',
                title: 'Add structured data',
                description: 'Include schema markup for better citation',
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
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Successfully processed cited analysis/));
    });

    it('should pass opportunityData from BO JSON to convertToOpportunity', async () => {
      const opportunityData = {
        title: 'Cited URL Analysis',
        description: 'Custom description from Mystique',
        runbook: 'https://adobe.sharepoint.com/sites/cited-analysis',
        origin: 'ESS_OPS',
        tags: ['cited', 'earned', 'isElmo'],
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

    it('should pass comparisonFn that matches by auditId', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              {
                id: 'test_1', rank: 1, type: 'CONTENT_UPDATE', data: { title: 'Test' },
              },
            ],
          },
        },
      };

      await handler.default(message, context);

      const comparisonFn = convertToOpportunityStub.firstCall.args[6];
      expect(comparisonFn).to.be.a('function');
      expect(comparisonFn({ getAuditId: () => auditId })).to.be.true;
      expect(comparisonFn({ getAuditId: () => 'different-audit-id' })).to.be.false;
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
              {
                id: 'test_1', rank: 1, type: 'CONTENT_UPDATE', data: { title: 'Test' },
              },
            ],
          },
        },
      };

      await handler.default(message, context);

      expect(mockOpportunity.setStatus).to.have.been.calledWith('IGNORED');
    });

    it('should use auditType from opportunityData.type when provided', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: { type: 'custom-audit-type' },
            suggestions: [
              {
                id: 'test_1', rank: 1, type: 'CONTENT_UPDATE', data: { title: 'Test' },
              },
            ],
          },
        },
      };

      await handler.default(message, context);

      const auditTypeArg = convertToOpportunityStub.firstCall.args[4];
      expect(auditTypeArg).to.equal('custom-audit-type');
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
      expect(context.log.info).to.have.been.calledWith('[Cited] No suggestions found in analysis');
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
          errorMessage: 'HTTP error in content store /url-lookup: 400 Bad Request',
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
      expect(context.log.error).to.have.been.calledWith('[Cited] No analysis data provided in message');
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
        title: 'Cited URL Analysis',
        description: 'Analysis description',
        runbook: 'https://adobe.sharepoint.com/sites/cited-analysis',
        origin: 'ESS_OPS',
        tags: ['cited', 'earned'],
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
      // fetchAnalysisFromPresignedUrl throws on non-ok response (status + statusText embedded in error).
      fetchAnalysisStub.rejects(new Error('[Cited] analysis fetch failed: 500 Internal Server Error'));

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
      // fetchAnalysisFromPresignedUrl invokes assertPresignedUrl, which throws on bad hostnames.
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
              {
                id: 'my_suggestion_id', rank: 1, type: 'CONTENT_UPDATE', data: { title: 'My Title' },
              },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { buildKey } = syncCall.args[0];
      const key = buildKey({ id: 'my_suggestion_id' });

      expect(key).to.equal('cited::my_suggestion_id');
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
      expect(callText).to.include('cited-analysis');
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
        sinon.match(/Error processing cited analysis/),
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
      expect(context.log.error).to.have.been.calledWith('[Cited] No analysis data provided in message');
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
        sinon.match(/Received cited analysis guidance for siteId/),
      );
    });

    it('should NOT log inbound brandId from message (trust boundary)', async () => {
      // Mystique's inbound brandId is informational and untrusted. Logging it leaks
      // the regression footgun a future maintainer might "discover" and wire into
      // setScopeId. This test pins the absence of that log line.
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
      // Confirmed no brand exists for this site → safe to clear stale scope.
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
      // resolved=false signals "we don't know" — preserve any existing scope on
      // the opportunity instead of silently wiping it during an incident.
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

      // Neither setter is called — the opportunity is saved with its existing scope intact.
      expect(mockOpportunity.setScopeType).to.not.have.been.called;
      expect(mockOpportunity.setScopeId).to.not.have.been.called;
    });

    it('should rollback scopeType when setScopeId throws (partial-write rollback)', async () => {
      // The real applyScopeToOpportunity wraps each setter separately and rolls
      // back scopeType to null if scopeId throws — guarantees the opportunity
      // never persists in a half-scoped state.
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

      // setScopeType is called twice: first with 'brand' (succeeds), then with null (rollback).
      expect(mockOpportunity.setScopeType).to.have.been.calledTwice;
      expect(mockOpportunity.setScopeType.firstCall).to.have.been.calledWith('brand');
      expect(mockOpportunity.setScopeType.secondCall).to.have.been.calledWith(null);
      // setScopeId is called twice: first with the brand (throws), then with null (rollback).
      expect(mockOpportunity.setScopeId).to.have.been.calledTwice;
      expect(mockOpportunity.setScopeId.firstCall).to.have.been.calledWith('brand-uuid-123');
      expect(mockOpportunity.setScopeId.secondCall).to.have.been.calledWith(null);
    });

    it('should ignore inbound brandId from message and use server-side resolved brand', async () => {
      resolveBrandResultForSiteStub.resolves({ brand: { brandId: 'current-uuid' }, resolved: true });

      const message = {
        siteId,
        auditId,
        brandId: 'stale-uuid', // <-- This MUST be ignored by the handler.
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
});
