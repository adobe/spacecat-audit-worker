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

export const guidance = [
  {
    id: 'test-opportunity-id',
    siteId: 'test-site-id',
    type: 'guidance:broken-backlinks',
    data: {
      suggestionId: 'test-suggestion-id-1',
      opportunityId: 'test-opportunity-id',
      broken_url: 'https://foo.com/redirects-throws-error',
      urls_suggested: ['https://foo.com/redirects-throws-error-1', 'https://foo.com/redirects-throws-error-2'],
      ai_rationale: 'The suggested URLs are similar to the original URL and are likely to be the correct destination.',
    },
  },
  {
    id: 'test-opportunity-id',
    siteId: 'test-site-id',
    type: 'guidance:broken-backlinks',
    data: {
      suggestionId: 'test-suggestion-id-2',
      opportunityId: 'test-opportunity-id',
      broken_url: 'https://foo.com/returns-429',
      urls_suggested: ['https://foo.com/returns-429-suggestion-1', 'https://foo.com/returns-429-suggestion-2'],
      ai_rationale: 'The suggested URLs are similar to the original URL and are likely to be the correct destination.',
    },
  },
  {
    id: 'test-opportunity-id',
    siteId: 'test-site-id',
    type: 'guidance:broken-backlinks',
    data: {
      suggestionId: 'test-suggestion-id-3',
      opportunityId: 'test-opportunity-id',
      broken_url: 'https://foo.com/not-excluded',
      urls_suggested: ['https://foo.com/not-excluded-suggestion-1', 'https://foo.com/not-excluded-suggestion-2'],
      ai_rationale: 'The suggested URLs are 0similar to the original URL and are likely to be the correct destination.',
    },
  },
  {
    id: 'test-opportunity-id',
    siteId: 'test-site-id',
    type: 'guidance:broken-backlinks',
    data: {
      suggestionId: 'test-suggestion-id-4',
      opportunityId: 'test-opportunity-id',
      broken_url: 'https://foo.com/returns-404',
      urls_suggested: [],
      ai_rationale: '',
    },
  },
];
