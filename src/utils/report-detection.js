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
 * Returns true when opportunity looks like a Paid Traffic/Media periodic report.
 * Matches ASO UI logic:
 * - Title contains either "paid media" or "paid traffic" (case-insensitive)
 * - Title contains either "weekly" or "monthly" (case-insensitive)
 * - Type is "paid-traffic"
 *
 * @param {Object} opp - Opportunity object with getTitle(), getType() methods
 * @returns {boolean} True if opportunity is a paid traffic report
 */
export function isPaidTrafficReport(opp) {
  if (!opp) {
    return false;
  }

  const title = (opp.getTitle?.() || '').toLowerCase();
  const type = (opp.getType?.() || '').toLowerCase();

  const isPaidTitle = title.includes('paid media') || title.includes('paid traffic');
  // Detect "week/weekly" or "month/monthly" anywhere in the title
  const isPeriodic = /(weekly|week|monthly|month)/i.test(title);
  const isPaidType = type === 'paid-traffic';

  return isPaidType && isPaidTitle && isPeriodic;
}
