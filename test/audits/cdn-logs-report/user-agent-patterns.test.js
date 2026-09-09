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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';

use(sinonChai);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SQL_PROVIDERS_DIR = path.join(__dirname, '../../../src/cdn-analysis/sql');

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
      expect(PROVIDER_USER_AGENT_PATTERNS.chatgpt).to.include('OAI-AdsBot');
      expect(PROVIDER_USER_AGENT_PATTERNS.perplexity).to.include('Perplexity');
    });

    it('separates Google AI agents from searchbots', () => {
      const { PROVIDER_USER_AGENT_PATTERNS } = userAgentPatterns;

      // Google AI agents
      expect(PROVIDER_USER_AGENT_PATTERNS).to.have.property('googleai');
      expect(PROVIDER_USER_AGENT_PATTERNS.googleai).to.include('Google$');
      expect(PROVIDER_USER_AGENT_PATTERNS.googleai).to.include('Google-NotebookLM');
      expect(PROVIDER_USER_AGENT_PATTERNS.googleai).to.include('Google-?Agent');

      // Google searchbots
      expect(PROVIDER_USER_AGENT_PATTERNS).to.have.property('google');
      expect(PROVIDER_USER_AGENT_PATTERNS.google).to.include('Googlebot');
      expect(PROVIDER_USER_AGENT_PATTERNS.google).to.include('Google-Extended');
    });

    it('includes Bingbot as searchbot', () => {
      const { PROVIDER_USER_AGENT_PATTERNS } = userAgentPatterns;

      expect(PROVIDER_USER_AGENT_PATTERNS).to.have.property('bing');
      expect(PROVIDER_USER_AGENT_PATTERNS.bing).to.include('Bingbot');
    });

    it('keeps provider patterns free of the Adobe-internal exclusion (handled in the filter)', () => {
      const { PROVIDER_USER_AGENT_PATTERNS } = userAgentPatterns;

      Object.values(PROVIDER_USER_AGENT_PATTERNS).forEach((pattern) => {
        expect(pattern).to.not.include('Tokowaka');
        expect(pattern).to.not.include('AdobeEdgeOptimize');
      });
    });
  });

  describe('buildAdobeInternalUaExclusion', () => {
    it('builds a full-string exclusion for Adobe-owned/proxied user agents', () => {
      const { buildAdobeInternalUaExclusion } = userAgentPatterns;

      expect(buildAdobeInternalUaExclusion()).to.equal(
        "NOT REGEXP_LIKE(user_agent, '(?i)(Tokowaka|Spacecat|AdobeEdgeOptimize)')",
      );
      expect(buildAdobeInternalUaExclusion('ua')).to.include('NOT REGEXP_LIKE(ua,');
    });

    it('rejects O@E-proxied and internal UAs in any position, matching the SQL semantics', () => {
      const { ADOBE_INTERNAL_UA_PATTERN } = userAgentPatterns;
      // Athena '(?i)' inline flag -> JS 'i' flag for a functional check
      const re = new RegExp(ADOBE_INTERNAL_UA_PATTERN.replace('(?i)', ''), 'i');

      // marker appended as suffix (O@E) and prepended (defensive) both caught
      expect(re.test('ChatGPT-User/1.0; +https://openai.com/bot AdobeEdgeOptimize/1.0')).to.equal(true);
      expect(re.test('Spacecat/1.0 ChatGPT-User/1.0')).to.equal(true);
      expect(re.test('Mozilla/5.0 ... Tokowaka/1.0 AdobeEdgeOptimize/1.0')).to.equal(true);
      // a genuine agentic UA is not excluded
      expect(re.test('ChatGPT-User/1.0')).to.equal(false);
    });
  });

  describe('buildUserAgentFilter exclusion', () => {
    it('appends the Adobe-internal exclusion to the agentic filter', () => {
      const { buildUserAgentFilter } = cdnUtils;
      expect(buildUserAgentFilter()).to.include(
        "AND NOT REGEXP_LIKE(user_agent, '(?i)(Tokowaka|Spacecat|AdobeEdgeOptimize)')",
      );
    });
  });

  describe('buildUserAgentFilter', () => {
    it('excludes searchbots and includes AI agents', () => {
      const { buildUserAgentFilter } = cdnUtils;
      const filter = buildUserAgentFilter();

      // Should exclude searchbots
      expect(filter).to.not.include('Googlebot');
      expect(filter).to.not.include('Google-Extended');
      expect(filter).to.not.include('Bingbot');

      // Should include AI agents (googleai, not google)
      expect(filter).to.include('ChatGPT');
      expect(filter).to.include('Perplexity');
      expect(filter).to.include('Google-?Agent');
      expect(filter).to.include('Google-NotebookLM');
      expect(filter).to.include('Claude');
      expect(filter).to.include('Shap(Bot|-User)');
      expect(filter).to.include('Manus-User');
      expect(filter).to.include('Keenable-User');
    });
  });

  describe('buildAgentTypeClassificationSQL', () => {
    it('builds SQL for ChatGPT and Perplexity agent types', () => {
      const { buildAgentTypeClassificationSQL } = userAgentPatterns;
      const sql = buildAgentTypeClassificationSQL();

      expect(sql).to.include('CASE');
      expect(sql).to.include('Web search crawlers');
      expect(sql).to.include('Ads bots');
      expect(sql).to.include('Chatbots');
      expect(sql).to.include('gptbot');
      expect(sql).to.include('oai-adsbot');
      expect(sql).to.include('perplexity');
      expect(sql).to.include('Search Bots');
      expect(sql).to.include('Action agents');
      expect(sql.toLowerCase()).to.include('googlebot');
      expect(sql.toLowerCase()).to.include('bingbot');
      expect(sql.toLowerCase()).to.include('google-extended');
      expect(sql.toLowerCase()).to.include('google-agent');
    });

    it('classifies Claude desktop/iOS app traffic as Media fetchers', () => {
      const { buildAgentTypeClassificationSQL } = userAgentPatterns;
      const sql = buildAgentTypeClassificationSQL();

      expect(sql).to.include("LIKE '%com.anthropic.claude%' THEN 'Media fetchers'");
      expect(sql).to.include("LIKE '%claude/%' THEN 'Media fetchers'");
    });

    it('classifies Google-NotebookLM as Chatbots (Research merged into Chatbots)', () => {
      const { buildAgentTypeClassificationSQL } = userAgentPatterns;
      const sql = buildAgentTypeClassificationSQL();

      expect(sql).to.include("LIKE '%google-notebooklm%' THEN 'Chatbots'");
      expect(sql).to.not.include('Research');
      expect(sql).to.not.include('gemini-deep-research');
      expect(sql).to.not.include('googleagent-mariner');
    });

    it('classifies new agentic search/user bots', () => {
      const { buildAgentTypeClassificationSQL } = userAgentPatterns;
      const sql = buildAgentTypeClassificationSQL();

      expect(sql).to.include("LIKE '%shapbot%' THEN 'Web search crawlers'");
      expect(sql).to.include("LIKE '%shap-user%' THEN 'Chatbots'");
      expect(sql).to.include("LIKE '%manus-user%' THEN 'Chatbots'");
      expect(sql).to.include("LIKE '%keenable-user%' THEN 'Web search crawlers'");
    });
  });

  describe('buildUserAgentDisplaySQL', () => {
    it('builds SQL for user agent display names', () => {
      const { buildUserAgentDisplaySQL } = userAgentPatterns;
      const sql = buildUserAgentDisplaySQL();

      expect(sql).to.include('CASE');
      expect(sql).to.include('ChatGPT-User');
      expect(sql).to.include('GPTBot');
      expect(sql).to.include('OAI-AdsBot');
      expect(sql).to.include('PerplexityBot');
      expect(sql).to.include('Google-Agent');
      expect(sql).to.include('GoogleBot');
      expect(sql).to.include('BingBot');
      expect(sql).to.include('Google-Extended');
    });

    it('collapses Claude desktop/iOS client UAs into a single "Claude Clients" bucket', () => {
      const { buildUserAgentDisplaySQL } = userAgentPatterns;
      const sql = buildUserAgentDisplaySQL();

      expect(sql).to.include("LIKE '%com.anthropic.claude%' THEN 'Claude Clients'");
      expect(sql).to.include("LIKE '%claude/%' THEN 'Claude Clients'");
    });
  });

  describe('inferProviderFromUserAgent', () => {
    it('maps known user agents to normalized provider labels', () => {
      const { inferProviderFromUserAgent } = userAgentPatterns;

      expect(inferProviderFromUserAgent('ChatGPT-User/1.0')).to.equal('ChatGPT');
      expect(inferProviderFromUserAgent('OAI-AdsBot/1.0')).to.equal('ChatGPT');
      expect(inferProviderFromUserAgent('PerplexityBot')).to.equal('Perplexity');
      expect(inferProviderFromUserAgent('ClaudeBot')).to.equal('Anthropic');
      expect(inferProviderFromUserAgent('Anthropic-SearchBot')).to.equal('Anthropic');
      expect(inferProviderFromUserAgent('GoogleAgent-Chrome')).to.equal('Gemini');
      expect(inferProviderFromUserAgent('GoogleAgent-URLContext')).to.equal('Gemini');
      expect(inferProviderFromUserAgent('GoogleAgent-Shopping')).to.equal('Gemini');
      expect(inferProviderFromUserAgent('Google-Agent')).to.equal('Gemini');
      expect(inferProviderFromUserAgent('Google-AI-Mode')).to.equal('Google AI Mode');
      expect(inferProviderFromUserAgent('google-notebooklm')).to.equal('Google');
      expect(inferProviderFromUserAgent('CopilotBot')).to.equal('Copilot');
      expect(inferProviderFromUserAgent('BingBot')).to.equal('Bing');
      expect(inferProviderFromUserAgent('MistralAI-Search')).to.equal('MistralAI');
      expect(inferProviderFromUserAgent('Amazonbot/0.1')).to.equal('Amazon');
      expect(inferProviderFromUserAgent('Shap-User/0.1.0')).to.equal('Parallel.ai');
      expect(inferProviderFromUserAgent('ShapBot/0.1.0')).to.equal('Parallel.ai');
      expect(inferProviderFromUserAgent('Manus-User/1.0')).to.equal('Manus');
      expect(inferProviderFromUserAgent('Keenable-User/1.0')).to.equal('Keenable.ai');
      // regexes must stay as specific as PROVIDER_USER_AGENT_PATTERNS -- not broad
      // substring matches that would misattribute an unrelated bot's provider
      expect(inferProviderFromUserAgent('reshape-bot/1.0')).to.equal('Other');
      expect(inferProviderFromUserAgent('manuscript-crawler/1.0')).to.equal('Other');
      expect(inferProviderFromUserAgent('unkeenable-thing/1.0')).to.equal('Other');
      expect(inferProviderFromUserAgent('something-unknown')).to.equal('Other');
    });
  });

  describe('CDN ingestion SQL (src/cdn-analysis/sql/*/insert-aggregated.sql)', () => {
    // Each provider's insert-aggregated.sql independently duplicates the "match known
    // LLM-related user-agents" REGEXP_LIKE inclusion list (different column name per
    // CDN, same regex literal) -- a UA that isn't in *this* list never reaches the
    // aggregated table, so Gate 1 (buildUserAgentFilter) never even sees it. This
    // guards that every provider stays in sync and that new bots are present here too.
    const providerDirs = fs.readdirSync(SQL_PROVIDERS_DIR)
      .filter((name) => fs.statSync(path.join(SQL_PROVIDERS_DIR, name)).isDirectory());

    function extractUaInclusionPattern(sql) {
      const match = sql.match(/match known LLM-related user-agents\s*\n\s*AND REGEXP_LIKE\([^,]+,\s*'([^']+)'\)/);
      return match?.[1] ?? null;
    }

    const patternsByProvider = Object.fromEntries(
      providerDirs.map((provider) => {
        const sql = fs.readFileSync(path.join(SQL_PROVIDERS_DIR, provider, 'insert-aggregated.sql'), 'utf8');
        return [provider, extractUaInclusionPattern(sql)];
      }),
    );

    it('has the UA inclusion regex in every provider file', () => {
      providerDirs.forEach((provider) => {
        expect(patternsByProvider[provider], `missing UA inclusion pattern in ${provider}`).to.not.be.null;
      });
    });

    it('keeps the UA inclusion regex identical across every CDN provider', () => {
      const [first, ...rest] = providerDirs;
      rest.forEach((provider) => {
        expect(patternsByProvider[provider], `${provider} drifted from ${first}`).to.equal(patternsByProvider[first]);
      });
    });

    it('includes every new agentic bot added in LLMO-7325', () => {
      const pattern = patternsByProvider[providerDirs[0]];

      expect(pattern).to.include('Shap(Bot|-User)');
      expect(pattern).to.include('Manus-User');
      expect(pattern).to.include('Keenable-User');
      expect(pattern).to.include('Google-NotebookLM');
    });
  });
});
