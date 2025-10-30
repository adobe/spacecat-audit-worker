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
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { AUDIT_TYPE, GUIDANCE_TYPE } from '../../../src/content-fragment-404/handler.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Broken Content Fragment Links Handler', () => {
  let sandbox;
  let context;
  let site;
  let baseURL;
  let handlerModule;
  let athenaCollectorStub;
  let pathIndexStub;
  let aemClientStub;
  let analysisStrategyStub;
  let convertToOpportunityStub;
  let syncSuggestionsStub;
  let mockOpportunity;
  let mockSuggestion;
  let mockConfiguration;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    baseURL = 'https://test-tenant.adobe.com';
    site = {
      getId: () => 'test-site-id',
      getBaseURL: () => baseURL,
      getDeliveryType: () => 'aem_edge',
    };

    mockOpportunity = {
      getId: () => 'test-opportunity-id',
      getType: () => AUDIT_TYPE,
      getAuditId: () => 'test-audit-id',
    };

    mockSuggestion = {
      getId: () => 'test-suggestion-id',
      getData: () => ({
        requestedPath: '/content/dam/test/fragment1',
        suggestedPath: '/content/dam/test/fixed1',
        type: 'SIMILAR',
        reason: 'Similar path found',
        requestCount: 100,
        requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }],
      }),
    };

    mockConfiguration = {
      isHandlerEnabledForSite: sandbox.stub().returns(true),
    };

    athenaCollectorStub = {
      fetchBrokenPaths: sandbox.stub().resolves([
        { url: '/content/dam/test/fragment1', requestCount: 100, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
        { url: '/content/dam/test/fragment2', requestCount: 200, requestUserAgents: [{ userAgent: 'Chrome/91.0', count: 200 }] },
      ]),
      constructor: { name: 'AthenaCollector' },
    };

    pathIndexStub = sandbox.stub();
    aemClientStub = sandbox.stub();
    analysisStrategyStub = {
      analyze: sandbox.stub().resolves([
        { toJSON: () => ({ requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar path found' }) },
        { toJSON: () => ({ requestedPath: '/content/dam/test/fragment2', suggestedPath: null, type: 'PUBLISH', reason: 'Content not published' }) },
      ]),
    };

    convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
    syncSuggestionsStub = sandbox.stub().resolves();

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        site,
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-mystique-queue',
        },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves(mockConfiguration),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([mockSuggestion]),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([mockOpportunity]),
          },
        },
      })
      .build();

    handlerModule = await esmock('../../../src/content-fragment-404/handler.js', {
      '../../../src/content-fragment-404/collectors/athena-collector.js': {
        AthenaCollector: {
          createFrom: sandbox.stub().resolves(athenaCollectorStub),
        },
      },
      '../../../src/content-fragment-404/domain/index/path-index.js': {
        PathIndex: function MockPathIndex() {
          return pathIndexStub;
        },
      },
      '../../../src/content-fragment-404/clients/aem-client.js': {
        AemClient: {
          createFrom: sandbox.stub().returns(aemClientStub),
        },
      },
      '../../../src/content-fragment-404/analysis/analysis-strategy.js': {
        AnalysisStrategy: function MockAnalysisStrategy() {
          return analysisStrategyStub;
        },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: convertToOpportunityStub,
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('contentFragment404AuditRunner', () => {
    it('should successfully fetch and analyze broken content fragment paths', async () => {
      const result = await handlerModule.contentFragment404AuditRunner(baseURL, context, site);

      expect(athenaCollectorStub.fetchBrokenPaths).to.have.been.calledOnce;
      expect(analysisStrategyStub.analyze).to.have.been.calledWith([
        '/content/dam/test/fragment1',
        '/content/dam/test/fragment2',
      ]);
      expect(context.log.info).to.have.been.calledWith('Found 2 broken content fragment paths from AthenaCollector');
      expect(context.log.info).to.have.been.calledWith('Found 2 suggestions for broken content fragment paths');

      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          brokenPaths: [
            { url: '/content/dam/test/fragment1', requestCount: 100, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
            { url: '/content/dam/test/fragment2', requestCount: 200, requestUserAgents: [{ userAgent: 'Chrome/91.0', count: 200 }] },
          ],
          suggestions: [
            { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar path found' },
            { requestedPath: '/content/dam/test/fragment2', suggestedPath: null, type: 'PUBLISH', reason: 'Content not published' },
          ],
        },
      });
    });

    it('should handle empty results from collector', async () => {
      athenaCollectorStub.fetchBrokenPaths.resolves([]);
      analysisStrategyStub.analyze.resolves([]);

      const result = await handlerModule.contentFragment404AuditRunner(baseURL, context, site);

      expect(context.log.info).to.have.been.calledWith('Found 0 broken content fragment paths from AthenaCollector');
      expect(context.log.info).to.have.been.calledWith('Found 0 suggestions for broken content fragment paths');
      expect(result.auditResult.brokenPaths).to.deep.equal([]);
      expect(result.auditResult.suggestions).to.deep.equal([]);
    });

    it('should handle mixed format in brokenPaths (objects and strings)', async () => {
      athenaCollectorStub.fetchBrokenPaths.resolves([
        { url: '/content/dam/test/object-format', requestCount: 50, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
        '/content/dam/test/string-format',
      ]);
      analysisStrategyStub.analyze.resolves([]);

      await handlerModule.contentFragment404AuditRunner(baseURL, context, site);

      expect(analysisStrategyStub.analyze).to.have.been.calledWith([
        '/content/dam/test/object-format',
        '/content/dam/test/string-format',
      ]);
    });

    it('should pass site in auditContext', async () => {
      await handlerModule.contentFragment404AuditRunner(baseURL, context, site);

      expect(athenaCollectorStub.fetchBrokenPaths).to.have.been.calledOnce;
      expect(analysisStrategyStub.analyze).to.have.been.calledOnce;
    });

    it('should use correct baseURL in response', async () => {
      const customURL = 'https://custom-tenant.adobe.com';
      const result = await handlerModule.contentFragment404AuditRunner(customURL, context, site);

      expect(result.fullAuditRef).to.equal(customURL);
    });
  });

  describe('createContentFragmentPathSuggestions', () => {
    let auditData;

    beforeEach(() => {
      auditData = {
        id: 'test-audit-id',
        auditResult: {
          brokenPaths: [
            { url: '/content/dam/test/fragment1', requestCount: 100, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
            { url: '/content/dam/test/fragment2', requestCount: 200, requestUserAgents: [{ userAgent: 'Chrome/91.0', count: 200 }] },
          ],
          suggestions: [
            { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar path found' },
            { requestedPath: '/content/dam/test/fragment2', suggestedPath: null, type: 'PUBLISH', reason: 'Content not published' },
          ],
        },
      };
    });

    it('should create opportunity and sync suggestions with enriched data', async () => {
      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(convertToOpportunityStub.firstCall.args[0]).to.equal(baseURL);
      expect(convertToOpportunityStub.firstCall.args[1]).to.equal(auditData);
      expect(convertToOpportunityStub.firstCall.args[2]).to.equal(context);
      expect(typeof convertToOpportunityStub.firstCall.args[3]).to.equal('function');
      expect(convertToOpportunityStub.firstCall.args[4]).to.equal(AUDIT_TYPE);

      expect(syncSuggestionsStub).to.have.been.calledOnce;
      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      expect(syncArgs.context).to.equal(context);
      expect(syncArgs.opportunity).to.equal(mockOpportunity);
      expect(syncArgs.newData).to.have.lengthOf(2);
      expect(syncArgs.newData[0]).to.deep.include({
        requestedPath: '/content/dam/test/fragment1',
        suggestedPath: '/content/dam/test/fixed1',
        type: 'SIMILAR',
        reason: 'Similar path found',
        requestCount: 100,
        requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }],
      });

      expect(context.log.info).to.have.been.calledWith('Created 2 suggestions for opportunity test-opportunity-id');
    });

    it('should skip when no suggestions are provided', async () => {
      auditData.auditResult.suggestions = [];

      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      expect(context.log.info).to.have.been.calledWith('No suggestions to create');
      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(syncSuggestionsStub).not.to.have.been.called;
    });

    it('should skip when suggestions is null', async () => {
      auditData.auditResult.suggestions = null;

      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      expect(context.log.info).to.have.been.calledWith('No suggestions to create');
      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(syncSuggestionsStub).not.to.have.been.called;
    });

    it('should enrich suggestions with requestCount and requestUserAgents from brokenPaths', async () => {
      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      expect(syncArgs.newData[0].requestCount).to.equal(100);
      expect(syncArgs.newData[0].requestUserAgents).to.deep.equal([{ userAgent: 'Mozilla/5.0', count: 50 }]);
      expect(syncArgs.newData[1].requestCount).to.equal(200);
      expect(syncArgs.newData[1].requestUserAgents).to.deep.equal([{ userAgent: 'Chrome/91.0', count: 200 }]);
    });

    it('should handle missing requestCount and requestUserAgents in brokenPaths', async () => {
      auditData.auditResult.brokenPaths = [
        { url: '/content/dam/test/fragment1' },
      ];
      auditData.auditResult.suggestions = [
        { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar' },
      ];

      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      expect(syncArgs.newData[0].requestCount).to.equal(0);
      expect(syncArgs.newData[0].requestUserAgents).to.deep.equal([]);
    });

    it('should use correct buildKey function', async () => {
      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      const { buildKey } = syncArgs;

      const key1 = buildKey(auditData.auditResult.suggestions[0]);
      const key2 = buildKey(auditData.auditResult.suggestions[1]);

      expect(key1).to.equal('/content/dam/test/fragment1|SIMILAR');
      expect(key2).to.equal('/content/dam/test/fragment2|PUBLISH');
    });

    it('should use correct getRank function', async () => {
      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      const { getRank } = syncArgs;

      const rank1 = getRank({ requestCount: 100 });
      const rank2 = getRank({ requestCount: 200 });

      expect(rank1).to.equal(100);
      expect(rank2).to.equal(200);
    });

    it('should map new suggestions correctly', async () => {
      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      const { mapNewSuggestion } = syncArgs;

      const enrichedSuggestion = {
        requestedPath: '/content/dam/test/fragment1',
        suggestedPath: '/content/dam/test/fixed1',
        type: 'SIMILAR',
        reason: 'Similar path found',
        requestCount: 100,
        requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }],
      };

      const mapped = mapNewSuggestion(enrichedSuggestion);

      expect(mapped).to.deep.equal({
        opportunityId: 'test-opportunity-id',
        type: SuggestionModel.TYPES.AI_INSIGHTS,
        rank: 100,
        data: enrichedSuggestion,
      });
    });
  });

  describe('enrichContentFragmentPathSuggestions', () => {
    let auditData;

    beforeEach(() => {
      auditData = {
        id: 'test-audit-id',
        auditResult: {
          brokenPaths: [
            { url: '/content/dam/test/fragment1', requestCount: 100, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
          ],
          suggestions: [
            { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar path found' },
          ],
        },
      };
    });

    it('should send suggestions to Mystique when handler is enabled', async () => {
      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.dataAccess.Configuration.findLatest).to.have.been.calledOnce;
      expect(mockConfiguration.isHandlerEnabledForSite).to.have.been.calledWith(AUDIT_TYPE, site);
      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledWith('test-site-id', 'NEW');
      expect(context.dataAccess.Suggestion.allByOpportunityIdAndStatus).to.have.been.calledWith('test-opportunity-id', SuggestionModel.STATUSES.NEW);
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith('Sent 1 content fragment path suggestions to Mystique for enrichment');
    });

    it('should skip when handler is disabled for site', async () => {
      mockConfiguration.isHandlerEnabledForSite.returns(false);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.log.info).to.have.been.calledWith('Auto-Suggest is disabled for site test-site-id');
      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).not.to.have.been.called;
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip when no opportunity found for this audit', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.log.info).to.have.been.calledWith('No opportunity found for this audit, skipping Mystique message');
      expect(context.dataAccess.Suggestion.allByOpportunityIdAndStatus).not.to.have.been.called;
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip when opportunity type does not match', async () => {
      const wrongOpportunity = {
        getId: () => 'wrong-opportunity-id',
        getType: () => 'different-type',
        getAuditId: () => 'test-audit-id',
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([wrongOpportunity]);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.log.info).to.have.been.calledWith('No opportunity found for this audit, skipping Mystique message');
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip when opportunity audit ID does not match', async () => {
      const wrongOpportunity = {
        getId: () => 'wrong-opportunity-id',
        getType: () => AUDIT_TYPE,
        getAuditId: () => 'different-audit-id',
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([wrongOpportunity]);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.log.info).to.have.been.calledWith('No opportunity found for this audit, skipping Mystique message');
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip when no synced suggestions found', async () => {
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves([]);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.log.info).to.have.been.calledWith('No suggestions to enrich, skipping Mystique message');
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip when synced suggestions is null', async () => {
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(null);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.log.info).to.have.been.calledWith('No suggestions to enrich, skipping Mystique message');
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should send correct message structure to Mystique', async () => {
      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sqsCall = context.sqs.sendMessage.getCall(0);
      expect(sqsCall.args[0]).to.equal('test-mystique-queue');

      const message = sqsCall.args[1];
      expect(message).to.have.property('type', GUIDANCE_TYPE);
      expect(message).to.have.property('siteId', 'test-site-id');
      expect(message).to.have.property('auditId', 'test-audit-id');
      expect(message).to.have.property('deliveryType', 'aem_edge');
      expect(message).to.have.property('url', baseURL);
      expect(message).to.have.property('time');
      expect(new Date(message.time)).to.be.a('date');

      expect(message.data).to.have.property('opportunityId', 'test-opportunity-id');
      expect(message.data.brokenPaths).to.be.an('array').with.lengthOf(1);
      
      const brokenPath = message.data.brokenPaths[0];
      expect(brokenPath).to.have.property('suggestionId', 'test-suggestion-id');
      expect(brokenPath).to.have.property('requestedPath', '/content/dam/test/fragment1');
      expect(brokenPath).to.have.property('requestCount', 100);
      expect(brokenPath).to.have.property('requestUserAgents');
      expect(brokenPath.requestUserAgents).to.deep.equal([{ userAgent: 'Mozilla/5.0', count: 50 }]);
      expect(brokenPath).to.have.property('suggestedPath', '/content/dam/test/fixed1');
      expect(brokenPath).to.have.property('reason', 'Similar path found');
    });

    it('should handle multiple suggestions in Mystique message', async () => {
      const mockSuggestion2 = {
        getId: () => 'test-suggestion-id-2',
        getData: () => ({
          requestedPath: '/content/dam/test/fragment2',
          suggestedPath: null,
          type: 'PUBLISH',
          reason: 'Content not published',
          requestCount: 200,
          requestUserAgents: [{ userAgent: 'Chrome/91.0', count: 200 }],
        }),
      };
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves([mockSuggestion, mockSuggestion2]);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      const message = context.sqs.sendMessage.getCall(0).args[1];
      expect(message.data.brokenPaths).to.have.lengthOf(2);
      expect(message.data.brokenPaths[0].suggestionId).to.equal('test-suggestion-id');
      expect(message.data.brokenPaths[1].suggestionId).to.equal('test-suggestion-id-2');
      expect(context.log.info).to.have.been.calledWith('Sent 2 content fragment path suggestions to Mystique for enrichment');
    });
  });

  describe('audit builder configuration', () => {
    it('should export default audit builder', () => {
      expect(handlerModule.default).to.exist;
      expect(typeof handlerModule.default).to.equal('object');
    });

    it('should export contentFragment404AuditRunner', () => {
      expect(handlerModule.contentFragment404AuditRunner).to.exist;
      expect(typeof handlerModule.contentFragment404AuditRunner).to.equal('function');
    });

    it('should export createContentFragmentPathSuggestions', () => {
      expect(handlerModule.createContentFragmentPathSuggestions).to.exist;
      expect(typeof handlerModule.createContentFragmentPathSuggestions).to.equal('function');
    });

    it('should export enrichContentFragmentPathSuggestions', () => {
      expect(handlerModule.enrichContentFragmentPathSuggestions).to.exist;
      expect(typeof handlerModule.enrichContentFragmentPathSuggestions).to.equal('function');
    });
  });
});
