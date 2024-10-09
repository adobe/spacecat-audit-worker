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
export const NON_UNIQUE = 'non-unique';
export const MISSING_TAGS = 'missing_tags';
export const EMPTY_TAGS = 'empty_tags';
export const LENGTH_CHECK_FAIL_TAGS = 'length_check_fail_tags';
export const DUPLICATE_TAGS = 'duplicate_tags';
export const MULTIPLE_H1_COUNT = 'multiple_h1_count';

// Tags lengths
export const TAG_LENGTHS = {
  [TITLE]: {
    minLength: 25,
    maxLength: 70,
  },
  [DESCRIPTION]: {
    minLength: 100,
    maxLength: 175,
  },
  [H1]: {
    maxLength: 75,
  },
};
