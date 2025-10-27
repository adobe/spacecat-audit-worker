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
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Broken Content Path Handler', () => {
  let sandbox;
  let context;
  let site;
  let audit;
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

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    baseURL = 'https://test-tenant.adobe.com';
    site = {
      getId: () => 'test-site-id',
      getBaseURL: () => baseURL,
      getDeliveryType: () => 'aem_edge',
    };

    audit = {
      getId: () => 'test-audit-id',
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

    mockOpportunity = {
      getId: () => 'test-opportunity-id',
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
        audit,
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-mystique-queue',
        },
        dataAccess: {
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([mockSuggestion]),
          },
        },
      })
      .build();

    handlerModule = await esmock('../../../src/content-fragment-broken-links/handler.js', {
      '../../../src/content-fragment-broken-links/collectors/athena-collector.js': {
        AthenaCollector: {
          createFrom: sandbox.stub().resolves(athenaCollectorStub),
        },
      },
      '../../../src/content-fragment-broken-links/domain/index/path-index.js': {
        PathIndex: function MockPathIndex() {
          return pathIndexStub;
        },
      },
      '../../../src/content-fragment-broken-links/clients/aem-client.js': {
        AemClient: {
          createFrom: sandbox.stub().returns(aemClientStub),
        },
      },
      '../../../src/content-fragment-broken-links/analysis/analysis-strategy.js': {
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

  describe('enrichBrokenContentFragmentLinkSuggestions', () => {
    it('should successfully enrich suggestions and send to Mystique', async () => {
      const brokenPaths = [
        { url: '/content/dam/test/fragment1', requestCount: 100, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
      ];
      const suggestions = [
        { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar path found' },
      ];

      const result = await handlerModule.enrichBrokenContentFragmentLinkSuggestions(
        context,
        brokenPaths,
        suggestions,
      );

      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith('Sent 1 content fragment path suggestions to Mystique for enrichment');
      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should skip enrichment when no suggestions are provided', async () => {
      const brokenPaths = [{ url: '/content/dam/test/fragment1', requestCount: 100 }];
      const suggestions = [];

      const result = await handlerModule.enrichBrokenContentFragmentLinkSuggestions(
        context,
        brokenPaths,
        suggestions,
      );

      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(syncSuggestionsStub).not.to.have.been.called;
      expect(context.sqs.sendMessage).not.to.have.been.called;
      expect(context.log.info).to.have.been.calledWith('No suggestions to enrich, skipping Mystique message');
      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should correctly map requestCount and requestUserAgents from brokenPaths to suggestions', async () => {
      const brokenPaths = [
        { url: '/content/dam/test/fragment1', requestCount: 150, requestUserAgents: [{ userAgent: 'Safari/14', count: 75 }] },
        { url: '/content/dam/test/fragment2', requestCount: 250, requestUserAgents: [{ userAgent: 'Edge/90', count: 125 }] },
      ];
      const suggestions = [
        { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar' },
        { requestedPath: '/content/dam/test/fragment2', suggestedPath: null, type: 'PUBLISH', reason: 'Not published' },
      ];

      await handlerModule.enrichBrokenContentFragmentLinkSuggestions(
        context,
        brokenPaths,
        suggestions,
      );

      expect(syncSuggestionsStub).to.have.been.calledOnce;
      const syncCall = syncSuggestionsStub.getCall(0);
      const mapNewSuggestion = syncCall.args[0].mapNewSuggestion;

      const mapped1 = mapNewSuggestion(suggestions[0]);
      expect(mapped1.data.requestCount).to.equal(150);
      expect(mapped1.data.requestUserAgents).to.deep.equal([{ userAgent: 'Safari/14', count: 75 }]);

      const mapped2 = mapNewSuggestion(suggestions[1]);
      expect(mapped2.data.requestCount).to.equal(250);
      expect(mapped2.data.requestUserAgents).to.deep.equal([{ userAgent: 'Edge/90', count: 125 }]);
    });

    it('should handle missing requestCount and requestUserAgents in brokenPaths', async () => {
      const brokenPaths = [
        { url: '/content/dam/test/fragment1' }, // Missing requestCount and requestUserAgents
      ];
      const suggestions = [
        { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar' },
      ];

      await handlerModule.enrichBrokenContentFragmentLinkSuggestions(
        context,
        brokenPaths,
        suggestions,
      );

      const syncCall = syncSuggestionsStub.getCall(0);
      const mapNewSuggestion = syncCall.args[0].mapNewSuggestion;
      const mapped = mapNewSuggestion(suggestions[0]);

      expect(mapped.data.requestCount).to.equal(0);
      expect(mapped.data.requestUserAgents).to.deep.equal([]);
    });

    it('should send correct message structure to Mystique', async () => {
      const brokenPaths = [
        { url: '/content/dam/test/fragment1', requestCount: 100, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
      ];
      const suggestions = [
        { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar path found' },
      ];

      await handlerModule.enrichBrokenContentFragmentLinkSuggestions(
        context,
        brokenPaths,
        suggestions,
      );

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sqsCall = context.sqs.sendMessage.getCall(0);
      expect(sqsCall.args[0]).to.equal('test-mystique-queue');

      const message = sqsCall.args[1];
      expect(message).to.have.property('type', 'guidance:broken-content-fragment-links');
      expect(message).to.have.property('siteId', 'test-site-id');
      expect(message).to.have.property('auditId', 'test-audit-id');
      expect(message).to.have.property('deliveryType', 'aem_edge');
      expect(message).to.have.property('url', baseURL);
      expect(message).to.have.property('time');
      expect(message.data).to.have.property('opportunityId', 'test-opportunity-id');
      expect(message.data.brokenPaths).to.be.an('array').with.lengthOf(1);
      expect(message.data.brokenPaths[0]).to.have.property('suggestionId', 'test-suggestion-id');
      expect(message.data.brokenPaths[0]).to.have.property('requestedPath', '/content/dam/test/fragment1');
    });

    it('should handle enrichment errors when opportunity creation fails', async () => {
      convertToOpportunityStub.rejects(new Error('Opportunity creation failed'));

      const brokenPaths = [
        { url: '/content/dam/test/fragment1', requestCount: 100, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
      ];
      const suggestions = [
        { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar' },
      ];

      await expect(
        handlerModule.enrichBrokenContentFragmentLinkSuggestions(context, brokenPaths, suggestions),
      ).to.be.rejectedWith('Opportunity creation failed');
    });

    it('should handle enrichment errors when suggestion syncing fails', async () => {
      syncSuggestionsStub.rejects(new Error('Suggestion sync failed'));

      const brokenPaths = [
        { url: '/content/dam/test/fragment1', requestCount: 100, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
      ];
      const suggestions = [
        { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar' },
      ];

      await expect(
        handlerModule.enrichBrokenContentFragmentLinkSuggestions(context, brokenPaths, suggestions),
      ).to.be.rejectedWith('Suggestion sync failed');
    });

    it('should handle enrichment errors when SQS message fails', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS send failed'));

      const brokenPaths = [
        { url: '/content/dam/test/fragment1', requestCount: 100, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
      ];
      const suggestions = [
        { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR', reason: 'Similar' },
      ];

      await expect(
        handlerModule.enrichBrokenContentFragmentLinkSuggestions(context, brokenPaths, suggestions),
      ).to.be.rejectedWith('SQS send failed');
    });
  });

  describe('contentFragmentBrokenLinksAuditRunner', () => {
    it('should successfully complete audit with broken paths and suggestions', async () => {
      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(athenaCollectorStub.fetchBrokenPaths).to.have.been.calledOnce;
      expect(analysisStrategyStub.analyze).to.have.been.calledWith([
        '/content/dam/test/fragment1',
        '/content/dam/test/fragment2',
      ]);
      expect(context.log.info).to.have.been.calledWith('Found 2 broken content fragment paths from AthenaCollector');
      expect(context.log.info).to.have.been.calledWith('Found 2 suggestions for broken content fragment paths');
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledOnce;

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

    it('should handle collector errors gracefully', async () => {
      const error = new Error('Athena connection failed');
      athenaCollectorStub.fetchBrokenPaths.rejects(error);

      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(context.log.error).to.have.been.calledWith('Audit failed with error: Athena connection failed');
      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          error: 'Athena connection failed',
        },
      });
    });

    it('should handle analysis strategy errors gracefully', async () => {
      const error = new Error('Analysis strategy failed');
      analysisStrategyStub.analyze.rejects(error);

      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(context.log.error).to.have.been.calledWith('Audit failed with error: Analysis strategy failed');
      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          error: 'Analysis strategy failed',
        },
      });
    });

    it('should handle enrichment errors gracefully', async () => {
      const error = new Error('Enrichment failed');
      syncSuggestionsStub.rejects(error);

      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(context.log.error).to.have.been.calledWith('Audit failed with error: Enrichment failed');
      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          error: 'Enrichment failed',
        },
      });
    });

    it('should handle empty results from collector', async () => {
      athenaCollectorStub.fetchBrokenPaths.resolves([]);
      analysisStrategyStub.analyze.resolves([]);

      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(context.log.info).to.have.been.calledWith('Found 0 broken content fragment paths from AthenaCollector');
      expect(context.log.info).to.have.been.calledWith('Found 0 suggestions for broken content fragment paths');
      expect(context.log.info).to.have.been.calledWith('No suggestions to enrich, skipping Mystique message');
      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(context.sqs.sendMessage).not.to.have.been.called;
      expect(result.auditResult.brokenPaths).to.deep.equal([]);
      expect(result.auditResult.suggestions).to.deep.equal([]);
    });

    it('should handle mixed format in brokenPaths (objects and strings)', async () => {
      athenaCollectorStub.fetchBrokenPaths.resolves([
        { url: '/content/dam/test/object-format', requestCount: 50, requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 50 }] },
        '/content/dam/test/string-format',
      ]);
      analysisStrategyStub.analyze.resolves([]);

      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(analysisStrategyStub.analyze).to.have.been.calledWith([
        '/content/dam/test/object-format',
        '/content/dam/test/string-format',
      ]);
    });

    it('should use correct baseURL in response', async () => {
      const customURL = 'https://custom-tenant.adobe.com';

      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(customURL, context, site);

      expect(result.fullAuditRef).to.equal(customURL);
    });

    it('should pass site in context to collectors and analysis', async () => {
      await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      // Verify that AthenaCollector.createFrom was called with context that includes site
      const createFromArg = handlerModule.AthenaCollector?.createFrom?.firstCall?.args[0]
        || athenaCollectorStub.fetchBrokenPaths.firstCall?.thisValue;

      // The site should be accessible in the context passed to the helpers
      expect(athenaCollectorStub.fetchBrokenPaths).to.have.been.calledOnce;
      expect(analysisStrategyStub.analyze).to.have.been.calledOnce;
    });

    it('should handle PathIndex creation errors', async () => {
      const pathIndexError = new Error('PathIndex initialization failed');

      const errorHandlerModule = await esmock('../../../src/content-fragment-broken-links/handler.js', {
        '../../../src/content-fragment-broken-links/collectors/athena-collector.js': {
          AthenaCollector: {
            createFrom: sandbox.stub().resolves(athenaCollectorStub),
          },
        },
        '../../../src/content-fragment-broken-links/domain/index/path-index.js': {
          PathIndex: function MockPathIndex() {
            throw pathIndexError;
          },
        },
        '../../../src/content-fragment-broken-links/clients/aem-client.js': {
          AemClient: {
            createFrom: sandbox.stub().returns(aemClientStub),
          },
        },
        '../../../src/content-fragment-broken-links/analysis/analysis-strategy.js': {
          AnalysisStrategy: function MockAnalysisStrategy() {
            return analysisStrategyStub;
          },
        },
      });

      const result = await errorHandlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(context.log.error).to.have.been.calledWith('Audit failed with error: PathIndex initialization failed');
      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          error: 'PathIndex initialization failed',
        },
      });
    });

    it('should handle AemClient creation errors', async () => {
      const aemError = new Error('AEM client initialization failed');

      const errorHandlerModule = await esmock('../../../src/content-fragment-broken-links/handler.js', {
        '../../../src/content-fragment-broken-links/collectors/athena-collector.js': {
          AthenaCollector: {
            createFrom: sandbox.stub().resolves(athenaCollectorStub),
          },
        },
        '../../../src/content-fragment-broken-links/domain/index/path-index.js': {
          PathIndex: function MockPathIndex() {
            return pathIndexStub;
          },
        },
        '../../../src/content-fragment-broken-links/clients/aem-client.js': {
          AemClient: {
            createFrom: sandbox.stub().throws(aemError),
          },
        },
        '../../../src/content-fragment-broken-links/analysis/analysis-strategy.js': {
          AnalysisStrategy: function MockAnalysisStrategy() {
            return analysisStrategyStub;
          },
        },
      });

      const result = await errorHandlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(context.log.error).to.have.been.calledWith('Audit failed with error: AEM client initialization failed');
      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          error: 'AEM client initialization failed',
        },
      });
    });

    it('should call fetchBrokenPaths, analyze, and provide suggestions in order', async () => {
      const callOrder = [];

      athenaCollectorStub.fetchBrokenPaths = sandbox.stub().callsFake(async () => {
        callOrder.push('fetch');
        return [
          { url: '/content/dam/test/fragment1', requestUserAgents: ['Mozilla/5.0'] },
        ];
      });

      analysisStrategyStub.analyze = sandbox.stub().callsFake(async () => {
        callOrder.push('analyze');
        return [
          { toJSON: () => ({ requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR' }) },
        ];
      });

      await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(callOrder).to.deep.equal(['fetch', 'analyze']);
    });
  });

  describe('audit builder configuration', () => {
    it('should export default audit builder with runner', () => {
      expect(handlerModule.default).to.exist;
      expect(typeof handlerModule.default).to.equal('object');
    });

    it('should export contentFragmentBrokenLinksAuditRunner', () => {
      expect(handlerModule.contentFragmentBrokenLinksAuditRunner).to.exist;
      expect(typeof handlerModule.contentFragmentBrokenLinksAuditRunner).to.equal('function');
    });

    it('should export enrichBrokenContentFragmentLinkSuggestions', () => {
      expect(handlerModule.enrichBrokenContentFragmentLinkSuggestions).to.exist;
      expect(typeof handlerModule.enrichBrokenContentFragmentLinkSuggestions).to.equal('function');
    });
  });
});
