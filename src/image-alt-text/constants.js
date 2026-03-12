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

// Projected traffic metrics
export const CPC = 1; // $1
export const PENALTY_PER_IMAGE = 0.01; // 1%
export const RUM_INTERVAL = 30; // days

export const ALT_TEXT_GUIDANCE_TYPE = 'guidance:missing-alt-text';
export const ALT_TEXT_OBSERVATION = 'Missing alt text on images';

// Preflight audit constants
export const PREFLIGHT_ALT_TEXT_GUIDANCE_TYPE = 'guidance:preflight-alt-text';
export const PREFLIGHT_ALT_TEXT_OBSERVATION = 'Missing or low-quality alt text on images';

// Shared constants for alt text analysis
export const MAX_ALT_TEXT_LENGTH = 125;

export const MYSTIQUE_BATCH_SIZE = 10;

// Page limits for alt-text audit
export const SUMMIT_PLG_PAGE_LIMIT = 20;
export const DEFAULT_PAGE_LIMIT = 100;
