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

import { addDays } from 'date-fns';

/**
 * Computes the next domain-level 403 block entry, or null if threshold not met (auto-restore).
 * Backoff: 2d → 4d → 8d (capped at 8d, repeating).
 *
 * @param {Object|undefined} existingDomainBlock - Current block from status.json root
 * @param {number} batch403Count - Number of 403 errors in the latest scrape batch
 * @param {number} batchSize - Total URLs in the latest scrape batch
 * @returns {{skipUntil: string, consecutiveBlocks: number}|null}
 */
export function computeDomainBlock(existingDomainBlock, batch403Count, batchSize) {
  const threshold = Math.max(50, Math.ceil(batchSize * 0.5));
  if (batch403Count < threshold) {
    return null;
  }
  const consecutiveBlocks = (existingDomainBlock?.consecutiveBlocks ?? 0) + 1;
  const skipDays = [2, 4, 8][Math.min(consecutiveBlocks - 1, 2)];
  return { skipUntil: addDays(new Date(), skipDays).toISOString(), consecutiveBlocks };
}
