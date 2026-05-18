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

export function createOpportunityData() {
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/doc2.aspx?sourcedoc=%7BAC174971-BA97-44A9-9560-90BE6C7CF789%7D&file=Experience_Success_Studio_Broken_External_Links_Runbook.docx&action=default&mobileredirect=true',
    origin: 'AUTOMATION',
    title: 'Fix broken external links to improve user experience',
    description: 'External links returning 4xx or 5xx errors break user journeys and may signal stale or incorrect content.',
    guidance: {
      steps: [
        'Review each broken external link listed below.',
        'Update or remove links that no longer resolve.',
        'Consider replacing with an archived version (e.g. Wayback Machine) where appropriate.',
      ],
    },
    tags: ['Engagement', 'Traffic acquisition'],
    data: {
      dataSources: ['SITE'],
    },
  };
}
