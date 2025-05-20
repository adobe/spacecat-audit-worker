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

export function createInDepthReportOpportunity(week, year) {
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
    origin: 'AUTOMATION',
    type: 'generic-opportunity',
    title: `Accessibility report - Desktop - Week ${week} - ${year} - in-depth`,
    description: 'This report provides an in-depth overview of various accessibility issues identified across different web pages. It categorizes issues based on their severity and impact, offering detailed descriptions and recommended fixes. The report covers critical aspects such as ARIA attributes, keyboard navigation, and screen reader compatibility to ensure a more inclusive and accessible web experience for all users.',
    tags: [
      'Optimizing opportunity',
      'a11y',
    ],
    status: 'IGNORED',
  };
}

export function createReportOpportunitySuggestionInstance(suggestionValue) {
  return [
    {
      type: 'CONTENT_UPDATE',
      rank: 1,
      status: 'NEW',
      data: {
        suggestionValue,
      },
    },
  ];
}
