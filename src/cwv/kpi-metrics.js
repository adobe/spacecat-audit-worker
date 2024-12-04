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

const METRICS = ['lcp', 'cls', 'inp'];

const THRESHOLDS = {
  lcp: { soft: 2500, hard: 4000 },
  cls: { soft: 0.1, hard: 0.25 },
  inp: { soft: 200, hard: 500 },
};

/**
 * CWV statuses based on the number of "green" metrics:
 *
 * 3 Good/Green CWV = Very Fast
 * 2 Good/Green CWV = Good
 * 1 Good/Green CWV = Needs Improvement
 * 0 Good/Green CWV = Poor
 */
const STATUSES = {
  3: 'Very Fast',
  2: 'Good',
  1: 'Needs Improvement',
  0: 'Poor',
};

// Multipliers for CWV status per device
const TRAFFIC_MULTIPLIERS = {
  'Poor': 0.015, // +1.5%
  'Needs Improvement': 0.005, // +0.5%
};

/**
 * Main function to calculate kpiDeltas for all devices
 *
 * @param {Object} entry - Page data (including organic traffic and metrics)
 * @param {number} cpcValue - Cost per click (CPC)
 * @returns {Object} - kpiDeltas object with values for each device
 */
const calculateKpiDeltas = (entry, cpcValue) => {
  const kpiDeltas = {};

  // Iterate through all devices in metrics
  entry.metrics.forEach(metrics => {
    const { deviceType } = metrics;

    // Calculate Projected Traffic Lost for the device
    const projectedTrafficLost = calculateProjectedTrafficLostForDevice(metrics, entry.organic);

    // Calculate Projected Traffic Value for the device
    const projectedTrafficValue = calculateProjectedTrafficValue(projectedTrafficLost, cpcValue);

    // Store results per device
    kpiDeltas[deviceType] = {
      projectedTrafficLost,
      projectedTrafficValue
    };
  });

  return kpiDeltas;
};

/**
 * Calculates Projected Traffic Lost per device
 *
 * @param {Object} metrics - Metrics object for a specific device
 * @param {number} organicTraffic - Organic traffic for the page
 * @returns {number} - Projected Traffic Lost for the device
 */
function calculateProjectedTrafficLostForDevice(metrics, organicTraffic) {
  let greenMetricsCount = 0;

  // Count the number of "green" metrics (below soft threshold)
  METRICS.forEach(metric => {
    if (!THRESHOLDS[metric] || !Number.isFinite(value) || value < 0) {
      return;
    }

    if (metrics[metric] <= THRESHOLDS[metric].soft) {
      greenMetricsCount++;
    }
  });

  // Determine CWV status based on the number of green metrics
  const cwvStatus = STATUSES[greenMetricsCount] || 'Unknown';

  // Calculate projected traffic increase based on CWV status
  const trafficMultiplier = TRAFFIC_MULTIPLIERS[cwvStatus] || 0;
  return organicTraffic * trafficMultiplier;
}

/**
 * Calculates Projected Traffic Value for a device
 *
 * @param {number} projectedTrafficLost - Projected Traffic Lost
 * @param {number} cpcValue - Cost per click (CPC)
 * @returns {number} - Projected Traffic Value
 */
const calculateProjectedTrafficValue = (projectedTrafficLost, cpcValue) => projectedTrafficLost * cpcValue;

export default calculateKpiDeltas;
