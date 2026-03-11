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

import { CWV_THRESHOLDS } from './constants.js';

/**
 * Categorizes a URL based on CWV metrics.
 * - Good: all available metrics within good thresholds
 * - Poor: any available metric exceeds poor threshold (OR logic)
 * - Needs Improvement: everything else
 * - null: no metrics available
 *
 * @param {number|null} lcp - Largest Contentful Paint (ms)
 * @param {number|null} cls - Cumulative Layout Shift
 * @param {number|null} inp - Interaction to Next Paint (ms)
 * @returns {'good'|'needsImprovement'|'poor'|null}
 */
export function categorizeUrl(lcp, cls, inp) {
  const hasLcp = lcp !== null && lcp !== undefined;
  const hasCls = cls !== null && cls !== undefined;
  const hasInp = inp !== null && inp !== undefined;

  if (!hasLcp && !hasCls && !hasInp) return null;

  const isPoor = (hasLcp && lcp > CWV_THRESHOLDS.LCP.POOR)
    || (hasCls && cls > CWV_THRESHOLDS.CLS.POOR)
    || (hasInp && inp > CWV_THRESHOLDS.INP.POOR);
  if (isPoor) return 'poor';

  const isGood = (!hasLcp || lcp <= CWV_THRESHOLDS.LCP.GOOD)
    && (!hasCls || cls <= CWV_THRESHOLDS.CLS.GOOD)
    && (!hasInp || inp <= CWV_THRESHOLDS.INP.GOOD);
  if (isGood) return 'good';

  return 'needsImprovement';
}
