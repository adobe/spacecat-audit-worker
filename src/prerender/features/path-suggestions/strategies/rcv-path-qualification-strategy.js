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
import { PathQualificationStrategy } from './path-qualification-strategy.js';

/**
 * Qualification strategy that mirrors rcv-scoring-dashboard's computeScore formula exactly.
 *
 * @extends PathQualificationStrategy
 */
export class RcvPathQualificationStrategy extends PathQualificationStrategy {
  constructor({
    minUrls = PATH_TYPE_MIN_URLS,
    minValuablePct = PATH_TYPE_MIN_VALUABLE_PCT,
    scoreThreshold = PATH_TYPE_SCORE_THRESHOLD,
  } = {}) {
    super();
    this.minUrls = minUrls;
    this.minValuablePct = minValuablePct;
    this.scoreThreshold = scoreThreshold;
  }

  qualify(pathPattern, urls) {
    if (urls.length < this.minUrls) {
      return { qualifies: false, score: 0, reason: `urlCount ${urls.length} < minUrls ${this.minUrls}` };
    }

    const valuableCount = urls.filter((u) => u.valuable === true).length;
    const valuablePercent = (valuableCount / urls.length) * 100;
    if (valuablePercent < this.minValuablePct) {
      return {
        qualifies: false,
        score: 0,
        reason: `valuablePercent ${valuablePercent.toFixed(1)}% < minValuablePct ${this.minValuablePct}%`,
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

    if (score < this.scoreThreshold) {
      return { qualifies: false, score, reason: `score ${score} < scoreThreshold ${this.scoreThreshold}` };
    }

    return {
      qualifies: true,
      score,
      valuableCount,
      valuablePercent: parseFloat(valuablePercent.toFixed(1)),
    };
  }
}
