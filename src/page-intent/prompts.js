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
/* c8 ignore start */
const MAX_CONTENT_LENGTH = 10000;

export const SYSTEM_PROMPT = `You are an expert in search intent classification and content analysis.
Analyze webpage content to determine its primary search intent and main topic.

Return JSON with:
- pageIntent: one of "INFORMATIONAL", "NAVIGATIONAL", "COMMERCIAL", "TRANSACTIONAL"
- topic: main topic/product (e.g., "Photoshop", "Firefly", "Express")

Intent definitions:
- INFORMATIONAL: Provides information, answers questions, educational content
- NAVIGATIONAL: Helps users navigate to specific pages or sections
- COMMERCIAL: Compares products/services, reviews, research before purchase
- TRANSACTIONAL: Designed for completing transactions, purchases, conversions

If there is insufficient data to confidently classify the page, return null for pageIntent.

Return a pure JSON string without markdown. Example output:
{
  "pageIntent": "COMMERCIAL",
  "topic": "Firefly"
}
`;

export function createUserPrompt(url, textContent) {
  const truncatedContent = textContent.length > MAX_CONTENT_LENGTH
    ? `${textContent.substring(0, MAX_CONTENT_LENGTH)}... [content truncated]`
    : textContent;

  return `URL: ${url}

Page Content:
${truncatedContent}

Analyze this page and return the intent classification and main topic.`;
}
/* c8 ignore end */
