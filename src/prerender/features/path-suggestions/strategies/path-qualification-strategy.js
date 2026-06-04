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
 * Base class for path qualification strategies.
 * Subclasses must implement `qualify(pathPattern, urls)`.
 *
 * Currently has one concrete implementation (RcvPathQualificationStrategy).
 * Additional strategies (e.g. traffic-only, content-quality-only) are planned
 * for future PRs to allow per-site or per-org strategy selection.
 *
 * @abstract
 */
export class PathQualificationStrategy {
  /**
   * Evaluates whether a path group qualifies as a suggestion.
   *
   * @param {string} pathPattern - The path pattern (e.g. '/products/*')
   * @param {Array} urls - Enriched URL objects with agenticTraffic, valuable, contentGainRatio
   * @returns {{ qualifies: boolean, score: number, reason?: string }}
   * @abstract
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  qualify(pathPattern, urls) {
    throw new Error('Subclasses must implement qualify(pathPattern, urls)');
  }
}
