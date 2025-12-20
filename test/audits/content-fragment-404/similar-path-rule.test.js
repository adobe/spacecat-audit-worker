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
  TEST_PATH_PARENT,
  TEST_PATH_FIXED,
  TEST_PATH_BROKEN_WITH_DOUBLE_SLASHES,
  ERROR_AEM_CONNECTION_FAILED,
  SIMILAR_PATH_RULE_PRIORITY,
  MAX_LEVENSHTEIN_DISTANCE,
} from './test-constants.js';

use(sinonChai);
use(chaiAsPromised);

describe('SimilarPathRule', () => {
  let sandbox;
  let context;
  let mockAemClient;
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

    mockAemClient = {
      isAvailable: sandbox.stub().resolves(false),
      getChildrenFromPath: sandbox.stub().resolves([]),
    };

    mockPathIndex = {
      find: sandbox.stub().returns(null),
      contains: sandbox.stub().returns(false),
    };

    mockSuggestion = {
      type: 'similar',
      originalPath: TEST_PATH_BROKEN,
      suggestedPath: TEST_PATH_FIXED,
    };

    mockPathUtils = {
      getParentPath: sandbox.stub().returns(TEST_PATH_PARENT),
      hasDoubleSlashes: sandbox.stub().returns(false),
      removeDoubleSlashes: sandbox.stub().returns(TEST_PATH_FIXED),
      removeLocaleFromPath: sandbox.stub().callsFake((path) => path),
    };

    mockLevenshteinDistance = {
      calculate: sandbox.stub().returns(MAX_LEVENSHTEIN_DISTANCE),
    };

    const module = await esmock('../../../src/content-fragment-404/rules/similar-path-rule.js', {
      '../../../src/content-fragment-404/domain/suggestion/suggestion.js': {
        Suggestion: {
          similar: sandbox.stub().returns(mockSuggestion),
        },
      },
      '../../../src/content-fragment-404/utils/levenshtein-distance.js': {
        LevenshteinDistance: mockLevenshteinDistance,
      },
      '../../../src/content-fragment-404/utils/path-utils.js': {
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
      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(SIMILAR_PATH_RULE_PRIORITY);
      expect(rule.aemClient).to.equal(mockAemClient);
      expect(rule.pathIndex).to.equal(mockPathIndex);
    });

    it('should extend BaseRule', () => {
      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);

      expect(rule.getPriority).to.be.a('function');
      expect(rule.getAemClient).to.be.a('function');
      expect(rule.apply).to.be.a('function');
    });
  });

  describe('applyRule main flow', () => {
    it('should return similar path suggestion when found', async () => {
      mockPathUtils.getParentPath.returns(TEST_PATH_PARENT);
      mockAemClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/similar.jpg' },
        { path: '/content/dam/test/other.pdf' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(MAX_LEVENSHTEIN_DISTANCE);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(brokenPath);

      expect(mockAemClient.getChildrenFromPath).to.have.been.calledWith(TEST_PATH_PARENT);
      expect(result).to.equal(mockSuggestion);
    });

    it('should return null when no parent path found', async () => {
      mockPathUtils.getParentPath.returns(null);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });

    it('should return null when no children paths found', async () => {
      mockPathUtils.getParentPath.returns(TEST_PATH_PARENT);
      mockAemClient.getChildrenFromPath.resolves([]);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });

    it('should return null when no similar paths within distance threshold', async () => {
      mockPathUtils.getParentPath.returns(TEST_PATH_PARENT);
      mockAemClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/completely-different.jpg' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      const distanceTooHigh = MAX_LEVENSHTEIN_DISTANCE + 9;
      mockLevenshteinDistance.calculate.returns(distanceTooHigh); // Distance too high

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(brokenPath);

      expect(result).to.be.null;
    });
  });

  describe('applyRule with double slash handling', () => {
    it('should return suggestion when double slash can be fixed directly', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns(TEST_PATH_FIXED);
      mockAemClient.isAvailable.resolves(true);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should continue with similarity check when double slash fix not available', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns(TEST_PATH_FIXED);
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemClient.isAvailable.resolves(false);
      mockAemClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/similar.jpg' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(MAX_LEVENSHTEIN_DISTANCE);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN_WITH_DOUBLE_SLASHES;

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should handle paths without double slashes normally', async () => {
      mockPathUtils.hasDoubleSlashes.returns(false);
      mockPathUtils.getParentPath.returns(TEST_PATH_PARENT);
      mockAemClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/similar.jpg' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(MAX_LEVENSHTEIN_DISTANCE);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });
  });

  describe('checkDoubleSlash', () => {
    it('should return null when no double slashes present', async () => {
      mockPathUtils.hasDoubleSlashes.returns(false);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.checkDoubleSlash(brokenPath);

      expect(result).to.be.null;
    });

    it('should return suggestion when fixed path is available', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns(TEST_PATH_FIXED);
      mockAemClient.isAvailable.resolves(true);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = '/content/dam//test/broken.jpg';

      const result = await rule.checkDoubleSlash(brokenPath);

      expect(result.suggestion).to.equal(mockSuggestion);
      expect(result.fixedPath).to.equal(TEST_PATH_FIXED);
    });

    it('should return fixed path without suggestion when not available', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns(TEST_PATH_FIXED);
      mockAemClient.isAvailable.resolves(false);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN_WITH_DOUBLE_SLASHES;

      const result = await rule.checkDoubleSlash(brokenPath);

      expect(result.suggestion).to.be.null;
      expect(result.fixedPath).to.equal(TEST_PATH_FIXED);
    });
  });

  describe('findSimilarPath static method', () => {
    it('should find best match within distance threshold', () => {
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      const distanceAboveThreshold = MAX_LEVENSHTEIN_DISTANCE + 1;
      const distanceAtThreshold = MAX_LEVENSHTEIN_DISTANCE;
      const distanceTooHigh = MAX_LEVENSHTEIN_DISTANCE + 2;
      mockLevenshteinDistance.calculate.onCall(0).returns(distanceAboveThreshold);
      mockLevenshteinDistance.calculate.onCall(1).returns(distanceAtThreshold);
      mockLevenshteinDistance.calculate.onCall(2).returns(distanceTooHigh);

      const candidatePaths = [
        { path: '/content/dam/test/far.jpg' },
        { path: '/content/dam/test/close.jpg' },
        { path: '/content/dam/test/very-far.jpg' },
      ];

      const result = SimilarPathRule.findSimilarPath(TEST_PATH_BROKEN, candidatePaths, MAX_LEVENSHTEIN_DISTANCE);

      expect(result).to.equal(candidatePaths[1]);
    });

    it('should return null when no matches within threshold', () => {
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      const distanceTooHigh = MAX_LEVENSHTEIN_DISTANCE + 4;
      mockLevenshteinDistance.calculate.returns(distanceTooHigh);

      const candidatePaths = [
        { path: '/content/dam/test/far.jpg' },
      ];

      const result = SimilarPathRule.findSimilarPath(TEST_PATH_BROKEN, candidatePaths, MAX_LEVENSHTEIN_DISTANCE);

      expect(result).to.be.null;
    });

    it('should handle empty candidate paths', () => {
      const result = SimilarPathRule.findSimilarPath('/content/dam/test/broken.jpg', [], MAX_LEVENSHTEIN_DISTANCE);

      expect(result).to.be.null;
    });

    it('should compare paths without locale information', () => {
      mockPathUtils.removeLocaleFromPath.onCall(0).returns(TEST_PATH_BROKEN);
      mockPathUtils.removeLocaleFromPath.onCall(1).returns('/content/dam/test/similar.jpg');
      mockLevenshteinDistance.calculate.returns(MAX_LEVENSHTEIN_DISTANCE);

      const candidatePaths = [
        { path: '/content/dam/en-us/test/similar.jpg' },
      ];

      const result = SimilarPathRule.findSimilarPath('/content/dam/fr-fr/test/broken.jpg', candidatePaths, MAX_LEVENSHTEIN_DISTANCE);

      expect(mockPathUtils.removeLocaleFromPath).to.have.been.calledWith('/content/dam/fr-fr/test/broken.jpg');
      expect(mockPathUtils.removeLocaleFromPath).to.have.been.calledWith('/content/dam/en-us/test/similar.jpg');
      expect(result).to.equal(candidatePaths[0]);
    });

    it('should find closest match when multiple candidates within threshold', () => {
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      const perfectMatch = 0;
      mockLevenshteinDistance.calculate.onCall(0).returns(MAX_LEVENSHTEIN_DISTANCE);
      mockLevenshteinDistance.calculate.onCall(1).returns(perfectMatch); // Perfect match
      mockLevenshteinDistance.calculate.onCall(2).returns(MAX_LEVENSHTEIN_DISTANCE);

      const candidatePaths = [
        { path: '/content/dam/test/close1.jpg' },
        { path: TEST_PATH_BROKEN }, // Exact match
        { path: '/content/dam/test/close2.jpg' },
      ];

      const result = SimilarPathRule.findSimilarPath(TEST_PATH_BROKEN, candidatePaths, MAX_LEVENSHTEIN_DISTANCE);

      expect(result).to.equal(candidatePaths[1]);
    });
  });

  describe('error handling', () => {
    it('should handle AEM client errors during children fetch', async () => {
      mockPathUtils.getParentPath.returns(TEST_PATH_PARENT);
      mockAemClient.getChildrenFromPath.rejects(new Error(ERROR_AEM_CONNECTION_FAILED));

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith(ERROR_AEM_CONNECTION_FAILED);
    });

    it('should handle AEM client errors during double slash check', async () => {
      mockPathUtils.hasDoubleSlashes.returns(true);
      mockPathUtils.removeDoubleSlashes.returns('/content/dam/test/fixed.jpg');
      mockAemClient.isAvailable.rejects(new Error(ERROR_AEM_CONNECTION_FAILED));

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN_WITH_DOUBLE_SLASHES;

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith(ERROR_AEM_CONNECTION_FAILED);
    });

    it('should throw error when AEM client not available', async () => {
      const rule = new SimilarPathRule(context, null, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AemClient not injected');
    });
  });

  describe('integration scenarios', () => {
    it('should work through apply method', async () => {
      mockPathUtils.getParentPath.returns(TEST_PATH_PARENT);
      mockAemClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/similar.jpg' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      mockLevenshteinDistance.calculate.returns(MAX_LEVENSHTEIN_DISTANCE);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = TEST_PATH_BROKEN;

      const result = await rule.apply(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should return correct priority', () => {
      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);

      expect(rule.getPriority()).to.equal(SIMILAR_PATH_RULE_PRIORITY);
    });

    it('should handle complex similarity scenarios', async () => {
      mockPathUtils.getParentPath.returns('/content/dam/test');
      mockAemClient.getChildrenFromPath.resolves([
        { path: '/content/dam/test/image1.jpg' },
        { path: '/content/dam/test/image2.png' },
        { path: '/content/dam/test/document.pdf' },
      ]);
      mockPathUtils.removeLocaleFromPath.callsFake((path) => path);
      const distanceAboveThreshold = MAX_LEVENSHTEIN_DISTANCE + 2;
      const distanceWithinThreshold = MAX_LEVENSHTEIN_DISTANCE;
      const distanceTooHigh = MAX_LEVENSHTEIN_DISTANCE + 4;
      mockLevenshteinDistance.calculate.onCall(0).returns(distanceAboveThreshold);
      mockLevenshteinDistance.calculate.onCall(1).returns(distanceWithinThreshold);
      mockLevenshteinDistance.calculate.onCall(2).returns(distanceTooHigh);

      const rule = new SimilarPathRule(context, mockAemClient, mockPathIndex);
      const brokenPath = '/content/dam/test/image3.jpg'; // Different path for this test case

      const result = await rule.applyRule(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });
  });
});
