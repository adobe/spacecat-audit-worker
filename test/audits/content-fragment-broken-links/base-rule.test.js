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
import { BaseRule } from '../../../src/content-fragment-broken-links/rules/base-rule.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('BaseRule', () => {
  let sandbox;
  let context;
  let mockAemAuthorClient;

  beforeEach(() => {
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
      isAvailable: sandbox.stub().resolves(true),
      getChildrenFromPath: sandbox.stub().resolves([]),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should initialize with default priority and no AEM client', () => {
      const rule = new BaseRule(context);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(42);
      expect(rule.aemAuthorClient).to.be.null;
    });

    it('should initialize with custom priority', () => {
      const rule = new BaseRule(context, 10);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(10);
      expect(rule.aemAuthorClient).to.be.null;
    });

    it('should initialize with AEM client', () => {
      const rule = new BaseRule(context, 42, mockAemAuthorClient);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(42);
      expect(rule.aemAuthorClient).to.equal(mockAemAuthorClient);
    });

    it('should initialize with all parameters', () => {
      const rule = new BaseRule(context, 5, mockAemAuthorClient);

      expect(rule.context).to.equal(context);
      expect(rule.priority).to.equal(5);
      expect(rule.aemAuthorClient).to.equal(mockAemAuthorClient);
    });
  });

  describe('apply', () => {
    it('should delegate to applyRule method', async () => {
      const rule = new BaseRule(context);
      const applyRuleSpy = sandbox.spy(rule, 'applyRule');
      const brokenPath = '/content/dam/test/broken.jpg';

      await expect(rule.apply(brokenPath))
        .to.be.rejectedWith('Subclasses must implement applyRule()');

      expect(applyRuleSpy).to.have.been.calledOnceWith(brokenPath);
    });

    it('should pass through return value from applyRule', async () => {
      const rule = new BaseRule(context);
      const mockSuggestion = { type: 'test', path: '/test' };

      // Override applyRule to return a mock suggestion
      rule.applyRule = sandbox.stub().resolves(mockSuggestion);

      const result = await rule.apply('/content/dam/test/broken.jpg');

      expect(result).to.equal(mockSuggestion);
    });

    it('should pass through errors from applyRule', async () => {
      const rule = new BaseRule(context);
      const testError = new Error('Test error');

      // Override applyRule to throw an error
      rule.applyRule = sandbox.stub().rejects(testError);

      await expect(rule.apply('/content/dam/test/broken.jpg'))
        .to.be.rejectedWith('Test error');
    });
  });

  describe('getPriority', () => {
    it('should return default priority', () => {
      const rule = new BaseRule(context);

      expect(rule.getPriority()).to.equal(42);
    });

    it('should return custom priority', () => {
      const rule = new BaseRule(context, 15);

      expect(rule.getPriority()).to.equal(15);
    });

    it('should return zero priority', () => {
      const rule = new BaseRule(context, 0);

      expect(rule.getPriority()).to.equal(0);
    });

    it('should return negative priority', () => {
      const rule = new BaseRule(context, -5);

      expect(rule.getPriority()).to.equal(-5);
    });
  });

  describe('getAemAuthorClient', () => {
    it('should return injected AEM client when available', () => {
      const rule = new BaseRule(context, 42, mockAemAuthorClient);

      const result = rule.getAemAuthorClient();

      expect(result).to.equal(mockAemAuthorClient);
      expect(context.log.error).not.to.have.been.called;
    });

    it('should throw error when AEM client not injected', () => {
      const rule = new BaseRule(context);

      expect(() => rule.getAemAuthorClient())
        .to.throw('AemAuthorClient not injected');

      expect(context.log.error).to.have.been.calledOnceWith('AemAuthorClient not injected');
    });

    it('should throw error when AEM client is null', () => {
      const rule = new BaseRule(context, 42, null);

      expect(() => rule.getAemAuthorClient())
        .to.throw('AemAuthorClient not injected');

      expect(context.log.error).to.have.been.calledOnceWith('AemAuthorClient not injected');
    });

    it('should throw error when AEM client is undefined', () => {
      const rule = new BaseRule(context, 42, undefined);

      expect(() => rule.getAemAuthorClient())
        .to.throw('AemAuthorClient not injected');

      expect(context.log.error).to.have.been.calledOnceWith('AemAuthorClient not injected');
    });
  });

  describe('applyRule', () => {
    it('should throw error indicating subclasses must implement', async () => {
      const rule = new BaseRule(context);

      await expect(rule.applyRule('/content/dam/test/broken.jpg'))
        .to.be.rejectedWith('Subclasses must implement applyRule()');
    });

    it('should throw error with any path input', async () => {
      const rule = new BaseRule(context);

      await expect(rule.applyRule('/different/path.pdf'))
        .to.be.rejectedWith('Subclasses must implement applyRule()');
    });

    it('should throw error with null path', async () => {
      const rule = new BaseRule(context);

      await expect(rule.applyRule(null))
        .to.be.rejectedWith('Subclasses must implement applyRule()');
    });

    it('should throw error with empty path', async () => {
      const rule = new BaseRule(context);

      await expect(rule.applyRule(''))
        .to.be.rejectedWith('Subclasses must implement applyRule()');
    });
  });

  describe('integration scenarios', () => {
    it('should work in a typical rule application flow', async () => {
      const rule = new BaseRule(context, 10, mockAemAuthorClient);

      // Override applyRule to simulate a real implementation
      rule.applyRule = sandbox.stub().resolves({ type: 'publish', path: '/test' });

      expect(rule.getPriority()).to.equal(10);
      expect(rule.getAemAuthorClient()).to.equal(mockAemAuthorClient);

      const result = await rule.apply('/content/dam/test/broken.jpg');
      expect(result).to.deep.equal({ type: 'publish', path: '/test' });
    });
  });
});
