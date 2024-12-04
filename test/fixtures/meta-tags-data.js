/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const testData = {
  auditData: {
    type: 'meta-tags',
    auditResult: {
      finalUrl: 'www.test-site.com/',
      detectedTags: {
        '/page1': {
          title: {
            tagContent: 'Lovesac - 404 Not Found',
            duplicates: [
              '/page4',
              '/page5',
            ],
            seoRecommendation: 'Unique across pages',
            issue: 'Duplicate Title',
            issueDetails: '3 pages share same title',
            seoImpact: 'High',
          },
          description: {
            tagContent: 'The BigOne Insert',
            seoRecommendation: '140-160 characters long',
            issue: 'Description too short',
            issueDetails: '110 chars below limit',
            seoImpact: 'Moderate',
          },
          h1: {
            seoRecommendation: 'Should be present',
            issue: 'Missing H1',
            issueDetails: 'H1 tag is missing',
            seoImpact: 'High',
          },
        },
        '/page2': {
          title: {
            seoRecommendation: '40-60 characters long',
            issue: 'Empty Title',
            issueDetails: 'Title tag is empty',
            seoImpact: 'High',
          },
          h1: {
            tagContent: '["We Can All Win Together","We Say As We Do"]',
            seoRecommendation: '1 H1 on a page',
            issue: 'Multiple H1 on page',
            issueDetails: '2 H1 detected',
            seoImpact: 'Moderate',
          },
        },
      },
    },
  },
  expectedSuggestions: [
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 5,
      data: {
        tagContent: 'Lovesac - 404 Not Found',
        duplicates: [
          '/page4',
          '/page5',
        ],
        seoRecommendation: 'Unique across pages',
        issue: 'Duplicate Title',
        issueDetails: '3 pages share same title',
        seoImpact: 'High',
        tagName: 'title',
        url: 'www.test-site.com/page1',
        rank: 5,
      },
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 9,
      data: {
        tagContent: 'The BigOne Insert',
        seoRecommendation: '140-160 characters long',
        issue: 'Description too short',
        issueDetails: '110 chars below limit',
        seoImpact: 'Moderate',
        tagName: 'description',
        url: 'www.test-site.com/page1',
        rank: 9,
      },
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 4,
      data: {
        seoRecommendation: 'Should be present',
        issue: 'Missing H1',
        issueDetails: 'H1 tag is missing',
        seoImpact: 'High',
        tagName: 'h1',
        url: 'www.test-site.com/page1',
        rank: 4,
      },
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 2,
      data: {
        seoRecommendation: '40-60 characters long',
        issue: 'Empty Title',
        issueDetails: 'Title tag is empty',
        seoImpact: 'High',
        tagName: 'title',
        url: 'www.test-site.com/page2',
        rank: 2,
      },
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 11,
      data: {
        tagContent: '["We Can All Win Together","We Say As We Do"]',
        seoRecommendation: '1 H1 on a page',
        issue: 'Multiple H1 on page',
        issueDetails: '2 H1 detected',
        seoImpact: 'Moderate',
        tagName: 'h1',
        url: 'www.test-site.com/page2',
        rank: 11,
      },
    },
  ],
  existingSuggestions: [
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 5,
      data: {
        tagContent: 'Lovesac - 404 Not Found',
        duplicates: [
          '/page4',
          '/page5',
        ],
        seoRecommendation: 'Unique across pages',
        issue: 'Duplicate Title',
        issueDetails: '3 pages share same title',
        seoImpact: 'High',
        tagName: 'title',
        url: 'www.test-site.com/page10',
        rank: 5,
      },
      remove: () => {},
      getStatus: () => 'NEW',
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 9,
      data: {
        tagContent: 'The BigOne Insert modified',
        seoRecommendation: '140-160 characters long',
        issue: 'Description too short',
        issueDetails: '110 chars below limit',
        seoImpact: 'Moderate',
        tagName: 'description',
        url: 'www.test-site.com/page1',
        rank: 9,
      },
      remove: () => {},
      getStatus: () => 'NEW',
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 4,
      data: {
        seoRecommendation: 'Should be present',
        issue: 'Missing H1',
        issueDetails: 'H1 tag is missing',
        seoImpact: 'High',
        tagName: 'h1',
        url: 'www.test-site.com/page1',
        rank: 4,
        aiSuggestion: 'This is an AI generated H1',
        aiRationale: 'This is why AI generated it',
        toOverride: 'user entered data',
      },
      remove: () => {},
      getStatus: () => 'SKIPPED',
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 11,
      data: {
        tagContent: '["We Can All Win Together","We Say As We Do"]',
        seoRecommendation: '1 H1 on a page',
        issue: 'Multiple H1 on page',
        issueDetails: '2 H1 detected',
        seoImpact: 'Moderate',
        tagName: 'h1',
        url: 'www.test-site.com/page2',
        rank: 11,
      },
      remove: () => {},
      getStatus: () => 'NEW',
    },
  ],
  expectedSyncedSuggestion: [
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 5,
      data: {
        tagContent: 'Lovesac - 404 Not Found',
        duplicates: [
          '/page4',
          '/page5',
        ],
        seoRecommendation: 'Unique across pages',
        issue: 'Duplicate Title',
        issueDetails: '3 pages share same title',
        seoImpact: 'High',
        tagName: 'title',
        url: 'www.test-site.com/page1',
        rank: 5,
      },
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 9,
      data: {
        tagContent: 'The BigOne Insert',
        seoRecommendation: '140-160 characters long',
        issue: 'Description too short',
        issueDetails: '110 chars below limit',
        seoImpact: 'Moderate',
        tagName: 'description',
        url: 'www.test-site.com/page1',
        rank: 9,
      },
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 4,
      data: {
        seoRecommendation: 'Should be present',
        issue: 'Missing H1',
        issueDetails: 'H1 tag is missing',
        seoImpact: 'High',
        tagName: 'h1',
        url: 'www.test-site.com/page1',
        rank: 4,
        aiSuggestion: 'This is an AI generated H1',
        aiRationale: 'This is why AI generated it',
        toOverride: 'user entered data',
      },
      status: 'SKIPPED',
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 2,
      data: {
        seoRecommendation: '40-60 characters long',
        issue: 'Empty Title',
        issueDetails: 'Title tag is empty',
        seoImpact: 'High',
        tagName: 'title',
        url: 'www.test-site.com/page2',
        rank: 2,
      },
    },
    {
      opportunityId: 'opportunity-id',
      type: 'METADATA_UPDATE',
      rank: 11,
      data: {
        tagContent: '["We Can All Win Together","We Say As We Do"]',
        seoRecommendation: '1 H1 on a page',
        issue: 'Multiple H1 on page',
        issueDetails: '2 H1 detected',
        seoImpact: 'Moderate',
        tagName: 'h1',
        url: 'www.test-site.com/page2',
        rank: 11,
      },
      status: 'NEW',
    },
  ],
  opportunityData: {
    siteId: 'site-id',
    auditId: 'audit-id',
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/doc2.aspx?sourcedoc=%7B27CF48AA-5492-435D-B17C-01E38332A5CA%7D&file=Experience_Success_Studio_Metatags_Runbook.docx&action=default&mobileredirect=true',
    type: 'meta-tags',
    origin: 'AUTOMATION',
    title: 'Pages have metadata issues, including missing and invalid tags.',
    description: 'Fixing metadata issues like missing or invalid tags boosts SEO by improving content visibility, search rankings, and user engagement.',
    guidance: {
      steps: [
        'Review the detected meta-tags with issues, the AI-generated suggestions, and the provided rationale behind each recommendation.',
        'Customize the AI-suggested tag content if necessary by manually editing it.',
        'Copy the finalized tag content for the affected page.',
        'Update the tag in your page authoring source by pasting the content in the appropriate location.',
        'Publish the changes to apply the updates to your live site.',
      ],
    },
    tags: [
      'Traffic acquisition',
    ],
  },
};

export default testData;