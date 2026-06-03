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
 * Interface for path qualification strategies.
 * Any object with a `qualify(pathPattern, urls)` method can serve as a strategy.
 *
 * @typedef {Object} QualificationResult
 * @property {boolean} qualifies - Whether the path group qualifies for a suggestion
 * @property {number} score - Computed score for the path group
 * @property {string} [reason] - Reason for disqualification (when qualifies=false)
 *
 * @typedef {Object} PathQualificationStrategy
 * @property {function(string, Array): QualificationResult} qualify
 *   Evaluates whether a path group qualifies as a suggestion.
 *   @param {string} pathPattern - The path pattern (e.g. '/products/*')
 *   @param {Array} urls - Enriched URL objects with agenticTraffic, valuable, contentGainRatio
 *   @returns {QualificationResult}
 */

/**
 * Validates that a strategy object conforms to the PathQualificationStrategy interface.
 *
 * @param {Object} strategy
 * @throws {TypeError} If the strategy does not implement qualify()
 */
export function assertValidStrategy(strategy) {
  if (typeof strategy?.qualify !== 'function') {
    throw new TypeError('Strategy must implement qualify(pathPattern, urls)');
  }
}
