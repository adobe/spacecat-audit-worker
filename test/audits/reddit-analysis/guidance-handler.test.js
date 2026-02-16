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
          analysis: {
            company: 'Example Corp',
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
            industryAnalysis: {
              industry: 'Technology',
            },
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

    it('should create guidance with industry analysis', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              { id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' },
            ],
            industryAnalysis: {
              industry: 'Finance',
            },
          },
        },
      };

      await handler.default(message, context);

      const convertCall = convertToOpportunityStub.firstCall;
      const guidanceArg = convertCall.args[5].guidance;
      expect(guidanceArg.rationale).to.include('Finance competitors');
    });

    it('should create guidance without industry analysis', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              { id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const convertCall = convertToOpportunityStub.firstCall;
      const guidanceArg = convertCall.args[5].guidance;
      expect(guidanceArg.rationale).to.include('Reddit community and sentiment best practices');
    });

    it('should return noContent when no suggestions found', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      expect(convertToOpportunityStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith('[Reddit] No suggestions found in analysis');
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
          analysis: {
            company: 'Example Corp',
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
    it('should fetch analysis from presigned URL', async () => {
      const analysisData = {
        company: 'Example Corp',
        suggestions: [
          {
            id: 'critical_1',
            priority: 'CRITICAL',
            title: 'Critical improvement',
            description: 'This is critical',
          },
        ],
      };

      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves(analysisData),
      });

      const message = {
        siteId,
        auditId,
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/reddit-analysis.json',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(fetchStub).to.have.been.calledWith('https://s3.amazonaws.com/bucket/reddit-analysis.json');
      expect(convertToOpportunityStub).to.have.been.calledOnce;
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
          presignedUrl: 'https://s3.amazonaws.com/bucket/reddit-analysis.json',
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
          presignedUrl: 'https://s3.amazonaws.com/bucket/reddit-analysis.json',
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
          analysis: {
            company: 'Example Corp',
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
          analysis: {
            company: 'Example Corp',
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
          analysis: {
            company: 'Example Corp',
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

    it('should return notFound when audit not found', async () => {
      context.dataAccess.Audit.findById.resolves(null);

      const message = {
        siteId,
        auditId: 'non-existent-audit',
        data: {
          analysis: {
            company: 'Example Corp',
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
      const analysisData = {
        company: 'Example Corp',
        suggestions: [
          { id: 's1', priority: 'HIGH', title: 'Test', description: 'Test' },
        ],
        extraData: 'should be preserved',
      };

      const message = {
        siteId,
        auditId,
        data: {
          analysis: analysisData,
        },
      };

      await handler.default(message, context);

      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({
          existingData: true,
          fullAnalysis: analysisData,
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
          analysis: {
            company: 'Test',
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
