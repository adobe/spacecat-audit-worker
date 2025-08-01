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

describe('LLM Error Pages - User Agent Patterns', () => {
  let userAgentPatterns;

  before(async () => {
    userAgentPatterns = await import('../../../src/llm-error-pages/constants/user-agent-patterns.js');
  });

  describe('LLM_USER_AGENT_PATTERNS constant', () => {
    it('should have all expected LLM providers', () => {
      const { LLM_USER_AGENT_PATTERNS } = userAgentPatterns;
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('chatgpt');
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('perplexity');
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('claude');
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('gemini');
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('copilot');
    });

    it('should have case-insensitive patterns', () => {
      const { LLM_USER_AGENT_PATTERNS } = userAgentPatterns;
      Object.values(LLM_USER_AGENT_PATTERNS).forEach((pattern) => {
        expect(pattern).to.include('(?i)');
      });
    });
  });

  describe('getLlmProviderPattern', () => {
    it('should return correct pattern for known providers (case-insensitive)', () => {
      expect(userAgentPatterns.getLlmProviderPattern('chatgpt')).to.include('ChatGPT');
      expect(userAgentPatterns.getLlmProviderPattern('CHATGPT')).to.include('ChatGPT');
      expect(userAgentPatterns.getLlmProviderPattern('perplexity')).to.include('Perplexity');
      expect(userAgentPatterns.getLlmProviderPattern('claude')).to.include('Claude');
      expect(userAgentPatterns.getLlmProviderPattern('gemini')).to.include('Gemini');
      expect(userAgentPatterns.getLlmProviderPattern('copilot')).to.include('Copilot');
    });

    it('should return null for unknown provider', () => {
      expect(userAgentPatterns.getLlmProviderPattern('unknown')).to.equal(null);
      expect(userAgentPatterns.getLlmProviderPattern('invalid-provider')).to.equal(null);
      expect(userAgentPatterns.getLlmProviderPattern('random-string')).to.equal(null);
    });

    it('should return null for undefined or null input', () => {
      expect(userAgentPatterns.getLlmProviderPattern(undefined)).to.equal(null);
      expect(userAgentPatterns.getLlmProviderPattern(null)).to.equal(null);
      expect(userAgentPatterns.getLlmProviderPattern('')).to.equal(null);
    });

    it('should handle edge cases gracefully', () => {
      expect(userAgentPatterns.getLlmProviderPattern(123)).to.equal(null);
      expect(userAgentPatterns.getLlmProviderPattern({})).to.equal(null);
      expect(userAgentPatterns.getLlmProviderPattern([])).to.equal(null);
      expect(userAgentPatterns.getLlmProviderPattern('   ')).to.equal(null);
    });
  });

  describe('getAllLlmProviders', () => {
    it('should return array of all LLM provider keys', () => {
      const providers = userAgentPatterns.getAllLlmProviders();
      expect(providers).to.be.an('array');
      expect(providers).to.include('chatgpt');
      expect(providers).to.include('claude');
      expect(providers).to.include('gemini');
      expect(providers).to.include('perplexity');
      expect(providers).to.include('copilot');
      expect(providers.length).to.equal(5);
    });

    it('should return consistent results on multiple calls', () => {
      const providers1 = userAgentPatterns.getAllLlmProviders();
      const providers2 = userAgentPatterns.getAllLlmProviders();
      expect(providers1).to.deep.equal(providers2);
    });

    it('should return lowercase provider keys', () => {
      const providers = userAgentPatterns.getAllLlmProviders();
      providers.forEach((provider) => {
        expect(provider).to.equal(provider.toLowerCase());
      });
    });
  });

  describe('buildLlmUserAgentFilter', () => {
    it('should build filter for single provider', () => {
      const filter = userAgentPatterns.buildLlmUserAgentFilter(['chatgpt']);
      expect(filter).to.be.a('string');
      expect(filter).to.include('ChatGPT');
      expect(filter).to.include('REGEXP_LIKE');
      expect(filter).to.include("REGEXP_LIKE(user_agent, '(?i)ChatGPT|GPTBot|OAI-SearchBot')");
    });

    it('should build filter for multiple providers', () => {
      const filter = userAgentPatterns.buildLlmUserAgentFilter(['chatgpt', 'claude']);
      expect(filter).to.be.a('string');
      expect(filter).to.include('ChatGPT');
      expect(filter).to.include('Claude');
      expect(filter).to.include('|'); // Should join with OR
    });

    it('should handle null providers (returns filter for all)', () => {
      const filter = userAgentPatterns.buildLlmUserAgentFilter(null);
      expect(filter).to.be.a('string');
      expect(filter).to.include('REGEXP_LIKE');
      expect(filter).to.include('ChatGPT');
      expect(filter).to.include('Perplexity');
      expect(filter).to.include('Claude');
      expect(filter).to.include('Gemini');
      expect(filter).to.include('Copilot');
    });

    it('should handle undefined providers (returns filter for all)', () => {
      const filter = userAgentPatterns.buildLlmUserAgentFilter(undefined);
      expect(filter).to.be.a('string');
      expect(filter).to.include('REGEXP_LIKE');
    });

    it('should return null for empty array', () => {
      const filter = userAgentPatterns.buildLlmUserAgentFilter([]);
      expect(filter).to.equal(null);
    });

    it('should filter out null patterns', () => {
      const filter = userAgentPatterns.buildLlmUserAgentFilter(['chatgpt', 'unknown-provider']);
      expect(filter).to.be.a('string');
      expect(filter).to.include('ChatGPT');
      expect(filter).to.not.include('unknown-provider');
    });

    it('should return null for array with all invalid providers', () => {
      const filter = userAgentPatterns.buildLlmUserAgentFilter(['invalid1', 'invalid2']);
      expect(filter).to.equal(null);
    });

    it('should handle mixed valid and invalid providers', () => {
      const filter = userAgentPatterns.buildLlmUserAgentFilter(['chatgpt', 'invalid', 'claude', null, undefined]);
      expect(filter).to.be.a('string');
      expect(filter).to.include('ChatGPT');
      expect(filter).to.include('Claude');
      expect(filter).to.include('|');
    });

    it('should generate proper SQL regex pattern', () => {
      const filter = userAgentPatterns.buildLlmUserAgentFilter(['chatgpt']);
      expect(filter).to.match(/^REGEXP_LIKE\(user_agent, '.*'\)$/);
    });
  });

  describe('normalizeUserAgentToProvider', () => {
    it('should detect ChatGPT variants', () => {
      const testUserAgents = [
        'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)',
        'GPTBot/1.0 (+https://openai.com/gptbot)',
        'OAI-SearchBot/1.0 (+https://openai.com/searchbot)',
        'ChatGPT-User/1.0',
      ];

      testUserAgents.forEach((userAgent) => {
        expect(userAgentPatterns.normalizeUserAgentToProvider(userAgent)).to.equal('ChatGPT');
      });
    });

    it('should detect Perplexity variants', () => {
      const testUserAgents = [
        'PerplexityBot/1.0 (+https://perplexity.ai/bot)',
        'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/bot)',
        'Perplexity-Search/1.0',
      ];

      testUserAgents.forEach((userAgent) => {
        expect(userAgentPatterns.normalizeUserAgentToProvider(userAgent)).to.equal('Perplexity');
      });
    });

    it('should detect Claude variants', () => {
      const testUserAgents = [
        'Claude-Web/1.0 (+https://claude.ai/bot)',
        'Mozilla/5.0 (compatible; Claude-Web/1.0)',
        'ClaudeBot/1.0',
        'Anthropic-AI/1.0',
      ];

      testUserAgents.forEach((userAgent) => {
        expect(userAgentPatterns.normalizeUserAgentToProvider(userAgent)).to.equal('Claude');
      });
    });

    it('should detect Gemini variants', () => {
      const testUserAgents = [
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Google-Extended/1.0 Gemini',
        'GoogleOther/1.0 Gemini-Pro',
        'Gemini-Bot/1.0',
      ];

      testUserAgents.forEach((userAgent) => {
        expect(userAgentPatterns.normalizeUserAgentToProvider(userAgent)).to.equal('Gemini');
      });
    });

    it('should detect Copilot variants', () => {
      const testUserAgents = [
        'Mozilla/5.0 (compatible; Microsoft Copilot/1.0)',
        'BingBot/2.0 (+http://www.bing.com/bingbot.htm) Copilot',
        'Microsoft-Copilot/1.0',
      ];

      testUserAgents.forEach((userAgent) => {
        expect(userAgentPatterns.normalizeUserAgentToProvider(userAgent)).to.equal('Copilot');
      });
    });

    it('should return original user agent for unknown user agents', () => {
      const testUserAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Chrome/91.0.4472.124 Safari/537.36',
        'UnknownBot/1.0',
        'RandomCrawler/2.0',
      ];

      testUserAgents.forEach((userAgent) => {
        expect(userAgentPatterns.normalizeUserAgentToProvider(userAgent)).to.equal(userAgent);
      });
    });

    it('should return "Unknown" for null and undefined input', () => {
      expect(userAgentPatterns.normalizeUserAgentToProvider(null)).to.equal('Unknown');
      expect(userAgentPatterns.normalizeUserAgentToProvider(undefined)).to.equal('Unknown');
      expect(userAgentPatterns.normalizeUserAgentToProvider('')).to.equal('Unknown');
    });

    it('should be case insensitive', () => {
      expect(userAgentPatterns.normalizeUserAgentToProvider('chatgpt-user/1.0')).to.equal('ChatGPT');
      expect(userAgentPatterns.normalizeUserAgentToProvider('CHATGPT-USER/1.0')).to.equal('ChatGPT');
      expect(userAgentPatterns.normalizeUserAgentToProvider('perplexitybot/1.0')).to.equal('Perplexity');
      expect(userAgentPatterns.normalizeUserAgentToProvider('PERPLEXITYBOT/1.0')).to.equal('Perplexity');
    });

    it('should handle mixed case provider names correctly', () => {
      expect(userAgentPatterns.normalizeUserAgentToProvider('ChatGPT/1.0')).to.equal('ChatGPT');
      expect(userAgentPatterns.normalizeUserAgentToProvider('perplexity/1.0')).to.equal('Perplexity');
      expect(userAgentPatterns.normalizeUserAgentToProvider('CLAUDE/1.0')).to.equal('Claude');
      expect(userAgentPatterns.normalizeUserAgentToProvider('gemini/1.0')).to.equal('Gemini');
      expect(userAgentPatterns.normalizeUserAgentToProvider('COPILOT/1.0')).to.equal('Copilot');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle malformed input gracefully', () => {
      const malformedInputs = [
        123,
        {},
        [],
        true,
        false,
      ];

      malformedInputs.forEach((input) => {
        expect(() => userAgentPatterns.getLlmProviderPattern(input)).to.not.throw();
        expect(() => userAgentPatterns.normalizeUserAgentToProvider(input)).to.not.throw();
        expect(userAgentPatterns.normalizeUserAgentToProvider(input)).to.equal('Unknown');
      });
    });

    it('should handle very long user agent strings', () => {
      const longUserAgent = `ChatGPT-User/1.0 ${'A'.repeat(10000)}`;
      expect(userAgentPatterns.normalizeUserAgentToProvider(longUserAgent)).to.equal('ChatGPT');
    });

    it('should handle user agent strings with special characters', () => {
      const specialUserAgents = [
        'ChatGPT-User/1.0 (+https://openai.com/bot) [Special]',
        'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot) <test>',
        'PerplexityBot/1.0 & Co.',
      ];

      expect(userAgentPatterns.normalizeUserAgentToProvider(specialUserAgents[0])).to.equal('ChatGPT');
      expect(userAgentPatterns.normalizeUserAgentToProvider(specialUserAgents[1])).to.equal('ChatGPT');
      expect(userAgentPatterns.normalizeUserAgentToProvider(specialUserAgents[2])).to.equal('Perplexity');
    });

    it('should handle whitespace-only input', () => {
      expect(userAgentPatterns.normalizeUserAgentToProvider('   ')).to.equal('   ');
      expect(userAgentPatterns.normalizeUserAgentToProvider('\t\n')).to.equal('\t\n');
    });

    it('should handle partial matches correctly', () => {
      expect(userAgentPatterns.normalizeUserAgentToProvider('NotChatGPTBot')).to.equal('ChatGPT');
      expect(userAgentPatterns.normalizeUserAgentToProvider('SomePerplexityTool')).to.equal('Perplexity');
      expect(userAgentPatterns.normalizeUserAgentToProvider('ClaudeAnthropic')).to.equal('Claude');
    });

    it('should prioritize first match when multiple patterns could match', () => {
      // This tests the order of checks in the function
      const ambiguousAgent = 'ChatGPT Perplexity Claude';
      expect(userAgentPatterns.normalizeUserAgentToProvider(ambiguousAgent)).to.equal('ChatGPT');
    });
  });
});
