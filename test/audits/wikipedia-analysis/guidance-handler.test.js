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

describe('Wikipedia Analysis Guidance Handler', function () {
  // esmock deep-loads the handler tree under coverage instrumentation, so the first
  // beforeEach can exceed mocha's 2s default.
  this.timeout(10000);

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
      setScopeType: sandbox.stub(),
      setScopeId: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    syncSuggestionsStub = sandbox.stub().resolves();
    convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
    fetchAnalysisStub = sandbox.stub();
    mockPostMessageOptional = sandbox.stub().resolves({ success: true });
    resolveBrandResultForSiteStub = sandbox.stub().resolves({ brand: null, resolved: true });

    handler = await esmock('../../../src/wikipedia-analysis/guidance-handler.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: convertToOpportunityStub,
      },
      '../../../src/utils/analysis-fetch.js': {
        fetchAnalysisFromPresignedUrl: fetchAnalysisStub,
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
                id: 'add_citations',
                priority: 'HIGH',
                title: 'Add more citations',
                description: 'The article needs more references',
                whyMatters: 'Citations improve credibility',
                expectedResult: '15 citations',
                dataSources: 'Company reports',
              },
              {
                id: 'expand_content',
                priority: 'MEDIUM',
                title: 'Expand content',
                description: 'Add more content about products',
                whyMatters: 'More content improves coverage',
                expectedResult: '2000 words',
                dataSources: 'Product documentation',
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
              { id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test', whyMatters: 'Test', expectedResult: 'Test', dataSources: 'Test' },
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
              { id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test', whyMatters: 'Test', expectedResult: 'Test', dataSources: 'Test' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const convertCall = convertToOpportunityStub.firstCall;
      const guidanceArg = convertCall.args[5].guidance;
      expect(guidanceArg.rationale).to.include('best practices');
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
            suggestions: [{ id: 'test_1', priority: 'HIGH', title: 'Test', description: 'Test', whyMatters: 'Test', expectedResult: 'Test', dataSources: 'Test' }],
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
            whyMatters: 'Critical for credibility',
            expectedResult: 'Improved article',
            dataSources: 'News sources',
          },
        ],
      };

      fetchAnalysisStub.resolves(analysisData);

      const message = {
        siteId,
        auditId,
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/analysis.json',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(fetchAnalysisStub).to.have.been.calledWith('https://s3.amazonaws.com/bucket/analysis.json', sinon.match.object);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
    });

    it('should return badRequest when presigned URL fetch fails with non-ok response', async () => {
      fetchAnalysisStub.rejects(new Error('[Wikipedia] analysis fetch failed: 500 Internal Server Error'));

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

    it('should return badRequest when presigned URL hostname is not allowlisted (SSRF guard)', async () => {
      fetchAnalysisStub.rejects(new Error('presignedUrl hostname is not an allowlisted S3 hostname: internal.example'));

      const message = {
        siteId,
        auditId,
        data: {
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
              { id: 'sug_a', priority: 'CRITICAL', title: 'A', description: 'A', whyMatters: 'A', expectedResult: 'A', dataSources: 'A' },
              { id: 'sug_b', priority: 'HIGH', title: 'B', description: 'B', whyMatters: 'B', expectedResult: 'B', dataSources: 'B' },
              { id: 'sug_c', priority: 'MEDIUM', title: 'C', description: 'C', whyMatters: 'C', expectedResult: 'C', dataSources: 'C' },
              { id: 'sug_d', priority: 'LOW', title: 'D', description: 'D', whyMatters: 'D', expectedResult: 'D', dataSources: 'D' },
              { id: 'sug_e', priority: 'UNKNOWN', title: 'E', description: 'E', whyMatters: 'E', expectedResult: 'E', dataSources: 'E' },
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

    it('should pass raw suggestions to syncSuggestions and map them correctly', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              {
                id: 'test_suggestion',
                priority: 'HIGH',
                title: 'Test Title',
                priorityNote: 'Important note',
                description: 'Test Description',
                whyMatters: 'This matters because...',
                expectedResult: 'Expected outcome',
                dataSources: 'Data source list',
              },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { newData, mapNewSuggestion } = syncCall.args[0];

      expect(newData[0].id).to.equal('test_suggestion');
      expect(newData[0].priority).to.equal('HIGH');
      expect(newData[0].title).to.equal('Test Title');
      expect(newData[0].priorityNote).to.equal('Important note');
      expect(newData[0].description).to.equal('Test Description');
      expect(newData[0].whyMatters).to.equal('This matters because...');
      expect(newData[0].expectedResult).to.equal('Expected outcome');
      expect(newData[0].dataSources).to.equal('Data source list');

      // mapNewSuggestion should produce the correct structure
      const mapped = mapNewSuggestion(newData[0]);
      expect(mapped.type).to.equal('CONTENT_UPDATE');
      expect(mapped.rank).to.equal(1); // HIGH priority
      expect(mapped.data).to.deep.equal(newData[0]);
    });

    it('should use correct buildKey function', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [
              { id: 'my_suggestion_id', priority: 'HIGH', title: 'My Title', description: 'Desc', whyMatters: 'Test', expectedResult: 'Test', dataSources: 'Test' },
            ],
          },
        },
      };

      await handler.default(message, context);

      const syncCall = syncSuggestionsStub.firstCall;
      const { buildKey } = syncCall.args[0];
      const key = buildKey({ id: 'my_suggestion_id' });

      expect(key).to.equal('wikipedia::my_suggestion_id');
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

    it('should return notFound when audit not found', async () => {
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

      expect(result.status).to.equal(404);
      expect(context.log.error).to.have.been.calledWith(sinon.match(/Audit not found/));
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
        sinon.match(/Received Wikipedia analysis guidance for siteId/),
      );
    });

    it('should NOT log inbound brandId from message (trust boundary)', async () => {
      const message = {
        siteId,
        auditId,
        brandId: 'brand-uuid-123',
        data: {
          analysis: {
            company: 'Test',
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

  describe('Slack Notifications', () => {
    const SLACK_CHANNEL_ID = 'C-test-channel';
    const SLACK_THREAD_TS = '1700000000.123456';
    const mockAnalysisData = {
      company: 'Example Corp',
      suggestions: [
        {
          id: 'add_citations',
          priority: 'HIGH',
          title: 'Add more citations',
          description: 'The article needs more references',
          whyMatters: 'Citations improve credibility',
          expectedResult: '15 citations',
          dataSources: 'Company reports',
        },
        {
          id: 'expand_content',
          priority: 'MEDIUM',
          title: 'Expand content',
          description: 'Add more content about products',
          whyMatters: 'More content improves coverage',
          expectedResult: '2000 words',
          dataSources: 'Product documentation',
        },
      ],
      industryAnalysis: {
        industry: 'Technology',
      },
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
        },
      };

      await handler.default(message, context);

      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const [callCtx, callChannelId, callText, callOptions] = mockPostMessageOptional.firstCall.args;
      expect(callCtx).to.equal(context);
      expect(callChannelId).to.equal(SLACK_CHANNEL_ID);
      expect(callOptions).to.deep.equal({ threadTs: SLACK_THREAD_TS });
      expect(callText).to.include('wikipedia-analysis');
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
        },
      };

      await handler.default(message, context);

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
            suggestions: [
              {
                id: 'single-suggestion',
                priority: 'HIGH',
                title: 'Single improvement',
                description: 'Only one',
              },
            ],
            company: 'Example Corp',
            industryAnalysis: { industry: 'Technology' },
          },
        },
      };

      await handler.default(message, context);

      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include('1 suggestion processed');
    });

    it('reports that the audit could not run when no Wikipedia page was found', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: { analysis: { company: 'Example Corp', suggestions: [], wikipediaUrl: '' } },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include(':warning:');
      expect(callText).to.include(baseURL);
      expect(callText).to.include("couldn't run");
      expect(callText).to.include('no Wikipedia page was found');
    });

    it('reports a finished-but-empty result when a Wikipedia page was analyzed with no suggestions', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: {
          analysis: {
            company: 'Example Corp',
            suggestions: [],
            wikipediaUrl: 'https://en.wikipedia.org/wiki/Example_Corp',
          },
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include(':white_check_mark:');
      expect(callText).to.include('audit finished');
      expect(callText).to.include('no improvement suggestions found');
    });

    it('reports that the audit could not run when Mystique returns an error', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: { error: true, errorMessage: 'Wikipedia analysis failed' },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include(':warning:');
      expect(callText).to.include("couldn't run");
      expect(callText).to.include('Wikipedia analysis failed');
      expect(context.log.error).to.have.been.calledWith(sinon.match(/Mystique returned an error/));
    });

    it('reports a Mystique error without a parenthetical when no errorMessage is provided', async () => {
      mockAudit.getAuditResult.returns({
        slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
      });

      const message = {
        siteId,
        auditId,
        data: { error: true },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include("couldn't run");
      expect(callText).to.not.include('(');
    });

    it('does not crash the handler when the Slack-context lookup fails', async () => {
      // A notification side-effect must never turn a graceful noContent into a 500.
      // The data.error path posts before any audit-existence lookup, so the only
      // Audit.findById is the guarded one inside the helper.
      context.dataAccess.Audit.findById.rejects(new Error('DB down'));

      const message = {
        siteId,
        auditId,
        data: { error: true, errorMessage: 'Wikipedia analysis failed' },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      expect(mockPostMessageOptional).to.not.have.been.called;
      expect(context.log.warn).to.have.been.calledWith(sinon.match(/Failed to post outcome to Slack/));
    });

    it('does not post an outcome message for an empty result when there is no slackContext', async () => {
      mockAudit.getAuditResult.returns({});

      const message = {
        siteId,
        auditId,
        data: { analysis: { company: 'Example Corp', suggestions: [], wikipediaUrl: '' } },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(204);
      expect(mockPostMessageOptional).to.not.have.been.called;
    });
  });

  describe('Brand scope', () => {
    const analysisWithSuggestions = {
      company: 'Test Corp',
      suggestions: [
        {
          id: 'add_citations',
          priority: 'HIGH',
          title: 'Add citations',
          description: 'Add more references',
        },
      ],
    };

    it('should set scope when brand is resolved server-side', async () => {
      resolveBrandResultForSiteStub.resolves({ brand: { brandId: 'brand-uuid-123' }, resolved: true });

      const message = {
        siteId,
        auditId,
        data: { analysis: analysisWithSuggestions },
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
        data: { analysis: analysisWithSuggestions },
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
        data: { analysis: analysisWithSuggestions },
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
        data: { analysis: analysisWithSuggestions },
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
        data: { analysis: analysisWithSuggestions },
      };

      await handler.default(message, context);

      expect(resolveBrandResultForSiteStub).to.have.been.called;
      expect(mockOpportunity.setScopeId).to.have.been.calledWith('current-uuid');
      expect(mockOpportunity.setScopeId).not.to.have.been.calledWith('stale-uuid');
    });
  });
});
