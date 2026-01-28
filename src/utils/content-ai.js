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

  /**
   * Gets all Content AI configurations
   * @returns {Promise<Array>} Array of configuration objects
   */
  async getConfigurations() {
    let allItems = [];
    let cursor = null;

    do {
      const url = cursor
        ? `${this.env.CONTENTAI_ENDPOINT}/configurations?cursor=${cursor}`
        : `${this.env.CONTENTAI_ENDPOINT}/configurations`;

      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get configurations from ContentAI: ${response.status} ${response.statusText}`);
      }

      // eslint-disable-next-line no-await-in-loop
      const json = await response.json();
      if (json.items) {
        allItems = allItems.concat(json.items);
      }
      cursor = json.cursor;
    } while (cursor);

    return allItems;
  }

  /**
   * Runs a semantic search query against Content AI
   * @param {string} text - The search query text
   * @param {string} type - The query type (e.g., 'vector')
   * @param {string} indexName - The index name to search
   * @param {Object} options - Optional search parameters
   * @param {number} options.limit - Number of results to return (default: 1)
   * @param {number} options.numCandidates - Number of candidates for vector search (default: 3)
   * @param {number} options.boost - Boost factor for the query (default: 1)
   * @param {string} options.vectorSpace - Vector space selection (default: 'semantic')
   * @param {string} options.lexicalSpace - Lexical space selection (default: 'fulltext')
   * @returns {Promise<Response>} The fetch response object
   */
  async runSemanticSearch(text, type, indexName, options = {}, pageLimit = 1) {
    const requestBody = {
      searchIndexConfig: {
        indexes: [
          {
            name: indexName,
          },
        ],
      },
      query: {
        type,
        text,
        options,
      },
      queryOptions: {
        pagination: {
          limit: pageLimit,
        },
      },
    };

    const searchResponse = await fetch(`${this.env.CONTENTAI_ENDPOINT}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(requestBody),
    });

    return searchResponse;
  }

  /**
   * Runs a generative search query against Content AI
   * @param {string} prompt - The prompt to search
   * @param {Object} site - The site object
   * @returns {Promise<Response>} The fetch response object
   */
  async runGenerativeSearch(prompt, site) {
    const configuration = await this.getConfigurationForSite(site);
    if (!configuration) {
      throw new Error('ContentAI configuration not found');
    }
    const { uid: integratorId } = configuration;
    const requestBody = {
      query: prompt,
      integratorId,
    };

    const searchResponse = await fetch(`${this.env.CONTENTAI_ENDPOINT}/gensearch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(requestBody),
    });

    return searchResponse;
  }

  /**
   * Gets the Content AI configuration for a site
   * @param {Object} site - The site object
   * @returns {Promise<Object|null>} The configuration object or null if not found
   */
  async getConfigurationForSite(site) {
    const configurations = await this.getConfigurations();

    const overrideBaseURL = site.getConfig()?.getFetchConfig()?.overrideBaseURL;
    const baseURL = site.getBaseURL();

    const existingConf = configurations.find(
      (conf) => conf.steps?.find(
        (step) => step.baseUrl === baseURL
          || (!!overrideBaseURL && step.baseUrl === overrideBaseURL),
      ),
    );

    return existingConf || null;
  }

  /**
   * Creates a Content AI configuration for a site
   * @param {Object} site - The site object
   * @returns {Promise<void>}
   */
  async createConfiguration(site) {
    const configurations = await this.getConfigurations();

    const overrideBaseURL = site.getConfig()?.getFetchConfig()?.overrideBaseURL;
    const baseURL = site.getBaseURL();

    const existingConf = configurations.find(
      (conf) => conf.steps?.find(
        (step) => step.baseUrl === baseURL
          || (!!overrideBaseURL && step.baseUrl === overrideBaseURL),
      ),
    );

    if (existingConf) {
      this.log?.info(`ContentAI configuration already exists for site ${baseURL}`);
      return;
    }

    const timestamp = Date.now();
    const cronSchedule = calculateWeeklyCronSchedule();
    const name = `${baseURL.replace(/https?:\/\//, '')}-generative`;

    this.log?.info(`Creating ContentAI configuration for site ${baseURL} with cron schedule ${cronSchedule} and name ${name}`);

    const contentAiData = {
      steps: [
        {
          type: 'index',
          name,
        },
        {
          type: 'discovery',
          sourceId: `${name}-${timestamp}`,
          baseUrl: baseURL,
          discoveryProperties: {
            type: 'website',
            includePdfs: true,
          },
          schedule: {
            cronSchedule,
            enabled: true,
          },
        },
        {
          type: 'generative',
          name: 'Comprehensive Q&A assitant',
          description: 'AI assistant for answering any user question about a topic in the indexed knowledge',
          prompts: {
            system: 'You are a helpful AI Assistant powering the search experience.\nYou will answer questions using the provided context.\nContext: {context}\n',
            user: 'Please answer the following question: {question}\n',
          },
        },
      ],
    };

    const response = await fetch(`${this.env.CONTENTAI_ENDPOINT}/configurations`, {
      method: 'POST',
      body: JSON.stringify(contentAiData),
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to enable content AI for site ${site.getId()}: ${response.status} ${response.statusText}`);
    }
    this.log?.info(`ContentAI configuration created for site ${baseURL}`);
  }
}
