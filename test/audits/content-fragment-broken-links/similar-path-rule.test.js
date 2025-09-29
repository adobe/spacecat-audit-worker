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

describe('SimilarPathRule', () => {
  let sandbox;
  let context;
  let mockAemAuthorClient;
  let mockPathIndex;
  let mockSuggestion;
  let mockPathUtils;
  let mockLevenshteinDistance;
  let SimilarPathRule;

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
      getChildrenFromPath: sandbox.stub().resolves([]),
    };

    mockPathIndex = {
      find: sandbox.stub().returns(null),
      contains: sandbox.stub().returns(false),
    };

    mockSuggestion = {
      type: 'similar',
      originalPath: '/content/dam/test/broken.jpg',
      suggestedPath: '/content/dam/test/fixed.jpg',
    };

    mockPathUtils = {
      getParentPath: sandbox.stub().returns('/content/dam/test'),
      hasDoubleSlashes: sandbox.stub().returns(false),
      removeDoubleSlashes: sandbox.stub().returns('/content/dam/test/fixed.jpg'),
      removeLocaleFromPath: sandbox.stub().callsFake((path) => path),
    };

    mockLevenshteinDistance = {
      calculate: sandbox.stub().returns(1),
    };

    const module = await esmock('../../../src/content-fragment-broken-links/rules/similar-path-rule.js', {
      '../../../src/content-fragment-broken-links/domain/suggestion/suggestion.js': {
        Suggestion: {
          similar: sandbox.stub().returns(mockSuggestion),
        },
      },
      '../../../src/content-fragment-broken-links/utils/levenshtein-distance.js': {
        LevenshteinDistance: mockLevenshteinDistance,
      },
      '../../../src/content-fragment-broken-links/utils/path-utils.js': {
        PathUtils: mockPathUtils,
      },
    });

    SimilarPathRule = module.SimilarPathRule;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should initialize with third priority (3) and path index', () => {
      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(3);
      expect(rule.aemAuthorClient).to.equal(mockAemAuthorClient);
      expect(rule.pathIndex).to.equal(mockPathIndex);
    });

    it('should extend BaseRule', () => {
      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);

      expect(rule.getPriority).to.be.a('function');
      expect(rule.getAemAuthorClient).to.be.a('function');
      expect(rule.apply).to.be.a('function');
    });
  });

  describe('applyRule main flow', () => {
    it('should return similar path suggestion when found', async () => {
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemAuthorClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/similar.jpg' },
        { path: '/content/dam/test/other.pdf' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(1);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(mockAemAuthorClient.getChildrenFromPath).to.have.been.calledWith('/content/dam/test');
      expect(result).to.equal(mockSuggestion);
    });

    it('should return null when no parent path found', async () => {
      mockPathUtils.getParentPath.returns(null);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });

    it('should return null when no children paths found', async () => {
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemAuthorClient.getChildrenFromPath.resolves([]);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });

    it('should return null when no similar paths within distance threshold', async () => {
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemAuthorClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/completely-different.jpg' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(10); // Distance too high

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });
  });

  describe('applyRule with double slash handling', () => {
    it('should return suggestion when double slash can be fixed directly', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns('/content/dam/test/fixed.jpg');
      mockAemAuthorClient.isAvailable.resolves(true);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam//test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should continue with similarity check when double slash fix not available', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns('/content/dam/test/fixed.jpg');
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemAuthorClient.isAvailable.resolves(false);
      mockAemAuthorClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/similar.jpg' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(1);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam//test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should handle paths without double slashes normally', async () => {
      mockPathUtils.hasDoubleSlashes.returns(false);
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemAuthorClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/similar.jpg' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(1);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });
  });

  describe('checkDoubleSlash', () => {
    it('should return null when no double slashes present', async () => {
      mockPathUtils.hasDoubleSlashes.returns(false);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.checkDoubleSlash(brokenPath);

      expect(result).to.be.null;
    });

    it('should return suggestion when fixed path is available', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns('/content/dam/test/fixed.jpg');
      mockAemAuthorClient.isAvailable.resolves(true);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam//test/broken.jpg';

      const result = await rule.checkDoubleSlash(brokenPath);

      expect(result.suggestion).to.equal(mockSuggestion);
      expect(result.fixedPath).to.equal('/content/dam/test/fixed.jpg');
    });

    it('should return fixed path without suggestion when not available', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns('/content/dam/test/fixed.jpg');
      mockAemAuthorClient.isAvailable.resolves(false);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam//test/broken.jpg';

      const result = await rule.checkDoubleSlash(brokenPath);

      expect(result.suggestion).to.be.null;
      expect(result.fixedPath).to.equal('/content/dam/test/fixed.jpg');
    });
  });

  describe('findSimilarPath static method', () => {
    it('should find best match within distance threshold', () => {
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.onCall(0).returns(2);
      mockLevenshteinDistance.calculate.onCall(1).returns(1);
      mockLevenshteinDistance.calculate.onCall(2).returns(3);

      const candidatePaths = [
        { path: '/content/dam/test/far.jpg' },
        { path: '/content/dam/test/close.jpg' },
        { path: '/content/dam/test/very-far.jpg' },
      ];

      const result = SimilarPathRule.findSimilarPath('/content/dam/test/broken.jpg', candidatePaths, 1);

      expect(result).to.equal(candidatePaths[1]);
    });

    it('should return null when no matches within threshold', () => {
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(5);

      const candidatePaths = [
        { path: '/content/dam/test/far.jpg' },
      ];

      const result = SimilarPathRule.findSimilarPath('/content/dam/test/broken.jpg', candidatePaths, 1);

      expect(result).to.be.null;
    });

    it('should handle empty candidate paths', () => {
      const result = SimilarPathRule.findSimilarPath('/content/dam/test/broken.jpg', [], 1);

      expect(result).to.be.null;
    });

    it('should compare paths without locale information', () => {
      mockPathUtils.removeLocaleFromPath.onCall(0).returns('/content/dam/test/broken.jpg');
      mockPathUtils.removeLocaleFromPath.onCall(1).returns('/content/dam/test/similar.jpg');
      mockLevenshteinDistance.calculate.returns(1);

      const candidatePaths = [
        { path: '/content/dam/en-us/test/similar.jpg' },
      ];

      const result = SimilarPathRule.findSimilarPath('/content/dam/fr-fr/test/broken.jpg', candidatePaths, 1);

      expect(mockPathUtils.removeLocaleFromPath).to.have.been.calledWith('/content/dam/fr-fr/test/broken.jpg');
      expect(mockPathUtils.removeLocaleFromPath).to.have.been.calledWith('/content/dam/en-us/test/similar.jpg');
      expect(result).to.equal(candidatePaths[0]);
    });

    it('should find closest match when multiple candidates within threshold', () => {
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.onCall(0).returns(1);
      mockLevenshteinDistance.calculate.onCall(1).returns(0); // Perfect match
      mockLevenshteinDistance.calculate.onCall(2).returns(1);

      const candidatePaths = [
        { path: '/content/dam/test/close1.jpg' },
        { path: '/content/dam/test/broken.jpg' }, // Exact match
        { path: '/content/dam/test/close2.jpg' },
      ];

      const result = SimilarPathRule.findSimilarPath('/content/dam/test/broken.jpg', candidatePaths, 1);

      expect(result).to.equal(candidatePaths[1]);
    });
  });

  describe('error handling', () => {
    it('should handle AEM client errors during children fetch', async () => {
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemAuthorClient.getChildrenFromPath.rejects(new Error('AEM connection failed'));

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam/test/broken.jpg';

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AEM connection failed');
    });

    it('should handle AEM client errors during double slash check', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns('/content/dam/test/fixed.jpg');
      mockAemAuthorClient.isAvailable.rejects(new Error('AEM connection failed'));

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam//test/broken.jpg';

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AEM connection failed');
    });

    it('should throw error when AEM client not available', async () => {
      const rule = new SimilarPathRule(context, null, mockPathIndex);
      const brokenPath = '/content/dam/test/broken.jpg';

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AemAuthorClient not injected');
    });
  });

  describe('integration scenarios', () => {
    it('should work through apply method', async () => {
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemAuthorClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/similar.jpg' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(1);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.apply(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should return correct priority', () => {
      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);

      expect(rule.getPriority()).to.equal(3);
    });

    it('should handle complex similarity scenarios', async () => {
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemAuthorClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/image1.jpg' },
        { path: '/content/dam/test/image2.png' },
        { path: '/content/dam/test/document.pdf' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.onCall(0).returns(3);
      mockLevenshteinDistance.calculate.onCall(1).returns(1);
      mockLevenshteinDistance.calculate.onCall(2).returns(5);

      const rule = new SimilarPathRule(context, mockAemAuthorClient, mockPathIndex);
      const brokenPath = '/content/dam/test/image3.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });
  });
});
