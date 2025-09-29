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

describe('AnalysisStrategy', () => {
  let sandbox;
  let context;
  let mockAemAuthorClient;
  let mockPathIndex;
  let mockPublishRule;
  let mockLocaleFallbackRule;
  let mockSimilarPathRule;
  let mockSuggestion;
  let mockContentPath;
  let mockLocale;
  let AnalysisStrategy;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
      })
      .build();

    mockPathIndex = {
      find: sandbox.stub().returns(null),
      insertContentPath: sandbox.stub(),
      parseContentStatus: sandbox.stub().returns('PUBLISHED'),
    };

    // Mock rules with priority methods
    mockPublishRule = {
      getPriority: sandbox.stub().returns(1),
      apply: sandbox.stub().resolves(null),
      constructor: { name: 'PublishRule' },
    };

    mockLocaleFallbackRule = {
      getPriority: sandbox.stub().returns(2),
      apply: sandbox.stub().resolves(null),
      constructor: { name: 'LocaleFallbackRule' },
    };

    mockSimilarPathRule = {
      getPriority: sandbox.stub().returns(3),
      apply: sandbox.stub().resolves(null),
      constructor: { name: 'SimilarPathRule' },
    };

    mockSuggestion = {
      notFound: sandbox.stub().returns({
        type: 'NOT_FOUND',
        requestedPath: '/content/dam/test/broken.jpg',
        suggestedPath: null,
        reason: 'Not found',
      }),
    };

    mockContentPath = sandbox.stub().returns({
      isPublished: sandbox.stub().returns(true),
      status: 'PUBLISHED',
    });

    mockLocale = {
      fromPath: sandbox.stub().returns({ code: 'en-us' }),
    };

    const module = await esmock('../../../src/content-fragment-broken-links/analysis/analysis-strategy.js', {
      '../../../src/content-fragment-broken-links/rules/publish-rule.js': {
        PublishRule: function PublishRule() { return mockPublishRule; },
      },
      '../../../src/content-fragment-broken-links/rules/locale-fallback-rule.js': {
        LocaleFallbackRule: function LocaleFallbackRule() { return mockLocaleFallbackRule; },
      },
      '../../../src/content-fragment-broken-links/rules/similar-path-rule.js': {
        SimilarPathRule: function SimilarPathRule() { return mockSimilarPathRule; },
      },
      '../../../src/content-fragment-broken-links/domain/suggestion/suggestion.js': {
        Suggestion: mockSuggestion,
        SuggestionType: {
          PUBLISH: 'PUBLISH',
          LOCALE: 'LOCALE',
          SIMILAR: 'SIMILAR',
          NOT_FOUND: 'NOT_FOUND',
        },
      },
      '../../../src/content-fragment-broken-links/domain/content/content-path.js': {
        ContentPath: mockContentPath,
      },
      '../../../src/content-fragment-broken-links/domain/language/locale.js': {
        Locale: mockLocale,
      },
      '../../../src/content-fragment-broken-links/domain/index/path-index.js': {
        PathIndex: mockPathIndex,
      },
    });

    AnalysisStrategy = module.AnalysisStrategy;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('static constants', () => {
    it('should have GraphQL suffix regex', () => {
      expect(AnalysisStrategy.GRAPHQL_SUFFIX).to.be.a('regexp');
      expect(AnalysisStrategy.GRAPHQL_SUFFIX.test('/content/dam/test.cfm.json')).to.be.true;
      expect(AnalysisStrategy.GRAPHQL_SUFFIX.test('/content/dam/test.cfm.model.json')).to.be.true;
      expect(AnalysisStrategy.GRAPHQL_SUFFIX.test('/content/dam/test.jpg')).to.be.false;
    });
  });

  describe('constructor', () => {
    it('should initialize with context, AEM client, and path index', () => {
      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);

      expect(strategy.context).to.equal(context);
      expect(strategy.aemAuthorClient).to.equal(mockAemAuthorClient);
      expect(strategy.pathIndex).to.equal(mockPathIndex);
      expect(strategy.rules).to.have.lengthOf(3);
    });

    it('should sort rules by priority', () => {
      mockPublishRule.getPriority.returns(3);
      mockLocaleFallbackRule.getPriority.returns(1);
      mockSimilarPathRule.getPriority.returns(2);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);

      expect(strategy.rules[0]).to.equal(mockLocaleFallbackRule);
      expect(strategy.rules[1]).to.equal(mockSimilarPathRule);
      expect(strategy.rules[2]).to.equal(mockPublishRule);
    });
  });

  describe('cleanPath static method', () => {
    it('should remove GraphQL suffix from paths', () => {
      expect(AnalysisStrategy.cleanPath('/content/dam/test.cfm.json')).to.equal('/content/dam/test');
      expect(AnalysisStrategy.cleanPath('/content/dam/test.cfm.model.json')).to.equal('/content/dam/test');
      expect(AnalysisStrategy.cleanPath('/content/dam/folder/item.cfm.variant.json')).to.equal('/content/dam/folder/item');
    });

    it('should return original path if no GraphQL suffix', () => {
      expect(AnalysisStrategy.cleanPath('/content/dam/test.jpg')).to.equal('/content/dam/test.jpg');
      expect(AnalysisStrategy.cleanPath('/content/dam/test')).to.equal('/content/dam/test');
      expect(AnalysisStrategy.cleanPath('/content/dam/test.json')).to.equal('/content/dam/test.json');
    });

    it('should handle edge cases', () => {
      expect(AnalysisStrategy.cleanPath('')).to.equal('');
      expect(AnalysisStrategy.cleanPath('/content/dam/.cfm.json')).to.equal('/content/dam/');
      expect(AnalysisStrategy.cleanPath('/content/dam/test.cfm')).to.equal('/content/dam/test.cfm');
    });
  });

  describe('analyze method', () => {
    it('should analyze multiple broken paths', async () => {
      const brokenPaths = [
        '/content/dam/test/broken1.jpg',
        '/content/dam/test/broken2.cfm.json',
      ];

      const suggestion1 = { type: 'PUBLISH', requestedPath: '/content/dam/test/broken1.jpg' };
      const suggestion2 = { type: 'LOCALE', requestedPath: '/content/dam/test/broken2' };

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const analyzePathStub = sandbox.stub(strategy, 'analyzePath');
      analyzePathStub.onCall(0).resolves(suggestion1);
      analyzePathStub.onCall(1).resolves(suggestion2);

      const processSuggestionsStub = sandbox.stub(strategy, 'processSuggestions').resolves([suggestion1, suggestion2]);

      const result = await strategy.analyze(brokenPaths);

      expect(analyzePathStub).to.have.been.calledTwice;
      expect(analyzePathStub.firstCall).to.have.been.calledWith('/content/dam/test/broken1.jpg');
      expect(analyzePathStub.secondCall).to.have.been.calledWith('/content/dam/test/broken2');
      expect(processSuggestionsStub).to.have.been.calledWith([suggestion1, suggestion2]);
      expect(result).to.deep.equal([suggestion1, suggestion2]);
    });

    it('should filter out null suggestions', async () => {
      const brokenPaths = [
        '/content/dam/test/broken1.jpg',
        '/content/dam/test/broken2.jpg',
        '/content/dam/test/broken3.jpg',
      ];

      const suggestion1 = { type: 'PUBLISH', requestedPath: '/content/dam/test/broken1.jpg' };

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const analyzePathStub = sandbox.stub(strategy, 'analyzePath');
      analyzePathStub.onCall(0).resolves(suggestion1);
      analyzePathStub.onCall(1).resolves(null);
      analyzePathStub.onCall(2).resolves(undefined);

      const processSuggestionsStub = sandbox.stub(strategy, 'processSuggestions').resolves([suggestion1]);

      const result = await strategy.analyze(brokenPaths);

      expect(analyzePathStub).to.have.been.calledThrice;
      expect(processSuggestionsStub).to.have.been.calledWith([suggestion1]);
      expect(result).to.deep.equal([suggestion1]);
    });

    it('should handle empty broken paths array', async () => {
      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const processSuggestionsStub = sandbox.stub(strategy, 'processSuggestions').resolves([]);

      const result = await strategy.analyze([]);

      expect(processSuggestionsStub).to.have.been.calledWith([]);
      expect(result).to.deep.equal([]);
    });

    it('should clean GraphQL paths before analysis', async () => {
      const brokenPaths = ['/content/dam/test/broken.cfm.json'];

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const analyzePathStub = sandbox.stub(strategy, 'analyzePath').resolves(null);
      sandbox.stub(strategy, 'processSuggestions').resolves([]);

      await strategy.analyze(brokenPaths);

      expect(analyzePathStub).to.have.been.calledWith('/content/dam/test/broken');
    });
  });

  describe('analyzePath method', () => {
    it('should return first successful rule suggestion', async () => {
      const brokenPath = '/content/dam/test/broken.jpg';
      const suggestion = { type: 'PUBLISH', requestedPath: brokenPath };

      mockPublishRule.apply.resolves(suggestion);
      mockLocaleFallbackRule.apply.resolves(null);
      mockSimilarPathRule.apply.resolves(null);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(mockPublishRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockLocaleFallbackRule.apply).to.not.have.been.called;
      expect(mockSimilarPathRule.apply).to.not.have.been.called;
      expect(result).to.equal(suggestion);
    });

    it('should try all rules until one succeeds', async () => {
      const brokenPath = '/content/dam/test/broken.jpg';
      const suggestion = { type: 'LOCALE', requestedPath: brokenPath };

      mockPublishRule.apply.resolves(null);
      mockLocaleFallbackRule.apply.resolves(suggestion);
      mockSimilarPathRule.apply.resolves(null);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(mockPublishRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockLocaleFallbackRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockSimilarPathRule.apply).to.not.have.been.called;
      expect(result).to.equal(suggestion);
    });

    it('should return notFound suggestion when no rules succeed', async () => {
      const brokenPath = '/content/dam/test/broken.jpg';
      const notFoundSuggestion = { type: 'NOT_FOUND', requestedPath: brokenPath };

      mockPublishRule.apply.resolves(null);
      mockLocaleFallbackRule.apply.resolves(null);
      mockSimilarPathRule.apply.resolves(null);
      mockSuggestion.notFound.returns(notFoundSuggestion);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(mockPublishRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockLocaleFallbackRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockSimilarPathRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockSuggestion.notFound).to.have.been.calledWith(brokenPath);
      expect(result).to.equal(notFoundSuggestion);
    });

    it('should handle rule errors and continue to next rule', async () => {
      const brokenPath = '/content/dam/test/broken.jpg';
      const suggestion = { type: 'SIMILAR', requestedPath: brokenPath };

      mockPublishRule.apply.rejects(new Error('Publish rule failed'));
      mockLocaleFallbackRule.apply.rejects(new Error('Locale rule failed'));
      mockSimilarPathRule.apply.resolves(suggestion);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(mockPublishRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockLocaleFallbackRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockSimilarPathRule.apply).to.have.been.calledWith(brokenPath);
      expect(context.log.error).to.have.been.calledTwice;
      expect(result).to.equal(suggestion);
    });

    it('should return notFound when all rules fail with errors', async () => {
      const brokenPath = '/content/dam/test/broken.jpg';
      const notFoundSuggestion = { type: 'NOT_FOUND', requestedPath: brokenPath };

      mockPublishRule.apply.rejects(new Error('Publish rule failed'));
      mockLocaleFallbackRule.apply.rejects(new Error('Locale rule failed'));
      mockSimilarPathRule.apply.rejects(new Error('Similar rule failed'));
      mockSuggestion.notFound.returns(notFoundSuggestion);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(context.log.error).to.have.been.calledThrice;
      expect(context.log.warn).to.have.been.calledWith(`No rules applied to ${brokenPath}`);
      expect(result).to.equal(notFoundSuggestion);
    });

    it('should log rule application success', async () => {
      const brokenPath = '/content/dam/test/broken.jpg';
      const suggestion = { type: 'PUBLISH', requestedPath: brokenPath };

      mockPublishRule.apply.resolves(suggestion);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      await strategy.analyzePath(brokenPath);

      expect(context.log.info).to.have.been.calledWith(`Analyzing broken path: ${brokenPath}`);
      expect(context.log.info).to.have.been.calledWith(`Rule PublishRule applied to ${brokenPath}`);
    });
  });

  describe('processSuggestions method', () => {
    it('should pass through PUBLISH and NOT_FOUND suggestions unchanged', async () => {
      const suggestions = [
        { type: 'PUBLISH', requestedPath: '/content/dam/test/broken1.jpg', suggestedPath: '/content/dam/test/fixed1.jpg' },
        { type: 'NOT_FOUND', requestedPath: '/content/dam/test/broken2.jpg', suggestedPath: null },
      ];

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(result).to.deep.equal(suggestions);
      expect(mockPathIndex.find).to.not.have.been.called;
    });

    it('should process LOCALE suggestions with published content', async () => {
      const suggestions = [
        { type: 'LOCALE', requestedPath: '/content/dam/test/broken.jpg', suggestedPath: '/content/dam/test/suggested.jpg' },
      ];

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: 'PUBLISHED',
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(mockPathIndex.find).to.have.been.calledWith('/content/dam/test/suggested.jpg');
      expect(result).to.deep.equal(suggestions);
      expect(context.log.debug).to.have.been.calledWith('Kept original suggestion type for /content/dam/test/suggested.jpg with status: PUBLISHED');
    });

    it('should process SIMILAR suggestions with published content', async () => {
      const suggestions = [
        { type: 'SIMILAR', requestedPath: '/content/dam/test/broken.jpg', suggestedPath: '/content/dam/test/suggested.jpg' },
      ];

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: 'PUBLISHED',
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(result).to.deep.equal(suggestions);
    });

    it('should update reason for unpublished content', async () => {
      const suggestions = [
        { type: 'LOCALE', requestedPath: '/content/dam/test/broken.jpg', suggestedPath: '/content/dam/test/suggested.jpg' },
      ];

      const contentPath = {
        isPublished: sandbox.stub().returns(false),
        status: 'DRAFT',
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(result).to.have.lengthOf(1);
      expect(result[0].reason).to.equal('Content is in DRAFT state. Suggest publishing.');
    });

    it('should handle empty suggestions array', async () => {
      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.processSuggestions([]);

      expect(result).to.deep.equal([]);
      expect(context.log.info).to.have.been.calledWith('Post-processing 0 suggestions');
    });

    it('should handle mixed suggestion types', async () => {
      const suggestions = [
        { type: 'PUBLISH', requestedPath: '/content/dam/test/broken1.jpg', suggestedPath: '/content/dam/test/fixed1.jpg' },
        { type: 'LOCALE', requestedPath: '/content/dam/test/broken2.jpg', suggestedPath: '/content/dam/test/suggested2.jpg' },
        { type: 'NOT_FOUND', requestedPath: '/content/dam/test/broken3.jpg', suggestedPath: null },
      ];

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: 'PUBLISHED',
      };
      mockPathIndex.find.onCall(0).returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(result).to.have.lengthOf(3);
      expect(result[0]).to.equal(suggestions[0]); // PUBLISH unchanged
      expect(result[1]).to.equal(suggestions[1]); // LOCALE processed but unchanged (published)
      expect(result[2]).to.equal(suggestions[2]); // NOT_FOUND unchanged
    });
  });

  describe('integration scenarios', () => {
    it('should work end-to-end with successful rule application', async () => {
      const brokenPaths = ['/content/dam/test/broken.cfm.json'];
      const suggestion = {
        type: 'LOCALE',
        requestedPath: '/content/dam/test/broken',
        suggestedPath: '/content/dam/test/suggested.jpg',
      };

      mockLocaleFallbackRule.apply.resolves(suggestion);

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: 'PUBLISHED',
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.analyze(brokenPaths);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.equal(suggestion);
      expect(context.log.info).to.have.been.calledWith('Analyzing broken path: /content/dam/test/broken');
      expect(context.log.info).to.have.been.calledWith('Rule LocaleFallbackRule applied to /content/dam/test/broken');
    });

    it('should handle no successful rules scenario', async () => {
      const brokenPaths = ['/content/dam/test/broken.jpg'];
      const notFoundSuggestion = {
        type: 'NOT_FOUND',
        requestedPath: '/content/dam/test/broken.jpg',
        suggestedPath: null,
      };

      mockPublishRule.apply.resolves(null);
      mockLocaleFallbackRule.apply.resolves(null);
      mockSimilarPathRule.apply.resolves(null);
      mockSuggestion.notFound.returns(notFoundSuggestion);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.analyze(brokenPaths);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.equal(notFoundSuggestion);
      expect(context.log.warn).to.have.been.calledWith('No rules applied to /content/dam/test/broken.jpg');
    });

    it('should handle multiple paths with different outcomes', async () => {
      const brokenPaths = [
        '/content/dam/test/broken1.jpg',
        '/content/dam/test/broken2.cfm.json',
        '/content/dam/test/broken3.jpg',
      ];

      const suggestion1 = { type: 'PUBLISH', requestedPath: '/content/dam/test/broken1.jpg' };
      const suggestion2 = { type: 'LOCALE', requestedPath: '/content/dam/test/broken2', suggestedPath: '/content/dam/test/suggested2.jpg' };
      const notFoundSuggestion = { type: 'NOT_FOUND', requestedPath: '/content/dam/test/broken3.jpg' };

      // Setup rule responses for different paths
      mockPublishRule.apply.onCall(0).resolves(suggestion1);
      mockPublishRule.apply.onCall(1).resolves(null);
      mockPublishRule.apply.onCall(2).resolves(null);

      mockLocaleFallbackRule.apply.onCall(0).resolves(suggestion2);
      mockLocaleFallbackRule.apply.onCall(1).resolves(null);

      mockSimilarPathRule.apply.resolves(null);
      mockSuggestion.notFound.returns(notFoundSuggestion);

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: 'PUBLISHED',
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemAuthorClient, mockPathIndex);
      const result = await strategy.analyze(brokenPaths);

      expect(result).to.have.lengthOf(3);
      expect(result[0]).to.equal(suggestion1);
      expect(result[1]).to.equal(suggestion2);
      expect(result[2]).to.equal(notFoundSuggestion);
    });
  });
});
