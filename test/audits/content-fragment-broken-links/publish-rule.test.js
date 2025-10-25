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

describe('PublishRule', () => {
  let sandbox;
  let context;
  let mockAemClient;
  let mockSuggestion;
  let PublishRule;

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
      type: 'publish',
      path: '/content/dam/test/broken.jpg',
      publish: sandbox.stub().returns({ type: 'publish', path: '/content/dam/test/broken.jpg' }),
    };

    const module = await esmock('../../../src/content-fragment-broken-links/rules/publish-rule.js', {
      '../../../src/content-fragment-broken-links/domain/suggestion/suggestion.js': {
        Suggestion: {
          publish: sandbox.stub().returns(mockSuggestion),
        },
      },
    });

    PublishRule = module.PublishRule;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should initialize with highest priority (1)', () => {
      const rule = new PublishRule(context, mockAemClient);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(1);
      expect(rule.aemClient).to.equal(mockAemClient);
    });

    it('should extend BaseRule', () => {
      const rule = new PublishRule(context, mockAemClient);

      expect(rule.getPriority).to.be.a('function');
      expect(rule.getAemClient).to.be.a('function');
      expect(rule.apply).to.be.a('function');
    });

    it('should work without AEM client initially', () => {
      const rule = new PublishRule(context, null);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(1);
      expect(rule.aemClient).to.be.null;
    });
  });

  describe('applyRule', () => {
    it('should return publish suggestion when content is available on Author', async () => {
      mockAemClient.isAvailable.resolves(true);
      const rule = new PublishRule(context, mockAemClient);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(mockAemClient.isAvailable).to.have.been.calledOnceWith(brokenPath);
      expect(result).to.equal(mockSuggestion);
    });

    it('should return null when content is not available on Author', async () => {
      mockAemClient.isAvailable.resolves(false);
      const rule = new PublishRule(context, mockAemClient);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.applyRule(brokenPath);

      expect(mockAemClient.isAvailable).to.have.been.calledOnceWith(brokenPath);
      expect(result).to.be.null;
    });

    it('should handle different path formats', async () => {
      mockAemClient.isAvailable.resolves(true);
      const rule = new PublishRule(context, mockAemClient);
      const testPaths = [
        '/content/dam/folder/file.pdf',
        '/content/dam/en-us/assets/image.png',
        '/content/dam/fr-fr/documents/doc.docx',
      ];

      for (const path of testPaths) {
        mockAemClient.isAvailable.resetHistory();
        context.log.debug.resetHistory();
        context.log.info.resetHistory();

        // eslint-disable-next-line no-await-in-loop
        const result = await rule.applyRule(path);

        expect(mockAemClient.isAvailable).to.have.been.calledOnceWith(path);
        expect(result).to.equal(mockSuggestion);
      }
    });

    it('should handle AEM client errors gracefully', async () => {
      const testError = new Error('AEM connection failed');
      mockAemClient.isAvailable.rejects(testError);
      const rule = new PublishRule(context, mockAemClient);
      const brokenPath = '/content/dam/test/broken.jpg';

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AEM connection failed');

      expect(mockAemClient.isAvailable).to.have.been.calledOnceWith(brokenPath);
    });

    it('should throw error when AEM client not available', async () => {
      const rule = new PublishRule(context, null);
      const brokenPath = '/content/dam/test/broken.jpg';

      await expect(rule.applyRule(brokenPath))
        .to.be.rejectedWith('AemClient not injected');

      expect(context.log.error).to.have.been.calledWith('AemClient not injected');
    });

    it('should handle empty path', async () => {
      mockAemClient.isAvailable.resolves(false);
      const rule = new PublishRule(context, mockAemClient);
      const brokenPath = '';

      const result = await rule.applyRule(brokenPath);

      expect(context.log.debug).to.have.been.calledWith('Applying PublishRule to path: ');
      expect(mockAemClient.isAvailable).to.have.been.calledOnceWith('');
      expect(result).to.be.null;
    });

    it('should handle null path', async () => {
      mockAemClient.isAvailable.resolves(false);
      const rule = new PublishRule(context, mockAemClient);
      const brokenPath = null;

      const result = await rule.applyRule(brokenPath);

      expect(context.log.debug).to.have.been.calledWith('Applying PublishRule to path: null');
      expect(mockAemClient.isAvailable).to.have.been.calledOnceWith(null);
      expect(result).to.be.null;
    });
  });

  describe('integration with BaseRule', () => {
    it('should work through apply method', async () => {
      mockAemClient.isAvailable.resolves(true);
      const rule = new PublishRule(context, mockAemClient);
      const brokenPath = '/content/dam/test/broken.jpg';

      const result = await rule.apply(brokenPath);

      expect(result).to.equal(mockSuggestion);
    });

    it('should return correct priority', () => {
      const rule = new PublishRule(context, mockAemClient);

      expect(rule.getPriority()).to.equal(1);
    });

    it('should return AEM client when available', () => {
      const rule = new PublishRule(context, mockAemClient);

      expect(rule.getAemClient()).to.equal(mockAemClient);
    });
  });

  describe('edge cases', () => {
    it('should handle very long paths', async () => {
      mockAemClient.isAvailable.resolves(true);
      const rule = new PublishRule(context, mockAemClient);
      const longPath = `/content/dam/${'very-long-folder-name/'.repeat(20)}file.jpg`;

      const result = await rule.applyRule(longPath);

      expect(mockAemClient.isAvailable).to.have.been.calledOnceWith(longPath);
      expect(result).to.equal(mockSuggestion);
    });

    it('should handle paths with special characters', async () => {
      mockAemClient.isAvailable.resolves(true);
      const rule = new PublishRule(context, mockAemClient);
      const specialPath = '/content/dam/folder with spaces/file-with-dashes_and_underscores.jpg';

      const result = await rule.applyRule(specialPath);

      expect(mockAemClient.isAvailable).to.have.been.calledOnceWith(specialPath);
      expect(result).to.equal(mockSuggestion);
    });

    it('should handle paths with encoded characters', async () => {
      mockAemClient.isAvailable.resolves(true);
      const rule = new PublishRule(context, mockAemClient);
      const encodedPath = '/content/dam/folder%20with%20spaces/file.jpg';

      const result = await rule.applyRule(encodedPath);

      expect(mockAemClient.isAvailable).to.have.been.calledOnceWith(encodedPath);
      expect(result).to.equal(mockSuggestion);
    });
  });
});
