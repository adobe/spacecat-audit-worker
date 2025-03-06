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

import { getStoredMetrics, isNonEmptyArray } from '@adobe/spacecat-shared-utils';

const CPC_DEFAULT_VALUE = 2.69;
const TRAFFIC_BANDS = [
  { threshold: 25000000, band: 0.03 },
  { threshold: 10000000, band: 0.02 },
  { threshold: 1000000, band: 0.01 },
  { threshold: 500000, band: 0.0075 },
  { threshold: 10000, band: 0.005 },
];

const getTrafficBand = (traffic) => {
  for (const { threshold, band } of TRAFFIC_BANDS) {
    if (traffic > threshold) {
      return band;
    }
  }
  return 0.001;
};

const calculateKpiMetrics = async (auditData, context, site) => {
  const { log } = context;
  const storedMetricsConfig = {
    ...context,
    s3: {
      s3Bucket: context.env?.S3_IMPORTER_BUCKET_NAME,
      s3Client: context.s3Client,
    },
  };

  const siteId = site.getId();
  const rumTrafficData = await getStoredMetrics(
    { source: 'rum', metric: 'all-traffic', siteId },
    storedMetricsConfig,
  );

  if (!isNonEmptyArray(rumTrafficData)) {
    log.info(`No RUM traffic data found for site ${siteId}`);
    return null;
  }

  const organicTrafficData = await getStoredMetrics(
    { source: 'ahrefs', metric: 'organic-traffic', siteId },
    storedMetricsConfig,
  );

  let CPC = CPC_DEFAULT_VALUE;

  if (isNonEmptyArray(organicTrafficData)) {
    const latestOrganicTrafficData = organicTrafficData.sort(
      (a, b) => new Date(b.time) - new Date(a.time),
    )[0];
    CPC = latestOrganicTrafficData.cost / latestOrganicTrafficData.value;
  }

  const projectedTrafficLost = auditData?.auditResult?.brokenBacklinks?.reduce((sum, backlink) => {
    const { traffic_domain: referringTraffic, urlsSuggested } = backlink;
    const trafficBand = getTrafficBand(referringTraffic);
    const targetUrl = urlsSuggested?.[0];
    const targetTrafficData = rumTrafficData.find((data) => data.url === targetUrl);
    const proposedTargetTraffic = targetTrafficData?.earned ?? 0;
    return sum + (proposedTargetTraffic * trafficBand);
  }, 0);

  const projectedTrafficValue = projectedTrafficLost * CPC;

  return {
    projectedTrafficLost,
    projectedTrafficValue,
  };
};

export default calculateKpiMetrics;
