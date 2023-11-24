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
  limit: 101,
};

const DOMAIN_LIST_URL = 'https://helix-pages.anywhere.run/helix-services/run-query@v3/rum-dashboard';

// weekly pageview threshold to eliminate urls with lack of samples
const PAGEVIEW_THRESHOLD = 7000;

/**
 * url param in run-query@v3/rum-dashboard works in a 'startsWith' fashion. url=domain.com returns
 * an empty result whereas url=www.domain.com/ returns the desired result. To catch the redirects
 * to subdomains we issue a GET call to the domain, then use the final url after redirects
 * @param url
 * @returns finalUrl {Promise<string>}
 */
export async function getRUMUrl(url) {
  const urlWithScheme = url.startsWith('http') ? url : `https://${url}`;
  const resp = await fetch(urlWithScheme);
  const finalUrl = resp.url.split('://')[1];
  return finalUrl.endsWith('/') ? finalUrl.slice(0, -1) : /* c8 ignore next */ finalUrl;
}

function filterRUMData(data) {
  return data.pageviews > PAGEVIEW_THRESHOLD // ignore the pages with low pageviews
    && data.url.toLowerCase() !== 'other'; // ignore the combined result
}

function processRUMResponse(respJson) {
  return respJson?.results?.data
    .filter(filterRUMData)
    .map((row) => ({
      url: row.url,
      pageviews: row.pageviews,
      avgcls: row.avgcls,
      avginp: row.avginp,
      avglcp: row.avglcp,
    }));
}
export default async function auditCWV(message, context) {
  const { type, url, auditContext } = message;
  const { log, sqs } = context;
  const {
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
    RUM_DOMAIN_KEY: domainkey,
  } = context.env;

  log.info(`Received audit req for domain: ${url}`);

  const finalUrl = await getRUMUrl(url);
  auditContext.finalUrl = finalUrl;

  const params = {
    ...DEFAULT_PARAMS,
    domainkey,
    url: finalUrl,
  };

  const resp = await fetch(createUrl(DOMAIN_LIST_URL, params));
  const respJson = await resp.json();

  const auditResult = processRUMResponse(respJson);

  await sqs.sendMessage(queueUrl, {
    type,
    url,
    auditContext,
    auditResult,
  });

  log.info(`Successfully audited ${url} for ${type} type audit`);

  return new Response('');
}
