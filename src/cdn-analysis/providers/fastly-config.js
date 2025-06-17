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

/* c8 ignore start */
export const config = {
  cdnType: 'fastly',
  userAgentField: 'request_user_agent',
  defaultFilterClause: "(response_content_type LIKE 'text/html%' OR url LIKE '%robots%' OR url LIKE '%sitemap%')",
  rawLogsSchema: {
    timestamp: 'string',
    geo_country: 'string',
    host: 'string',
    url: 'string',
    request_method: 'string',
    request_protocol: 'string',
    request_user_agent: 'string',
    response_state: 'string',
    response_status: 'int',
    response_reason: 'string',
    request_referer: 'string',
    response_content_type: 'string',
  },
  tableProperties: {
    serdeLibrary: 'org.apache.hive.hcatalog.data.JsonSerDe',
    storageFormat: 'ROW FORMAT SERDE',
  },
};

export const mappingExpressions = {
  url: 'url',
  user_agent: 'request_user_agent',
  status: 'response_status',
  referer: 'request_referer',
};

/* c8 ignore stop */
