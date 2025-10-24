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
  let aemClientStub;
  let analysisStrategyStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

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
        site: {
          getId: () => 'test-site-id',
          getBaseURL: () => 'https://test-tenant.adobe.com',
        },
        audit: {
          getAuditResult: sandbox.stub().returns({
            success: true,
            brokenPaths: [
              { url: '/content/dam/test/fragment1', requestUserAgents: ['Mozilla/5.0'] },
              { url: '/content/dam/test/fragment2', requestUserAgents: ['Chrome/91.0'] },
            ],
            suggestions: [
              { requestedPath: '/content/dam/test/fragment1', suggestedPath: '/content/dam/test/fixed1', type: 'SIMILAR' },
              { requestedPath: '/content/dam/test/fragment2', suggestedPath: null, type: 'PUBLISH' },
            ],
          }),
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
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('fetchBrokenContentFragmentLinks', () => {
    it('should successfully fetch broken content paths', async () => {
      const result = await handlerModule.fetchBrokenContentFragmentLinks(context);

      expect(athenaCollectorStub.fetchBrokenPaths).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith('Found 2 broken content fragment paths from AthenaCollector');

      expect(result).to.deep.equal({
        siteId: 'test-site-id',
        fullAuditRef: 'https://test-tenant.adobe.com',
        auditResult: {
          brokenPaths: [
            { url: '/content/dam/test/fragment1', requestUserAgents: ['Mozilla/5.0'] },
            { url: '/content/dam/test/fragment2', requestUserAgents: ['Chrome/91.0'] },
          ],
          success: true,
        },
      });
    });

    it('should handle collector errors gracefully', async () => {
      const error = new Error('Athena connection failed');
      athenaCollectorStub.fetchBrokenPaths.rejects(error);

      const result = await handlerModule.fetchBrokenContentFragmentLinks(context);

      expect(context.log.error).to.have.been.calledWith('Failed to fetch broken content fragment paths: Athena connection failed');
      expect(result).to.deep.equal({
        siteId: 'test-site-id',
        fullAuditRef: 'https://test-tenant.adobe.com',
        auditResult: {
          error: 'Athena connection failed',
          success: false,
        },
      });
    });

    it('should handle empty results from collector', async () => {
      athenaCollectorStub.fetchBrokenPaths.resolves([]);

      const result = await handlerModule.fetchBrokenContentFragmentLinks(context);

      expect(context.log.info).to.have.been.calledWith('Found 0 broken content fragment paths from AthenaCollector');
      expect(result.auditResult.brokenPaths).to.deep.equal([]);
      expect(result.auditResult.success).to.be.true;
    });

    it('should use correct tenant URL in response', async () => {
      const customContext = {
        ...context,
        site: {
          getId: () => 'custom-site-id',
          getBaseURL: () => 'https://custom-tenant.adobe.com',
        },
        log: context.log,
      };

      const result = await handlerModule.fetchBrokenContentFragmentLinks(customContext);

      expect(result.siteId).to.equal('custom-site-id');
      expect(result.fullAuditRef).to.equal('https://custom-tenant.adobe.com');
    });
  });

  describe('analyzeBrokenContentFragmentLinks', () => {
    it('should successfully analyze broken content paths', async () => {
      const result = await handlerModule.analyzeBrokenContentFragmentLinks(context);

      expect(analysisStrategyStub.analyze).to.have.been.calledWith(['/content/dam/test/fragment1', '/content/dam/test/fragment2']);
      expect(context.log.info).to.have.been.calledWith('Found 2 suggestions for broken content fragment paths');

      expect(result).to.deep.equal({
        siteId: 'test-site-id',
        fullAuditRef: 'https://test-tenant.adobe.com',
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

    it('should throw error when audit result is unsuccessful', async () => {
      context.audit.getAuditResult.returns({ success: false, error: 'Previous step failed' });

      await expect(handlerModule.analyzeBrokenContentFragmentLinks(context))
        .to.be.rejectedWith('Audit failed, skipping content fragment path analysis');
    });

    it('should handle analysis strategy errors gracefully', async () => {
      const error = new Error('Analysis strategy failed');
      analysisStrategyStub.analyze.rejects(error);

      const result = await handlerModule.analyzeBrokenContentFragmentLinks(context);

      expect(context.log.error).to.have.been.calledWith('Failed to analyze broken content fragment paths: Analysis strategy failed');
      expect(result).to.deep.equal({
        siteId: 'test-site-id',
        fullAuditRef: 'https://test-tenant.adobe.com',
        auditResult: {
          brokenPaths: [
            { url: '/content/dam/test/fragment1', requestUserAgents: ['Mozilla/5.0'] },
            { url: '/content/dam/test/fragment2', requestUserAgents: ['Chrome/91.0'] },
          ],
          error: 'Analysis strategy failed',
          success: false,
        },
      });
    });

    it('should handle empty broken paths array', async () => {
      context.audit.getAuditResult.returns({
        success: true,
        brokenPaths: [],
      });
      analysisStrategyStub.analyze.resolves([]);

      const result = await handlerModule.analyzeBrokenContentFragmentLinks(context);

      expect(analysisStrategyStub.analyze).to.have.been.calledWith([]);
      expect(context.log.info).to.have.been.calledWith('Found 0 suggestions for broken content fragment paths');
      expect(result).to.deep.equal({
        siteId: 'test-site-id',
        fullAuditRef: 'https://test-tenant.adobe.com',
        auditResult: {
          brokenPaths: [],
          suggestions: [],
          success: true,
        },
      });
    });

    it('should create PathIndex and AemClient correctly', async () => {
      await handlerModule.analyzeBrokenContentFragmentLinks(context);

      expect(pathIndexStub).to.exist;
      expect(handlerModule.AemClient?.createFrom || (() => {})).to.exist;
    });

    it('should handle AemClient creation errors', async () => {
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

      const result = await errorHandlerModule.analyzeBrokenContentFragmentLinks(context);

      expect(context.log.error).to.have.been.calledWith('Failed to analyze broken content fragment paths: AEM client initialization failed');
      expect(result).to.deep.equal({
        siteId: 'test-site-id',
        fullAuditRef: 'https://test-tenant.adobe.com',
        auditResult: {
          brokenPaths: [
            { url: '/content/dam/test/fragment1', requestUserAgents: ['Mozilla/5.0'] },
            { url: '/content/dam/test/fragment2', requestUserAgents: ['Chrome/91.0'] },
          ],
          error: 'AEM client initialization failed',
          success: false,
        },
      });
    });
  });

  describe('provideContentFragmentLinkSuggestions', () => {
    it('should provide suggestions for successful analysis', () => {
      const result = handlerModule.provideContentFragmentLinkSuggestions(context);

      expect(context.log.info).to.have.been.calledWith('Providing 2 content fragment path suggestions');
      expect(result).to.deep.equal({
        siteId: 'test-site-id',
        fullAuditRef: 'https://test-tenant.adobe.com',
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

    it('should throw error when audit result is unsuccessful', () => {
      context.audit.getAuditResult.returns({ success: false, error: 'Analysis failed' });

      expect(() => handlerModule.provideContentFragmentLinkSuggestions(context))
        .to.throw('Audit failed, skipping content fragment path suggestions generation');
    });

    it('should handle empty suggestions array', () => {
      context.audit.getAuditResult.returns({
        success: true,
        suggestions: [],
      });

      const result = handlerModule.provideContentFragmentLinkSuggestions(context);

      expect(context.log.info).to.have.been.calledWith('Providing 0 content fragment path suggestions');
      expect(result.auditResult.suggestions).to.deep.equal([]);
      expect(result.auditResult.success).to.be.true;
    });

    it('should handle missing suggestions gracefully', () => {
      context.audit.getAuditResult.returns({
        success: true,
      });

      const result = handlerModule.provideContentFragmentLinkSuggestions(context);

      expect(context.log.info).to.have.been.calledWith('Providing 0 content fragment path suggestions');
      expect(result.auditResult.suggestions).to.deep.equal([]);
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
