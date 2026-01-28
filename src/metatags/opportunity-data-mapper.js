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

export function createOpportunityData(props = {}) {
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/doc2.aspx?sourcedoc=%7B27CF48AA-5492-435D-B17C-01E38332A5CA%7D&file=Experience_Success_Studio_Metatags_Runbook.docx&action=default&mobileredirect=true',
    origin: 'AUTOMATION',
    title: 'Stand out in search results with clean meta tags — fixes ready for the missing or invalid ones',
    description: 'Well-structured meta tags increase click-through rates and help search engines display accurate, appealing results.',
    guidance: {
      steps: [
        'Review the detected meta-tags with issues, the AI-generated suggestions, and the provided rationale behind each recommendation.',
        'Customize the AI-suggested tag content if necessary by manually editing it.',
        'Copy the finalized tag content for the affected page.',
        'Update the tag in your page authoring source by pasting the content in the appropriate location.',
        'Publish the changes to apply the updates to your live site.',
      ],
    },
    tags: mergeTagsWithHardcodedTags(OPPORTUNITY_TYPES.INVALID_OR_MISSING_METADATA, []),
    data: {
      ...props,
      dataSources: [DATA_SOURCES.AHREFS, DATA_SOURCES.RUM, DATA_SOURCES.SITE],
    },
  };
}
