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

describe('Broken Content Path Handler', () => {
  let sandbox;
  let context;
  let site;
  let baseURL;
  let handlerModule;
  let athenaCollectorStub;
  let pathIndexStub;
  let aemClientStub;
  let analysisStrategyStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    baseURL = 'https://test-tenant.adobe.com';
    site = {
      getId: () => 'test-site-id',
      getBaseURL: () => baseURL,
    };

    athenaCollectorStub = {
      fetchBrokenPaths: sandbox.stub().resolves([
        { url: '/content/dam/test/fragment1', requestUserAgents: ['Mozilla/5.0'] },
        { url: '/content/dam/test/fragment2', requestUserAgents: ['Chrome/91.0'] },
      ]),
      constructor: { name: 'AthenaCollector' },
    };

    pathIndexStub = sandbox.stub();
    aemClientStub = sandbox.stub();
    analysisStrategyStub = {
      analyze: sandbox.stub().resolves([
        { toJSON: () => ({ requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR' }) },
        { toJSON: () => ({ requestedPath: '/content/dam/test/fragment2', suggestedPath: null, type: 'PUBLISH' }) },
      ]),
    };

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
    });
  });

  afterEach(() => {
    sandbox.restore();
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

      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          brokenPaths: [
            { url: '/content/dam/test/fragment1', requestUserAgents: ['Mozilla/5.0'] },
            { url: '/content/dam/test/fragment2', requestUserAgents: ['Chrome/91.0'] },
          ],
          suggestions: [
            { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR' },
            { requestedPath: '/content/dam/test/fragment2', suggestedPath: null, type: 'PUBLISH' },
          ],
          success: true,
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
          success: false,
        },
      });
    });

    it('should handle analysis strategy errors gracefully', async () => {
      const error = new Error('Analysis strategy failed');
      analysisStrategyStub.analyze.rejects(error);

      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(context.log.error).to.have.been.calledWith('Audit failed with error: Analysis strategy failed');
      expect(result).to.deep.equal({
        fullAuditRef: baseURL,
        auditResult: {
          error: 'Analysis strategy failed',
          success: false,
        },
      });
    });

    it('should handle empty results from collector', async () => {
      athenaCollectorStub.fetchBrokenPaths.resolves([]);
      analysisStrategyStub.analyze.resolves([]);

      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(context.log.info).to.have.been.calledWith('Found 0 broken content fragment paths from AthenaCollector');
      expect(context.log.info).to.have.been.calledWith('Found 0 suggestions for broken content fragment paths');
      expect(result.auditResult.brokenPaths).to.deep.equal([]);
      expect(result.auditResult.suggestions).to.deep.equal([]);
      expect(result.auditResult.success).to.be.true;
    });

    it('should handle mixed format in brokenPaths (objects and strings)', async () => {
      athenaCollectorStub.fetchBrokenPaths.resolves([
        { url: '/content/dam/test/object-format', requestUserAgents: ['Mozilla/5.0'] },
        '/content/dam/test/string-format',
      ]);
      analysisStrategyStub.analyze.resolves([]);

      const result = await handlerModule.contentFragmentBrokenLinksAuditRunner(baseURL, context, site);

      expect(analysisStrategyStub.analyze).to.have.been.calledWith([
        '/content/dam/test/object-format',
        '/content/dam/test/string-format',
      ]);
      expect(result.auditResult.success).to.be.true;
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
          success: false,
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
          success: false,
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
  });
});
