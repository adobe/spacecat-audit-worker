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

export function createOpportunityData(projectedTrafficMetrics = {}) {
  const { projectedTrafficLost, projectedTrafficValue } = projectedTrafficMetrics;

  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Acquisition%20-%20SEO/Experience_Success_Studio_Redirect_Chains_Runbook.docx?d=w15b25d46a5124cf29543ed08acf6caae&csf=1&web=1&e=Kiosk9',
    origin: 'AUTOMATION',
    title: 'Redirect issues found with the /redirects.json file',
    description: 'This audit identifies issues with the /redirects.json file that may lead to degraded Core Web Vitals (CWV) performance. It is recommended to review and resolve these issues to improve your site\'s performance.',
    guidance: {
      steps: [
        'For each affected entry in the /redirects.json file, check if the redirect is valid. See the suggestion provided for details on how to resolve.',
      ],
    },
    tags: ['Traffic Acquisition'],
    data: {
      dataSources: [DATA_SOURCES.SITE],
      projectedTrafficLost: projectedTrafficLost || 0,
      projectedTrafficValue: projectedTrafficValue || 0,
    },
  };
}
