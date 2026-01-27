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
export const suggestionData = [
  {
    pageUrl: 'https://main--example--page.aem.page/page1',
    step: 'suggest',
    audits: [
      {
        name: 'body-size',
        type: 'seo',
        opportunities: [
          {
            check: 'content-length',
            issue: 'Body content length is below 100 characters',
            seoImpact: 'Moderate',
            seoRecommendation: 'Add more meaningful content to the page',
          },
        ],
      },
      {
        name: 'lorem-ipsum',
        type: 'seo',
        opportunities: [],
      },
      {
        name: 'h1-count',
        type: 'seo',
        opportunities: [
          {
            check: 'multiple-h1',
            issue: 'Found 2 H1 tags',
            seoImpact: 'High',
            seoRecommendation: 'Use exactly one H1 tag per page for better SEO structure',
          },
        ],
      },
      {
        name: 'canonical',
        type: 'seo',
        // TODO: Re-enable when preflight canonical is updated for
        // new multi-step architecture
        opportunities: [],
      },
      {
        name: 'metatags',
        type: 'seo',
        opportunities: [], // Added length check in metatags audit, no oppty when body is short
      },
      {
        name: 'links',
        type: 'seo',
        opportunities: [
          {
            check: 'broken-internal-links',
            issue: [
              {
                url: 'https://main--example--page.aem.page/broken',
                issue: 'Status 404',
                seoImpact: 'High',
                seoRecommendation: 'Fix or remove broken links to improve user experience and SEO',
                aiSuggestion: 'https://main--example--page.aem.page/fix',
                aiRationale: 'Rationale',
              },
              {
                url: 'https://main--example--page.aem.page/another-broken-url',
                issue: 'Status 404',
                seoImpact: 'High',
                seoRecommendation: 'Fix or remove broken links to improve user experience and SEO',
                aiSuggestion: 'https://main--example--page.aem.page/fix',
                aiRationale: 'Rationale',
              },
            ],
          },
        ],
      },
      {
        name: 'headings',
        type: 'seo',
        opportunities: [
          {
            check: 'heading-multiple-h1',
            issue: 'Multiple H1 Headings',
            issueDetails: 'Page has more than one H1 element.',
            seoImpact: 'High',
            seoRecommendation: 'Found 2 h1 elements: Pages should have only one H1 element.',
            suggestion: 'Change additional H1 elements to H2 or appropriate levels.',
          },
        ],
      },
      {
        name: 'readability',
        type: 'seo',
        opportunities: [],
      },
    ],
  },
];
