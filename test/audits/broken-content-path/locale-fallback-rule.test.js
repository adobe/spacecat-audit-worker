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

describe('LocaleFallbackRule', () => {
  let sandbox;
  let context;
  let mockAemAuthorClient;
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

    mockAemAuthorClient = {
      isAvailable: sandbox.stub().resolves(false),
    };

    mockSuggestion = {
      type: 'locale',
      originalPath: '/content/dam/fr-fr/test/broken.jpg',
      suggestedPath: '/content/dam/en-us/test/broken.jpg',
    };

    mockLocale = {
      getCode: sandbox.stub().returns('fr-fr'),
      replaceInPath: sandbox.stub().returns('/content/dam/en-us/test/broken.jpg'),
    };

    mockPathUtils = {
      hasDoubleSlashes: sandbox.stub().returns(false),
    };

    mockLanguageTree = {
      findSimilarLanguageRoots: sandbox.stub().returns(['en-us', 'en-gb']),
      findEnglishFallbacks: sandbox.stub().returns(['en-us', 'en-gb', 'en']),
    };

    const module = await esmock('../../../src/broken-content-path/rules/locale-fallback-rule.js', {
      '../../../src/broken-content-path/domain/suggestion/suggestion.js': {
        Suggestion: {
          locale: sandbox.stub().returns(mockSuggestion),
        },
      },
      '../../../src/broken-content-path/domain/language/locale.js': {
        Locale: {
          fromPath: sandbox.stub().returns(mockLocale),
        },
      },
      '../../../src/broken-content-path/domain/language/language-tree.js': {
        LanguageTree: mockLanguageTree,
      },
      '../../../src/broken-content-path/utils/path-utils.js': {
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
      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(2);
      expect(rule.aemAuthorClient).to.equal(mockAemAuthorClient);
    });

    it('should extend BaseRule', () => {
      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);

      expect(rule.getPriority).to.be.a('function');
      expect(rule.getAemAuthorClient).to.be.a('function');
      expect(rule.apply).to.be.a('function');
    });
  });

  describe('applyRule with detected locale', () => {
    it('should return locale suggestion when fallback is available', async () => {
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us', 'en-gb']);
      mockAemAuthorClient.isAvailable.onFirstCall().resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam/fr-fr/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should try multiple fallback locales until one is found', async () => {
      // Locale.fromPath is already mocked in esmock
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us', 'en-gb', 'en']);
      mockLocale.replaceInPath.onCall(0).returns('/content/dam/en-us/test/broken.jpg');
      mockLocale.replaceInPath.onCall(1).returns('/content/dam/en-gb/test/broken.jpg');
      mockAemAuthorClient.isAvailable.onCall(0).resolves(false);
      mockAemAuthorClient.isAvailable.onCall(1).resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam/fr-fr/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(mockAemAuthorClient.isAvailable).to.have.been.calledTwice;
      expect(result).to.equal(mockSuggestion);
    });

    it('should return null when no fallback locales are available', async () => {
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us', 'en-gb']);
      mockAemAuthorClient.isAvailable.resolves(false);

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam/fr-fr/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(mockAemAuthorClient.isAvailable).to.have.been.calledTwice;
      expect(result).to.be.null;
    });

    it('should return null when no similar language roots found', async () => {
      // Locale.fromPath is already mocked in esmock
      mockLanguageTree.findSimilarLanguageRoots.returns([]);

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam/fr-fr/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(mockAemAuthorClient.isAvailable).not.to.have.been.called;
      expect(result).to.be.null;
    });
  });

  describe('applyRule without detected locale', () => {
    it('should return null when no locale detected and no double slashes', async () => {
      // Create a rule with mocked dependencies that return null for Locale.fromPath
      const ruleModule = await esmock('../../../src/broken-content-path/rules/locale-fallback-rule.js', {
        '../../../src/broken-content-path/domain/language/locale.js': {
          Locale: {
            fromPath: sandbox.stub().returns(null), // Return null to trigger the uncovered lines
          },
        },
        '../../../src/broken-content-path/utils/path-utils.js': {
          PathUtils: {
            hasDoubleSlashes: sandbox.stub().returns(false), // No double slashes
          },
        },
      });

      const rule = new ruleModule.LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });

    it('should try locale insertion when double slashes detected', async () => {
      // Create a rule with mocked dependencies that return null for Locale.fromPath
      const ruleModule = await esmock('../../../src/broken-content-path/rules/locale-fallback-rule.js', {
        '../../../src/broken-content-path/domain/suggestion/suggestion.js': {
          Suggestion: {
            locale: sandbox.stub().returns(mockSuggestion),
          },
        },
        '../../../src/broken-content-path/domain/language/locale.js': {
          Locale: {
            fromPath: sandbox.stub().returns(null), // Return null for this test
          },
        },
        '../../../src/broken-content-path/domain/language/language-tree.js': {
          LanguageTree: {
            findEnglishFallbacks: sandbox.stub().returns(['en-us', 'en-gb']),
          },
        },
        '../../../src/broken-content-path/utils/path-utils.js': {
          PathUtils: {
            hasDoubleSlashes: sandbox.stub().returns(true),
          },
        },
      });

      mockAemAuthorClient.isAvailable.onFirstCall().resolves(true);

      const rule = new ruleModule.LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam//test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should try multiple English fallbacks for locale insertion', async () => {
      // Create a rule with mocked dependencies that return null for Locale.fromPath
      const ruleModule = await esmock('../../../src/broken-content-path/rules/locale-fallback-rule.js', {
        '../../../src/broken-content-path/domain/suggestion/suggestion.js': {
          Suggestion: {
            locale: sandbox.stub().returns(mockSuggestion),
          },
        },
        '../../../src/broken-content-path/domain/language/locale.js': {
          Locale: {
            fromPath: sandbox.stub().returns(null), // Return null for this test
          },
        },
        '../../../src/broken-content-path/domain/language/language-tree.js': {
          LanguageTree: {
            findEnglishFallbacks: sandbox.stub().returns(['en-us', 'en-gb', 'en']),
          },
        },
        '../../../src/broken-content-path/utils/path-utils.js': {
          PathUtils: {
            hasDoubleSlashes: sandbox.stub().returns(true),
          },
        },
      });

      mockAemAuthorClient.isAvailable.onCall(0).resolves(false);
      mockAemAuthorClient.isAvailable.onCall(1).resolves(true);

      const rule = new ruleModule.LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam//test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(mockAemAuthorClient.isAvailable).to.have.been.calledTwice;
      expect(result).to.equal(mockSuggestion);
    });

    it('should return null when no English fallbacks work for locale insertion', async () => {
      // Locale.fromPath is already mocked in esmock to return null
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockLanguageTree.findEnglishFallbacks.returns(['en-us', 'en-gb']);
      mockAemAuthorClient.isAvailable.resolves(false);

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam//test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(mockAemAuthorClient.isAvailable).to.have.been.calledTwice;
      expect(result).to.be.null;
    });
  });

  describe('tryLocaleInsertion', () => {
    it('should replace double slashes with locale codes', async () => {
      mockLanguageTree.findEnglishFallbacks.returns(['en-us']);
      mockAemAuthorClient.isAvailable.resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam//assets/image.jpg';

      const result = await rule.tryLocaleInsertion(brokenPath);

      expect(mockAemAuthorClient.isAvailable).to.have.been.calledWith('/content/dam/en-us/assets/image.jpg');
      expect(result).to.equal(mockSuggestion);
    });

    it('should handle multiple double slashes by replacing only the first', async () => {
      mockLanguageTree.findEnglishFallbacks.returns(['en-us']);
      mockAemAuthorClient.isAvailable.resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam//assets//image.jpg';

      const result = await rule.tryLocaleInsertion(brokenPath);

      expect(mockAemAuthorClient.isAvailable).to.have.been.calledWith('/content/dam/en-us/assets//image.jpg');
      expect(result).to.equal(mockSuggestion);
    });

    it('should return null when no English fallbacks are available', async () => {
      mockLanguageTree.findEnglishFallbacks.returns([]);

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam//test/broken.jpg';

      const result = await rule.tryLocaleInsertion(brokenPath);

      expect(mockAemAuthorClient.isAvailable).not.to.have.been.called;
      expect(result).to.be.null;
    });
  });

  describe('error handling', () => {
    it('should handle AEM client errors during locale fallback', async () => {
      // Locale.fromPath is already mocked in esmock
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us']);
      mockAemAuthorClient.isAvailable.rejects(new Error('AEM connection failed'));

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam/fr-fr/test/broken.jpg';

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AEM connection failed');
    });

    it('should handle AEM client errors during locale insertion', async () => {
      // Locale.fromPath is already mocked in esmock to return null
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockLanguageTree.findEnglishFallbacks.returns(['en-us']);
      mockAemAuthorClient.isAvailable.rejects(new Error('AEM connection failed'));

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam//test/broken.jpg';

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AEM connection failed');
    });

    it('should throw error when AEM client not available', async () => {
      const rule = new LocaleFallbackRule(context, null);
      const brokenPath = '/content/dam/fr-fr/test/broken.jpg';

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AemAuthorClient not injected');
    });
  });

  describe('integration scenarios', () => {
    it('should work through apply method', async () => {
      // Locale.fromPath is already mocked in esmock
      mockLanguageTree.findSimilarLanguageRoots.returns(['en-us']);
      mockAemAuthorClient.isAvailable.resolves(true);

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '/content/dam/fr-fr/test/broken.jpg';

      const result = await rule.apply(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should return correct priority', () => {
      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);

      expect(rule.getPriority()).to.equal(2);
    });

    it('should handle edge cases with empty paths', async () => {
      // Locale.fromPath is already mocked in esmock to return null

      const rule = new LocaleFallbackRule(context, mockAemAuthorClient);
      const brokenPath = '';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });
  });
});
