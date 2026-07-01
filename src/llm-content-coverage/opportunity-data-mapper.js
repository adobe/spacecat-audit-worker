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
 * Called by convertToOpportunity with the `props` argument.
 *
 * @param {{ domain: string, topicCount: number }} props
 * @returns {object}
 */
export function createOpportunityData({ domain = '', topicCount = 0 } = {}) {
  return {
    title: 'LLM Content Coverage',
    description: `Found ${topicCount} topic(s) for ${domain} where AI prompt volume is high but brand presence is low. Adding content for these topics can improve AI citation and brand visibility.`,
    type: AUDIT_TYPE,
    tags: ['llm', 'content-coverage', 'brand-presence'],
    data: {
      domain,
      topicCount,
    },
  };
}
