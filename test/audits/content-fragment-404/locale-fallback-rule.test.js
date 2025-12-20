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
import {
  TEST_PATH_BROKEN,
  TEST_PATH_EN_US,
  TEST_PATH_EN_GB,
  TEST_PATH_FR_FR,
  TEST_PATH_BROKEN_WITH_DOUBLE_SLASHES,
  ERROR_AEM_CONNECTION_FAILED,
  LOCALE_FALLBACK_RULE_PRIORITY,
} from './test-constants.js';

use(sinonChai);
use(chaiAsPromised);

describe('LocaleFallbackRule', () => {
  let sandbox;
  let context;
  let mockAemClient;
  let mockSuggestion;
  let mockLocale;
  let mockPathUtils;
  let mockLanguageTree;
  let LocaleFallbackRule;

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

    mockAemClient = {
      isAvailable: sandbox.stub().resolves(false),
    };

    mockSuggestion = {
      type: 'locale',
      originalPath: TEST_PATH_FR_FR,
      suggestedPath: TEST_PATH_EN_US,
    };

    mockLocale = {
      getCode: sandbox.stub().returns('fr-fr'),
      replaceInPath: sandbox.stub().returns(TEST_PATH_EN_US),
    };

    mockPathUtils = {
      hasDoubleSlashes: sandbox.stub().returns(false),
    };

    mockLanguageTree = {
      findSimilarLanguageRoots: sandbox.stub().returns(['en-us', 'en-gb']),
      findEnglishFallbacks: sandbox.stub().returns(['en-us', 'en-gb', 'en']),
    };

    const module = await esmock('../../../src/content-fragment-404/rules/locale-fallback-rule.js', {
      '../../../src/content-fragment-404/domain/suggestion/suggestion.js': {
        Suggestion: {
          locale: sandbox.stub().returns(mockSuggestion),
        },
      },
      '../../../src/content-fragment-404/domain/language/locale.js': {
        Locale: {
          fromPath: sandbox.stub().returns(mockLocale),
        },
      },
      '../../../src/content-fragment-404/domain/language/language-tree.js': {
        LanguageTree: mockLanguageTree,
      },
      '../../../src/content-fragment-404/utils/path-utils.js': {
        PathUtils: mockPathUtils,
      },
    });

    LocaleFallbackRule = module.LocaleFallbackRule;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should initialize with second priority (2)', () => {
      const rule = new LocaleFallbackRule(context, mockAemClient);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(LOCALE_FALLBACK_RULE_PRIORITY);
      expect(rule.aemClient).to.equal(mockAemClient);
    });

    it('should extend BaseRule', () => {
      const rule = new LocaleFallbackRule(context, mockAemClient);

      expect(rule.getPriority).to.be.a('function');
      expect(rule.getAemClient).to.be.a('function');
      expect(rule.apply).to.be.a('function');
    });
  });

  describe('applyRule with detected locale', () => {
    it('should return locale suggestion when fallback is available', async () => {
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us', 'en-gb']);
      mockAemClient.isAvailable.onFirstCall().resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_FR_FR;

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should try multiple fallback locales until one is found', async () => {
      // Locale.fromPath is already mocked in esmock
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us', 'en-gb', 'en']);
      mockLocale.replaceInPath.onCall(0).returns(TEST_PATH_EN_US);
      mockLocale.replaceInPath.onCall(1).returns(TEST_PATH_EN_GB);
      mockAemClient.isAvailable.onCall(0).resolves(false);
      mockAemClient.isAvailable.onCall(1).resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_FR_FR;

      const result = await rule.applyRule(brokenPath);

      expect(mockAemClient.isAvailable).to.have.been.calledTwice;
      expect(result).to.equal(mockSuggestion);
    });

    it('should return null when no fallback locales are available', async () => {
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us', 'en-gb']);
      mockAemClient.isAvailable.resolves(false);

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_FR_FR;

      const result = await rule.applyRule(brokenPath);

      expect(mockAemClient.isAvailable).to.have.been.calledTwice;
      expect(result).to.be.null;
    });

    it('should return null when no similar language roots found', async () => {
      // Locale.fromPath is already mocked in esmock
      mockLanguageTree.findSimilarLanguageRoots.returns([]);

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_FR_FR;

      const result = await rule.applyRule(brokenPath);

      expect(mockAemClient.isAvailable).not.to.have.been.called;
      expect(result).to.be.null;
    });
  });

  describe('applyRule without detected locale', () => {
    it('should return null when no locale detected and no double slashes', async () => {
      // Create a rule with mocked dependencies that return null for Locale.fromPath
      const ruleModule = await esmock('../../../src/content-fragment-404/rules/locale-fallback-rule.js', {
        '../../../src/content-fragment-404/domain/language/locale.js': {
          Locale: {
            fromPath: sandbox.stub().returns(null), // Return null to trigger the uncovered lines
          },
        },
        '../../../src/content-fragment-404/utils/path-utils.js': {
          PathUtils: {
            hasDoubleSlashes: sandbox.stub().returns(false), // No double slashes
          },
        },
      });

      const rule = new ruleModule.LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });

    it('should try locale insertion when double slashes detected', async () => {
      // Create a rule with mocked dependencies that return null for Locale.fromPath
      const ruleModule = await esmock('../../../src/content-fragment-404/rules/locale-fallback-rule.js', {
        '../../../src/content-fragment-404/domain/suggestion/suggestion.js': {
          Suggestion: {
            locale: sandbox.stub().returns(mockSuggestion),
          },
        },
        '../../../src/content-fragment-404/domain/language/locale.js': {
          Locale: {
            fromPath: sandbox.stub().returns(null), // Return null for this test
          },
        },
        '../../../src/content-fragment-404/domain/language/language-tree.js': {
          LanguageTree: {
            findEnglishFallbacks: sandbox.stub().returns(['en-us', 'en-gb']),
          },
        },
        '../../../src/content-fragment-404/utils/path-utils.js': {
          PathUtils: {
            hasDoubleSlashes: sandbox.stub().returns(true),
          },
        },
      });

      mockAemClient.isAvailable.onFirstCall().resolves(true);

      const rule = new ruleModule.LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(TEST_PATH_BROKEN_WITH_DOUBLE_SLASHES);

      expect(result).to.equal(mockSuggestion);
    });

    it('should try multiple English fallbacks for locale insertion', async () => {
      // Create a rule with mocked dependencies that return null for Locale.fromPath
      const ruleModule = await esmock('../../../src/content-fragment-404/rules/locale-fallback-rule.js', {
        '../../../src/content-fragment-404/domain/suggestion/suggestion.js': {
          Suggestion: {
            locale: sandbox.stub().returns(mockSuggestion),
          },
        },
        '../../../src/content-fragment-404/domain/language/locale.js': {
          Locale: {
            fromPath: sandbox.stub().returns(null), // Return null for this test
          },
        },
        '../../../src/content-fragment-404/domain/language/language-tree.js': {
          LanguageTree: {
            findEnglishFallbacks: sandbox.stub().returns(['en-us', 'en-gb', 'en']),
          },
        },
        '../../../src/content-fragment-404/utils/path-utils.js': {
          PathUtils: {
            hasDoubleSlashes: sandbox.stub().returns(true),
          },
        },
      });

      mockAemClient.isAvailable.onCall(0).resolves(false);
      mockAemClient.isAvailable.onCall(1).resolves(true);

      const rule = new ruleModule.LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(brokenPath);

      expect(mockAemClient.isAvailable).to.have.been.calledTwice;
      expect(result).to.equal(mockSuggestion);
    });

    it('should return null when no English fallbacks work for locale insertion', async () => {
      // Locale.fromPath is already mocked in esmock to return null
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockLanguageTree.findEnglishFallbacks.returns(['en-us', 'en-gb']);
      mockAemClient.isAvailable.resolves(false);

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(brokenPath);

      expect(mockAemClient.isAvailable).to.have.been.calledTwice;
      expect(result).to.be.null;
    });
  });

  describe('tryLocaleInsertion', () => {
    it('should replace double slashes with locale codes', async () => {
      mockLanguageTree.findEnglishFallbacks.returns(['en-us']);
      mockAemClient.isAvailable.resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = '/content/dam//assets/image.jpg';

      const result = await rule.tryLocaleInsertion(brokenPath);

      expect(mockAemClient.isAvailable).to.have.been.calledWith('/content/dam/en-us/assets/image.jpg');
      expect(result).to.equal(mockSuggestion);
    });

    it('should handle multiple double slashes by replacing only the first', async () => {
      mockLanguageTree.findEnglishFallbacks.returns(['en-us']);
      mockAemClient.isAvailable.resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = '/content/dam//assets//image.jpg';

      const result = await rule.tryLocaleInsertion(brokenPath);

      expect(mockAemClient.isAvailable).to.have.been.calledWith('/content/dam/en-us/assets//image.jpg');
      expect(result).to.equal(mockSuggestion);
    });

    it('should return null when no English fallbacks are available', async () => {
      mockLanguageTree.findEnglishFallbacks.returns([]);

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_BROKEN_WITH_DOUBLE_SLASHES;

      const result = await rule.tryLocaleInsertion(brokenPath);

      expect(mockAemClient.isAvailable).not.to.have.been.called;
      expect(result).to.be.null;
    });
  });

  describe('error handling', () => {
    it('should handle AEM client errors during locale fallback', async () => {
      // Locale.fromPath is already mocked in esmock
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us']);
      mockAemClient.isAvailable.rejects(new Error(ERROR_AEM_CONNECTION_FAILED));

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_FR_FR;

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith(ERROR_AEM_CONNECTION_FAILED);
    });

    it('should handle AEM client errors during locale insertion', async () => {
      // Locale.fromPath is already mocked in esmock to return null
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockLanguageTree.findEnglishFallbacks.returns(['en-us']);
      mockAemClient.isAvailable.rejects(new Error(ERROR_AEM_CONNECTION_FAILED));

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_BROKEN_WITH_DOUBLE_SLASHES;

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith(ERROR_AEM_CONNECTION_FAILED);
    });

    it('should throw error when AEM client not available', async () => {
      const rule = new LocaleFallbackRule(context, null);
      const brokenPath = TEST_PATH_FR_FR;

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AemClient not injected');
    });
  });

  describe('integration scenarios', () => {
    it('should work through apply method', async () => {
      // Locale.fromPath is already mocked in esmock
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us']);
      mockAemClient.isAvailable.resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = TEST_PATH_FR_FR;

      const result = await rule.apply(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should return correct priority', () => {
      const rule = new LocaleFallbackRule(context, mockAemClient);

      expect(rule.getPriority()).to.equal(LOCALE_FALLBACK_RULE_PRIORITY);
    });

    it('should handle edge cases with empty paths', async () => {
      // Locale.fromPath is already mocked in esmock to return null

      const rule = new LocaleFallbackRule(context, mockAemClient);
      const brokenPath = '';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });
  });
});
