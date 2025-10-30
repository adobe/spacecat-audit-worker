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

import {
  TEST_PATH_BROKEN,
  TEST_PATH_BROKEN_1,
  TEST_PATH_BROKEN_2,
  TEST_PATH_BROKEN_3,
  TEST_PATH_BROKEN_NO_EXT,
  TEST_PATH_FIXED_1,
  TEST_PATH_SUGGESTED,
  TEST_PATH_SUGGESTED_2,
  PRIORITY_HIGH,
  PRIORITY_MEDIUM,
  PRIORITY_LOW,
  STATUS_PUBLISHED,
  STATUS_DRAFT,
  SUGGESTION_TYPE_PUBLISH,
  SUGGESTION_TYPE_LOCALE,
  SUGGESTION_TYPE_SIMILAR,
  SUGGESTION_TYPE_NOT_FOUND,
  LOCALE_CODE_EN_US,
  EXPECTED_RULES_COUNT,
  EXPECTED_EMPTY_COUNT,
} from './test-constants.js';

const EXPECTED_SUGGESTIONS_COUNT_3 = 3;
const EXPECTED_SUGGESTIONS_COUNT_1 = 1;

describe('AnalysisStrategy', () => {
  let sandbox;
  let context;
  let mockAemClient;
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
      parseContentStatus: sandbox.stub().returns(STATUS_PUBLISHED),
    };

    // Mock rules with priority methods
    mockPublishRule = {
      getPriority: sandbox.stub().returns(PRIORITY_HIGH),
      apply: sandbox.stub().resolves(null),
      constructor: { name: 'PublishRule' },
    };

    mockLocaleFallbackRule = {
      getPriority: sandbox.stub().returns(PRIORITY_MEDIUM),
      apply: sandbox.stub().resolves(null),
      constructor: { name: 'LocaleFallbackRule' },
    };

    mockSimilarPathRule = {
      getPriority: sandbox.stub().returns(PRIORITY_LOW),
      apply: sandbox.stub().resolves(null),
      constructor: { name: 'SimilarPathRule' },
    };

    mockSuggestion = {
      notFound: sandbox.stub().returns({
        type: SUGGESTION_TYPE_NOT_FOUND,
        requestedPath: TEST_PATH_BROKEN,
        suggestedPath: null,
        reason: 'Not found',
      }),
    };

    mockContentPath = sandbox.stub().returns({
      isPublished: sandbox.stub().returns(true),
      status: STATUS_PUBLISHED,
    });

    mockLocale = {
      fromPath: sandbox.stub().returns({ code: LOCALE_CODE_EN_US }),
    };

    const module = await esmock('../../../src/content-fragment-404/analysis/analysis-strategy.js', {
      '../../../src/content-fragment-404/rules/publish-rule.js': {
        PublishRule: function PublishRule() { return mockPublishRule; },
      },
      '../../../src/content-fragment-404/rules/locale-fallback-rule.js': {
        LocaleFallbackRule: function LocaleFallbackRule() { return mockLocaleFallbackRule; },
      },
      '../../../src/content-fragment-404/rules/similar-path-rule.js': {
        SimilarPathRule: function SimilarPathRule() { return mockSimilarPathRule; },
      },
      '../../../src/content-fragment-404/domain/suggestion/suggestion.js': {
        Suggestion: mockSuggestion,
        SuggestionType: {
          PUBLISH: 'PUBLISH',
          LOCALE: 'LOCALE',
          SIMILAR: 'SIMILAR',
          NOT_FOUND: 'NOT_FOUND',
        },
      },
      '../../../src/content-fragment-404/domain/content/content-path.js': {
        ContentPath: mockContentPath,
      },
      '../../../src/content-fragment-404/domain/language/locale.js': {
        Locale: mockLocale,
      },
      '../../../src/content-fragment-404/domain/index/path-index.js': {
        PathIndex: mockPathIndex,
      },
    });

    AnalysisStrategy = module.AnalysisStrategy;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should initialize with context, AEM client, and path index', () => {
      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);

      expect(strategy.context).to.equal(context);
      expect(strategy.aemClient).to.equal(mockAemClient);
      expect(strategy.pathIndex).to.equal(mockPathIndex);
      expect(strategy.rules).to.have.lengthOf(EXPECTED_RULES_COUNT);
    });

    it('should sort rules by priority', () => {
      mockPublishRule.getPriority.returns(PRIORITY_LOW);
      mockLocaleFallbackRule.getPriority.returns(PRIORITY_HIGH);
      mockSimilarPathRule.getPriority.returns(PRIORITY_MEDIUM);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);

      expect(strategy.rules[0]).to.equal(mockLocaleFallbackRule);
      expect(strategy.rules[1]).to.equal(mockSimilarPathRule);
      expect(strategy.rules[2]).to.equal(mockPublishRule);
    });
  });

  describe('analyze method', () => {
    it('should analyze multiple broken paths', async () => {
      const brokenPaths = [
        TEST_PATH_BROKEN_1,
        TEST_PATH_BROKEN_2,
      ];

      const suggestion1 = { type: SUGGESTION_TYPE_PUBLISH, requestedPath: TEST_PATH_BROKEN_1 };
      const suggestion2 = { type: SUGGESTION_TYPE_LOCALE, requestedPath: TEST_PATH_BROKEN_2 };

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const analyzePathStub = sandbox.stub(strategy, 'analyzePath');
      analyzePathStub.onCall(0).resolves(suggestion1);
      analyzePathStub.onCall(1).resolves(suggestion2);

      const processSuggestionsStub = sandbox.stub(strategy, 'processSuggestions').resolves([suggestion1, suggestion2]);

      const result = await strategy.analyze(brokenPaths);

      expect(analyzePathStub).to.have.been.calledTwice;
      expect(analyzePathStub.firstCall).to.have.been.calledWith(TEST_PATH_BROKEN_1);
      expect(analyzePathStub.secondCall).to.have.been.calledWith(TEST_PATH_BROKEN_2);
      expect(processSuggestionsStub).to.have.been.calledWith([suggestion1, suggestion2]);
      expect(result).to.deep.equal([suggestion1, suggestion2]);
    });

    it('should filter out null suggestions', async () => {
      const brokenPaths = [
        TEST_PATH_BROKEN_1,
        TEST_PATH_BROKEN_2,
        TEST_PATH_BROKEN_3,
      ];

      const suggestion1 = { type: SUGGESTION_TYPE_PUBLISH, requestedPath: TEST_PATH_BROKEN_1 };

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
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
      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const processSuggestionsStub = sandbox.stub(strategy, 'processSuggestions').resolves([]);

      const result = await strategy.analyze([]);

      expect(processSuggestionsStub).to.have.been.calledWith([]);
      expect(result).to.deep.equal([]);
    });
  });

  describe('analyzePath method', () => {
    it('should return first successful rule suggestion', async () => {
      const brokenPath = TEST_PATH_BROKEN;
      const suggestion = { type: SUGGESTION_TYPE_PUBLISH, requestedPath: brokenPath };

      mockPublishRule.apply.resolves(suggestion);
      mockLocaleFallbackRule.apply.resolves(null);
      mockSimilarPathRule.apply.resolves(null);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(mockPublishRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockLocaleFallbackRule.apply).to.not.have.been.called;
      expect(mockSimilarPathRule.apply).to.not.have.been.called;
      expect(result).to.equal(suggestion);
    });

    it('should try all rules until one succeeds', async () => {
      const brokenPath = TEST_PATH_BROKEN;
      const suggestion = { type: SUGGESTION_TYPE_LOCALE, requestedPath: brokenPath };

      mockPublishRule.apply.resolves(null);
      mockLocaleFallbackRule.apply.resolves(suggestion);
      mockSimilarPathRule.apply.resolves(null);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(mockPublishRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockLocaleFallbackRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockSimilarPathRule.apply).to.not.have.been.called;
      expect(result).to.equal(suggestion);
    });

    it('should return notFound suggestion when no rules succeed', async () => {
      const brokenPath = TEST_PATH_BROKEN;
      const notFoundSuggestion = { type: SUGGESTION_TYPE_NOT_FOUND, requestedPath: brokenPath };

      mockPublishRule.apply.resolves(null);
      mockLocaleFallbackRule.apply.resolves(null);
      mockSimilarPathRule.apply.resolves(null);
      mockSuggestion.notFound.returns(notFoundSuggestion);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(mockPublishRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockLocaleFallbackRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockSimilarPathRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockSuggestion.notFound).to.have.been.calledWith(brokenPath);
      expect(result).to.equal(notFoundSuggestion);
    });

    it('should handle rule errors and continue to next rule', async () => {
      const brokenPath = TEST_PATH_BROKEN;
      const suggestion = { type: SUGGESTION_TYPE_SIMILAR, requestedPath: brokenPath };

      mockPublishRule.apply.rejects(new Error('Publish rule failed'));
      mockLocaleFallbackRule.apply.rejects(new Error('Locale rule failed'));
      mockSimilarPathRule.apply.resolves(suggestion);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(mockPublishRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockLocaleFallbackRule.apply).to.have.been.calledWith(brokenPath);
      expect(mockSimilarPathRule.apply).to.have.been.calledWith(brokenPath);
      expect(context.log.error).to.have.been.calledTwice;
      expect(result).to.equal(suggestion);
    });

    it('should return notFound when all rules fail with errors', async () => {
      const brokenPath = TEST_PATH_BROKEN;
      const notFoundSuggestion = { type: SUGGESTION_TYPE_NOT_FOUND, requestedPath: brokenPath };

      mockPublishRule.apply.rejects(new Error('Publish rule failed'));
      mockLocaleFallbackRule.apply.rejects(new Error('Locale rule failed'));
      mockSimilarPathRule.apply.rejects(new Error('Similar rule failed'));
      mockSuggestion.notFound.returns(notFoundSuggestion);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.analyzePath(brokenPath);

      expect(context.log.error).to.have.been.calledThrice;
      expect(result).to.equal(notFoundSuggestion);
    });

    it('should log rule application success', async () => {
      const brokenPath = TEST_PATH_BROKEN;
      const suggestion = { type: SUGGESTION_TYPE_PUBLISH, requestedPath: brokenPath };

      mockPublishRule.apply.resolves(suggestion);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      await strategy.analyzePath(brokenPath);

    });
  });

  describe('processSuggestions method', () => {
    it('should pass through PUBLISH and NOT_FOUND suggestions unchanged', async () => {
      const suggestions = [
        { type: SUGGESTION_TYPE_PUBLISH, requestedPath: TEST_PATH_BROKEN_1, suggestedPath: TEST_PATH_FIXED_1 },
        { type: SUGGESTION_TYPE_NOT_FOUND, requestedPath: TEST_PATH_BROKEN_2, suggestedPath: null },
      ];

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(result).to.deep.equal(suggestions);
      expect(mockPathIndex.find).to.not.have.been.called;
    });

    it('should process LOCALE suggestions with published content', async () => {
      const suggestions = [
        { type: SUGGESTION_TYPE_LOCALE, requestedPath: TEST_PATH_BROKEN, suggestedPath: TEST_PATH_SUGGESTED },
      ];

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: STATUS_PUBLISHED,
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(mockPathIndex.find).to.have.been.calledWith(TEST_PATH_SUGGESTED);
      expect(result).to.deep.equal(suggestions);
    });

    it('should process SIMILAR suggestions with published content', async () => {
      const suggestions = [
        { type: SUGGESTION_TYPE_SIMILAR, requestedPath: TEST_PATH_BROKEN, suggestedPath: TEST_PATH_SUGGESTED },
      ];

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: STATUS_PUBLISHED,
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(result).to.deep.equal(suggestions);
    });

    it('should update reason for unpublished content', async () => {
      const suggestions = [
        { type: SUGGESTION_TYPE_LOCALE, requestedPath: TEST_PATH_BROKEN, suggestedPath: TEST_PATH_SUGGESTED },
      ];

      const contentPath = {
        isPublished: sandbox.stub().returns(false),
        status: STATUS_DRAFT,
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(result).to.have.lengthOf(EXPECTED_SUGGESTIONS_COUNT_1);
      expect(result[0].reason).to.equal(`Content is in ${STATUS_DRAFT} state. Suggest publishing.`);
    });

    it('should handle empty suggestions array', async () => {
      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.processSuggestions([]);

      expect(result).to.deep.equal([]);
    });

    it('should handle mixed suggestion types', async () => {
      const suggestions = [
        { type: SUGGESTION_TYPE_PUBLISH, requestedPath: TEST_PATH_BROKEN_1, suggestedPath: TEST_PATH_FIXED_1 },
        { type: SUGGESTION_TYPE_LOCALE, requestedPath: TEST_PATH_BROKEN_2, suggestedPath: TEST_PATH_SUGGESTED_2 },
        { type: SUGGESTION_TYPE_NOT_FOUND, requestedPath: TEST_PATH_BROKEN_3, suggestedPath: null },
      ];

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: STATUS_PUBLISHED,
      };
      mockPathIndex.find.onCall(EXPECTED_EMPTY_COUNT).returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.processSuggestions(suggestions);

      expect(result).to.have.lengthOf(EXPECTED_SUGGESTIONS_COUNT_3);
      expect(result[0]).to.equal(suggestions[0]); // PUBLISH unchanged
      expect(result[1]).to.equal(suggestions[1]); // LOCALE processed but unchanged (published)
      expect(result[2]).to.equal(suggestions[2]); // NOT_FOUND unchanged
    });
  });

  describe('integration scenarios', () => {
    it('should work end-to-end with successful rule application', async () => {
      const brokenPaths = [TEST_PATH_BROKEN_NO_EXT];
      const suggestion = {
        type: SUGGESTION_TYPE_LOCALE,
        requestedPath: TEST_PATH_BROKEN_NO_EXT,
        suggestedPath: TEST_PATH_SUGGESTED,
      };

      mockLocaleFallbackRule.apply.resolves(suggestion);

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: STATUS_PUBLISHED,
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.analyze(brokenPaths);

      expect(result).to.have.lengthOf(EXPECTED_SUGGESTIONS_COUNT_1);
      expect(result[0]).to.equal(suggestion);
    });

    it('should handle no successful rules scenario', async () => {
      const brokenPaths = [TEST_PATH_BROKEN];
      const notFoundSuggestion = {
        type: SUGGESTION_TYPE_NOT_FOUND,
        requestedPath: TEST_PATH_BROKEN,
        suggestedPath: null,
      };

      mockPublishRule.apply.resolves(null);
      mockLocaleFallbackRule.apply.resolves(null);
      mockSimilarPathRule.apply.resolves(null);
      mockSuggestion.notFound.returns(notFoundSuggestion);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.analyze(brokenPaths);

      expect(result).to.have.lengthOf(EXPECTED_SUGGESTIONS_COUNT_1);
      expect(result[0]).to.equal(notFoundSuggestion);
    });

    it('should handle multiple paths with different outcomes', async () => {
      const brokenPaths = [
        TEST_PATH_BROKEN_1,
        TEST_PATH_BROKEN_2,
        TEST_PATH_BROKEN_3,
      ];

      const suggestion1 = { type: SUGGESTION_TYPE_PUBLISH, requestedPath: TEST_PATH_BROKEN_1 };
      const suggestion2 = { type: SUGGESTION_TYPE_LOCALE, requestedPath: TEST_PATH_BROKEN_2, suggestedPath: TEST_PATH_SUGGESTED_2 };
      const notFoundSuggestion = { type: SUGGESTION_TYPE_NOT_FOUND, requestedPath: TEST_PATH_BROKEN_3 };

      // Setup rule responses for different paths
      mockPublishRule.apply.onCall(EXPECTED_EMPTY_COUNT).resolves(suggestion1);
      mockPublishRule.apply.onCall(EXPECTED_SUGGESTIONS_COUNT_1).resolves(null);
      mockPublishRule.apply.onCall(PRIORITY_MEDIUM).resolves(null);

      mockLocaleFallbackRule.apply.onCall(EXPECTED_EMPTY_COUNT).resolves(suggestion2);
      mockLocaleFallbackRule.apply.onCall(EXPECTED_SUGGESTIONS_COUNT_1).resolves(null);

      mockSimilarPathRule.apply.resolves(null);
      mockSuggestion.notFound.returns(notFoundSuggestion);

      const contentPath = {
        isPublished: sandbox.stub().returns(true),
        status: STATUS_PUBLISHED,
      };
      mockPathIndex.find.returns(contentPath);

      const strategy = new AnalysisStrategy(context, mockAemClient, mockPathIndex);
      const result = await strategy.analyze(brokenPaths);

      expect(result).to.have.lengthOf(EXPECTED_SUGGESTIONS_COUNT_3);
      expect(result[0]).to.equal(suggestion1);
      expect(result[1]).to.equal(suggestion2);
      expect(result[2]).to.equal(notFoundSuggestion);
    });
  });
});
