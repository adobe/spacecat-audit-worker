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
import nock from 'nock';
import esmock from 'esmock';

use(sinonChai);

describe('LLM Error Pages – url-validator', () => {
  let urlValidator;
  let fetchStub;
  const sandbox = sinon.createSandbox();

  beforeEach(async () => {
    fetchStub = sandbox.stub();
    // Use esmock to replace tracingFetch with our stub
    urlValidator = await esmock('../../../src/llm-error-pages/url-validator.js', {
      '@adobe/spacecat-shared-utils': { tracingFetch: fetchStub },
    });
  });

  afterEach(() => sandbox.restore());

  describe('validateUrlsBatch', () => {
    it('keeps crawler-specific 403 errors (GET 200)', async () => {
      // LLM request returns 403, simple GET returns 200
      fetchStub.onFirstCall().resolves({ status: 200 }); // simple GET
      fetchStub.onSecondCall().resolves({ status: 403 }); // LLM user agent

      const error = {
        url: 'https://example.com/private',
        status: '403',
        userAgent: 'ChatGPT',
        rawUserAgents: ['ChatGPT'],
      };
      const validated = await urlValidator.validateUrlsBatch([error], console);
      expect(validated).to.have.lengthOf(1);
      expect(validated[0].url).to.equal('https://example.com/private');
    });

    it('excludes universally blocked 403 errors (GET 403)', async () => {
      // Simple GET returns 403, indicating universal block
      fetchStub.onFirstCall().resolves({ status: 403 }); // simple GET

      const error = {
        url: 'https://example.com/private',
        status: '403',
        userAgent: 'ChatGPT',
        rawUserAgents: ['ChatGPT'],
      };
      const validated = await urlValidator.validateUrlsBatch([error], console);
      expect(validated).to.have.lengthOf(0);
    });

    it('excludes status mismatch errors (expected 404, got 200)', async () => {
      // Only LLM request performed (function early returns for 404 path)
      fetchStub.resolves({ status: 200 });

      const error = {
        url: 'https://example.com/old',
        status: '404',
        userAgent: 'ChatGPT',
        rawUserAgents: ['ChatGPT'],
      };
      const validated = await urlValidator.validateUrlsBatch([error], console);
      expect(validated).to.have.lengthOf(0);
    });

    it('should handle network errors gracefully and include the URL', async () => {
      fetchStub.rejects(new Error('Network timeout'));

      const error = {
        url: 'https://example.com/network-error',
        status: '404',
        userAgent: 'ChatGPT',
        rawUserAgents: ['ChatGPT'],
      };

      const mockLog = {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      };

      const validated = await urlValidator.validateUrlsBatch([error], mockLog);
      expect(validated).to.have.lengthOf(1);
      expect(validated[0].url).to.equal('https://example.com/network-error');
      expect(validated[0].validationError).to.equal('Network timeout');
      expect(mockLog.warn.calledOnce).to.be.true;
      expect(mockLog.warn.firstCall.args[0]).to.include('Validation failed for https://example.com/network-error (ChatGPT): Network timeout - including anyway');
    });

    it('should handle batch processing with multiple URLs', async () => {
      fetchStub.resolves({ status: 404 });

      // Create multiple errors
      const errors = Array.from({ length: 5 }, (_, i) => ({
        url: `https://example.com/page${i}`,
        status: '404',
        userAgent: 'ChatGPT',
        rawUserAgents: ['ChatGPT'],
      }));

      const mockLog = {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      };

      const validated = await urlValidator.validateUrlsBatch(errors, mockLog);

      expect(validated).to.have.lengthOf(5);
      expect(mockLog.info.calledWith('Starting URL validation for 5 URLs')).to.be.true;
    });

    it('should handle empty errors array', async () => {
      const mockLog = {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      };

      const validated = await urlValidator.validateUrlsBatch([], mockLog);

      expect(validated).to.have.lengthOf(0);
      expect(mockLog.info.calledWith('Starting URL validation for 0 URLs')).to.be.true;
    });

    it('should handle mixed validation results', async () => {
      // Mock different responses for different calls
      fetchStub.onCall(0).resolves({ status: 404 }); // Valid 404
      fetchStub.onCall(1).resolves({ status: 200 }); // Status mismatch (404 expected, got 200)
      fetchStub.onCall(2).rejects(new Error('Network error')); // Network error

      const errors = [
        {
          url: 'https://example.com/page1', status: '404', userAgent: 'ChatGPT', rawUserAgents: ['ChatGPT'],
        },
        {
          url: 'https://example.com/page2', status: '404', userAgent: 'Claude', rawUserAgents: ['Claude'],
        },
        {
          url: 'https://example.com/page3', status: '404', userAgent: 'Gemini', rawUserAgents: ['Gemini'],
        },
      ];

      const mockLog = {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
      };

      const validated = await urlValidator.validateUrlsBatch(errors, mockLog);

      // Should include valid 404 and network error (but not status mismatch)
      expect(validated).to.have.lengthOf(2);
      expect(validated[0].url).to.equal('https://example.com/page1');
      expect(validated[1].url).to.equal('https://example.com/page3');
      expect(validated[1].validationError).to.equal('Network error');
    });

    it('should handle 500 error validation', async () => {
      fetchStub.resolves({ status: 500 });

      const error = {
        url: 'https://example.com/server-error',
        status: '500',
        userAgent: 'ChatGPT',
        rawUserAgents: ['ChatGPT'],
      };

      const validated = await urlValidator.validateUrlsBatch([error], console);
      expect(validated).to.have.lengthOf(1);
      expect(validated[0].url).to.equal('https://example.com/server-error');
    });
  });

  describe('validateSingleUrl', () => {
    it('should filter out universally blocked 403 errors', async () => {
      const error = {
        url: 'https://httpstat.us/200',
        status: '403',
        userAgent: 'ChatGPT',
        rawUserAgents: ['ChatGPT-User'],
        totalRequests: 2,
      };

      const log = {
        debug: sinon.stub(),
        warn: sinon.stub(),
      };

      // Returns 200 without user agent, then 403 with user agent (crawler blocked)
      nock('https://httpstat.us')
        .get('/200')
        .reply(200, 'OK')
        .get('/200')
        .matchHeader('User-Agent', 'ChatGPT-User')
        .reply(403, 'Forbidden');

      const result = await urlValidator.validateSingleUrl(error, log);

      expect(result).to.not.be.null;
      expect(result.validatedAt).to.be.a('string');
    });
  });

  describe('Edge Cases - Using Reference Patterns', () => {
    it('should handle batch processing failures', async () => {
      const errors = [
        {
          url: 'https://example.com/page1',
          status: '404',
          userAgent: 'ChatGPT',
          rawUserAgents: ['ChatGPT-User'],
          totalRequests: 1,
        },
      ];

      const log = {
        info: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub(),
      };

      // Mock Promise.allSettled to simulate batch processing failure
      const originalAllSettled = Promise.allSettled;
      const allSettledStub = sinon.stub(Promise, 'allSettled');

      // Make the batch processing itself fail
      allSettledStub.resolves([
        { status: 'rejected', reason: 'Batch processing failed' },
      ]);

      try {
        const result = await urlValidator.validateUrlsBatch(errors, log);
        expect(result).to.be.an('array');
        expect(log.error).to.have.been.calledWith(sinon.match(/Batch processing failed/));
      } finally {
        allSettledStub.restore();
        Promise.allSettled = originalAllSettled;
      }
    });
  });
});
