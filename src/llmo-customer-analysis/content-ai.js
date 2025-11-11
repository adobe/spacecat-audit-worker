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

async function getAccessToken(tokenEndpoint, clientId, clientSecret) {
  const formParams = new URLSearchParams();
  formParams.append('grant_type', 'client_credentials');
  formParams.append('client_id', clientId);
  formParams.append('client_secret', clientSecret);
  formParams.append('scope', 'openid,AdobeID,aem.contentai');

  const accessTokenRes = await fetch(tokenEndpoint, {
    method: 'POST',
    body: formParams,
  });
  if (!accessTokenRes.ok) {
    throw new Error(`Failed to get access token from ContentAI: ${accessTokenRes.status} ${accessTokenRes.statusText}`);
  }
  const accessTokenJson = await accessTokenRes.json();
  return {
    accessToken: accessTokenJson.access_token,
    tokenType: accessTokenJson.token_type,
  };
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
  const { env } = context;

  const { accessToken, tokenType } = await getAccessToken(
    env.CONTENTAI_TOKEN_ENDPOINT,
    env.CONTENTAI_CLIENT_ID,
    env.CONTENTAI_CLIENT_SECRET,
  );

  const configurations = await getConfigurations(env.CONTENTAI_ENDPOINT, tokenType, accessToken);

  const existingConf = configurations.find(
    (conf) => conf.steps?.find((step) => step.baseUrl === site.getBaseURL()),
  );

  if (existingConf) {
    return;
  }

  // Calculate cron schedule: weekly on current day, one hour from now (rounded to next hour)
  const now = new Date();
  const timestamp = now.getTime();
  const nextHour = (now.getHours() + 1) % 24;
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const cronSchedule = `0 ${nextHour} * * ${dayOfWeek}`;

  const contentAiData = {
    steps: [
      {
        type: 'index',
        name: `${site.getBaseURL().replace(/https?:\/\//, '')}-generative`,
      },
      {
        type: 'discovery',
        sourceId: `${site.getBaseURL().replace(/https?:\/\//, '')}-generative-${timestamp}`,
        baseUrl: site.getBaseURL(),
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

  const contentAIResponse = await fetch(env.CONTENTAI_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(contentAiData),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${tokenType} ${accessToken}`,
    },
  });

  if (!contentAIResponse.ok) {
    throw new Error(`Failed to enable content AI for site ${site.getId()}: ${contentAIResponse.status} ${contentAIResponse.statusText}`);
  }
}
