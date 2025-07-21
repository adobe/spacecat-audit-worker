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
        opportunities: [
          {
            check: 'canonical-self-referenced',
            issue: 'The canonical URL should point to itself to indicate that it is the preferred version of the content.',
            seoImpact: 'Moderate',
            seoRecommendation: 'The canonical URL should point to itself to indicate that it is the preferred version of the content.',
          },
        ],
      },
      {
        name: 'metatags',
        type: 'seo',
        opportunities: [
          {
            seoImpact: 'Moderate',
            issue: 'Title too short',
            issueDetails: '28 chars below limit',
            seoRecommendation: '40-60 characters long',
            tagContent: 'Page 1 Title',
            aiSuggestion: 'Our Story: Innovating Comfort for Every Home',
            aiRationale: 'The title is catchy and broad...',
            tagName: 'title',
          },
        ],
      },
      {
        name: 'links',
        type: 'seo',
        opportunities: [
          {
            check: 'broken-internal-links',
            issue: {
              url: 'https://example.com/broken',
              issue: 'Status 404',
              seoImpact: 'High',
              seoRecommendation: 'Fix or remove broken links to improve user experience and SEO',
              urlsSuggested: [
                'https://main--example--page.aem.page/fix',
              ],
              aiRationale: 'Rationale',
            },
          },
          {
            check: 'broken-internal-links',
            issue: {
              url: 'https://example.com/another-broken-url',
              issue: 'Status 404',
              seoImpact: 'High',
              seoRecommendation: 'Fix or remove broken links to improve user experience and SEO',
              urlsSuggested: [
                'https://main--example--page.aem.page/fix',
              ],
              aiRationale: 'Rationale',
            },
          },
        ],
      },
    ],
  },
];
