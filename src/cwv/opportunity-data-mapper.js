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
import { OPPORTUNITY_TYPES, mergeTagsWithHardcodedTags } from '@adobe/spacecat-shared-utils';
import { DATA_SOURCES } from '../common/constants.js';

export function createOpportunityData(kpiDeltas) {
  return {
    runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_CWV_Runbook.docx?web=1',
    origin: 'AUTOMATION',
    title: 'Opportunities to improve core web vitals — optimization available to improve user experience',
    description: 'Pages with core web vitals issues increase bounce rates and reduce conversions — keep visitors engaged and improve SEO rankings by optimizing for core web vitals.',
    guidance: {
      steps: [
        'Analyze CWV data using RUM and PageSpeed Insights to identify performance bottlenecks.',
        'Optimize CWV metrics (CLS, INP, LCP) by addressing common issues such as slow server response times, unoptimized assets, excessive JavaScript, and layout instability.',
        'Test the implemented changes with tools like Chrome DevTools or PageSpeed Insights to verify improvements.',
        'Monitor performance over time to ensure consistent CWV scores across devices.',
      ],
    },
    tags: mergeTagsWithHardcodedTags(OPPORTUNITY_TYPES.CWV, []),
    data: {
      ...kpiDeltas,
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.RUM, DATA_SOURCES.SITE],
    },
  };
}
