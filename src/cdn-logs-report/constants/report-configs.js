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

import { weeklyBreakdownQueries } from '../utils/query-builder.js';

export const REPORT_CONFIGS = {
  agentic: {
    filePrefix: 'agentictraffic',
    workbookCreator: 'Spacecat Agentic Traffic Report',
    queries: {
      reqcountbycountry: weeklyBreakdownQueries.createCountryWeeklyBreakdown,
      reqcountbyuseragent: weeklyBreakdownQueries.createUserAgentWeeklyBreakdown,
      reqcountbyurlstatus: weeklyBreakdownQueries.createUrlStatusWeeklyBreakdown,
      top_bottom_urls_by_status: weeklyBreakdownQueries.createTopBottomUrlsByStatus,
      error_404_urls: weeklyBreakdownQueries.createError404Urls,
      error_503_urls: weeklyBreakdownQueries.createError503Urls,
      success_urls_by_category: weeklyBreakdownQueries.createSuccessUrlsByCategory,
      top_urls: weeklyBreakdownQueries.createTopUrls,
    },
    sheets: [
      { name: 'shared-hits_by_user_agents', dataKey: 'reqcountbyuseragent', type: 'userAgents' },
      { name: 'shared-hits_by_country', dataKey: 'reqcountbycountry', type: 'country' },
      { name: 'shared-hits_by_page_type', dataKey: 'reqcountbyurlstatus', type: 'pageType' },
      { name: 'shared-top_bottom_5_by_status', dataKey: 'top_bottom_urls_by_status', type: 'topBottom' },
      { name: 'shared-404_all_urls', dataKey: 'error_404_urls', type: 'error404' },
      { name: 'shared-503_all_urls', dataKey: 'error_503_urls', type: 'error503' },
      { name: 'shared-hits_by_page', dataKey: 'top_urls', type: 'topUrls' },
    ],
    conditionalSheets: [
      {
        condition: (site) => site && site.getBaseURL().includes('bulk.com'),
        sheet: { name: 'shared-200s_by_category', dataKey: 'success_urls_by_category', type: 'category' },
      },
    ],
  },
  referral: {
    filePrefix: 'referraltraffic-v2',
    workbookCreator: 'Spacecat Referral Traffic Report',
    queries: {
      referralCountryTopic: weeklyBreakdownQueries.createReferralTrafficByCountryTopic,
      referralUrlTopic: weeklyBreakdownQueries.createReferralTrafficByUrlTopic,
    },
    sheets: [
      { name: 'shared-hits_by_country_topic', dataKey: 'referralCountryTopic', type: 'referralCountryTopic' },
      { name: 'shared-hits_by_url_topic', dataKey: 'referralUrlTopic', type: 'referralUrlTopic' },
    ],
  },
};
