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

import { DATA_SOURCES } from '../common/constants.js';
import { OPPORTUNITY_TITLES } from './constants.js';

/**
 * Creates the opportunity data object for a CWV Trends audit.
 * The title is determined by the deviceType in the audit result.
 *
 * @param {object} props - Props containing auditResult from the audit run
 * @returns {object} Opportunity data
 */
export function createOpportunityData(props) {
  const { deviceType } = props;

  return {
    runbook: '',
    origin: 'AUTOMATION',
    title: OPPORTUNITY_TITLES[deviceType] || OPPORTUNITY_TITLES.mobile,
    description: 'Web Performance Trends Report tracking CWV metrics over time.',
    guidance: {
      steps: [
        'Review CWV trends to identify performance degradation patterns.',
        'Investigate URLs with Poor CWV scores for LCP, CLS, and INP issues.',
        'Prioritize fixes for high-traffic pages with declining metrics.',
        'Monitor trends after optimization to verify improvements.',
      ],
    },
    tags: ['Web Performance', 'CWV'],
    data: {
      deviceType,
      dataSources: [DATA_SOURCES.RUM, DATA_SOURCES.SITE],
    },
  };
}
