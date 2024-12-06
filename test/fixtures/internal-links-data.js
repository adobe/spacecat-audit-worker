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
    url: 'https://www.example.com/article/dogs/breeds/choosing-an-irish-setter',
    views: 100,
    all_sources: [
      'https://www.example.com/article/dogs/just-for-fun/dogs-good-for-men-13-manly-masculine-dog-breeds',
    ],
    source_count: 1,
    top_source: 'https://www.example.com/article/dogs/just-for-fun/dogs-good-for-men-13-manly-masculine-dog-breeds',
  },
  {
    url: 'https://www.example.com/article/dogs/breeds/choosing-an-german-dog',
    views: 5,
    all_sources: [
      'https://www.example.com/article/dogs/just-for-fun/dogs-good-for-men-8',
    ],
    source_count: 1,
    top_source: 'https://www.example.com/article/dogs/just-for-fun/dogs-good-for-men-8',
  },
  {
    url: 'x',
    views: 100,
    all_sources: [
      'invalid-url',
    ],
    source_count: 1,
    top_source: '',
  },
  {
    url: 'https://www.example.com/dogs/the-stages-of-canine-reproduction',
    views: 100,
    all_sources: [
      'android-app://com.google.android.googlequicksearchbox/',
    ],
    source_count: 1,
    top_source: 'android-app://com.google.android.googlequicksearchbox/',
  },
  {
    url: 'https://www.example.com/article/reptiles/general/unusual-pets-praying-mantis',
    views: 100,
    all_sources: [
      'https://www.google.com/',
    ],
    source_count: 1,
    top_source: 'https://www.google.com/',
  },
  {
    url: 'https://www.example.com/article/dogs/breeds/choosing-a-miniature-poodle',
    views: 100,
    all_sources: [
      'https://www.example.com/article/dogs/pet-care/when-is-a-dog-considered-senior',
    ],
    source_count: 1,
    top_source: 'https://www.example.com/article/dogs/pet-care/when-is-a-dog-considered-senior',
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
      url_to: 'https://www.example.com/article/dogs/breeds/choosing-an-irish-setter',
      url_from: 'https://www.example.com/article/dogs/just-for-fun/dogs-good-for-men-13-manly-masculine-dog-breeds',
      traffic_domain: 100,
    },
  },
  {
    type: 'CONTENT_UPDATE',
    rank: 100,
    data: {
      url_to: 'https://www.example.com/article/dogs/breeds/choosing-a-miniature-poodle-1',
      url_from: 'https://www.example.com/article/dogs/pet-care/when-is-a-dog-considered-senior',
      traffic_domain: 100,
    },
  },
];
