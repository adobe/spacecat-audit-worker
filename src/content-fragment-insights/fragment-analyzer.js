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

export const UNUSED_CONTENT_STATUSES = ['NEW', 'DRAFT', 'UNPUBLISHED', 'MODIFIED'];

export class FragmentAnalyzer {
  static DAY_IN_MS = 24 * 60 * 60 * 1000;

  static UNUSED_CONTENT_THRESHOLD_DAYS = 90;

  constructor(
    log = console,
    unusedThresholdDays = FragmentAnalyzer.UNUSED_CONTENT_THRESHOLD_DAYS,
  ) {
    this.log = log;
    this.unusedThresholdMs = FragmentAnalyzer.DAY_IN_MS * unusedThresholdDays;
  }

  static hasUnusedStatus(status) {
    if (!status) {
      return false;
    }

    const normalized = status.toUpperCase();
    return UNUSED_CONTENT_STATUSES.includes(normalized);
  }

  findUnusedFragments(fragments = []) {
    const now = Date.now();
    const unusedFragments = [];

    for (const fragment of fragments) {
      if (!FragmentAnalyzer.hasUnusedStatus(fragment.status)) {
        // eslint-disable-next-line no-continue
        continue;
      }

      // TODO: Check MODIFIED content to be unpublished before adding to unused fragments

      const lastTimestamp = fragment.modifiedAt || fragment.createdAt || null;
      if (!lastTimestamp) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const lastDate = new Date(lastTimestamp);
      const lastTime = lastDate.getTime();
      if (Number.isNaN(lastTime)) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const ageMs = now - lastTime;
      if (ageMs >= this.unusedThresholdMs) {
        const ageInDays = Math.floor(ageMs / FragmentAnalyzer.DAY_IN_MS);
        unusedFragments.push({
          fragmentPath: fragment.fragmentPath,
          status: fragment.status,
          ageInDays,
          lastModified: lastTimestamp,
          publishedAt: fragment.publishedAt || null,
        });
      }
    }

    this.log.info(`[Content Fragment Insights] Found ${unusedFragments.length} unused fragments`);

    return unusedFragments;
  }
}
