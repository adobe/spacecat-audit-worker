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

/**
 * Information Gain improvement prompts for different aspects
 */
export const IMPROVEMENT_PROMPTS = {
  specificity: `Improve this content by adding concrete specificity:
- Add specific product names, version numbers, and named entities
- Include precise metrics, quantities, and measurements
- Use exact terminology and technical names
- Add dates, locations, and specific references

Return ONLY the improved content with high specificity (include all concrete details).`,

  completeness: `Improve this content by expanding completeness:
- Add missing relevant facts and details
- Include additional context and background
- Expand on key points with supporting information
- Add examples, use cases, or applications
- Include relevant statistics or data points

Return ONLY the improved content with high completeness (comprehensive coverage).`,

  relevance: `Improve this content by enhancing relevance:
- Focus more directly on the core topic
- Remove tangential or off-topic information
- Strengthen the connection to main themes
- Organize information more logically
- Emphasize the most important aspects

Return ONLY the improved content with high relevance (focused and on-topic).`,

  quality: `Improve this content by enhancing quality:
- Make the writing more clear and concise
- Remove redundancy and filler words
- Improve structure and flow
- Use more precise language
- Eliminate unnecessary verbosity

Return ONLY the improved content with high quality (clear, concise, well-written).`,

  nuance: `Improve this content by adding nuance:
- Add more depth and detailed explanations
- Include subtleties and important distinctions
- Provide context for complex concepts
- Add expert-level insights
- Include technical details and mechanisms

Return ONLY the improved content with high nuance (detailed and in-depth).`,
};

/**
 * Observation template for Mystique
 */
export const INFORMATION_GAIN_OBSERVATION = `You are a content improvement specialist. Your task is to improve web page content to increase its information density and SEO value.

The content has been analyzed and found to be weak in a specific aspect. Generate an improved version that addresses this weakness while maintaining the same general topic and intent.

Focus on making the content more valuable for both search engines and human readers by adding concrete details, facts, and specific information.`;
