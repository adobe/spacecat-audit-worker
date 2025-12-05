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

describe('Wikipedia Analysis Guidance Handler', () => {
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

    handler = await esmock('../../../src/wikipedia-analysis/guidance-handler.js', {
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
                priority: 'HIGH',
                title: 'Add more citations',
                description: 'The article needs more references',
                suggestedValue: '15 citations',
                currentValue: '5 citations',
                category: 'references',
              },
              {
                priority: 'MEDIUM',
                title: 'Expand content',
                description: 'Add more content about products',
                suggestedValue: '2000 words',
                currentValue: '800 words',
                category: 'content',
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
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Successfully processed Wikipedia analysis/));
    });

    it('should create guidance with industry analysis', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              { priority: 'HIGH', title: 'Test', description: 'Test', category: 'test' },
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
      expect(guidanceArg[0].rationale).to.include('Finance competitors');
    });

    it('should create guidance without industry analysis', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              { priority: 'HIGH', title: 'Test', description: 'Test', category: 'test' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const convertCall = convertToOpportunityStub.firstCall;
      const guidanceArg = convertCall.args[5].guidance;
      expect(guidanceArg[0].rationale).to.include('best practices');
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
      expect(context.log.info).to.have.been.calledWith('[Wikipedia] No suggestions found in analysis');
    });

    it('should return badRequest when no analysis data provided', async () => {
      const message = {
        siteId,
        auditId,
        data: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith('[Wikipedia] No analysis data provided in message');
    });

    it('should return notFound when site not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      const message = {
        siteId: 'non-existent-site',
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [{ priority: 'HIGH', title: 'Test', description: 'Test', category: 'test' }],
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
            priority: 'CRITICAL',
            title: 'Critical improvement',
            description: 'This is critical',
            category: 'critical',
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
          presignedUrl: 'https://s3.amazonaws.com/bucket/analysis.json',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(fetchStub).to.have.been.calledWith('https://s3.amazonaws.com/bucket/analysis.json');
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
          presignedUrl: 'https://s3.amazonaws.com/bucket/analysis.json',
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
          presignedUrl: 'https://s3.amazonaws.com/bucket/analysis.json',
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
              { priority: 'CRITICAL', title: 'A', description: 'A', category: 'a' },
              { priority: 'HIGH', title: 'B', description: 'B', category: 'b' },
              { priority: 'MEDIUM', title: 'C', description: 'C', category: 'c' },
              { priority: 'LOW', title: 'D', description: 'D', category: 'd' },
              { priority: 'UNKNOWN', title: 'E', description: 'E', category: 'e' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { newData } = syncCall.args[0];

      expect(newData[0].rank).to.equal(0); // CRITICAL
      expect(newData[1].rank).to.equal(1); // HIGH
      expect(newData[2].rank).to.equal(2); // MEDIUM
      expect(newData[3].rank).to.equal(3); // LOW
      expect(newData[4].rank).to.equal(4); // UNKNOWN (default)
    });

    it('should include all suggestion data in mapped suggestions', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              {
                priority: 'HIGH',
                title: 'Test Title',
                description: 'Test Description',
                suggestedValue: 'Suggested',
                currentValue: 'Current',
                competitorAverage: 'Average',
                category: 'test-category',
              },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { newData } = syncCall.args[0];

      expect(newData[0].data.priority).to.equal('HIGH');
      expect(newData[0].data.title).to.equal('Test Title');
      expect(newData[0].data.description).to.equal('Test Description');
      expect(newData[0].data.suggestedValue).to.equal('Suggested');
      expect(newData[0].data.currentValue).to.equal('Current');
      expect(newData[0].data.competitorAverage).to.equal('Average');
      expect(newData[0].data.category).to.equal('test-category');
      expect(newData[0].type).to.equal('CONTENT_UPDATE');
    });

    it('should use correct buildKey function', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              { priority: 'HIGH', title: 'My Title', description: 'Desc', category: 'my-cat' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { buildKey } = syncCall.args[0];
      const key = buildKey({ data: { category: 'my-cat', title: 'My Title' } });

      expect(key).to.equal('wikipedia::my-cat::My Title');
    });

    it('should use correct mapNewSuggestion function', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              { priority: 'HIGH', title: 'Title', description: 'Desc', category: 'cat' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { mapNewSuggestion } = syncCall.args[0];
      const mapped = mapNewSuggestion({
        type: 'CONTENT_UPDATE',
        rank: 1,
        data: { test: 'data' },
      });

      expect(mapped.opportunityId).to.equal('opp-123');
      expect(mapped.type).to.equal('CONTENT_UPDATE');
      expect(mapped.rank).to.equal(1);
      expect(mapped.data).to.deep.equal({ test: 'data' });
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
              { priority: 'HIGH', title: 'Test', description: 'Test', category: 'test' },
            ],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error processing Wikipedia analysis/),
        sinon.match.any,
      );
    });

    it('should warn when audit not found but continue processing', async () => {
      context.dataAccess.Audit.findById.resolves(null);

      const message = {
        siteId,
        auditId: 'non-existent-audit',
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              { priority: 'HIGH', title: 'Test', description: 'Test', category: 'test' },
            ],
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(context.log.warn).to.have.been.calledWith(sinon.match(/Audit not found/));
    });

    it('should store full analysis in opportunity data', async () => {
      const analysisData = {
        company: 'Example Corp',
        suggestions: [
          { priority: 'HIGH', title: 'Test', description: 'Test', category: 'test' },
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
        sinon.match(/Message received in Wikipedia analysis guidance handler/),
      );
    });
  });
});
