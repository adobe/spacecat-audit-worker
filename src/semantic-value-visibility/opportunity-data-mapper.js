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

export function createOpportunityData(props = {}) {
  return {
    runbook: '',
    origin: 'AUTOMATION',
    title: 'Improve image semantic visibility for LLMs',
    description: 'Marketing images on this site contain text that is not represented in HTML. Adding semantic HTML makes this content visible to search engines and AI models.',
    guidance: {
      steps: [
        'Review the detected marketing images and their extracted text.',
        'Verify the generated semantic HTML accurately represents the image content.',
        'Approve or edit the suggestions before deployment.',
      ],
    },
    tags: ['LLMO', 'SEO', 'Images'],
    data: {
      ...props,
      dataSources: [DATA_SOURCES.SITE],
    },
  };
}
