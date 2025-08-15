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
  LLM_USER_AGENT_PATTERNS,
  getLlmProviderPattern,
  getAllLlmProviders,
  buildLlmUserAgentFilter,
  normalizeUserAgentToProvider,
} from '../../../src/llm-error-pages/constants/user-agent-patterns.js';

describe('LLM Error Pages - User Agent Patterns', () => {
  describe('LLM_USER_AGENT_PATTERNS', () => {
    it('should contain expected LLM providers', () => {
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('chatgpt');
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('perplexity');
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('claude');
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('gemini');
      expect(LLM_USER_AGENT_PATTERNS).to.have.property('copilot');
    });

    it('should have case-insensitive patterns', () => {
      expect(LLM_USER_AGENT_PATTERNS.chatgpt).to.include('(?i)');
      expect(LLM_USER_AGENT_PATTERNS.perplexity).to.include('(?i)');
      expect(LLM_USER_AGENT_PATTERNS.claude).to.include('(?i)');
      expect(LLM_USER_AGENT_PATTERNS.gemini).to.include('(?i)');
      expect(LLM_USER_AGENT_PATTERNS.copilot).to.include('(?i)');
    });
  });

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
    it('should return array of all provider keys', () => {
      const providers = getAllLlmProviders();
      expect(providers).to.be.an('array');
      expect(providers).to.include('chatgpt');
      expect(providers).to.include('perplexity');
      expect(providers).to.include('claude');
      expect(providers).to.include('gemini');
      expect(providers).to.include('copilot');
      expect(providers).to.have.length(5);
    });
  });

  describe('buildLlmUserAgentFilter', () => {
    it('should build filter for all providers when none specified', () => {
      const filter = buildLlmUserAgentFilter();
      expect(filter).to.include('REGEXP_LIKE(user_agent');
      expect(filter).to.include('ChatGPT');
      expect(filter).to.include('Perplexity');
      expect(filter).to.include('Claude');
      expect(filter).to.include('Gemini');
      expect(filter).to.include('Copilot');
    });

    it('should build filter for specific providers', () => {
      const filter = buildLlmUserAgentFilter(['chatgpt', 'claude']);
      expect(filter).to.include('REGEXP_LIKE(user_agent');
      expect(filter).to.include('ChatGPT');
      expect(filter).to.include('Claude');
      expect(filter).to.not.include('Perplexity');
    });

    it('should return null for empty providers', () => {
      expect(buildLlmUserAgentFilter([])).to.be.null;
    });

    it('should return null for invalid providers', () => {
      expect(buildLlmUserAgentFilter(['invalid', 'nonexistent'])).to.be.null;
    });

    it('should filter out invalid providers and build filter for valid ones', () => {
      const filter = buildLlmUserAgentFilter(['chatgpt', 'invalid', 'claude']);
      expect(filter).to.include('REGEXP_LIKE(user_agent');
      expect(filter).to.include('ChatGPT');
      expect(filter).to.include('Claude');
      expect(filter).to.not.include('invalid');
    });
  });

  describe('normalizeUserAgentToProvider', () => {
    it('should handle invalid input', () => {
      expect(normalizeUserAgentToProvider(null)).to.equal('Unknown');
      expect(normalizeUserAgentToProvider(undefined)).to.equal('Unknown');
      expect(normalizeUserAgentToProvider('')).to.equal('Unknown');
      expect(normalizeUserAgentToProvider(123)).to.equal('Unknown');
    });

    it('should normalize ChatGPT variants', () => {
      expect(normalizeUserAgentToProvider('ChatGPT-User')).to.equal('ChatGPT');
      expect(normalizeUserAgentToProvider('GPTBot crawler')).to.equal('ChatGPT');
      expect(normalizeUserAgentToProvider('OAI-SearchBot/1.0')).to.equal('ChatGPT');
      expect(normalizeUserAgentToProvider('chatgpt mobile')).to.equal('ChatGPT');
    });

    it('should normalize Perplexity variants', () => {
      expect(normalizeUserAgentToProvider('Perplexity-Bot')).to.equal('Perplexity');
      expect(normalizeUserAgentToProvider('perplexity.ai')).to.equal('Perplexity');
    });

    it('should normalize Claude variants', () => {
      expect(normalizeUserAgentToProvider('Claude-3')).to.equal('Claude');
      expect(normalizeUserAgentToProvider('Anthropic AI')).to.equal('Claude');
      expect(normalizeUserAgentToProvider('claude assistant')).to.equal('Claude');
    });

    it('should normalize Gemini variants', () => {
      expect(normalizeUserAgentToProvider('Gemini-Pro')).to.equal('Gemini');
      expect(normalizeUserAgentToProvider('Google Gemini')).to.equal('Gemini');
      expect(normalizeUserAgentToProvider('gemini-1.5')).to.equal('Gemini');
    });

    it('should normalize Copilot variants', () => {
      expect(normalizeUserAgentToProvider('Microsoft Copilot')).to.equal('Copilot');
      expect(normalizeUserAgentToProvider('GitHub Copilot')).to.equal('Copilot');
      expect(normalizeUserAgentToProvider('copilot-web')).to.equal('Copilot');
    });

    it('should return original string for unknown user agents', () => {
      const unknownAgent = 'Mozilla/5.0 (compatible; CustomBot/1.0)';
      expect(normalizeUserAgentToProvider(unknownAgent)).to.equal(unknownAgent);

      const anotherUnknown = 'SomeOtherBot/2.0';
      expect(normalizeUserAgentToProvider(anotherUnknown)).to.equal(anotherUnknown);
    });

    it('should handle case insensitive matching', () => {
      expect(normalizeUserAgentToProvider('CHATGPT')).to.equal('ChatGPT');
      expect(normalizeUserAgentToProvider('pErPlExItY')).to.equal('Perplexity');
      expect(normalizeUserAgentToProvider('CLAUDE')).to.equal('Claude');
      expect(normalizeUserAgentToProvider('GEMINI')).to.equal('Gemini');
      expect(normalizeUserAgentToProvider('COPILOT')).to.equal('Copilot');
    });
  });
});
