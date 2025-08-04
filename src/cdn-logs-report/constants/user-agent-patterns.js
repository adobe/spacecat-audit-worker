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
export const PROVIDER_USER_AGENT_PATTERNS = {
  chatgpt: '(?i)ChatGPT|GPTBot|OAI-SearchBot',
  perplexity: '(?i)Perplexity',
  claude: '(?i)Claude|Anthropic',
  gemini: '(?i)Gemini',
  copilot: '(?i)Copilot',
  google: '(?i)Googlebot',
  bing: '(?i)Bingbot',
};

export function getProviderPattern(provider) {
  return PROVIDER_USER_AGENT_PATTERNS[provider?.toLowerCase()] || null;
}

export function buildAgentTypeClassificationSQL(provider = null) {
  const allPatterns = [
    // ChatGPT/OpenAI
    { pattern: '%gptbot%', result: 'Crawlers', provider: 'chatgpt' },
    { pattern: '%oai-searchbot%', result: 'Crawlers', provider: 'chatgpt' },
    { pattern: '%chatgpt-user%', result: 'Chatbots', provider: 'chatgpt' },
    { pattern: '%chatgpt%', result: 'Chatbots', provider: 'chatgpt' },
    // Perplexity
    { pattern: '%perplexitybot%', result: 'Crawlers', provider: 'perplexity' },
    { pattern: '%perplexity-user%', result: 'Chatbots', provider: 'perplexity' },
    { pattern: '%perplexity%', result: 'Chatbots', provider: 'perplexity' },
    // Others
    { pattern: '%googlebot%', result: 'Crawlers', provider: 'google' },
    { pattern: '%bingbot%', result: 'Crawlers', provider: 'bing' },
  ];

  const patterns = provider ? allPatterns.filter((p) => p.provider === provider) : allPatterns;
  const cases = patterns.map((p) => `WHEN LOWER(user_agent) LIKE '${p.pattern}' THEN '${p.result}'`).join('\n          ');

  return `CASE\n          ${cases}\n          ELSE 'Other'\n        END`;
}
