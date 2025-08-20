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
import {
  getLlmProviderPattern, getAllLlmProviders, buildLlmUserAgentFilter, normalizeUserAgentToProvider,
} from '../../../src/llm-error-pages/utils.js';

describe('LLM Error Pages – user-agent-patterns', () => {
  // describe('LLM_USER_AGENT_PATTERNS', () => {
  //   it('should contain expected LLM providers', () => {
  //     expect(LLM_USER_AGENT_PATTERNS).to.have.property('chatgpt');
  //     expect(LLM_USER_AGENT_PATTERNS).to.have.property('perplexity');
  //     expect(LLM_USER_AGENT_PATTERNS).to.have.property('claude');
  //     expect(LLM_USER_AGENT_PATTERNS).to.have.property('gemini');
  //     expect(LLM_USER_AGENT_PATTERNS).to.have.property('copilot');
  //   });

  //   it('should have regex patterns for each provider', () => {
  //     Object.values(LLM_USER_AGENT_PATTERNS).forEach((pattern) => {
  //       expect(pattern).to.be.a('string');
  //       expect(pattern).to.include('(?i)');
  //     });
  //   });
  // });

  describe('getLlmProviderPattern', () => {
    it('should return pattern for valid provider', () => {
      expect(getLlmProviderPattern('chatgpt')).to.equal('(?i)ChatGPT|GPTBot|OAI-SearchBot');
      expect(getLlmProviderPattern('perplexity')).to.equal('(?i)Perplexity');
      expect(getLlmProviderPattern('claude')).to.equal('(?i)Claude|Anthropic');
      expect(getLlmProviderPattern('gemini')).to.equal('(?i)Gemini');
      expect(getLlmProviderPattern('copilot')).to.equal('(?i)Copilot');
    });

    it('should handle case insensitive provider names', () => {
      expect(getLlmProviderPattern('CHATGPT')).to.equal('(?i)ChatGPT|GPTBot|OAI-SearchBot');
      expect(getLlmProviderPattern('Perplexity')).to.equal('(?i)Perplexity');
      expect(getLlmProviderPattern('ClAuDe')).to.equal('(?i)Claude|Anthropic');
    });

    it('should return null for invalid provider', () => {
      expect(getLlmProviderPattern('invalid')).to.be.null;
      expect(getLlmProviderPattern('')).to.be.null;
      expect(getLlmProviderPattern('   ')).to.be.null;
      expect(getLlmProviderPattern(null)).to.be.null;
      expect(getLlmProviderPattern(undefined)).to.be.null;
      expect(getLlmProviderPattern(123)).to.be.null;
    });
  });

  describe('getAllLlmProviders', () => {
    it('should return array of provider names', () => {
      const providers = getAllLlmProviders();
      expect(providers).to.be.an('array');
      expect(providers).to.include('chatgpt');
      expect(providers).to.include('perplexity');
      expect(providers).to.include('claude');
      expect(providers).to.include('gemini');
      expect(providers).to.include('copilot');
    });

    it('should return exactly 5 providers', () => {
      const providers = getAllLlmProviders();
      expect(providers).to.have.lengthOf(5);
    });
  });

  describe('buildLlmUserAgentFilter', () => {
    it('should build filter for specific providers', () => {
      const filter = buildLlmUserAgentFilter(['chatgpt', 'claude']);
      expect(filter).to.include('ChatGPT|GPTBot|OAI-SearchBot');
      expect(filter).to.include('Claude|Anthropic');
      expect(filter).to.include('REGEXP_LIKE(user_agent,');
      expect(filter).to.not.include('Perplexity');
    });

    it('should build filter for all providers when none specified', () => {
      const filter = buildLlmUserAgentFilter();
      expect(filter).to.include('ChatGPT|GPTBot|OAI-SearchBot');
      expect(filter).to.include('Perplexity');
      expect(filter).to.include('Claude|Anthropic');
      expect(filter).to.include('Gemini');
      expect(filter).to.include('Copilot');
    });

    it('should return null for empty providers array', () => {
      const filter = buildLlmUserAgentFilter([]);
      expect(filter).to.be.null;
    });

    it('should handle mixed valid/invalid providers', () => {
      const filter = buildLlmUserAgentFilter(['chatgpt', 'invalid', 'claude']);
      expect(filter).to.include('ChatGPT|GPTBot|OAI-SearchBot');
      expect(filter).to.include('Claude|Anthropic');
      expect(filter).to.not.include('invalid');
    });
  });

  describe('normalizeUserAgentToProvider', () => {
    it('should normalize ChatGPT user agents', () => {
      expect(normalizeUserAgentToProvider('mozilla chatgpt sdd')).to.equal('ChatGPT');
      expect(normalizeUserAgentToProvider('GPTBot')).to.equal('ChatGPT');
      expect(normalizeUserAgentToProvider('OAI-SearchBot')).to.equal('ChatGPT');
    });

    it('should normalize Perplexity user agents', () => {
      expect(normalizeUserAgentToProvider('perplexity bot')).to.equal('Perplexity');
      expect(normalizeUserAgentToProvider('PERPLEXITY')).to.equal('Perplexity');
    });

    it('should normalize Claude user agents', () => {
      expect(normalizeUserAgentToProvider('claude bot')).to.equal('Claude');
      expect(normalizeUserAgentToProvider('anthropic')).to.equal('Claude');
    });

    it('should normalize Gemini user agents', () => {
      expect(normalizeUserAgentToProvider('gemini bot')).to.equal('Gemini');
      expect(normalizeUserAgentToProvider('GEMINI')).to.equal('Gemini');
    });

    it('should normalize Copilot user agents', () => {
      expect(normalizeUserAgentToProvider('copilot bot')).to.equal('Copilot');
      expect(normalizeUserAgentToProvider('COPILOT')).to.equal('Copilot');
    });

    it('should return original string for unknown user agents', () => {
      expect(normalizeUserAgentToProvider('mozilla chrome')).to.equal('mozilla chrome');
      expect(normalizeUserAgentToProvider('unknown bot')).to.equal('unknown bot');
    });

    it('should handle edge cases', () => {
      expect(normalizeUserAgentToProvider('')).to.equal('Unknown');
      expect(normalizeUserAgentToProvider(null)).to.equal('Unknown');
      expect(normalizeUserAgentToProvider(undefined)).to.equal('Unknown');
      expect(normalizeUserAgentToProvider(123)).to.equal('Unknown');
    });
  });
});
