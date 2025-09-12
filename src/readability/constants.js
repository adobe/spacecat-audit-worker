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

export const READABILITY_GUIDANCE_TYPE = 'guidance:readability';
export const READABILITY_OBSERVATION = 'Content readability needs improvement';
export const MYSTIQUE_BATCH_SIZE = 10;

// Target Flesch Reading Ease score - scores below this will be flagged as poor readability
// Applied to all languages since the custom formulas already account for language differences
export const TARGET_READABILITY_SCORE = 30;

// Minimum character length for text chunks to be considered for readability analysis
export const MIN_TEXT_LENGTH = 100;

// Maximum characters to display in the audit report
export const MAX_CHARACTERS_DISPLAY = 200;
