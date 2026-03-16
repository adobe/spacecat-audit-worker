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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { DATA_SOURCES } from '../common/constants.js';

// Fallback until @adobe/spacecat-shared-data-access includes CITED_ANALYSIS (PR #1444)
const CITED_ANALYSIS_TYPE = Audit.AUDIT_TYPES.CITED_ANALYSIS || 'cited-analysis';

/**
 * Creates opportunity data for cited URL analysis.
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
    type: opportunityData?.type || CITED_ANALYSIS_TYPE,
    title: opportunityData?.title || 'LLM discoverability: Improve cited URL presence',
    description: opportunityData?.description
      || 'Enhance your company\'s presence across top-cited URLs to improve visibility in Large Language Model (LLM) responses. '
      + 'Optimizing content on frequently cited pages increases the likelihood of being referenced by AI systems.',
    status: opportunityData?.status || 'NEW',
    tags: [...new Set([...(opportunityData?.tags || []), 'isElmo', 'cited', 'earned'])],
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
