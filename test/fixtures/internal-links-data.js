/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

export const internalLinksData = [
  {
    traffic_domain: 1800,
    url_to: 'https://www.petplace.com/a01',
    url_from: 'https://www.petplace.com/a02nf',
    priority: 'high',
  },
  {
    traffic_domain: 1200,
    url_to: 'https://www.petplace.com/ax02',
    url_from: 'https://www.petplace.com/ax02nf',
    priority: 'medium',
  },
  {
    traffic_domain: 200,
    url_to: 'https://www.petplace.com/a01',
    url_from: 'https://www.petplace.com/a01nf',
    priority: 'low',
  },
];

export const expectedOpportunity = {
  siteId: 'site-id-1',
  auditId: 'audit-id-1',
  runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Broken_Internal_Links_Runbook.docx?web=1',
  type: 'broken-internal-links',
  origin: 'AUTOMATION',
  title: 'Broken internal links found',
  description: 'We\'ve detected broken internal links on your website. Broken links can negatively impact user experience and SEO. Please review and fix these links to ensure smooth navigation and accessibility.',
  guidance: {
    steps: [
      'Update each broken internal link to valid URLs.',
      'Test the implemented changes manually to ensure they are working as expected.',
      'Monitor internal links for 404 errors in RUM tool over time to ensure they are functioning correctly.',
    ],
  },
  tags: [
    'Traffic acquisition',
    'Engagement',
  ],
};

export const expectedSuggestions = [
  {
    type: 'CONTENT_UPDATE',
    rank: 100,
    data: {
      traffic_domain: 1800,
      url_to: 'https://www.petplace.com/a01',
      url_from: 'https://www.petplace.com/a02nf',
      priority: 'high',
    },
  },
  {
    type: 'CONTENT_UPDATE',
    rank: 100,
    data: {
      traffic_domain: 1200,
      url_to: 'https://www.petplace.com/ax02-changed',
      url_from: 'https://www.petplace.com/ax02nf',
      priority: 'medium',
    },
  },
  {
    type: 'CONTENT_UPDATE',
    rank: 100,
    data: {
      traffic_domain: 200,
      url_to: 'https://www.petplace.com/a01',
      url_from: 'https://www.petplace.com/a01nf',
      priority: 'low',
    },
  },
];
// export const expectedSuggestions = [{
//   traffic_domain: 1800,
//   url_to: 'https://www.petplace.com/a01',
//   url_from: 'https://www.petplace.com/a02nf',
//   priority: 'high',
// },
// {
//   traffic_domain: 1200,
//   url_to: 'https://www.petplace.com/ax02',
//   url_from: 'https://www.petplace.com/ax02nf',
//   priority: 'medium',
// },
// {
//   traffic_domain: 200,
//   url_to: 'https://www.petplace.com/a01',
//   url_from: 'https://www.petplace.com/a01nf-1',
//   priority: 'low',
// },
// ];
