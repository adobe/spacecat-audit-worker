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
import sinonChai from 'sinon-chai';

use(sinonChai);

describe('User Agent Patterns', () => {
  let userAgentPatterns;

  before(async () => {
    userAgentPatterns = await import('../../../src/cdn-logs-report/constants/user-agent-patterns.js');
  });

  describe('PROVIDER_USER_AGENT_PATTERNS', () => {
    it('contains ChatGPT and Perplexity patterns', () => {
      const { PROVIDER_USER_AGENT_PATTERNS } = userAgentPatterns;

      expect(PROVIDER_USER_AGENT_PATTERNS).to.have.property('chatgpt');
      expect(PROVIDER_USER_AGENT_PATTERNS).to.have.property('perplexity');
      expect(PROVIDER_USER_AGENT_PATTERNS.chatgpt).to.include('ChatGPT');
      expect(PROVIDER_USER_AGENT_PATTERNS.perplexity).to.include('Perplexity');
    });
  });

  describe('getProviderPattern', () => {
    it('returns correct pattern for known providers', () => {
      const { getProviderPattern } = userAgentPatterns;

      expect(getProviderPattern('chatgpt')).to.include('ChatGPT');
      expect(getProviderPattern('CHATGPT')).to.include('ChatGPT');
      expect(getProviderPattern('perplexity')).to.include('Perplexity');
    });

    it('returns null for unknown providers', () => {
      const { getProviderPattern } = userAgentPatterns;

      expect(getProviderPattern('unknown')).to.be.null;
      expect(getProviderPattern(null)).to.be.null;
      expect(getProviderPattern(undefined)).to.be.null;
    });
  });

  describe('buildAgentTypeClassificationSQL', () => {
    it('builds SQL for ChatGPT and Perplexity agent types', () => {
      const { buildAgentTypeClassificationSQL } = userAgentPatterns;
      const sql = buildAgentTypeClassificationSQL();

      expect(sql).to.include('CASE');
      expect(sql).to.include('Crawlers');
      expect(sql).to.include('Chatbots');
      expect(sql).to.include('gptbot');
      expect(sql).to.include('perplexity');
    });
  });

  describe('buildUserAgentDisplaySQL', () => {
    it('builds SQL for user agent display names', () => {
      const { buildUserAgentDisplaySQL } = userAgentPatterns;
      const sql = buildUserAgentDisplaySQL();

      expect(sql).to.include('CASE');
      expect(sql).to.include('ChatGPT-User');
      expect(sql).to.include('GPTBot');
      expect(sql).to.include('PerplexityBot');
    });
  });
});
