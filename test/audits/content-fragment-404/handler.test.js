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

import {
  TEST_SITE_ID,
  TEST_OPPORTUNITY_ID,
  TEST_AUDIT_ID,
  TEST_SUGGESTION_ID,
  TEST_SUGGESTION_ID_2,
  TEST_BASE_URL,
  TEST_CUSTOM_URL,
  TEST_PATH_1,
  TEST_PATH_2,
  TEST_SUGGESTED_PATH_1,
  TEST_OBJECT_FORMAT_PATH,
  TEST_STRING_FORMAT_PATH,
  REQUEST_COUNT_1,
  REQUEST_COUNT_2,
  REQUEST_COUNT_LOW,
  REQUEST_COUNT_NONE,
  USER_AGENT_COUNT_1,
  USER_AGENT_COUNT_2,
  TEST_USER_AGENT_1,
  TEST_USER_AGENT_2,
  EXPECTED_SUGGESTIONS_COUNT,
  EXPECTED_SINGLE_SUGGESTION_COUNT,
} from './test-constants.js';

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

    baseURL = TEST_BASE_URL;
    site = {
      getId: () => TEST_SITE_ID,
      getBaseURL: () => baseURL,
      getDeliveryType: () => 'aem_edge',
    };

    mockOpportunity = {
      getId: () => TEST_OPPORTUNITY_ID,
      getType: () => AUDIT_TYPE,
      getAuditId: () => TEST_AUDIT_ID,
    };

    mockSuggestion = {
      getId: () => TEST_SUGGESTION_ID,
      getData: () => ({
        requestedPath: TEST_PATH_1,
        suggestedPath: TEST_SUGGESTED_PATH_1,
        type: 'SIMILAR',
        reason: 'Similar path found',
        requestCount: REQUEST_COUNT_1,
        requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }],
      }),
    };

    mockConfiguration = {
      isHandlerEnabledForSite: sandbox.stub().returns(true),
    };

    athenaCollectorStub = {
      fetchContentFragment404s: sandbox.stub().resolves([
        { url: TEST_PATH_1, requestCount: REQUEST_COUNT_1, requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }] },
        { url: TEST_PATH_2, requestCount: REQUEST_COUNT_2, requestUserAgents: [{ userAgent: TEST_USER_AGENT_2, count: USER_AGENT_COUNT_2 }] },
      ]),
      constructor: { name: 'AthenaCollector' },
    };

    pathIndexStub = sandbox.stub();
    aemClientStub = sandbox.stub();
    analysisStrategyStub = {
      analyze: sandbox.stub().resolves([
        { toJSON: () => ({ requestedPath: TEST_PATH_1, suggestedPath: TEST_SUGGESTED_PATH_1, type: 'SIMILAR', reason: 'Similar path found' }) },
        { toJSON: () => ({ requestedPath: TEST_PATH_2, suggestedPath: null, type: 'PUBLISH', reason: 'Content not published' }) },
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

      expect(athenaCollectorStub.fetchContentFragment404s).to.have.been.calledOnce;
      expect(analysisStrategyStub.analyze).to.have.been.calledWith([
        TEST_PATH_1,
        TEST_PATH_2,
      ]);

      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          contentFragment404s: [
            { url: TEST_PATH_1, requestCount: REQUEST_COUNT_1, requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }] },
            { url: TEST_PATH_2, requestCount: REQUEST_COUNT_2, requestUserAgents: [{ userAgent: TEST_USER_AGENT_2, count: USER_AGENT_COUNT_2 }] },
          ],
          suggestions: [
            { requestedPath: TEST_PATH_1, suggestedPath: TEST_SUGGESTED_PATH_1, type: 'SIMILAR', reason: 'Similar path found' },
            { requestedPath: TEST_PATH_2, suggestedPath: null, type: 'PUBLISH', reason: 'Content not published' },
          ],
        },
      });
    });

    it('should handle empty results from collector', async () => {
      athenaCollectorStub.fetchContentFragment404s.resolves([]);
      analysisStrategyStub.analyze.resolves([]);

      const result = await handlerModule.contentFragment404AuditRunner(baseURL, context, site);

      expect(result.auditResult.contentFragment404s).to.deep.equal([]);
      expect(result.auditResult.suggestions).to.deep.equal([]);
    });

    it('should handle mixed format in contentFragment404s (objects and strings)', async () => {
      athenaCollectorStub.fetchContentFragment404s.resolves([
        { url: TEST_OBJECT_FORMAT_PATH, requestCount: REQUEST_COUNT_LOW, requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }] },
        TEST_STRING_FORMAT_PATH,
      ]);
      analysisStrategyStub.analyze.resolves([]);

      await handlerModule.contentFragment404AuditRunner(baseURL, context, site);

      expect(analysisStrategyStub.analyze).to.have.been.calledWith([
        TEST_OBJECT_FORMAT_PATH,
        TEST_STRING_FORMAT_PATH,
      ]);
    });

    it('should pass site in auditContext', async () => {
      await handlerModule.contentFragment404AuditRunner(baseURL, context, site);

      expect(athenaCollectorStub.fetchContentFragment404s).to.have.been.calledOnce;
      expect(analysisStrategyStub.analyze).to.have.been.calledOnce;
    });

    it('should use correct baseURL in response', async () => {
      const result = await handlerModule.contentFragment404AuditRunner(TEST_CUSTOM_URL, context, site);

      expect(result.fullAuditRef).to.equal(TEST_CUSTOM_URL);
    });
  });

  describe('createContentFragmentPathSuggestions', () => {
    let auditData;

    beforeEach(() => {
      auditData = {
        id: TEST_AUDIT_ID,
        auditResult: {
          contentFragment404s: [
            { url: TEST_PATH_1, requestCount: REQUEST_COUNT_1, requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }] },
            { url: TEST_PATH_2, requestCount: REQUEST_COUNT_2, requestUserAgents: [{ userAgent: TEST_USER_AGENT_2, count: USER_AGENT_COUNT_2 }] },
          ],
          suggestions: [
            { requestedPath: TEST_PATH_1, suggestedPath: TEST_SUGGESTED_PATH_1, type: 'SIMILAR', reason: 'Similar path found' },
            { requestedPath: TEST_PATH_2, suggestedPath: null, type: 'PUBLISH', reason: 'Content not published' },
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
      expect(syncArgs.newData).to.have.lengthOf(EXPECTED_SUGGESTIONS_COUNT);
      expect(syncArgs.newData[0]).to.deep.include({
        requestedPath: TEST_PATH_1,
        suggestedPath: TEST_SUGGESTED_PATH_1,
        type: 'SIMILAR',
        reason: 'Similar path found',
        requestCount: REQUEST_COUNT_1,
        requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }],
      });

    });

    it('should skip when no suggestions are provided', async () => {
      auditData.auditResult.suggestions = [];

      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(syncSuggestionsStub).not.to.have.been.called;
    });

    it('should skip when suggestions is null', async () => {
      auditData.auditResult.suggestions = null;

      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(syncSuggestionsStub).not.to.have.been.called;
    });

    it('should enrich suggestions with requestCount and requestUserAgents from contentFragment404s', async () => {
      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      expect(syncArgs.newData[0].requestCount).to.equal(REQUEST_COUNT_1);
      expect(syncArgs.newData[0].requestUserAgents).to.deep.equal([{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }]);
      expect(syncArgs.newData[1].requestCount).to.equal(REQUEST_COUNT_2);
      expect(syncArgs.newData[1].requestUserAgents).to.deep.equal([{ userAgent: TEST_USER_AGENT_2, count: USER_AGENT_COUNT_2 }]);
    });

    it('should handle missing requestCount and requestUserAgents in contentFragment404s', async () => {
      auditData.auditResult.contentFragment404s = [
        { url: TEST_PATH_1 },
      ];
      auditData.auditResult.suggestions = [
        { requestedPath: TEST_PATH_1, suggestedPath: TEST_SUGGESTED_PATH_1, type: 'SIMILAR', reason: 'Similar' },
      ];

      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      expect(syncArgs.newData[0].requestCount).to.equal(REQUEST_COUNT_NONE);
      expect(syncArgs.newData[0].requestUserAgents).to.deep.equal([]);
    });

    it('should use correct buildKey function', async () => {
      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      const { buildKey } = syncArgs;

      const key1 = buildKey(auditData.auditResult.suggestions[0]);
      const key2 = buildKey(auditData.auditResult.suggestions[1]);

      expect(key1).to.equal(`${TEST_PATH_1}|SIMILAR`);
      expect(key2).to.equal(`${TEST_PATH_2}|PUBLISH`);
    });

    it('should use correct getRank function', async () => {
      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      const { getRank } = syncArgs;

      const rank1 = getRank({ requestCount: REQUEST_COUNT_1 });
      const rank2 = getRank({ requestCount: REQUEST_COUNT_2 });

      expect(rank1).to.equal(REQUEST_COUNT_1);
      expect(rank2).to.equal(REQUEST_COUNT_2);
    });

    it('should map new suggestions correctly', async () => {
      await handlerModule.createContentFragmentPathSuggestions(baseURL, auditData, context);

      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      const { mapNewSuggestion } = syncArgs;

      const enrichedSuggestion = {
        requestedPath: TEST_PATH_1,
        suggestedPath: TEST_SUGGESTED_PATH_1,
        type: 'SIMILAR',
        reason: 'Similar path found',
        requestCount: REQUEST_COUNT_1,
        requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }],
      };

      const mapped = mapNewSuggestion(enrichedSuggestion);

      expect(mapped).to.deep.equal({
        opportunityId: TEST_OPPORTUNITY_ID,
        type: SuggestionModel.TYPES.AI_INSIGHTS,
        rank: REQUEST_COUNT_1,
        data: enrichedSuggestion,
      });
    });
  });

  describe('enrichContentFragmentPathSuggestions', () => {
    let auditData;

    beforeEach(() => {
      auditData = {
        id: TEST_AUDIT_ID,
        auditResult: {
          contentFragment404s: [
            { url: TEST_PATH_1, requestCount: REQUEST_COUNT_1, requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }] },
          ],
          suggestions: [
            { requestedPath: TEST_PATH_1, suggestedPath: TEST_SUGGESTED_PATH_1, type: 'SIMILAR', reason: 'Similar path found' },
          ],
        },
      };
    });

    it('should send suggestions to Mystique when handler is enabled', async () => {
      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.dataAccess.Configuration.findLatest).to.have.been.calledOnce;
      expect(mockConfiguration.isHandlerEnabledForSite).to.have.been.calledWith(AUDIT_TYPE_AUTO_SUGGEST, site);
      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledWith(TEST_SITE_ID, 'NEW');
      expect(context.dataAccess.Suggestion.allByOpportunityIdAndStatus).to.have.been.calledWith(TEST_OPPORTUNITY_ID, SuggestionModel.STATUSES.NEW);
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
    });

    it('should skip when handler is disabled for site', async () => {
      mockConfiguration.isHandlerEnabledForSite.returns(false);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).not.to.have.been.called;
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip when no opportunity found for this audit', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.dataAccess.Suggestion.allByOpportunityIdAndStatus).not.to.have.been.called;
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip when opportunity type does not match', async () => {
      const wrongOpportunity = {
        getId: () => 'wrong-opportunity-id',
        getType: () => 'different-type',
        getAuditId: () => TEST_AUDIT_ID,
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([wrongOpportunity]);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

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

      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip when no synced suggestions found', async () => {
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves([]);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip when synced suggestions is null', async () => {
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(null);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should send correct message structure to Mystique', async () => {
      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sqsCall = context.sqs.sendMessage.getCall(0);
      expect(sqsCall.args[0]).to.equal('test-mystique-queue');

      const message = sqsCall.args[1];
      expect(message).to.have.property('type', GUIDANCE_TYPE);
      expect(message).to.have.property('siteId', TEST_SITE_ID);
      expect(message).to.have.property('auditId', TEST_AUDIT_ID);
      expect(message).to.have.property('deliveryType', 'aem_edge');
      expect(message).to.have.property('url', baseURL);
      expect(message).to.have.property('time');
      expect(new Date(message.time)).to.be.a('date');

      expect(message.data).to.have.property('opportunityId', TEST_OPPORTUNITY_ID);
      expect(message.data.contentFragment404s).to.be.an('array').with.lengthOf(EXPECTED_SINGLE_SUGGESTION_COUNT);
      
      const brokenPath = message.data.contentFragment404s[0];
      expect(brokenPath).to.have.property('suggestionId', TEST_SUGGESTION_ID);
      expect(brokenPath).to.have.property('requestedPath', TEST_PATH_1);
      expect(brokenPath).to.have.property('requestCount', REQUEST_COUNT_1);
      expect(brokenPath).to.have.property('requestUserAgents');
      expect(brokenPath.requestUserAgents).to.deep.equal([{ userAgent: TEST_USER_AGENT_1, count: USER_AGENT_COUNT_1 }]);
      expect(brokenPath).to.have.property('suggestedPath', TEST_SUGGESTED_PATH_1);
      expect(brokenPath).to.have.property('reason', 'Similar path found');
    });

    it('should handle multiple suggestions in Mystique message', async () => {
      const mockSuggestion2 = {
        getId: () => TEST_SUGGESTION_ID_2,
        getData: () => ({
          requestedPath: TEST_PATH_2,
          suggestedPath: null,
          type: 'PUBLISH',
          reason: 'Content not published',
          requestCount: REQUEST_COUNT_2,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_2, count: USER_AGENT_COUNT_2 }],
        }),
      };
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves([mockSuggestion, mockSuggestion2]);

      await handlerModule.enrichContentFragmentPathSuggestions(baseURL, auditData, context, site);

      const message = context.sqs.sendMessage.getCall(0).args[1];
      expect(message.data.contentFragment404s).to.have.lengthOf(EXPECTED_SUGGESTIONS_COUNT);
      expect(message.data.contentFragment404s[0].suggestionId).to.equal(TEST_SUGGESTION_ID);
      expect(message.data.contentFragment404s[1].suggestionId).to.equal(TEST_SUGGESTION_ID_2);
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
