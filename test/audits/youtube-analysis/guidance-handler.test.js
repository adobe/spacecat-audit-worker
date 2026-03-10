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
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('YouTube Analysis Guidance Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockOpportunity;
  let handler;
  let syncSuggestionsStub;
  let convertToOpportunityStub;
  let fetchStub;

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
    };

    mockOpportunity = {
      getId: sandbox.stub().returns('opp-123'),
      getData: sandbox.stub().returns({ existingData: true }),
      setData: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    syncSuggestionsStub = sandbox.stub().resolves();
    convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
    fetchStub = sandbox.stub();

    handler = await esmock('../../../src/youtube-analysis/guidance-handler.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: convertToOpportunityStub,
      },
      '@adobe/spacecat-shared-utils': {
        tracingFetch: fetchStub,
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
                type: 'CONTENT_UPDATE',
                rank: 1,
                data: { suggestionValue: 'Improve thumbnails' },
              },
              {
                id: 'sug_2',
                type: 'CONTENT_UPDATE',
                rank: 2,
                data: { suggestionValue: 'Increase upload frequency' },
              },
            ],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      expect(mockOpportunity.setData).to.have.been.called;
      expect(mockOpportunity.save).to.have.been.called;
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Successfully processed YouTube analysis/));
    });

    it('should pass opportunityData from BO JSON to convertToOpportunity', async () => {
      const opportunityData = {
        title: '[ʙᴇᴛᴀ] Cited YouTube Sentiment Analysis',
        description: 'Custom description from Mystique',
        runbook: 'https://adobe.sharepoint.com/sites/youtube-sentiment-analysis',
        origin: 'ESS_OPS',
        tags: ['Video Content', 'social', 'Youtube', 'isElmo', 'Social Media'],
      };
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            opportunity: opportunityData,
            suggestions: [
              { id: 'test_1', type: 'CONTENT_UPDATE', rank: 1, data: { suggestionValue: 'Test' } },
            ],
          },
        },
      };

      await handler.default(message, context);

      const convertCall = convertToOpportunityStub.firstCall;
      expect(convertCall.args[0]).to.equal(baseURL);
      expect(convertCall.args[1]).to.deep.include({ siteId, auditId });
      expect(convertCall.args[4]).to.equal('youtube-analysis');
      const propsArg = convertCall.args[5];
      expect(propsArg.opportunityData).to.deep.equal(opportunityData);
    });

    it('should pass empty opportunityData when opportunity is missing from analysis', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              { id: 'test_1', type: 'CONTENT_UPDATE', rank: 1, data: {} },
            ],
          },
        },
      };

      await handler.default(message, context);

      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg.opportunityData).to.deep.equal({});
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
      expect(context.log.info).to.have.been.calledWith('[YouTube] No suggestions found in analysis');
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
          errorMessage: 'HTTP error in content store /url-lookup (dataset=youtube_videos): 400 Bad Request',
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
      expect(context.log.error).to.have.been.calledWith('[YouTube] No analysis data provided in message');
    });

    it('should return notFound when site not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      const message = {
        siteId: 'non-existent-site',
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [{ id: 'test_1', type: 'CONTENT_UPDATE', rank: 1, data: {} }],
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
        title: '[ʙᴇᴛᴀ] Cited YouTube Sentiment Analysis',
        description: 'Analysis description',
        runbook: 'https://adobe.sharepoint.com/sites/youtube-sentiment-analysis',
        origin: 'ESS_OPS',
        tags: ['Video Content', 'social', 'Youtube', 'isElmo', 'Social Media'],
      };
      const boJson = {
        opportunity: opportunityData,
        suggestions: [
          {
            id: 'critical_1',
            type: 'CONTENT_UPDATE',
            rank: 1,
            data: { suggestionValue: 'Critical improvement' },
          },
        ],
      };

      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves(boJson),
      });

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
      expect(fetchStub).to.have.been.calledWith('https://s3.amazonaws.com/bucket/bo.json');
      expect(convertToOpportunityStub).to.have.been.calledOnce;

      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg.opportunityData).to.deep.equal(opportunityData);
    });

    it('should override inline analysis when presigned URL is also provided', async () => {
      const presignedBoJson = {
        opportunity: { title: 'From presigned URL' },
        suggestions: [
          { id: 'from_url', type: 'CONTENT_UPDATE', rank: 1, data: { suggestionValue: 'URL suggestion' } },
        ],
      };

      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves(presignedBoJson),
      });

      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          presignedUrl: 'https://s3.amazonaws.com/bucket/bo.json',
          analysis: {
            opportunity: { title: 'From inline' },
            suggestions: [
              { id: 'from_inline', type: 'SEO_UPDATE', rank: 5, data: { suggestionValue: 'Inline suggestion' } },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { newData } = syncCall.args[0];
      expect(newData[0].id).to.equal('from_url');

      const propsArg = convertToOpportunityStub.firstCall.args[5];
      expect(propsArg.opportunityData.title).to.equal('From presigned URL');
    });

    it('should return badRequest when presigned URL fetch fails with non-ok response', async () => {
      fetchStub.resolves({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

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
      expect(context.log.error).to.have.been.calledWith(sinon.match(/Failed to fetch analysis data/));
    });

    it('should return badRequest when presigned URL fetch throws error', async () => {
      fetchStub.rejects(new Error('Network error'));

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
    it('should pass suggestion type, rank, and data directly', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              {
                id: 'sug_1',
                type: 'CONTENT_UPDATE',
                rank: 1,
                data: { suggestionValue: '## Report content' },
              },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { newData, mapNewSuggestion } = syncCall.args[0];

      const mapped = mapNewSuggestion(newData[0]);
      expect(mapped.opportunityId).to.equal('opp-123');
      expect(mapped.type).to.equal('CONTENT_UPDATE');
      expect(mapped.rank).to.equal(1);
      expect(mapped.data.suggestionValue).to.equal('## Report content');
    });

    it('should use correct buildKey function', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              { id: 'my_suggestion_id', type: 'CONTENT_UPDATE', rank: 1, data: {} },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { buildKey } = syncCall.args[0];
      const key = buildKey({ id: 'my_suggestion_id' });

      expect(key).to.equal('youtube::my_suggestion_id');
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
              { id: 's1', type: 'CONTENT_UPDATE', rank: 1, data: {} },
            ],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error processing YouTube analysis/),
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
              { id: 's1', type: 'CONTENT_UPDATE', rank: 1, data: {} },
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
      expect(context.log.error).to.have.been.calledWith('[YouTube] No analysis data provided in message');
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
              { id: 's1', type: 'CONTENT_UPDATE', rank: 1, data: {} },
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
          { id: 's1', type: 'CONTENT_UPDATE', rank: 1, data: { suggestionValue: 'Test' } },
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
        sinon.match(/Received YouTube analysis guidance for siteId/),
      );
    });
  });
});
