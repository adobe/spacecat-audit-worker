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
  1: 'Needs Improvement',
  0: 'Poor',
};

/**
 * Multipliers for CWV statuses
 * These modifiers are applied to statuses that require adjustment
 */
const TRAFFIC_MULTIPLIERS = {
  'Needs Improvement': 0.005, // +0.5%
  Poor: 0.015, // +1.5%
};

const calculateProjectedTrafficLost = (metrics) => {
  let greenMetricsCount = 0;

  // Count the number of "green" metrics below thresholds
  METRICS.forEach((metric) => {
    if (!THRESHOLDS[metric] || !Number.isFinite(metrics[metric]) || metrics[metric] < 0) {
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

/**
 * Calculates kpiDeltas for all devices in an audit entry
 *
 * Metrics contain CWV data, organic traffic and device type
 *
 * @param {Object} entry - Audit entry containing metrics
 * @returns {Object} - kpiDeltas object with values for each device
 */
const calculateKpiDeltasForAuditEntryPerDevice = (entry) => {
  const kpiDeltas = {};
  const cpcValue = resolveCpcValue(entry);

  // Iterate through all devices in entry metrics
  entry.metrics.forEach((metrics) => {
    const { deviceType } = metrics;
    const projectedTrafficLost = calculateProjectedTrafficLost(metrics);
    const projectedTrafficValue = calculateProjectedTrafficValue(projectedTrafficLost, cpcValue);

    // Store results per device
    kpiDeltas[deviceType] = {
      projectedTrafficLost,
      projectedTrafficValue,
    };
  });

  return kpiDeltas;
};

/**
 * Calculate aggregated kpiDeltas for all audit entries
 *
 * @param {Array} entries - Array of audit entries
 * @returns {Object} - Aggregated kpiDeltas for all entries
 */
const calculateKpiDeltasForAuditEntries = (entries) => {
  const aggregatedKpiDeltas = {
    projectedTrafficLost: 0,
    projectedTrafficValue: 0,
  };

  // Iterate through all entries and aggregate (sum) kpiDeltas
  entries.forEach((entry) => {
    const kpiDeltasForEntryPerDevice = calculateKpiDeltasForAuditEntryPerDevice(entry);

    Object.values(kpiDeltasForEntryPerDevice).forEach(
      ({ projectedTrafficLost, projectedTrafficValue }) => {
        aggregatedKpiDeltas.projectedTrafficLost += projectedTrafficLost;
        aggregatedKpiDeltas.projectedTrafficValue += projectedTrafficValue;
      },
    );
  });

  return aggregatedKpiDeltas;
};

export {
  calculateKpiDeltasForAuditEntryPerDevice,
  calculateKpiDeltasForAuditEntries,
};
