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

import { getStoredMetrics, isNonEmptyArray, isNonEmptyObject } from '@adobe/spacecat-shared-utils';

const calculateKpiMetrics = async (auditData, context, site) => {
  const { log } = context;
  const siteId = site.getId();
  const rumTrafficData = await getStoredMetrics(
    { source: 'rum', metric: 'rum-traffic', siteId },
    context,
  );

  if (!isNonEmptyObject(rumTrafficData)) {
    log.info(`No RUM traffic data found for site ${siteId}`);
    return null;
  }

  const organicTrafficData = await getStoredMetrics(
    { source: 'ahrefs', metric: 'organic-traffic', siteId },
    context,
  );

  if (!isNonEmptyArray(organicTrafficData)) {
    log.info(`No organic traffic data found for site ${siteId}`);
    return null;
  }

  const latestOrganicTrafficData = organicTrafficData.sort(
    (a, b) => new Date(b.time) - new Date(a.time),
  )[0];
  const CPC = latestOrganicTrafficData.cost / latestOrganicTrafficData.value;

  const projectedTrafficLost = auditData.auditResult.brokenBacklinks.reduce((sum, backlink) => {
    const { traffic_domain: referringTraffic, urlsSuggested } = backlink;

    let trafficBand;
    if (referringTraffic > 25000000) {
      trafficBand = 0.03;
    } else if (referringTraffic > 10000000) {
      trafficBand = 0.02;
    } else if (referringTraffic > 1000000) {
      trafficBand = 0.01;
    } else if (referringTraffic > 500000) {
      trafficBand = 0.0075;
    } else if (referringTraffic > 10000) {
      trafficBand = 0.005;
    } else {
      trafficBand = 0.001;
    }
    const proposedTargetTraffic = rumTrafficData[urlsSuggested[0]]?.earned ?? 0;
    return sum + (proposedTargetTraffic * trafficBand);
  }, 0);

  const projectedTrafficValue = projectedTrafficLost * CPC;

  return {
    projectedTrafficLost,
    projectedTrafficValue,
  };
};

export default calculateKpiMetrics;
