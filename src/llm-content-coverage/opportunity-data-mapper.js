/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

export const AUDIT_TYPE = 'llm-content-coverage';

/**
 * Creates opportunity data for the LLM Content Coverage audit.
 *
 * @param {{
 *   domain: string,
 *   topics: Array<{
 *     topic: string,
 *     promptCount: number,
 *     brandCitations: number,
 *     brandMentions: number,
 *     gapScore: number,
 *     matchedTopicName: string,
 *     similarityScore: number,
 *     lowRankKeywords: Array<{ keyword: string, volume: number, brandPosition: number }>
 *   }>
 * }} props
 * @returns {object}
 */
export function createOpportunityData({ domain = '', topics = [] } = {}) {
  const topicsWithKeywords = topics.filter((t) => t.lowRankKeywords?.length > 0);
  const totalKeywords = topics.reduce((sum, t) => sum + (t.lowRankKeywords?.length ?? 0), 0);

  return {
    title: 'LLM Content Coverage',
    description: `Found ${topics.length} topic(s) for ${domain} where AI prompt volume is high but brand citation is low. ${totalKeywords} low-ranking keyword(s) identified across ${topicsWithKeywords.length} topic(s) — adding content for these can improve AI citation and search visibility.`,
    type: AUDIT_TYPE,
    origin: 'AUTOMATION',
    tags: ['llm', 'content-coverage', 'brand-presence'],
    data: {
      domain,
      topics: topics.map((t) => ({
        topic: t.topic,
        promptCount: t.promptCount,
        brandCitations: t.brandCitations,
        brandMentions: t.brandMentions,
        gapScore: Math.round(t.gapScore),
      })),
      semrushTopics: topics.map((t) => ({
        topic: t.topic,
        matchedTopicName: t.matchedTopicName ?? null,
        similarityScore: t.similarityScore ?? null,
        keywords: (t.lowRankKeywords ?? []).map((k) => ({
          keyword: k.keyword,
          volume: k.volume,
          brandPosition: k.brandPosition,
        })),
      })),
    },
  };
}
