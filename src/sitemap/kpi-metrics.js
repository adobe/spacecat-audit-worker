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

const PROJECTED_TRAFFIC_INCREASE = 0.10; // +10%

/**
 * Calculates the projected traffic increase for a given set of pages.
 *
 * @param {Array<object>} pagesWithIssues - An array of page objects with issues.
 * @param {Function} getAvgOrganicTraffic - A function to retrieve the average organic traffic.
 * @returns {Promise<number>} A promise that resolves to the total projected traffic increase.
 */
// eslint-disable-next-line no-shadow
async function calculateProjectedTraffic(pagesWithIssues, getAvgOrganicTraffic) {
  let totalProjectedTraffic = 0;

  for (const page of pagesWithIssues) {
    // eslint-disable-next-line no-await-in-loop
    const traffic = await getAvgOrganicTraffic(page.pageUrl);
    totalProjectedTraffic += traffic * PROJECTED_TRAFFIC_INCREASE;
  }

  return Math.round(totalProjectedTraffic);
}

/**
 * Retrieves the average organic traffic for a given URL from the RUM API.
 *
 * @param {import('@adobe/spacecat-shared-data-access/src/models/site.js').default} site - Site.
 * @param {string} pageUrl - The URL of the page to retrieve traffic data for.
 * @param {object} context - The context object.
 * @returns {Promise<number>} A promise that resolves to the average organic traffic.
 */
async function getAvgOrganicTraffic(site, pageUrl, context) {
  const { rumApiClient } = context;
  const siteId = site.getId();

  const params = {
    url: pageUrl,
    source: '-organic.search',
  };

  const traffic = await rumApiClient.getTraffic(params, 7, siteId);
  return traffic.length > 0 ? traffic[0].views : 0;
}

/**
 * Calculates KPIs for the sitemap audit.
 *
 * @param {Array<object>} pagesWithIssues - An array of page objects with issues.
 * @param {import('@adobe/spacecat-shared-data-access/src/models/site.js').default} site - Site.
 * @param {object} context - The context object.
 * @returns {Promise<{
 *  PROJECTED_TRAFFIC_LOST: number,
 *  PROJECTED_TRAFFIC_VALUE: number
 * }>} A promise that resolves to an object containing the calculated KPIs.
 */
export async function calculateKpis(pagesWithIssues, site, context) {
  if (!pagesWithIssues || pagesWithIssues.length === 0) {
    return {
      PROJECTED_TRAFFIC_LOST: 0,
      PROJECTED_TRAFFIC_VALUE: 0,
    };
  }
  const avgOrganicTrafficFetcher = (url) => getAvgOrganicTraffic(site, url, context);

  const projectedTrafficLost = await calculateProjectedTraffic(
    pagesWithIssues,
    avgOrganicTrafficFetcher,
  );

  const cpc = 1;

  return {
    PROJECTED_TRAFFIC_LOST: projectedTrafficLost,
    PROJECTED_TRAFFIC_VALUE: Math.round(projectedTrafficLost * cpc),
  };
}
