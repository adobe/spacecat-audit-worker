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

import { internalServerError, noContent } from '@adobe/spacecat-shared-http-utils';
import { fetch } from '../support/utils.js';

export default async function auditBrokenBacklinks(message, context) {
  const { type, url, auditContext } = message;
  const { log, sqs } = context;
  const {
    BACKLINK_AUDIT_API_URL: auditAPIUrl,
    BACKLINK_AUDIT_TOKEN: auditToken,
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
  } = context.env;

  try {
    log.info(`Received Backlink audit request for domain: ${url}`);

    const filter = {
      and: [
        { field: 'is_dofollow', is: ['eq', 1] },
        { field: 'is_content', is: ['eq', 1] },
        { field: 'domain_rating_source', is: ['gte', 29.5] },
        { field: 'traffic_domain', is: ['gte', 500] },
        { field: 'links_external', is: ['lte', 300] },
      ],
    };

    const queryParams = {
      select: [
        'title', 'url_from', 'languages', 'domain_rating_source',
        'url_rating_source', 'traffic_domain', 'refdomains_source',
        'linked_domains_source_page', 'links_external', 'traffic',
        'positions', 'name_target', 'http_code_target', 'snippet_left',
        'anchor', 'snippet_right', 'link_type', 'is_content', 'is_dofollow',
        'is_ugc', 'is_sponsored', 'link_group_count',
      ].join(','),
      ahrefs_rank_source: '',
      limit: 50,
      mode: 'prefix',
      order_by: 'traffic_domain:desc',
      target: url,
      output: 'json',
      where: JSON.stringify(filter),
    };

    const queryString = Object.keys(queryParams)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
      .join('&');

    const response = await fetch(`${auditAPIUrl}?${queryString}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditToken}`,
      },
    });

    const data = await response.json();

    const auditResult = {
      broken_backlinks: data.backlinks,
    };

    await sqs.sendMessage(queueUrl, {
      type,
      url,
      auditContext,
      auditResult,
    });

    log.info(`Successfully audited backlinks for ${url}`);
    return noContent();
  } catch (e) {
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
