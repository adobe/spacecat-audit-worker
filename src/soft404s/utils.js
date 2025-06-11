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
import { SOFT_404_INDICATORS } from './constants.js';

export const extractTextAndCountWords = (html) => {
  if (!html || typeof html !== 'string') {
    return { textContent: '', wordCount: 0 };
  }

  // Remove script and style elements
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Extract text content by removing HTML tags
  const textContent = cleanHtml
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Count words (split by whitespace and filter out empty strings)
  const words = textContent.split(/\s+/).filter((word) => word.length > 0);
  const wordCount = words.length;

  return { textContent, wordCount };
};

/**
 * Checks if content contains soft 404 indicators
 * @param {string} textContent - Text content to check
 * @returns {Array} - Array of matched indicators
 */
export const checkSoft404Indicators = (textContent) => {
  if (!textContent) return [];

  const lowerContent = textContent.toLowerCase();
  const matchedIndicators = [];

  SOFT_404_INDICATORS.forEach((indicator) => {
    if (lowerContent.includes(indicator.toLowerCase())) {
      matchedIndicators.push(indicator);
    }
  });

  return matchedIndicators;
};
