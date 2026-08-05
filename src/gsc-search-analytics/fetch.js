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

const PAGE = 1000; // GSC returns at most 1000 rows per call
const MAX_PAGES = 50; // safety cap: up to 50k rows per window

/**
 * Fetch all page-dimension rows for one window, paginating until Google returns
 * fewer than a full page. Bounded by MAX_PAGES so a very large site cannot run away.
 *
 * @param {object} google - GoogleClient instance exposing getOrganicSearchData.
 * @param {Date} startDate - window start.
 * @param {Date} endDate - window end.
 * @returns {Promise<Array<object>>} aggregated GSC rows (each keyed by page URL).
 */
export async function fetchWindow(google, startDate, endDate) {
  const all = [];
  let startRow = 0;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await google.getOrganicSearchData(startDate, endDate, ['page'], PAGE, startRow);
    const rows = res?.data?.rows ?? [];
    all.push(...rows);
    if (rows.length < PAGE) {
      break;
    }
    startRow += PAGE;
  }
  return all;
}
