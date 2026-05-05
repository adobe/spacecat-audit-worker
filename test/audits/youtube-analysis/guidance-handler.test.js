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
  let mockFetch;
  let mockConvertToOpportunity;
  let mockSyncSuggestions;
  let mockPostMessageOptional;
  let resolveBrandForSiteStub;

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

    mockFetch = sandbox.stub();
    mockConvertToOpportunity = sandbox.stub().resolves(mockOpportunity);
    mockSyncSuggestions = sandbox.stub().resolves();
    mockPostMessageOptional = sandbox.stub().resolves({ success: true });
    resolveBrandForSiteStub = sandbox.stub().resolves(null);

    guidanceHandler = await esmock('../../../src/youtube-analysis/guidance-handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: mockFetch,
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: mockSyncSuggestions,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: mockConvertToOpportunity,
      },
      '../../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
      },
      '../../../src/utils/brand-resolver.js': {
        resolveBrandForSite: resolveBrandForSiteStub,
        applyScopeToOpportunity: (opp, brand, l, prefix) => {
          try {
            opp.setScopeType(brand ? 'brand' : null);
            opp.setScopeId(brand?.brandId ?? null);
          } catch (err) {
            l?.warn?.(`${prefix} Failed to set brand scope; continuing without: ${err.message}`);
          }
        },
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
      const presignedUrl = 'https://s3.example.com/analysis.json';
      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves(mockAnalysisData),
      });

      const message = {
        siteId,
        auditId,
        data: {
          presignedUrl,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(mockFetch).to.have.been.calledWith(presignedUrl);
      expect(response.status).to.equal(200);
    });

    it('should return badRequest when presigned URL fetch fails', async () => {
      const presignedUrl = 'https://s3.example.com/analysis.json';
      mockFetch.resolves({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

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
        sinon.match(/Failed to fetch analysis data/),
      );
    });

    it('should return badRequest when presigned URL fetch throws error', async () => {
      const presignedUrl = 'https://s3.example.com/analysis.json';
      mockFetch.rejects(new Error('Network error'));

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

      expect(mockFetch).to.not.have.been.called;
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
        { opportunityData: {} },
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

    it('should pass comparisonFn that matches by auditId', async () => {
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

      const comparisonFn = mockConvertToOpportunity.firstCall.args[6];
      expect(comparisonFn).to.be.a('function');
      expect(comparisonFn({ getAuditId: () => auditId })).to.be.true;
      expect(comparisonFn({ getAuditId: () => 'different-audit-id' })).to.be.false;
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
  });

  describe('Complete Flow', () => {
    it('should handle complete successful flow with presigned URL', async () => {
      const presignedUrl = 'https://s3.example.com/analysis.json';
      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves(mockAnalysisData),
      });

      const message = {
        siteId,
        auditId,
        data: {
          presignedUrl,
          companyName: 'Example Corp',
        },
      };

      const response = await guidanceHandler.default(message, context);

      expect(mockFetch).to.have.been.calledWith(presignedUrl);
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
    it('should include brandId in log when present', async () => {
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

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/brandId: brand-uuid-123/),
      );
    });
  });

  describe('Brand scope', () => {
    it('should set scope when brand is resolved server-side', async () => {
      resolveBrandForSiteStub.resolves({ brandId: 'brand-uuid-123' });

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

    it('should clear scope (null) when no brand is resolved', async () => {
      resolveBrandForSiteStub.resolves(null);

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
  });
});
