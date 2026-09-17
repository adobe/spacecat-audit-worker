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

import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';

function normalizeSiteUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${hostname}${url.port ? `:${url.port}` : ''}${pathname}${url.search}`;
  } catch {
    return value;
  }
}

function findContentSourceForSite(contentSources, site) {
  const overrideBaseURL = site.getConfig()?.getFetchConfig()?.overrideBaseURL;
  const siteUrls = new Set(
    [overrideBaseURL, site.getBaseURL()].filter(Boolean).map(normalizeSiteUrl),
  );

  return contentSources.find((source) => (
    siteUrls.has(normalizeSiteUrl(source.acquisitionConfig?.baseUrl))
  ));
}

async function parseResponse(response, action) {
  if (!response.ok) {
    let detail;
    try {
      const problem = await response.json();
      detail = problem.detail;
    } catch {
      // Use the HTTP status text when the response is not problem JSON.
    }

    const error = new Error(
      `${action}: ${response.status} ${detail || response.statusText}`.trim(),
    );
    error.status = response.status;
    throw error;
  }

  return response.status === 204 ? null : response.json();
}

/**
 * Calculates a weekly cron schedule set to run one hour from now.
 * If the next hour is midnight (0), the day is incremented.
 * @returns {string} Cron schedule in format "0 HH * * D" where HH is hour and D is day of week
 */
export function calculateWeeklyCronSchedule() {
  const now = new Date();
  const currentHour = now.getHours();
  const nextHour = (currentHour + 1) % 24;
  let dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  // If next hour wraps to 0 (midnight), we're on the next day
  if (nextHour === 0) {
    dayOfWeek = (dayOfWeek + 1) % 7;
  }

  return `0 ${nextHour} * * ${dayOfWeek}`;
}

/**
 * Content AI Client for interacting with Adobe Content AI APIs
 */
export class ContentAIClient {
  /**
   * Creates a new Content AI Client
   * @param {Object} context - The context object with env and log
   */
  constructor(context) {
    this.context = context;
    this.env = context.env;
    this.log = context.log;
    this.tokenResponse = null;
  }

  /**
   * Initializes the client by fetching an access token
   * @returns {Promise<ContentAIClient>} The initialized client
   */
  async initialize() {
    const imsClient = ImsClient.createFrom({
      ...this.context,
      env: {
        ...this.env,
        IMS_HOST: this.env.CONTENTAI_IMS_HOST,
        IMS_CLIENT_ID: this.env.CONTENTAI_CLIENT_ID,
        IMS_CLIENT_SECRET: this.env.CONTENTAI_CLIENT_SECRET,
        IMS_SCOPE: this.env.CONTENTAI_CLIENT_SCOPE,
      },
    });
    this.tokenResponse = await imsClient.getServiceAccessTokenV3();
    return this;
  }

  /**
   * Gets the authorization header
   * @returns {string} Authorization header value
   */
  getAuthHeader() {
    if (!this.tokenResponse) {
      throw new Error('ContentAIClient not initialized. Call initialize() first.');
    }
    return `${this.tokenResponse.token_type} ${this.tokenResponse.access_token}`;
  }

  getHeaders() {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: this.getAuthHeader(),
    };
  }

  async listAcquisitionContentSources() {
    const contentSources = [];
    let cursor;

    do {
      const url = new URL(`${this.env.CONTENTAI_ENDPOINT}/content-sources/acquisition`);
      url.searchParams.set('limit', '50');
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, { headers: this.getHeaders() });
      // eslint-disable-next-line no-await-in-loop
      const page = await parseResponse(
        response,
        'Failed to list Content AI acquisition sources',
      );
      contentSources.push(...(page?.items || []));
      cursor = page?.cursor;
    } while (cursor);

    return contentSources;
  }

  static async persistContentSourceName(site, name) {
    const siteConfig = site.getConfig();
    siteConfig.updateContentAiConfig({ name });
    site.setConfig(Config.toDynamoItem(siteConfig));
    await site.save();
  }

  /**
    * Resolves the persisted or discovered Content AI source name for a site.
   * @param {Object} site - The site object
    * @returns {Promise<string|null>} The source name or null if not found
   */
  async resolveContentSourceName(site) {
    const persistedName = site.getConfig()?.getContentAiConfig()?.name;
    if (persistedName) {
      return persistedName;
    }

    const contentSources = await this.listAcquisitionContentSources();
    const contentSource = findContentSourceForSite(contentSources, site);
    if (!contentSource) {
      return null;
    }

    await ContentAIClient.persistContentSourceName(site, contentSource.name);
    return contentSource.name;
  }

  /**
    * Creates and persists an acquisition content source for a site.
   * @param {Object} site - The site object
    * @returns {Promise<string>} The persisted source name
   */
  async createAcquisitionContentSource(site) {
    const existingName = await this.resolveContentSourceName(site);
    if (existingName) {
      this.log?.info(`Content AI source already exists for site ${site.getBaseURL()}`);
      return existingName;
    }

    const baseUrl = site.getConfig()?.getFetchConfig()?.overrideBaseURL || site.getBaseURL();
    const name = new URL(baseUrl).hostname.replace(/^www\./, '');
    const requestBody = {
      name,
      description: `Content acquired from ${baseUrl}`,
      acquisitionConfig: {
        baseUrl,
        discovery: {
          includePdfs: true,
        },
        schedule: {
          cronSchedule: calculateWeeklyCronSchedule(),
          enabled: true,
        },
      },
    };

    const response = await fetch(`${this.env.CONTENTAI_ENDPOINT}/content-sources/acquisition`, {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: this.getHeaders(),
    });

    if (response.status === 409) {
      const contentSources = await this.listAcquisitionContentSources();
      const contentSource = findContentSourceForSite(contentSources, site);
      if (contentSource) {
        await ContentAIClient.persistContentSourceName(site, contentSource.name);
        return contentSource.name;
      }
    }

    const contentSource = await parseResponse(
      response,
      `Failed to enable Content AI for site ${site.getId()}`,
    );
    if (!contentSource?.name) {
      throw new Error(`Content AI source response did not include a name for site ${site.getId()}`);
    }

    await ContentAIClient.persistContentSourceName(site, contentSource.name);
    this.log?.info(`Content AI source ${contentSource.name} created for site ${baseUrl}`);
    return contentSource.name;
  }

  async searchContentSource(name, text, options = {}, pageLimit = 1) {
    const requestBody = {
      contentSource: {
        name,
        type: 'ACQUISITION',
      },
      query: {
        type: 'vector',
        text,
        options,
      },
      queryOptions: {
        pagination: {
          limit: pageLimit,
        },
      },
    };

    const response = await fetch(`${this.env.CONTENTAI_ENDPOINT}/content-sources/search`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
    });

    return parseResponse(response, `Content AI search failed for source ${name}`);
  }
}
