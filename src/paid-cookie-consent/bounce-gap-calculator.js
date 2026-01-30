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
 * Calculates bounce gap loss.
 * Formula: sum of (pageViews × max(0, bounceRate_treatment - bounceRate_control)) per group
 *
 * @param {Object} grouped - Data grouped by dimension, e.g.:
 *   { paid: { show: { pageViews, bounceRate }, hidden: { pageViews, bounceRate } } }
 * @param {Object} log - Logger instance
 * @param {string} treatment - Treatment key (default: 'show')
 * @param {string} control - Control key (default: 'hidden')
 * @returns {Object} { totalLoss, byGroup }
 */
export function calculateBounceGapLoss(grouped, log, treatment = 'show', control = 'hidden') {
  const byGroup = {};
  let totalLoss = 0;
  let skipped = 0;

  Object.entries(grouped).forEach(([group, variants]) => {
    const t = variants[treatment];
    const c = variants[control];

    if (!t || !c) {
      skipped += 1;
      return;
    }

    const delta = Math.max(0, t.bounceRate - c.bounceRate);
    const loss = t.pageViews * delta;

    byGroup[group] = { loss, delta };
    totalLoss += loss;
  });

  const groups = Object.keys(byGroup);
  log.debug(`[bounce-gap] groups=${groups.length}, skipped=${skipped}, totalLoss=${totalLoss.toFixed(0)}`);

  return { totalLoss, byGroup };
}
