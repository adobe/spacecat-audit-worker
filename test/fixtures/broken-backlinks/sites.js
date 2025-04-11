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

import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';

const siteData = {
  getConfig: () => Config({}),
  getId: () => 'site1',
  getBaseURL: () => 'https://bar.foo.com',
  getIsLive: () => true,
  getOrganizationId: () => 'org1',
  resolveFinalURL: () => 'https://bar.foo.com',
};

export const site = siteData;

export const excludedUrl = 'https://foo.com/returns-404';

export const siteWithExcludedUrls = {
  ...siteData,
  getConfig: () => Config({
    slack: {
      workspace: 'my-workspace',
      channel: 'general',
      invitedUserCount: 10,
    },
    handlers: {
      404: {
        mentions: {
          slack: ['user1', 'user2'],
          email: ['user1@example.com'],
        },
        excludedURLs: [excludedUrl],
      },
      'broken-backlinks': {
        mentions: {
          slack: ['user3'],
          email: ['user2@example.com'],
        },
        excludedURLs: [excludedUrl],
      },
    },
  }),
};

export const siteTopPage = {
  getSiteId: () => site.getId(),
  getUrl: () => `${site.getBaseURL()}/foo.html`,
  getTraffic: () => 1000,
  getSource: () => 'ahrefs',
  getGeo: () => 'global',
  getImportedAt: () => new Date('2024-06-18').toISOString(),
  getTopKeyword: () => '404',
};

export const siteTopPage2 = {
  getSiteId: () => site.getId(),
  getUrl: () => `${site.getBaseURL()}/bar.html`,
  getTraffic: () => 500,
  getSource: () => 'ahrefs',
  getGeo: () => 'global',
  getImportedAt: () => new Date('2024-06-18').toISOString(),
  getTopKeyword: () => '429',
};

export const site2 = {
  getId: () => 'site2',
  getBaseURL: () => 'https://foo.com',
  getConfig: () => Config({}),
  getIsLive: () => true,
  getOrganizationId: () => 'org2',
};

export const site3 = {
  getId: () => 'site3',
  getBaseURL: () => 'https://foo.com',
  getConfig: () => Config({}),
  getIsLive: () => true,
  getOrganizationId: () => 'org3',
};

export const fixedBacklinks = [
  {
    title: 'fixed backlink',
    url_from: 'https://from.com/from-1',
    url_to: 'https://foo.com/fixed',
    traffic_domain: 4500,
  },
  {
    title: 'fixed backlink via redirect',
    url_from: 'https://from.com/from-2',
    url_to: 'https://foo.com/fixed-via-redirect',
    traffic_domain: 1500,
  },
];

export const brokenBacklinkWithTimeout = {
  title: 'backlink that times out',
  url_from: 'https://from.com/from-4',
  url_to: 'https://foo.com/times-out',
  traffic_domain: 500,
};

export const org = { getId: () => 'org4', getName: () => 'org4' };
