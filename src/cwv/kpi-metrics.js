/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import resolveCpcValue from './cpc-value-resolver.js';

const METRICS = ['lcp', 'cls', 'inp'];

/**
 * Thresholds for "green" metrics
 */
const THRESHOLDS = {
  lcp: 2500,
  cls: 0.1,
  inp: 200,
};

/**
 * CWV statuses based on the number of "green" metrics:
 *
 * Statuses not requiring adjustment:
 * 3 Good/Green CWV = Very Fast
 * 2 Good/Green CWV = Good
 *
 * Statuses requiring adjustment:
 * 1 Good/Green CWV = Needs Improvement
 * 0 Good/Green CWV = Poor
 */
const STATUSES = {
  0: 'Poor',
  1: 'Needs Improvement',
};

/**
 * Multipliers for CWV statuses
 * These modifiers are applied to statuses that require adjustment
 */
const TRAFFIC_MULTIPLIERS = {
  Poor: 0.015, // +1.5%
  'Needs Improvement': 0.005, // +0.5%
};

const calculateProjectedTrafficLost = (metrics) => {
  let greenMetricsCount = 0;

  if (!metrics.organic || !Number.isFinite(metrics.organic) || metrics.organic < 0) {
    return 0;
  }

  // Count the number of "green" metrics below thresholds
  METRICS.forEach((metric) => {
    if (!Number.isFinite(metrics[metric]) || metrics[metric] < 0) {
      return;
    }

    if (metrics[metric] <= THRESHOLDS[metric]) {
      greenMetricsCount += 1;
    }
  });

  // Determine CWV status based on the number of green metrics
  const cwvStatus = STATUSES[greenMetricsCount] || 'Unknown';

  // Calculate projected traffic increase based on CWV status
  const trafficMultiplier = TRAFFIC_MULTIPLIERS[cwvStatus] || 0;
  return metrics.organic * trafficMultiplier;
};

const calculateProjectedTrafficValue = (
  projectedTrafficLost,
  cpcValue,
) => projectedTrafficLost * cpcValue;

const calculateKpiDeltasForAuditEntryPerDevice = (entry, cpcValue) => entry.metrics.reduce((
  kpiDeltas,
  metrics,
) => {
  const { deviceType } = metrics;
  const projectedTrafficLost = calculateProjectedTrafficLost(metrics);
  const projectedTrafficValue = calculateProjectedTrafficValue(projectedTrafficLost, cpcValue);

  return {
    ...kpiDeltas,
    // Store results per device
    [deviceType]: {
      projectedTrafficLost,
      projectedTrafficValue,
    },
  };
}, {});

/**
 * Calculate aggregated kpiDeltas for all audit entries
 *
 * @param {Object} auditData - Audit data
 * @param {Object} dataAccess - The data access object for database operations
 * @returns {Object} - Aggregated kpiDeltas for all audit entries
 */
const calculateKpiDeltasForAudit = (auditData, dataAccess) => {
  const cpcValue = resolveCpcValue(auditData, dataAccess);

  return auditData.auditResult.cwv
    .map((entry) => calculateKpiDeltasForAuditEntryPerDevice(entry, cpcValue))
    .flatMap(Object.values) // Flatten all device-level values into a single array
    .reduce(
      (totals, { projectedTrafficLost, projectedTrafficValue }) => ({
        projectedTrafficLost: totals.projectedTrafficLost + projectedTrafficLost,
        projectedTrafficValue: totals.projectedTrafficValue + projectedTrafficValue,
      }),
      { projectedTrafficLost: 0, projectedTrafficValue: 0 },
    );
};

export default calculateKpiDeltasForAudit;
