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

import { expect } from 'chai';
import sinon from 'sinon';
import {
  BotProtectionError,
  checkBotProtectionInScrapeResult,
  validateScrapeForBotProtection,
} from '../../src/common/bot-protection-utils.js';

describe('Bot Protection Utils', () => {
  let logStub;

  beforeEach(() => {
    logStub = {
      warn: sinon.stub(),
      error: sinon.stub(),
      info: sinon.stub(),
    };
  });

  describe('BotProtectionError', () => {
    it('creates error with correct properties', () => {
      const botProtection = {
        type: 'cloudflare',
        blocked: true,
        confidence: 0.9,
      };

      const error = new BotProtectionError('Test error', {
        botProtection,
        siteUrl: 'https://example.com',
        url: 'https://example.com/page',
      });

      expect(error).to.be.instanceOf(Error);
      expect(error.name).to.equal('BotProtectionError');
      expect(error.message).to.equal('Test error');
      expect(error.botProtection).to.deep.equal(botProtection);
      expect(error.siteUrl).to.equal('https://example.com');
      expect(error.url).to.equal('https://example.com/page');
    });

    it('creates error with empty botProtection when not provided', () => {
      const error = new BotProtectionError('Test error', {
        siteUrl: 'https://example.com',
        url: 'https://example.com/page',
      });

      expect(error).to.be.instanceOf(Error);
      expect(error.name).to.equal('BotProtectionError');
      expect(error.message).to.equal('Test error');
      expect(error.botProtection).to.deep.equal({});
      expect(error.siteUrl).to.equal('https://example.com');
      expect(error.url).to.equal('https://example.com/page');
    });
  });

  describe('checkBotProtectionInScrapeResult', () => {
    it('returns null for null scrape result', () => {
      const result = checkBotProtectionInScrapeResult(null, logStub);
      expect(result).to.be.null;
    });

    it('returns null for scrape result without botProtection', () => {
      const scrapeResult = {
        finalUrl: 'https://example.com',
        scrapeResult: { rawBody: '<html></html>' },
      };

      const result = checkBotProtectionInScrapeResult(scrapeResult, logStub);
      expect(result).to.be.null;
    });

    it('returns bot protection details when blocked', () => {
      const scrapeResult = {
        finalUrl: 'https://example.com',
        botProtection: {
          detected: true,
          type: 'cloudflare',
          blocked: true,
          confidence: 0.9,
          reason: 'Challenge page detected',
        },
      };

      const result = checkBotProtectionInScrapeResult(scrapeResult, logStub);

      expect(result).to.not.be.null;
      expect(result.detected).to.be.true;
      expect(result.type).to.equal('cloudflare');
      expect(result.blocked).to.be.true;
      expect(result.confidence).to.equal(0.9);
      expect(result.reason).to.equal('Challenge page detected');

      expect(logStub.warn.calledOnce).to.be.true;
      expect(logStub.warn.firstCall.args[0]).to.include('Bot protection detected');
      expect(logStub.warn.firstCall.args[0]).to.include('cloudflare');
    });

    it('returns bot protection when crawlable is false', () => {
      const scrapeResult = {
        botProtection: {
          crawlable: false,
          type: 'imperva',
          confidence: 0.99,
        },
      };

      const result = checkBotProtectionInScrapeResult(scrapeResult, logStub);

      expect(result).to.not.be.null;
      expect(result.blocked).to.be.true;
      expect(result.type).to.equal('imperva');
    });

    it('returns null when bot protection bypassed', () => {
      const scrapeResult = {
        botProtection: {
          detected: false, // When bypassed, detected is false
          type: 'none', // Type is 'none' when no blocking detected
          blocked: false,
          confidence: 1.0,
        },
      };

      const result = checkBotProtectionInScrapeResult(scrapeResult, logStub);

      expect(result).to.be.null;
      // No log expected when type is 'none'
    });

    it('logs info when bot protection infrastructure detected but bypassed', () => {
      const scrapeResult = {
        botProtection: {
          detected: true,
          type: 'cloudflare-allowed',
          blocked: false,
          crawlable: true,
          confidence: 0.7,
        },
      };

      const result = checkBotProtectionInScrapeResult(scrapeResult, logStub);

      expect(result).to.be.null;
      expect(logStub.info.calledOnce).to.be.true;
      expect(logStub.info.firstCall.args[0]).to.include('bypassed');
      expect(logStub.info.firstCall.args[0]).to.include('cloudflare-allowed');
    });

    it('handles missing optional fields', () => {
      const scrapeResult = {
        botProtection: {
          blocked: true,
        },
      };

      const result = checkBotProtectionInScrapeResult(scrapeResult, logStub);

      expect(result).to.not.be.null;
      expect(result.type).to.equal('unknown');
      expect(result.confidence).to.equal(0.5);
    });
  });

  describe('validateScrapeForBotProtection', () => {
    it('does not throw when bot protection not present', () => {
      const scrapeResult = {
        finalUrl: 'https://example.com',
        scrapeResult: { rawBody: '<html></html>' },
      };

      expect(() => {
        validateScrapeForBotProtection(scrapeResult, 'https://example.com', logStub);
      }).to.not.throw();
    });

    it('does not throw when bot protection bypassed', () => {
      const scrapeResult = {
        botProtection: {
          detected: false, // When bypassed, detected is false
          type: 'none', // Type is 'none' when no blocking detected
          blocked: false,
        },
      };

      expect(() => {
        validateScrapeForBotProtection(scrapeResult, 'https://example.com', logStub);
      }).to.not.throw();
    });

    it('throws BotProtectionError when blocked', () => {
      const scrapeResult = {
        botProtection: {
          detected: true,
          type: 'cloudflare',
          blocked: true,
          confidence: 0.9,
          reason: 'Challenge page',
        },
      };

      expect(() => {
        validateScrapeForBotProtection(scrapeResult, 'https://example.com', logStub);
      }).to.throw(BotProtectionError);

      // Reset log stub after first call
      logStub.error.resetHistory();
      logStub.warn.resetHistory();

      try {
        validateScrapeForBotProtection(scrapeResult, 'https://example.com', logStub);
      } catch (error) {
        expect(error).to.be.instanceOf(BotProtectionError);
        expect(error.message).to.include('cloudflare');
        expect(error.message).to.include('https://example.com');
        expect(error.botProtection.type).to.equal('cloudflare');
        expect(error.url).to.equal('https://example.com');
      }

      expect(logStub.error.calledOnce).to.be.true;
    });

    it('logs error before throwing', () => {
      const scrapeResult = {
        botProtection: {
          blocked: true,
          type: 'imperva',
        },
      };

      try {
        validateScrapeForBotProtection(scrapeResult, 'https://test.com', logStub);
      } catch (error) {
        // Expected
      }

      expect(logStub.error.calledOnce).to.be.true;
      expect(logStub.error.firstCall.args[0]).to.include('Bot protection blocking');
      expect(logStub.error.firstCall.args[0]).to.include('imperva');
    });
  });
});
