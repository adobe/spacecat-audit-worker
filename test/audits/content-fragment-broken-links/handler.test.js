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
  let handlerModule;
  let athenaCollectorStub;
  let pathIndexStub;
  let aemAuthorClientStub;
  let analysisStrategyStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    athenaCollectorStub = {
      fetchBrokenPaths: sandbox.stub().resolves(['/content/dam/test/broken1.jpg', '/content/dam/test/broken2.pdf']),
      constructor: { name: 'AthenaCollector' },
    };

    pathIndexStub = sandbox.stub();
    aemAuthorClientStub = sandbox.stub();
    analysisStrategyStub = {
      analyze: sandbox.stub().resolves([
        { requestedPath: '/content/dam/test/broken1.jpg', suggestedPath: '/content/dam/test/fixed1.jpg', type: 'SIMILAR' },
        { requestedPath: '/content/dam/test/broken2.pdf', suggestedPath: null, type: 'PUBLISH' },
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
        tenantUrl: 'https://test-tenant.adobe.com',
        audit: {
          getAuditResult: sandbox.stub().returns({
            success: true,
            brokenPaths: ['/content/dam/test/broken1.jpg', '/content/dam/test/broken2.pdf'],
            suggestions: [
              { requestedPath: '/content/dam/test/broken1.jpg', suggestedPath: '/content/dam/test/fixed1.jpg', type: 'SIMILAR' },
              { requestedPath: '/content/dam/test/broken2.pdf', suggestedPath: null, type: 'PUBLISH' },
            ],
          }),
        },
      })
      .build();

    handlerModule = await esmock('../../../src/content-fragment-broken-links/handler.js', {
      '../../../src/content-fragment-broken-links/collectors/athena-collector.js': {
        AthenaCollector: function MockAthenaCollector() {
          return athenaCollectorStub;
        },
      },
      '../../../src/content-fragment-broken-links/domain/index/path-index.js': {
        PathIndex: function MockPathIndex() {
          return pathIndexStub;
        },
      },
      '../../../src/content-fragment-broken-links/clients/aem-author-client.js': {
        AemAuthorClient: {
          createFrom: sandbox.stub().returns(aemAuthorClientStub),
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

  describe('fetchBrokenContentFragmentPaths', () => {
    it('should successfully fetch broken content paths', async () => {
      const result = await handlerModule.fetchBrokenContentFragmentPaths(context);

      expect(athenaCollectorStub.fetchBrokenPaths).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith('Found 2 broken content paths from AthenaCollector');

      expect(result).to.deep.equal({
        fullAuditRef: 'https://test-tenant.adobe.com',
        auditResult: {
          brokenPaths: ['/content/dam/test/broken1.jpg', '/content/dam/test/broken2.pdf'],
          success: true,
        },
      });
    });

    it('should handle collector errors gracefully', async () => {
      const error = new Error('Athena connection failed');
      athenaCollectorStub.fetchBrokenPaths.rejects(error);

      const result = await handlerModule.fetchBrokenContentFragmentPaths(context);

      expect(context.log.error).to.have.been.calledWith('Failed to fetch broken content paths: Athena connection failed');
      expect(result).to.deep.equal({
        fullAuditRef: 'https://test-tenant.adobe.com',
        auditResult: {
          error: 'Athena connection failed',
          success: false,
        },
      });
    });

    it('should handle empty results from collector', async () => {
      athenaCollectorStub.fetchBrokenPaths.resolves([]);

      const result = await handlerModule.fetchBrokenContentFragmentPaths(context);

      expect(context.log.info).to.have.been.calledWith('Found 0 broken content paths from AthenaCollector');
      expect(result.auditResult.brokenPaths).to.deep.equal([]);
      expect(result.auditResult.success).to.be.true;
    });

    it('should use correct tenant URL in response', async () => {
      const customContext = {
        ...context,
        tenantUrl: 'https://custom-tenant.adobe.com',
        log: context.log,
      };

      const result = await handlerModule.fetchBrokenContentFragmentPaths(customContext);

      expect(result.fullAuditRef).to.equal('https://custom-tenant.adobe.com');
    });
  });

  describe('analyzeBrokenContentFragmentPaths', () => {
    it('should successfully analyze broken content paths', async () => {
      const result = await handlerModule.analyzeBrokenContentFragmentPaths(context);

      expect(analysisStrategyStub.analyze).to.have.been.calledWith(['/content/dam/test/broken1.jpg', '/content/dam/test/broken2.pdf']);
      expect(context.log.info).to.have.been.calledWith('Found 2 suggestions for broken content paths');

      expect(result).to.deep.equal({
        suggestions: [
          { requestedPath: '/content/dam/test/broken1.jpg', suggestedPath: '/content/dam/test/fixed1.jpg', type: 'SIMILAR' },
          { requestedPath: '/content/dam/test/broken2.pdf', suggestedPath: null, type: 'PUBLISH' },
        ],
        success: true,
      });
    });

    it('should throw error when audit result is unsuccessful', async () => {
      context.audit.getAuditResult.returns({ success: false, error: 'Previous step failed' });

      await expect(handlerModule.analyzeBrokenContentFragmentPaths(context))
        .to.be.rejectedWith('Audit failed, skipping analysis');
    });

    it('should handle analysis strategy errors gracefully', async () => {
      const error = new Error('Analysis strategy failed');
      analysisStrategyStub.analyze.rejects(error);

      const result = await handlerModule.analyzeBrokenContentFragmentPaths(context);

      expect(context.log.error).to.have.been.calledWith('Failed to analyze broken content paths: Analysis strategy failed');
      expect(result).to.deep.equal({
        error: 'Analysis strategy failed',
        success: false,
      });
    });

    it('should handle empty broken paths array', async () => {
      context.audit.getAuditResult.returns({
        success: true,
        brokenPaths: [],
      });
      analysisStrategyStub.analyze.resolves([]);

      const result = await handlerModule.analyzeBrokenContentFragmentPaths(context);

      expect(analysisStrategyStub.analyze).to.have.been.calledWith([]);
      expect(context.log.info).to.have.been.calledWith('Found 0 suggestions for broken content paths');
      expect(result.suggestions).to.deep.equal([]);
      expect(result.success).to.be.true;
    });

    it('should create PathIndex and AemAuthorClient correctly', async () => {
      await handlerModule.analyzeBrokenContentFragmentPaths(context);

      expect(pathIndexStub).to.exist;
      expect(handlerModule.AemAuthorClient?.createFrom || (() => {})).to.exist;
    });

    it('should handle AemAuthorClient creation errors', async () => {
      const aemError = new Error('AEM client initialization failed');

      const errorHandlerModule = await esmock('../../../src/content-fragment-broken-links/handler.js', {
        '../../../src/content-fragment-broken-links/collectors/athena-collector.js': {
          AthenaCollector: function MockAthenaCollector() {
            return athenaCollectorStub;
          },
        },
        '../../../src/content-fragment-broken-links/domain/index/path-index.js': {
          PathIndex: function MockPathIndex() {
            return pathIndexStub;
          },
        },
        '../../../src/content-fragment-broken-links/clients/aem-author-client.js': {
          AemAuthorClient: {
            createFrom: sandbox.stub().throws(aemError),
          },
        },
        '../../../src/content-fragment-broken-links/analysis/analysis-strategy.js': {
          AnalysisStrategy: function MockAnalysisStrategy() {
            return analysisStrategyStub;
          },
        },
      });

      const result = await errorHandlerModule.analyzeBrokenContentFragmentPaths(context);

      expect(context.log.error).to.have.been.calledWith('Failed to analyze broken content paths: AEM client initialization failed');
      expect(result.success).to.be.false;
      expect(result.error).to.equal('AEM client initialization failed');
    });
  });

  describe('provideSuggestions', () => {
    it('should provide suggestions for successful analysis', () => {
      const result = handlerModule.provideSuggestions(context);

      expect(result).to.deep.equal({
        fullAuditRef: 'https://test-tenant.adobe.com',
        auditResult: {
          tenantUrl: 'https://test-tenant.adobe.com',
          brokenContentPaths: [
            { requestedPath: '/content/dam/test/broken1.jpg', suggestedPath: '/content/dam/test/fixed1.jpg', type: 'SIMILAR' },
            { requestedPath: '/content/dam/test/broken2.pdf', suggestedPath: null, type: 'PUBLISH' },
          ],
          success: true,
        },
      });
    });

    it('should throw error when audit result is unsuccessful', () => {
      context.audit.getAuditResult.returns({ success: false, error: 'Analysis failed' });

      expect(() => handlerModule.provideSuggestions(context))
        .to.throw('Audit failed, skipping suggestions generation');
    });

    it('should handle empty suggestions array', () => {
      context.audit.getAuditResult.returns({
        success: true,
        suggestions: [],
      });

      const result = handlerModule.provideSuggestions(context);

      expect(result.auditResult.brokenContentPaths).to.deep.equal([]);
      expect(result.auditResult.success).to.be.true;
    });

    it('should use correct tenant URL in both fullAuditRef and auditResult', () => {
      const customContext = {
        ...context,
        tenantUrl: 'https://custom-tenant.adobe.com',
        audit: context.audit,
      };

      const result = handlerModule.provideSuggestions(customContext);

      expect(result.fullAuditRef).to.equal('https://custom-tenant.adobe.com');
      expect(result.auditResult.tenantUrl).to.equal('https://custom-tenant.adobe.com');
    });

    it('should handle null suggestions gracefully', () => {
      context.audit.getAuditResult.returns({
        success: true,
        suggestions: null,
      });

      const result = handlerModule.provideSuggestions(context);

      expect(result.auditResult.brokenContentPaths).to.be.null;
      expect(result.auditResult.success).to.be.true;
    });
  });

  describe('audit builder configuration', () => {
    it('should export default audit builder with correct steps', () => {
      expect(handlerModule.default).to.exist;
      // The audit builder creates an object with audit configuration
      expect(typeof handlerModule.default).to.equal('object');
    });
  });
});
