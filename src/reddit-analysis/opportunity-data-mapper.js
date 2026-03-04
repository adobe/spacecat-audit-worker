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

import { DATA_SOURCES } from '../common/constants.js';

/**
 * Creates opportunity data for Reddit analysis.
 * When a BO JSON opportunity object is provided (from Mystique), uses its values.
 * Otherwise falls back to defaults.
 * @param {Object} props - The props object from convertToOpportunity
 * @param {Object} [props.opportunityData] - The opportunity object from the BO JSON
 * @returns {Object} Opportunity data
 */
export function createOpportunityData({ opportunityData } = {}) {
  return {
    runbook: opportunityData?.runbook || '',
    origin: 'AUTOMATION',
    type: 'reddit-analysis',
    title: opportunityData?.title || 'Reddit presence: Improve brand sentiment and visibility',
    description: opportunityData?.description
      || 'Enhance your company\'s Reddit presence to improve brand sentiment and visibility. '
      + 'A well-managed Reddit presence can influence how your brand is perceived in community discussions.',
    status: opportunityData?.status || 'NEW',
    tags: [...new Set([...(opportunityData?.tags || []), 'isElmo', 'Reddit', 'social'])],
    data: {
      ...(opportunityData?.data || {}),
      dataSources: [...new Set([
        ...(opportunityData?.data?.dataSources || []),
        DATA_SOURCES.SITE,
        DATA_SOURCES.PAGE,
      ])],
    },
  };
}
