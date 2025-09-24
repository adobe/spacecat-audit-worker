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

import { DATA_SOURCES } from '../../common/constants.js';

export function createOpportunityData() {
  return {
    runbook: '',
    origin: 'AUTOMATION',
    title: 'Content readability issues affecting user experience and SEO',
    description: 'Poor readability makes content difficult for users to understand. Content with low readability scores may drive away visitors and reduce engagement metrics.',
    guidance: {
      steps: [
        'Review content identified with poor readability scores on high-traffic pages.',
        'Simplify complex sentences by breaking them into shorter, clearer statements.',
        'Use common words instead of technical jargon when possible.',
        'Improve paragraph structure with logical flow and clear topic sentences.',
        'Consider your target audience reading level when revising content.',
        'Use AI-generated suggestions as a starting point for improvements.',
      ],
    },
    tags: ['Engagement', 'Accessibility'],
    data: {
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.SITE],
    },
  };
}
