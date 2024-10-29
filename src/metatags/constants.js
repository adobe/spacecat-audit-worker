/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// Tag Names
export const TITLE = 'title';
export const DESCRIPTION = 'description';
export const H1 = 'h1';

// SEO impact category
export const HIGH = 'High';
export const MODERATE = 'Moderate';

// Audit result constants
export const ISSUE = 'issue';
export const ISSUE_DETAILS = 'issueDetails';
export const SEO_RECOMMENDATION = 'seoRecommendation';
export const SEO_IMPACT = 'seoImpact';
export const DUPLICATES = 'duplicates';
export const MULTIPLE_H1_ON_PAGE = 'Multiple H1 on page';

// SEO Guidelines Suggestions
export const SHOULD_BE_PRESENT = 'Should be present';
export const UNIQUE_ACROSS_PAGES = 'Unique across pages';
export const TITLE_LENGTH_SUGGESTION = '40-60 characters long';
export const DESCRIPTION_LENGTH_SUGGESTION = '140-160 characters long';
export const H1_LENGTH_SUGGESTION = 'Below 70 characters';
export const ONE_H1_ON_A_PAGE = '1 H1 on a page';

// Tags lengths
export const TAG_LENGTHS = {
  [TITLE]: {
    minLength: 25,
    maxLength: 75,
    idealMinLength: 40,
    idealMaxLength: 60,
  },
  [DESCRIPTION]: {
    minLength: 100,
    maxLength: 175,
    idealMinLength: 140,
    idealMaxLength: 160,
  },
  [H1]: {
    maxLength: 75,
    idealMaxLength: 70,
  },
};
