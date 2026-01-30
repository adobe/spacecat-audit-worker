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

import { GetObjectCommand } from '@aws-sdk/client-s3';

export const DEFAULT_CPC = 0.80;

/**
 * Fetches Ahrefs aggregated metrics from S3 and calculates CPC values.
 *
 * Note: Both cost and traffic values are already fully converted during import to be usd not cents:
 * - Cost values are in USD (converted from cents)
 * - Traffic values are actual visitor counts
 *
 * CPC calculation:
 * CPC = cost / traffic
 *
 * @param {Object} context - Request context with S3 client
 * @param {string} bucketName - S3 bucket name for importer data
 * @param {string} siteId - Site ID
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} CPC data: { organicCPC, paidCPC, source }
 */
export async function fetchCPCData(context, bucketName, siteId, log) {
  const key = `metrics/${siteId}/ahrefs/agg-metrics.json`;

  try {
    log.info(`Fetching Ahrefs CPC data from s3://${bucketName}/${key}`);

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await context.s3.s3Client.send(command);
    const bodyString = await response.Body.transformToString();
    const data = JSON.parse(bodyString);

    // Calculate CPC: cost and traffic are already in final units
    const organicCPC = data.organicTraffic > 0
      ? data.organicCost / data.organicTraffic
      : DEFAULT_CPC;

    const paidCPC = data.paidTraffic > 0
      ? data.paidCost / data.paidTraffic
      : DEFAULT_CPC;

    log.info(`Ahrefs CPC calculated - organic: $${organicCPC.toFixed(4)}, paid: $${paidCPC.toFixed(4)}`);

    return {
      organicCPC,
      paidCPC,
      source: 'ahrefs',
    };
  } catch (error) {
    log.warn(`Failed to fetch Ahrefs CPC data: ${error.message}. Using default CPC: $${DEFAULT_CPC}. Please make paid ahrefs import is enabled and run for this site to get accurate CPC data.`);

    return {
      organicCPC: DEFAULT_CPC,
      paidCPC: DEFAULT_CPC,
      source: 'default',
    };
  }
}

/**
 * Gets the appropriate CPC value based on traffic type.
 *
 * @param {string} trfType - Traffic type (paid, earned, owned, organic)
 * @param {Object} cpcData - CPC data from fetchCPCData
 * @returns {number} CPC value
 */
export function getCPCForTrafficType(trfType, cpcData) {
  if (trfType === 'paid') {
    return cpcData.paidCPC;
  }
  // earned, owned, organic all use organicCPC
  return cpcData.organicCPC;
}

/**
 * Calculates estimated cost based on bounce gap loss and CPC.
 *
 * @param {number} bounceGapLoss - Number of users lost due to consent banner
 * @param {number} cpc - Cost per click
 * @returns {number} Estimated cost
 */
export function calculateEstimatedCost(bounceGapLoss, cpc) {
  return bounceGapLoss * cpc;
}
