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

import { calculateStats } from '@adobe/spacecat-shared-html-analyzer';

const BOT_USER_AGENT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/chatgpt)';
const NORMAL_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Calculate citability score from bot and normal HTML
 */
export async function calculateCitabilityScore(botHtml, normalHtml) {
  const stats = await calculateStats(botHtml, normalHtml, true);

  return {
    citabilityScore: stats.citationReadability,
    contentRatio: stats.contentIncreaseRatio,
    wordDifference: stats.wordDiff,
    botWords: stats.wordCountBefore,
    normalWords: stats.wordCountAfter,
  };
}

/**
 * User-agent configurations for scraping
 */
export const USER_AGENTS = {
  BOT: BOT_USER_AGENT,
  NORMAL: NORMAL_USER_AGENT,
};
