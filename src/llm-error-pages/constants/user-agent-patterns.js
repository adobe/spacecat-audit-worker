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

export const LLM_USER_AGENT_PATTERNS = {
  chatgpt: '(?i)ChatGPT|GPTBot|OAI-SearchBot',
  perplexity: '(?i)Perplexity',
  claude: '(?i)Claude|Anthropic',
  gemini: '(?i)Gemini',
  copilot: '(?i)Copilot',
};

export function getLlmProviderPattern(provider) {
  return LLM_USER_AGENT_PATTERNS[provider?.toLowerCase()] || null;
}

export function getAllLlmProviders() {
  return Object.keys(LLM_USER_AGENT_PATTERNS);
}

export function buildLlmUserAgentFilter(providers = null) {
  const targetProviders = providers || getAllLlmProviders();
  const patterns = targetProviders
    .map((provider) => getLlmProviderPattern(provider))
    .filter(Boolean);

  if (patterns.length === 0) {
    return null;
  }

  return `REGEXP_LIKE(user_agent, '${patterns.join('|')}')`;
}

/**
 * Normalizes raw user agent string to clean provider name
 * @param {string} rawUserAgent - Raw user agent string like "mozilla chatgtpt sdd"
 * @returns {string} Clean provider name like "ChatGPT" or original if no match
 */
export function normalizeUserAgentToProvider(rawUserAgent) {
  if (!rawUserAgent) return 'Unknown';

  if (/chatgpt|gptbot|oai-searchbot/i.test(rawUserAgent)) {
    return 'ChatGPT';
  }
  if (/perplexity/i.test(rawUserAgent)) {
    return 'Perplexity';
  }
  if (/claude|anthropic/i.test(rawUserAgent)) {
    return 'Claude';
  }
  if (/gemini/i.test(rawUserAgent)) {
    return 'Gemini';
  }
  if (/copilot/i.test(rawUserAgent)) {
    return 'Copilot';
  }

  return rawUserAgent;
}
