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
 * Compute the after-minus-before change for one URL's metrics.
 * A negative position delta means the URL moved up in results (better).
 *
 * @param {{clicks:number, impressions:number, ctr:number, position:number}} before
 * @param {{clicks:number, impressions:number, ctr:number, position:number}} after
 * @returns {{clicks:number, impressions:number, ctr:number, position:number}}
 */
export function buildDelta(before, after) {
  return {
    clicks: after.clicks - before.clicks,
    impressions: after.impressions - before.impressions,
    ctr: after.ctr - before.ctr,
    position: after.position - before.position,
  };
}
