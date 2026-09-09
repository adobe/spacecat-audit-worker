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

/**
 * Per-site V1 -> V2 cutover: a site's opportunity is owned by the Mystique blackboard
 * producer cascade — rather than this legacy audit — when its per-audit
 * `deliveryConfig.<engineField>` is set to `"blackboard"` (Spec 009-04 / ADR-0022).
 *
 * Generalizes the CWV-specific `isCwvBlackboardEngine` (see `src/cwv/handler.js`, #2825)
 * so any audit can gate on its own engine field (`canonicalEngine`, `metaTagsEngine`,
 * `brokenInternalLinksEngine`, ...). Degrades to legacy on absent / null / any other
 * value.
 */
export const BLACKBOARD_ENGINE = 'blackboard';

/**
 * @param {Object} site - Site with a `getDeliveryConfig()` accessor.
 * @param {string} engineField - The per-audit deliveryConfig key, e.g. `"canonicalEngine"`.
 * @returns {boolean} True when the flag selects the Mystique blackboard engine.
 */
export function isBlackboardEngine(site, engineField) {
  return site?.getDeliveryConfig?.()?.[engineField] === BLACKBOARD_ENGINE;
}
