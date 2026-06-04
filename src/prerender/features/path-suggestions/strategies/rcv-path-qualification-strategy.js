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

import {
  PATH_TYPE_MIN_URLS,
  PATH_TYPE_MIN_VALUABLE_PCT,
  PATH_TYPE_SCORE_THRESHOLD,
} from '../../../utils/constants.js';

/**
 * Creates a path qualification function using the rcv-scoring-dashboard formula.
 * Returns a qualify(pathPattern, urls) function bound to the given thresholds.
 *
 * @param {Object} [options]
 * @param {number} [options.minUrls]
 * @param {number} [options.minValuablePct]
 * @param {number} [options.scoreThreshold]
 * @returns {Function} qualify(pathPattern, urls) → { qualifies, score, reason? }
 */
export function createRcvQualifier({
  minUrls = PATH_TYPE_MIN_URLS,
  minValuablePct = PATH_TYPE_MIN_VALUABLE_PCT,
  scoreThreshold = PATH_TYPE_SCORE_THRESHOLD,
} = {}) {
  return function qualify(pathPattern, urls) {
    if (urls.length < minUrls) {
      return { qualifies: false, score: 0, reason: `urlCount ${urls.length} < minUrls ${minUrls}` };
    }

    const valuableCount = urls.filter((u) => u.valuable === true).length;
    const valuablePercent = (valuableCount / urls.length) * 100;
    if (valuablePercent < minValuablePct) {
      return {
        qualifies: false,
        score: 0,
        reason: `valuablePercent ${valuablePercent.toFixed(1)}% < minValuablePct ${minValuablePct}%`,
      };
    }

    const totalAgenticTraffic = urls.reduce((sum, u) => sum + (u.agenticTraffic || 0), 0);
    let weightedValuableTraffic = 0;
    if (totalAgenticTraffic > 0) {
      for (const u of urls) {
        weightedValuableTraffic += (u.agenticTraffic / totalAgenticTraffic) * (u.valuable ? 1 : 0);
      }
    }
    const avgContentGainRatio = urls.reduce((sum, u) => sum + (u.contentGainRatio || 0), 0)
      / urls.length;
    const score = parseFloat((weightedValuableTraffic + avgContentGainRatio).toFixed(4));

    if (score < scoreThreshold) {
      return { qualifies: false, score, reason: `score ${score} < scoreThreshold ${scoreThreshold}` };
    }

    return {
      qualifies: true,
      score,
      contentGainRatio: parseFloat(avgContentGainRatio.toFixed(2)),
    };
  };
}
