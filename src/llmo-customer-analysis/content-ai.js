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

async function getAccessToken(context) {
  const imsClient = ImsClient.createFrom({
    ...context,
    env: {
      ...context.env,
      IMS_HOST: context.env.CONTENTAI_IMS_HOST,
      IMS_CLIENT_ID: context.env.CONTENTAI_CLIENT_ID,
      IMS_CLIENT_SECRET: context.env.CONTENTAI_CLIENT_SECRET,
      IMS_SCOPE: context.env.CONTENTAI_CLIENT_SCOPE,
    },
  });
  return imsClient.getServiceAccessTokenV3();
}

async function getConfigurations(endpoint, tokenType, accessToken) {
  let allItems = [];
  let cursor = null;

  do {
    const url = cursor
      ? `${endpoint}/configurations?cursor=${cursor}`
      : `${endpoint}/configurations`;

    // eslint-disable-next-line no-await-in-loop
    const configurationsResponse = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${tokenType} ${accessToken}`,
      },
    });

    if (!configurationsResponse.ok) {
      throw new Error(`Failed to get configurations from ContentAI: ${configurationsResponse.status} ${configurationsResponse.statusText}`);
    }

    // eslint-disable-next-line no-await-in-loop
    const configurationsJson = await configurationsResponse.json();
    if (configurationsJson.items) {
      allItems = allItems.concat(configurationsJson.items);
    }
    cursor = configurationsJson.cursor;
  } while (cursor);

  return allItems;
}

export async function enableContentAI(site, context) {
  const { env, log } = context;

  const tokenResponse = await getAccessToken(context);
  const configurations = await getConfigurations(
    env.CONTENTAI_ENDPOINT,
    tokenResponse.token_type,
    tokenResponse.access_token,
  );

  const overrideBaseURL = site.getConfig()?.getFetchConfig()?.overrideBaseURL;
  const baseURL = site.getBaseURL();

  const existingConf = configurations.find(
    (conf) => conf.steps?.find(
      (step) => step.baseUrl === baseURL || (!!overrideBaseURL && step.baseUrl === overrideBaseURL),
    ),
  );

  if (existingConf) {
    log.info(`ContentAI configuration already exists for site ${baseURL}`);
    return;
  }

  const timestamp = Date.now();
  const cronSchedule = calculateWeeklyCronSchedule();
  const name = `${baseURL.replace(/https?:\/\//, '')}-generative`;

  log.info(`Creating ContentAI configuration for site ${baseURL} with cron schedule ${cronSchedule} and name ${name}`);

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

  const contentAIResponse = await fetch(`${env.CONTENTAI_ENDPOINT}/configurations`, {
    method: 'POST',
    body: JSON.stringify(contentAiData),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${tokenResponse.token_type} ${tokenResponse.access_token}`,
    },
  });

  if (!contentAIResponse.ok) {
    throw new Error(`Failed to enable content AI for site ${site.getId()}: ${contentAIResponse.status} ${contentAIResponse.statusText}`);
  }
  log.info(`ContentAI configuration created for site ${baseURL}`);
}
