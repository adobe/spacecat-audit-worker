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
  let cdnUtils;

  before(async () => {
    userAgentPatterns = await import('../../../src/common/user-agent-classification.js');
    cdnUtils = await import('../../../src/utils/cdn-utils.js');
  });

  describe('PROVIDER_USER_AGENT_PATTERNS', () => {
    it('contains ChatGPT and Perplexity patterns', () => {
      const { PROVIDER_USER_AGENT_PATTERNS } = userAgentPatterns;

      expect(PROVIDER_USER_AGENT_PATTERNS).to.have.property('chatgpt');
      expect(PROVIDER_USER_AGENT_PATTERNS).to.have.property('perplexity');
      expect(PROVIDER_USER_AGENT_PATTERNS.chatgpt).to.include('ChatGPT');
      expect(PROVIDER_USER_AGENT_PATTERNS.perplexity).to.include('Perplexity');
      expect(PROVIDER_USER_AGENT_PATTERNS).to.have.property('bing');
    });

    it('includes searchbots (Googlebot, Bingbot, Google-Extended)', () => {
      const { PROVIDER_USER_AGENT_PATTERNS } = userAgentPatterns;

      expect(PROVIDER_USER_AGENT_PATTERNS.google).to.include('Googlebot');
      expect(PROVIDER_USER_AGENT_PATTERNS.google).to.include('Google-Extended');
      expect(PROVIDER_USER_AGENT_PATTERNS.bing).to.include('Bingbot');
    });
  });

  describe('buildUserAgentFilter', () => {
    it('excludes searchbots (Googlebot, Bingbot, Google-Extended) from reports', () => {
      const { buildUserAgentFilter } = cdnUtils;
      const filter = buildUserAgentFilter();

      // Should not include searchbots
      expect(filter).to.not.include('Googlebot');
      expect(filter).to.not.include('Google-Extended');
      expect(filter).to.not.include('Bingbot');
    });

    it('includes non-searchbot AI agents', () => {
      const { buildUserAgentFilter } = cdnUtils;
      const filter = buildUserAgentFilter();

      expect(filter).to.include('ChatGPT');
      expect(filter).to.include('Perplexity');
      expect(filter).to.include('Claude');
      expect(filter).to.include('GoogleAgent');
      expect(filter).to.include('Gemini-Deep-Research');
      expect(filter).to.include('Google-NotebookLM');
    });
  });

  describe('buildAgentTypeClassificationSQL', () => {
    it('builds SQL for ChatGPT and Perplexity agent types', () => {
      const { buildAgentTypeClassificationSQL } = userAgentPatterns;
      const sql = buildAgentTypeClassificationSQL();

      expect(sql).to.include('CASE');
      expect(sql).to.include('Web search crawlers');
      expect(sql).to.include('Chatbots');
      expect(sql).to.include('gptbot');
      expect(sql).to.include('perplexity');
      expect(sql).to.include('Search Bots');
      expect(sql.toLowerCase()).to.include('googlebot');
      expect(sql.toLowerCase()).to.include('bingbot');
      expect(sql.toLowerCase()).to.include('google-extended');
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
      expect(sql).to.include('GoogleBot');
      expect(sql).to.include('BingBot');
      expect(sql).to.include('Google-Extended');
    });
  });
});
