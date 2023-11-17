/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { createUrl, Response } from '@adobe/fetch';
import { fetch } from '../support/utils.js';

export const DEFAULT_PARAMS = {
  interval: 7,
  offset: 0,
  limit: 100,
};

// weekly pageview threshold to eliminate urls with lack of samples
const PAGEVIEW_THRESHOLD = 7000;

export async function getRUMUrl(url) {
  const urlWithScheme = url.startsWith('http') ? url : `https://${url}`;
  const resp = await fetch(urlWithScheme);
  return resp.url.split('://')[1];
}

const DOMAIN_LIST_URL = 'https://helix-pages.anywhere.run/helix-services/run-query@v3/rum-dashboard';

export default async function auditCWV(message, context) {
  const { type, url, auditContext } = message;
  const { log, sqs } = context;
  const { AUDIT_JOBS_QUEUE_URL: queueUrl } = context.env;

  log.info(`Received audit req for domain: ${url}`);

  const finalUrl = await getRUMUrl(url);

  const params = {
    ...DEFAULT_PARAMS,
    domainkey: context.env.RUM_DOMAIN_KEY,
    url: finalUrl,
  };

  const resp = await fetch(createUrl(DOMAIN_LIST_URL, params));
  const respJson = await resp.json();

  const auditResult = respJson?.results?.data
    .filter((row) => row.pageviews > PAGEVIEW_THRESHOLD)
    .filter((row) => row.url.toLowerCase() !== 'other')
    .map((row) => ({
      url: row.url,
      pageviews: row.pageviews,
      avglcp: row.avglcp,
    }));

  await sqs.sendMessage(queueUrl, {
    type,
    url,
    auditContext,
    auditResult,
  });

  log.info(`Successfully audited ${url} for ${type} type audit`);

  return new Response('');
}
