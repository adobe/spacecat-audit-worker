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

export const USER_AGENT_DISPLAY_PATTERNS = [
  { pattern: '%chatgpt-user%', displayName: 'ChatGPT-User' },
  { pattern: '%gptbot%', displayName: 'GPTBot' },
  { pattern: '%oai-searchbot%', displayName: 'OAI-SearchBot' },
  { pattern: '%perplexitybot%', displayName: 'PerplexityBot' },
  { pattern: '%perplexity-user%', displayName: 'Perplexity-User' },
  { pattern: '%gemini-deep-research%', displayName: 'Gemini-Deep-Research' },
  { pattern: 'google', displayName: 'Google-ai-mode' },
];

export function buildUserAgentDisplaySQL() {
  const cases = USER_AGENT_DISPLAY_PATTERNS
    .map((p) => `WHEN LOWER(user_agent) LIKE '${p.pattern}' THEN '${p.displayName}'`)
    .join('\n    ');

  return `CASE 
    ${cases}
    ELSE SUBSTR(user_agent, 1, 100)
  END`;
}

export function buildAgentTypeClassificationSQL() {
  const patterns = [
    // ChatGPT/OpenAI
    { pattern: '%gptbot%', result: 'Training bots' },
    { pattern: '%oai-searchbot%', result: 'Web search crawlers' },
    { pattern: '%chatgpt-user%', result: 'Chatbots' },
    { pattern: '%chatgpt%', result: 'Chatbots' },
    // Perplexity
    { pattern: '%perplexitybot%', result: 'Web search crawlers' },
    { pattern: '%perplexity-user%', result: 'Chatbots' },
    { pattern: '%perplexity%', result: 'Chatbots' },
    // Google
    { pattern: '%gemini-deep-research%', result: 'Research' },
    { pattern: 'google', result: 'Web search crawlers' },
  ];

  const cases = patterns.map((p) => `WHEN LOWER(user_agent) LIKE '${p.pattern}' THEN '${p.result}'`).join('\n          ');

  return `CASE
          ${cases}
          ELSE 'Other'
        END`;
}
