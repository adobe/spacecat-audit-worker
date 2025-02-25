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
const DEFAULT_CPC_VALUE = 1;
const TRAFFIC_MULTIPLIER = 0.01; // 1%
const MAX_LINKS_TO_CONSIDER = 10;

/**
 * Calculates KPI deltas based on broken internal links audit data
 * @param {Object} auditData - The audit data containing results
 * @returns {Object} KPI delta calculations
 */
function calculateKpiDeltasForAudit(auditData) {
  const brokenLinks = auditData?.auditResult?.brokenInternalLinks || [];

  const groups = {};

  for (const link of brokenLinks) {
    if (!groups[link.urlTo]) {
      groups[link.urlTo] = [];
    }
    groups[link.urlTo].push(link);
  }

  let projectedTrafficLost = 0;

  Object.keys(groups).forEach((url) => {
    const links = groups[url];
    let linksToBeIncremented;
    // Sort links by traffic domain if there are more than MAX_LINKS_TO_CONSIDER
    // and only consider top MAX_LINKS_TO_CONSIDER for calculating deltas
    if (links.length > MAX_LINKS_TO_CONSIDER) {
      links.sort((a, b) => b.trafficDomain - a.trafficDomain);
      linksToBeIncremented = links.slice(0, MAX_LINKS_TO_CONSIDER);
    } else {
      linksToBeIncremented = links;
    }

    projectedTrafficLost += linksToBeIncremented.reduce(
      (acc, link) => acc + (link.trafficDomain * TRAFFIC_MULTIPLIER),
      0,
    );
  });

  const projectedTrafficValue = projectedTrafficLost * DEFAULT_CPC_VALUE;
  return {
    projectedTrafficLost,
    projectedTrafficValue,
  };
}

export { calculateKpiDeltasForAudit };
