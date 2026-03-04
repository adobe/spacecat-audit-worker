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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
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

    handler = await esmock('../../../src/reddit-analysis/guidance-handler.js', {
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
      expect(mockOpportunity.setData).to.have.been.called;
      expect(mockOpportunity.save).to.have.been.called;
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Successfully processed Reddit analysis/));
    });

    it('should pass opportunityData from BO JSON to convertToOpportunity', async () => {
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

  describe('Priority ranking', () => {
    it('should map priorities to correct ranks', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          companyName: 'Example Corp',
          analysis: {
            suggestions: [
              { id: 'sug_a', priority: 'CRITICAL', title: 'A', description: 'A' },
              { id: 'sug_b', priority: 'HIGH', title: 'B', description: 'B' },
              { id: 'sug_c', priority: 'MEDIUM', title: 'C', description: 'C' },
              { id: 'sug_d', priority: 'LOW', title: 'D', description: 'D' },
              { id: 'sug_e', priority: 'UNKNOWN', title: 'E', description: 'E' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { newData, mapNewSuggestion } = syncCall.args[0];

      expect(mapNewSuggestion(newData[0]).rank).to.equal(0); // CRITICAL
      expect(mapNewSuggestion(newData[1]).rank).to.equal(1); // HIGH
      expect(mapNewSuggestion(newData[2]).rank).to.equal(2); // MEDIUM
      expect(mapNewSuggestion(newData[3]).rank).to.equal(3); // LOW
      expect(mapNewSuggestion(newData[4]).rank).to.equal(4); // UNKNOWN (default)
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
  });
});
