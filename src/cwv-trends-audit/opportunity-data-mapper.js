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

import { DATA_SOURCES } from '../common/constants.js';
import { OPPORTUNITY_TITLES } from './constants.js';

/**
 * Creates opportunity data structure for CWV Trends Audit
 * @param {object} auditResult - Audit result containing deviceType, summary, trendData, urlDetails
 * @returns {object} Opportunity data object
 */
export function createOpportunityData(auditResult) {
  const { deviceType, summary } = auditResult;

  return {
    title: OPPORTUNITY_TITLES[deviceType],
    description: `Web Performance Trends Report for ${deviceType} over 28 days`,
    guidance: `Average Good: ${summary.avgGood.toFixed(1)}%, Needs Improvement: ${summary.avgNeedsImprovement.toFixed(1)}%, Poor: ${summary.avgPoor.toFixed(1)}%`,
    runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_CWV_Runbook.docx?web=1',
    origin: 'AUTOMATION',
    tags: ['cwv', 'performance', 'trends', deviceType],
    data: {
      deviceType,
      summary,
      dataSources: [DATA_SOURCES.RUM, DATA_SOURCES.SITE],
    },
  };
}

/**
 * Comparison function to match opportunities by device type
 * Ensures mobile and desktop opportunities are tracked separately
 * @param {object} existingOpportunity - Existing opportunity from database
 * @param {object} opportunityInstance - New opportunity instance being created
 * @returns {boolean} True if opportunities match (same device type)
 */
export function compareOpportunityByDevice(existingOpportunity, opportunityInstance) {
  // Match by device type from opportunity data
  const existingDevice = existingOpportunity.getData()?.deviceType;
  const newDevice = opportunityInstance.data?.deviceType;

  return existingDevice === newDevice;
}
